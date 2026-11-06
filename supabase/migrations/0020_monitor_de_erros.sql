-- Monitor de erros: o que quebra no navegador de quem usa o site vem parar aqui, agrupado, e só o admin lê.
--
-- O mesmo erro não vira mil linhas: cada tipo de erro tem uma linha, com quantas vezes aconteceu e quantas pessoas pegou.
-- Se um erro marcado como resolvido acontecer de novo, ele reabre sozinho (com a marca "voltou").
--
-- O envio é aberto para visitantes também, porque a tela de login e a de cadastro podem quebrar. Como a chave do site é
-- pública, qualquer um poderia chamar registrar_erro: por isso a função corta os textos, tira dados sensíveis e limita
-- quantos erros novos entram. A tabela não aceita gravação direta pela API.

create table public.erros_do_site (
  id uuid primary key default gen_random_uuid(),
  assinatura text not null unique,
  origem text not null check (origem in ('tela', 'pagina', 'promessa', 'banco', 'arquivos', 'funcao', 'login', 'leitor_pdf', 'teste')),
  mensagem text not null,
  detalhe text not null default '',
  -- Dados da última vez que aconteceu.
  rota text not null default '',
  navegador text not null default '',
  versao text not null default '',
  ultimo_por uuid,
  ocorrencias integer not null default 1,
  -- Quem pegou o erro (até 50 pessoas; só para contar e saber se é geral).
  pessoas uuid[] not null default '{}',
  primeiro_em timestamptz not null default now(),
  ultimo_em timestamptz not null default now(),
  resolvido_em timestamptz,
  voltou boolean not null default false
);
create index erros_do_site_ultimo_em on public.erros_do_site (ultimo_em desc);

alter table public.erros_do_site enable row level security;
create policy "só o admin lê os erros" on public.erros_do_site
  for select to authenticated using (public.meu_papel() = 'admin');
create policy "só o admin marca os erros" on public.erros_do_site
  for update to authenticated using (public.meu_papel() = 'admin') with check (public.meu_papel() = 'admin');
create policy "só o admin apaga os erros" on public.erros_do_site
  for delete to authenticated using (public.meu_papel() = 'admin');
revoke all on public.erros_do_site from anon, authenticated;
grant select, delete on public.erros_do_site to authenticated;
grant update (resolvido_em, voltou) on public.erros_do_site to authenticated;

-- Tira do texto o que não deve ficar guardado: tokens, chaves, senhas em links e e-mails.
create function public.limpar_texto_de_erro(p_texto text, p_maximo integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select left(
    regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
      left(coalesce(p_texto, ''), 20000),
      'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)?', '[token]', 'g'),
      'AIza[0-9A-Za-z_-]{30,}', '[chave]', 'g'),
      '(key|token|apikey|access_token|refresh_token|password|senha)=[^&[:space:]"'']+', '\1=[oculto]', 'gi'),
      'Bearer [A-Za-z0-9._~+/=-]+', 'Bearer [oculto]', 'gi'),
      '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[e-mail]', 'g'),
    p_maximo
  );
$$;
revoke execute on function public.limpar_texto_de_erro(text, integer) from public, anon, authenticated;

