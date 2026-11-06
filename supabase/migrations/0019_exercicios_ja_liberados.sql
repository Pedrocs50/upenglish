-- Exercício adicionado ao curso já aparece para o aluno, sem a etapa de liberar turma por turma.
-- Rodar no Supabase: SQL Editor -> colar este arquivo -> Run (depois do 0018).
--
-- 1. Entrou no curso: fica liberado em todas as turmas do curso (e os alunos recebem um aviso só por comando).
-- 2. Turma nova: já nasce com os exercícios que o curso tem.
-- 3. Rascunho no curso: continua escondido (pode estar incompleto) e o aviso sai quando ele for publicado.
--
-- A professora ainda pode recolher um exercício numa turma: o recolhido só volta se ela liberar de novo.
-- O que já estava no curso antes desta migração não muda: pode ter sido segurado de propósito ("Liberar todos" resolve).

-- ---------------------------------------------------------------------------
-- 1. Exercício novo no curso
-- ---------------------------------------------------------------------------
-- security definer: a professora coloca o exercício no curso, mas pode não gerenciar todas as turmas dele.
create function public.liberar_exercicios_novos_do_curso()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.curso_listas_liberadas (turma_id, lista_id)
  select t.id, n.lista_id
  from novas n join public.turmas t on t.curso_id = n.curso_id
  on conflict do nothing;
  return null;
end;
$$;
revoke execute on function public.liberar_exercicios_novos_do_curso() from public, anon, authenticated;
create trigger liberar_exercicios_novos_do_curso after insert on public.curso_listas
  referencing new table as novas
  for each statement execute function public.liberar_exercicios_novos_do_curso();

-- ---------------------------------------------------------------------------
-- 2. Turma nova
-- ---------------------------------------------------------------------------
create function public.liberar_exercicios_na_turma_nova()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.curso_listas_liberadas (turma_id, lista_id)
  select new.id, cl.lista_id
  from public.curso_listas cl
  where cl.curso_id = new.curso_id
  on conflict do nothing;
  return null;
end;
$$;
revoke execute on function public.liberar_exercicios_na_turma_nova() from public, anon, authenticated;
create trigger liberar_exercicios_na_turma_nova after insert on public.turmas
  for each row execute function public.liberar_exercicios_na_turma_nova();

-- ---------------------------------------------------------------------------
-- 3. Aviso quando um rascunho já liberado é publicado
-- ---------------------------------------------------------------------------
-- Antes o aviso saía ao liberar, depois de publicar. Agora a liberação vem primeiro, então o aviso precisa sair aqui.
-- Um por aluno, mesmo que ele esteja em duas turmas do mesmo curso.
create function public.notificar_exercicio_publicado()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  m record;
begin
  for m in
    select distinct on (ma.aluno_id) ma.aluno_id, ma.turma_id
    from public.curso_listas_liberadas lib
    join public.turmas t on t.id = lib.turma_id
    join public.curso_listas cl on cl.curso_id = t.curso_id and cl.lista_id = lib.lista_id
    join public.matriculas ma on ma.turma_id = lib.turma_id and ma.situacao = 'aprovada'
    where lib.lista_id = new.id
    order by ma.aluno_id, ma.turma_id
  loop
    perform public.notificar(m.aluno_id, 'exercicio_liberado', 'Exercício novo: ' || new.titulo,
      'A professora publicou um exercício do curso para a turma.', '/praticar/' || new.id || '?turma=' || m.turma_id);
  end loop;
  return null;
end;
$$;
revoke execute on function public.notificar_exercicio_publicado() from public, anon, authenticated;
create trigger notificar_exercicio_publicado after update of status on public.listas
  for each row when (old.status = 'rascunho' and new.status = 'publicada')
  execute function public.notificar_exercicio_publicado();