-- Recebe um erro do navegador. Quem pegou o erro vem do login, nunca do que o navegador diz.
create function public.registrar_erro(
  p_origem text,
  p_mensagem text,
  p_detalhe text default '',
  p_rota text default '',
  p_navegador text default '',
  p_versao text default ''
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_origem text := case when p_origem in ('tela', 'pagina', 'promessa', 'banco', 'arquivos', 'funcao', 'login', 'leitor_pdf', 'teste') then p_origem else 'pagina' end;
  v_mensagem text := public.limpar_texto_de_erro(p_mensagem, 500);
  v_detalhe text := public.limpar_texto_de_erro(p_detalhe, 4000);
  -- O link fica sem parâmetros, e o código do convite não é guardado.
  v_rota text := regexp_replace(left(split_part(split_part(coalesce(p_rota, ''), '?', 1), '#', 1), 200), '^/convite/.*', '/convite/:codigo');
  v_navegador text := left(coalesce(p_navegador, ''), 200);
  v_versao text := left(coalesce(p_versao, ''), 40);
  v_quem uuid := auth.uid();
  v_assinatura text;
  v_padrao_id constant text := '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
begin
  if trim(v_mensagem) = '' then
    return;
  end if;

  -- Mesmo erro em outra turma, ou em outra publicação do site, conta como o mesmo: ids, números e nomes de arquivo saem da conta.
  v_assinatura := md5(
    v_origem || '|' ||
    regexp_replace(regexp_replace(regexp_replace(lower(v_mensagem), '/assets/[^[:space:]''")]+', '/assets/*', 'g'), v_padrao_id, ':id', 'g'), '[0-9]+', '#', 'g') || '|' ||
    regexp_replace(regexp_replace(lower(v_rota), v_padrao_id, ':id', 'g'), '[0-9]+', '#', 'g')
  );

  update public.erros_do_site
  set ocorrencias = ocorrencias + 1,
      ultimo_em = now(),
      mensagem = v_mensagem,
      detalhe = case when v_detalhe <> '' then v_detalhe else detalhe end,
      rota = v_rota,
      navegador = v_navegador,
      versao = v_versao,
      ultimo_por = coalesce(v_quem, ultimo_por),
      pessoas = case when v_quem is null or v_quem = any (pessoas) or cardinality(pessoas) >= 50 then pessoas else array_append(pessoas, v_quem) end,
      voltou = voltou or resolvido_em is not null,
      resolvido_em = null
  where assinatura = v_assinatura;
  if found then
    return;
  end if;

  -- Erro novo: aproveita para jogar fora o que está parado há mais de 90 dias.
  delete from public.erros_do_site where ultimo_em < now() - interval '90 days';

  -- Limites contra enxurrada: a chave do site é pública, então alguém poderia tentar encher esta tabela.
  if (select count(*) from public.erros_do_site where primeiro_em > now() - interval '1 hour') >= 200
     or (select count(*) from public.erros_do_site) >= 2000 then
    return;
  end if;

  insert into public.erros_do_site (assinatura, origem, mensagem, detalhe, rota, navegador, versao, ultimo_por, pessoas)
  values (v_assinatura, v_origem, v_mensagem, v_detalhe, v_rota, v_navegador, v_versao, v_quem, case when v_quem is null then '{}'::uuid[] else array[v_quem] end)
  on conflict (assinatura) do nothing;
end;
$$;
revoke execute on function public.registrar_erro(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.registrar_erro(text, text, text, text, text, text) to anon, authenticated;

-- Confere o banco para a tela de verificações (só admin; só lê). p_esperados: nomes de tabelas, funções e gatilhos que o
-- site espera encontrar. A lista fica no site (lib/diagnostico.ts) porque é ele que sabe de que precisa.
create function public.diagnostico_banco(p_esperados text[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_resultado jsonb;
begin
  if public.meu_papel() is distinct from 'admin' then
    raise exception 'Só o admin pode rodar as verificações.' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'faltando', coalesce((
      select jsonb_agg(nome order by nome) from unnest(p_esperados) as nome
      where not exists (select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = nome)
        and not exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = nome)
        and not exists (select 1 from pg_catalog.pg_trigger t where t.tgname = nome and not t.tgisinternal)
    ), '[]'::jsonb),
    'tabelas_sem_rls', coalesce((
      select jsonb_agg(c.relname order by c.relname) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
    ), '[]'::jsonb),
    'contas_sem_perfil', (select count(*) from auth.users u where not exists (select 1 from public.perfis p where p.id = u.id)),
    'buckets_faltando', coalesce((
      select jsonb_agg(b order by b) from unnest(array['audios', 'materiais']) as b
      where not exists (select 1 from storage.buckets s where s.id = b)
    ), '[]'::jsonb),
    'ia_24h', (select count(*) from public.geracoes_ia where criado_em > now() - interval '24 hours'),
    'ia_falhas_24h', (select count(*) from public.geracoes_ia where criado_em > now() - interval '24 hours' and not ok),
    'ia_ultima_falha', (select erro from public.geracoes_ia where criado_em > now() - interval '24 hours' and not ok order by criado_em desc limit 1)
  ) into v_resultado;
  return v_resultado;
end;
$$;
revoke execute on function public.diagnostico_banco(text[]) from public, anon, authenticated;
grant execute on function public.diagnostico_banco(text[]) to authenticated;
