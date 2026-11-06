// Testes do banco: roda todas as migrações num Postgres local (PGlite) com o "auth" e o "storage" do Supabase
// simulados, e confere as regras de acesso e a correção das listas.
//
// Uso (na pasta plataforma):  npm run test:banco
// Sai com código 1 se alguma verificação falhar (o GitHub Actions usa isso).
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PASTA_MIGRACOES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../supabase/migrations");
const ADMIN = "00000000-0000-0000-0000-00000000000a";
const PROFESSOR = "00000000-0000-0000-0000-0000000000c1";
const ALUNO = "00000000-0000-0000-0000-0000000000b1";
const OUTRO_ALUNO = "00000000-0000-0000-0000-0000000000b2";

const db = new PGlite();
let falhas = 0;

function conferir(condicao, descricao) {
  console.log(`${condicao ? "  ✓" : "  ✗"} ${descricao}`);
  if (!condicao) falhas += 1;
}

/** Roda o SQL como se fosse o usuário `uid` logado pela API (papel "authenticated"). */
async function como(uid, sql, parametros) {
  await db.exec(`set role authenticated; select set_config('teste.uid', '${uid}', false);`);
  try {
    return await db.query(sql, parametros);
  } finally {
    await db.exec("reset role; select set_config('teste.uid', '', false);");
  }
}

async function falhaComo(uid, sql, parametros) {
  try {
    await como(uid, sql, parametros);
    return false;
  } catch {
    return true;
  }
}

/** Tenta a alteração e diz se ela foi barrada: com erro, ou ignorada pelas regras de acesso (0 linhas). */
async function barrado(uid, sql, conferirDepois) {
  if (await falhaComo(uid, sql)) return true;
  return conferirDepois();
}

async function numero(uid, sql, parametros) {
  const { rows } = await como(uid, sql, parametros);
  return Number(Object.values(rows[0])[0]);
}

// ----------------------------------------------------------------------------- ambiente
await db.exec(`
  create role anon; create role authenticated;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('teste.uid', true), '')::uuid $$;
  grant usage on schema auth to authenticated;
  grant execute on function auth.uid() to authenticated;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  grant usage on schema storage to authenticated;
  grant select, insert, update, delete on storage.objects to authenticated;
`);

console.log("Migrações");
for (const arquivo of fs.readdirSync(PASTA_MIGRACOES).filter((a) => a.endsWith(".sql")).sort()) {
  await db.exec(fs.readFileSync(path.join(PASTA_MIGRACOES, arquivo), "utf8"));
  console.log(`  ✓ ${arquivo}`);
}

await db.exec(`
  insert into auth.users (id, email, raw_user_meta_data) values
    ('${ADMIN}', 'admin@teste', '{"nome":"Admin"}'),
    ('${PROFESSOR}', 'prof@teste', '{"nome":"Professora"}'),
    ('${ALUNO}', 'aluno@teste', '{"nome":"Aluno"}'),
    ('${OUTRO_ALUNO}', 'outro@teste', '{"nome":"Outro aluno"}');
  update public.perfis set papel = 'admin' where id = '${ADMIN}';
  update public.perfis set papel = 'professor' where id = '${PROFESSOR}';
`);

// ----------------------------------------------------------------------------- perfis e papéis
console.log("Perfis e papéis");
conferir((await numero(ALUNO, "select count(*) from public.perfis")) === 1, "aluno só vê o próprio perfil");
conferir((await numero(ADMIN, "select count(*) from public.perfis")) === 4, "admin vê todos os perfis");
conferir(await falhaComo(ALUNO, `update public.perfis set papel = 'admin' where id = '${ALUNO}'`), "aluno não se promove");
conferir(await falhaComo(ADMIN, `update public.perfis set papel = 'aluno' where id = '${ADMIN}'`), "admin não muda o próprio papel");

// ----------------------------------------------------------------------------- listas e correção
console.log("Listas e correção");
const lista = {
  titulo: "Teste", idioma: "espanhol", nivel: 1, status: "publicada",
  secoes: [{
    id: "11111111-1111-1111-1111-111111111111", titulo: "S1", tipo_estimulo: "nenhum", estimulo: {},
    questoes: [
      { id: "a0000000-0000-0000-0000-000000000001", formato: "multipla_escolha", enunciado: "MC", conteudo: { opcoes: ["x", "y", "z"] }, gabarito: { correta: 1 }, explicacao: "porque y" },
      { id: "a0000000-0000-0000-0000-000000000002", formato: "verdadeiro_falso", enunciado: "VF", gabarito: { valor: false } },
      { id: "a0000000-0000-0000-0000-000000000003", formato: "lacuna", enunciado: "___ coche, ___ casa", gabarito: { lacunas: [["Éste", "Este"], ["esa"]] } },
      { id: "a0000000-0000-0000-0000-000000000004", formato: "lacuna_opcoes", enunciado: "Ana ___ Isabel", conteudo: { opcoes: [["y", "e"]] }, gabarito: { lacunas: [1] } },
      { id: "a0000000-0000-0000-0000-000000000005", formato: "resposta_curta", enunciado: "851", gabarito: { aceitas: ["eight hundred and fifty-one", "eight hundred fifty-one"] } },
      { id: "a0000000-0000-0000-0000-000000000006", formato: "completar_letras", enunciado: "Co_bustible", gabarito: { lacunas: [["m"]] } },
    ],
  }],
};
const { rows: [{ salvar_lista: idLista }] } = await como(PROFESSOR, "select public.salvar_lista($1::jsonb)", [JSON.stringify(lista)]);
conferir(!!idLista, "professora salva lista");
conferir(await falhaComo(ALUNO, "select public.salvar_lista($1::jsonb)", [JSON.stringify(lista)]), "aluno não salva lista");
conferir((await numero(ALUNO, "select count(*) from public.gabaritos")) === 0, "aluno não lê gabaritos");

// ----------------------------------------------------------------------------- turmas: entrada com aprovação
console.log("Turmas: entrada com aprovação");
conferir((await numero(ALUNO, "select count(*) from public.listas")) === 0, "aluno sem turma não vê listas publicadas");
const { rows: [{ id: idCursoBase }] } = await como(PROFESSOR, "insert into public.cursos (titulo, idioma, nivel) values ('Espanhol Básico', 'espanhol', 1) returning id");
await como(PROFESSOR, "insert into public.turmas (nome, curso_id) values ('Turma Base', $1)", [idCursoBase]);
const { rows: [{ id: idTurmaBase, codigo: codigoBase }] } = await como(PROFESSOR, "select id, codigo from public.turmas where curso_id = $1", [idCursoBase]);
await como(PROFESSOR, "insert into public.turma_listas (turma_id, lista_id) values ($1, $2)", [idTurmaBase, idLista]);
await db.exec("set role anon");
const { rows: [{ conferir_codigo_turma: infoCodigo }] } = await db.query("select public.conferir_codigo_turma($1)", [` ${codigoBase.toLowerCase()} `]);
await db.exec("reset role");
conferir(infoCodigo?.turma === "Turma Base" && infoCodigo.curso === "Espanhol Básico", "cadastro confere o código (sem login) antes de criar a conta");
await como(ALUNO, "select public.entrar_na_turma($1)", [codigoBase]);
conferir((await numero(ALUNO, "select count(*) from public.turmas")) === 1, "aluno pendente vê o nome da turma");
conferir((await numero(ALUNO, "select count(*) from public.listas")) === 0, "aluno pendente ainda não vê os exercícios");
conferir((await numero(ALUNO, "select count(*) from public.cursos")) === 0, "aluno pendente não vê o curso");
conferir(
  await barrado(ALUNO, `update public.matriculas set situacao = 'aprovada' where aluno_id = '${ALUNO}'`, async () => (await numero(PROFESSOR, "select count(*) from public.matriculas where situacao = 'pendente'")) === 1),
  "aluno não se aprova sozinho",
);
await como(PROFESSOR, "update public.matriculas set situacao = 'aprovada', aprovada_em = now() where turma_id = $1 and aluno_id = $2", [idTurmaBase, ALUNO]);
conferir((await numero(ALUNO, "select count(*) from public.listas")) === 1, "aprovado: aluno vê o exercício avulso da turma");
conferir((await numero(ALUNO, "select count(*) from public.turma_listas")) === 1, "aluno vê os avulsos da própria turma");
conferir((await numero(OUTRO_ALUNO, "select count(*) from public.listas")) === 0, "aluno de fora não vê os exercícios da turma");
conferir(await falhaComo(OUTRO_ALUNO, "select public.enviar_tentativa($1, '{}'::jsonb)", [idLista]), "aluno de fora não envia respostas");
conferir(await falhaComo(ALUNO, "insert into public.turma_listas (turma_id, lista_id) values ($1, $2)", [idTurmaBase, idLista]), "aluno não libera exercícios");
await db.exec(`insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-0000000000b3', 'novo@teste', '{"nome":"Novo","codigo_turma":"${codigoBase.toLowerCase()}"}')`);
conferir((await numero(PROFESSOR, "select count(*) from public.matriculas where situacao = 'pendente' and turma_id = $1", [idTurmaBase])) === 1, "cadastro com código já cria o pedido de entrada");
conferir((await numero(PROFESSOR, "select count(*) from public.perfis where nome = 'Novo'")) === 1, "professora vê o nome de quem pediu para entrar");

const respostas = {
  "a0000000-0000-0000-0000-000000000001": { opcao: 1 },
  "a0000000-0000-0000-0000-000000000002": { valor: false },
  "a0000000-0000-0000-0000-000000000003": { lacunas: ["  este. ", "ESA"] },
  "a0000000-0000-0000-0000-000000000004": { lacunas: [0] },
  "a0000000-0000-0000-0000-000000000005": { texto: "Eight hundred fifty one" },
  "a0000000-0000-0000-0000-000000000006": { lacunas: ["M"] },
};
const { rows: [{ enviar_tentativa: resultado }] } = await como(ALUNO, "select public.enviar_tentativa($1, $2::jsonb)", [idLista, JSON.stringify(respostas)]);
conferir(resultado.acertos === 5 && resultado.total === 6 && Number(resultado.nota) === 83, `correção: 5 de 6, nota 83 (veio ${resultado.acertos}/${resultado.total}, ${resultado.nota})`);
conferir(resultado.questoes["a0000000-0000-0000-0000-000000000004"].fracao === 0, "opção errada na lacuna conta como erro");

lista.id = idLista;
lista.secoes[0].questoes.pop();
await como(PROFESSOR, "select public.salvar_lista($1::jsonb)", [JSON.stringify(lista)]);
conferir((await numero(PROFESSOR, "select count(*) from public.questoes where lista_id = $1", [idLista])) === 5, "remover questão no editor apaga só ela");

await como(PROFESSOR, "update public.listas set status = 'rascunho' where id = $1", [idLista]);
conferir((await numero(ALUNO, "select count(*) from public.listas")) === 0, "rascunho some para o aluno");
await como(PROFESSOR, "update public.listas set status = 'publicada' where id = $1", [idLista]);

// ----------------------------------------------------------------------------- IA: cota e configuração
console.log("Assistente e áudio");
await como(PROFESSOR, "insert into public.geracoes_ia (habilidade, provedor, modelo, ok) values ('gerar_lista','gemini','x', true), ('gerar_lista','gemini','x', false), ('gerar_audio','gemini','tts', true), ('gerar_audio','gemini','tts', true)");
conferir((await numero(PROFESSOR, "select public.geracoes_hoje()")) === 1, "cota de listas conta só as que deram certo");
conferir((await numero(PROFESSOR, "select public.geracoes_hoje('gerar_audio')")) === 2, "cota de áudio é separada");
conferir(await falhaComo(ALUNO, "insert into public.geracoes_ia (habilidade, provedor, modelo, ok) values ('gerar_lista','gemini','x', true)"), "aluno não registra geração");
conferir((await numero(ALUNO, "select count(*) from public.config_ia")) === 0, "aluno não vê a configuração de IA");
conferir(
  await barrado(PROFESSOR, "update public.config_ia set limite_diario = 999", async () => (await numero(ADMIN, "select max(limite_diario) from public.config_ia")) < 999),
  "professora não muda a configuração de IA",
);

await como(PROFESSOR, "insert into storage.objects (bucket_id, name) values ('audios', 'x.mp3')");
conferir((await numero(PROFESSOR, "select count(*) from storage.objects where bucket_id = 'audios'")) === 1, "professora envia e lê áudios");
conferir(await falhaComo(ALUNO, "insert into storage.objects (bucket_id, name) values ('audios', 'y.mp3')"), "aluno não envia áudio");

// ----------------------------------------------------------------------------- bloqueio
console.log("Bloqueio");
conferir(await falhaComo(ALUNO, `update public.perfis set bloqueado = true where id = '${ALUNO}'`), "aluno não mexe no próprio bloqueio");
conferir(await falhaComo(ADMIN, `update public.perfis set bloqueado = true where id = '${ADMIN}'`), "admin não se bloqueia");
conferir(
  await barrado(PROFESSOR, `update public.perfis set bloqueado = true where id = '${ALUNO}'`, async () => (await numero(ADMIN, "select count(*) from public.perfis where bloqueado")) === 0),
  "professora não bloqueia ninguém",
);
await como(ADMIN, `update public.perfis set bloqueado = true where id in ('${ALUNO}', '${PROFESSOR}')`);
conferir((await numero(ALUNO, "select count(*) from public.listas")) === 0, "aluno bloqueado não vê listas");
conferir(await falhaComo(ALUNO, "select public.enviar_tentativa($1, '{}'::jsonb)", [idLista]), "aluno bloqueado não envia respostas");
conferir((await numero(ALUNO, `select count(*) from public.perfis where bloqueado and id = '${ALUNO}'`)) === 1, "aluno bloqueado ainda lê o próprio perfil");
conferir(await falhaComo(PROFESSOR, "select public.salvar_lista($1::jsonb)", [JSON.stringify(lista)]), "professora bloqueada não salva lista");
await como(ADMIN, `update public.perfis set bloqueado = false where id in ('${ALUNO}', '${PROFESSOR}')`);
conferir((await numero(ALUNO, "select count(*) from public.listas")) === 1, "desbloqueado volta a ver as listas");

// ----------------------------------------------------------------------------- aulas com PDF
console.log("Aulas com PDF");
const { rows: [{ id: idCurso }] } = await como(PROFESSOR, "insert into public.cursos (titulo, idioma, nivel) values ('Inglês Beginner', 'ingles', 1) returning id");
const { rows: [{ id: idAula }] } = await como(PROFESSOR, "insert into public.aulas (curso_id, numero, titulo, material_arquivo, material_nome) values ($1, 1, 'Numbers', 'aula-1.pdf', 'ENGLISH CLASS - NUMBERS.pdf') returning id", [idCurso]);
conferir(!!idAula, "professora cria aula com PDF");
await como(PROFESSOR, "insert into storage.objects (bucket_id, name) values ('materiais', 'aula-1.pdf')");
await como(PROFESSOR, "insert into public.aula_listas (aula_id, lista_id) values ($1, $2)", [idAula, idLista]);
conferir((await numero(PROFESSOR, "select count(*) from public.aula_listas")) === 1, "professora liga exercício à aula");
conferir(await falhaComo(ALUNO, "insert into storage.objects (bucket_id, name) values ('materiais', 'pirata.pdf')"), "aluno não envia material");
conferir((await numero(ALUNO, "select count(*) from storage.objects where bucket_id = 'materiais'")) === 0, "aluno sem turma não lê o PDF");
conferir((await numero(ALUNO, "select count(*) from public.aula_listas")) === 0, "aluno sem turma não vê os exercícios da aula");

// Sem "returning": a regra de leitura da turma não enxerga a linha no mesmo comando que a cria (o site também não pede o retorno).
await como(PROFESSOR, "insert into public.turmas (nome, curso_id) values ('Turma A', $1)", [idCurso]);
const { rows: [{ id: idTurma, codigo }] } = await como(PROFESSOR, "select id, codigo from public.turmas where curso_id = $1", [idCurso]);
await como(ALUNO, "select public.entrar_na_turma($1)", [codigo]);
conferir((await numero(ALUNO, "select count(*) from storage.objects where bucket_id = 'materiais'")) === 0, "aula ainda não liberada: PDF continua fechado");
await como(PROFESSOR, "insert into public.aulas_liberadas (turma_id, aula_id) values ($1, $2)", [idTurma, idAula]);
conferir((await numero(ALUNO, "select count(*) from storage.objects where bucket_id = 'materiais'")) === 0, "aula liberada, mas aluno pendente: PDF continua fechado");
await como(PROFESSOR, "update public.matriculas set situacao = 'aprovada' where turma_id = $1", [idTurma]);
conferir((await numero(ALUNO, "select count(*) from storage.objects where bucket_id = 'materiais'")) === 1, "aula liberada: aluno da turma lê o PDF");
conferir((await numero(ALUNO, "select count(*) from public.aula_listas")) === 1, "aula liberada: aluno vê os exercícios da aula");
conferir((await numero(OUTRO_ALUNO, "select count(*) from storage.objects where bucket_id = 'materiais'")) === 0, "aluno de outra turma não lê o PDF");

// ----------------------------------------------------------------------------- listas de exemplo
console.log("Listas de exemplo");
const SQL_EXEMPLOS = fs.readFileSync(path.resolve(PASTA_MIGRACOES, "../exemplos/listas_de_exemplo.sql"), "utf8");
const SQL_CURSOS_EXEMPLO = fs.readFileSync(path.resolve(PASTA_MIGRACOES, "../exemplos/cursos_de_exemplo.sql"), "utf8");
await db.exec(SQL_EXEMPLOS);
await db.exec(SQL_CURSOS_EXEMPLO);
await db.exec(SQL_EXEMPLOS); // rodar de novo recria, sem duplicar
await db.exec(SQL_CURSOS_EXEMPLO);
conferir((await numero(ADMIN, "select count(*) from public.listas where origem = 'exemplo' and status = 'publicada'")) === 25, "25 listas de exemplo publicadas");
conferir((await numero(ADMIN, "select count(*) from public.turmas where nome like 'Turma de teste%'")) === 3, "3 cursos de exemplo, cada um com a turma de teste");
const { rows: turmasExemplo } = await db.query("select id, codigo from public.turmas where nome like 'Turma de teste%'");
for (const t of turmasExemplo) await como(OUTRO_ALUNO, "select public.entrar_na_turma($1)", [t.codigo]);
await db.query("update public.matriculas set situacao = 'aprovada' where aluno_id = $1", [OUTRO_ALUNO]);
conferir((await numero(OUTRO_ALUNO, "select count(*) from public.listas where origem = 'exemplo'")) === 18, "aluno das turmas de teste vê as aulas liberadas e os avulsos (18 de 25)");
await db.query("insert into public.aulas_liberadas (turma_id, aula_id) select t.id, a.id from public.turmas t join public.aulas a on a.curso_id = t.curso_id where t.nome like 'Turma de teste%' on conflict do nothing");
conferir((await numero(OUTRO_ALUNO, "select count(*) from public.listas where origem = 'exemplo'")) === 25, "liberando todas as aulas, vê as 25");
conferir((await numero(ADMIN, "select count(*) from public.listas where origem = 'exemplo' and criado_por = $1", [ADMIN])) === 25, "exemplos ficam em nome do admin");

// Responde cada lista com o próprio gabarito: tudo precisa dar 100%.
const { rows: exemplos } = await db.query("select id, titulo from public.listas where origem = 'exemplo'");
const erradas = [];
for (const { id, titulo } of exemplos) {
  const { rows: questoes } = await db.query("select q.id, q.formato, g.gabarito from public.questoes q join public.gabaritos g on g.questao_id = q.id where q.lista_id = $1", [id]);
  const respostasCertas = {};
  for (const { id: idQuestao, formato, gabarito } of questoes) {
    respostasCertas[idQuestao] =
      formato === "multipla_escolha" ? { opcao: gabarito.correta }
      : formato === "verdadeiro_falso" ? { valor: gabarito.valor }
      : formato === "resposta_curta" ? { texto: gabarito.aceitas[0] }
      : formato === "lacuna_opcoes" ? { lacunas: gabarito.lacunas }
      : { lacunas: gabarito.lacunas.map((aceitas) => aceitas[0]) };
  }
  const { rows: [{ enviar_tentativa: r }] } = await como(OUTRO_ALUNO, "select public.enviar_tentativa($1, $2::jsonb)", [id, JSON.stringify(respostasCertas)]);
  if (Number(r.nota) !== 100) erradas.push(`${titulo} (${r.nota}%)`);
}
conferir(erradas.length === 0, `gabarito de cada exemplo corrige como 100%${erradas.length ? `: ${erradas.join(", ")}` : ""}`);

// ----------------------------------------------------------------------------- resultados
console.log("Resultados");
// Uma tentativa com erro numa lista de exemplo, para aparecer nas questões mais erradas.
const [{ id: listaErrada }] = exemplos;
const { rows: [primeira] } = await db.query("select q.id, g.gabarito from public.questoes q join public.secoes s on s.id = q.secao_id join public.gabaritos g on g.questao_id = q.id where q.lista_id = $1 and q.formato = 'multipla_escolha' order by s.ordem, q.ordem limit 1", [listaErrada]);
const opcaoErrada = primeira.gabarito.correta === 0 ? 1 : 0;
await como(OUTRO_ALUNO, "select public.enviar_tentativa($1, $2::jsonb)", [listaErrada, JSON.stringify({ [primeira.id]: { opcao: opcaoErrada } })]);

conferir(await falhaComo(OUTRO_ALUNO, "select public.resultados_equipe()"), "aluno não vê os resultados da equipe");
conferir(await falhaComo(OUTRO_ALUNO, "select public.resultados_lista($1)", [listaErrada]), "aluno não vê os resultados de uma lista");
conferir(await falhaComo(PROFESSOR, "select public.conta_no_resultado($1, false)", [ALUNO]), "função auxiliar não é chamada direto");
const { rows: [{ resultados_equipe: geral }] } = await como(PROFESSOR, "select public.resultados_equipe()");
conferir(geral.alunos.some((a) => a.id === OUTRO_ALUNO && a.nome === "Outro aluno"), "professora vê o nome de quem respondeu, mesmo sem turma em comum");
conferir(geral.alunos.every((a) => a.papel === "aluno") && geral.tentativas.every((t) => geral.alunos.some((a) => a.id === t.aluno)), "tentativas da equipe ficam de fora por padrão");
conferir(geral.tentativas.filter((t) => t.aluno === OUTRO_ALUNO).length === 26, "todas as tentativas do aluno entram");
conferir(geral.habilidades.some((h) => h.habilidade === "listening" && Number(h.total) > 0), "acerto por habilidade vem agregado");
const { rows: [{ resultados_equipe: futuro }] } = await como(ADMIN, "select public.resultados_equipe(now() + interval '1 day')");
conferir(futuro.tentativas.length === 0, "filtro de data funciona");
const { rows: [{ resultados_lista: daLista }] } = await como(PROFESSOR, "select public.resultados_lista($1)", [listaErrada]);
const questaoErrada = daLista.questoes.find((q) => q.id === primeira.id);
conferir(Number(questaoErrada.acerto) === 0.5 && Number(questaoErrada.respostas) === 2, "taxa de acerto por questão (1 certa, 1 errada)");
conferir(questaoErrada.erradas.length === 1 && questaoErrada.erradas[0].resposta.opcao === opcaoErrada, "resposta errada mais comum aparece");
conferir(daLista.tentativas.length === 2 && daLista.alunos.length === 1, "tentativas e alunos da lista");

// ----------------------------------------------------------------------------- notificações
console.log("Notificações");
const contar = (uid, tipo) => numero(uid, "select count(*) from public.notificacoes where tipo = $1", [tipo]);
conferir((await contar(PROFESSOR, "pedido_entrada")) >= 2, "professora é avisada dos pedidos para entrar");
conferir((await contar(ALUNO, "entrada_aprovada")) >= 1, "aluno é avisado quando é aprovado");
conferir((await numero(ALUNO, "select count(*) from public.notificacoes where para <> $1", [ALUNO])) === 0, "cada um só vê as próprias notificações");
conferir(await falhaComo(ALUNO, `insert into public.notificacoes (para, tipo, titulo) values ('${PROFESSOR}', 'x', 'falsa')`), "ninguém cria notificação pela API");
conferir(await falhaComo(ALUNO, `select public.notificar('${PROFESSOR}', 'x', 'falsa', '', '')`), "função de notificar não é chamada direto");

const { rows: [{ id: aulaBase1 }] } = await como(PROFESSOR, "insert into public.aulas (curso_id, numero, titulo) values ($1, 1, 'Saludos') returning id", [idCursoBase]);
await como(PROFESSOR, "insert into public.aulas_liberadas (turma_id, aula_id) values ($1, $2)", [idTurmaBase, aulaBase1]);
conferir((await contar(ALUNO, "aula_liberada")) === 1, "aluno aprovado é avisado da aula liberada");
await como(PROFESSOR, "insert into public.turma_listas (turma_id, lista_id) values ($1, $2)", [idTurmaBase, listaErrada]);
conferir((await contar(ALUNO, "extra_liberado")) === 1, "aluno é avisado do exercício extra");

await como(ALUNO, "select public.enviar_tentativa($1, '{}'::jsonb)", [listaErrada]);
conferir((await contar(PROFESSOR, "nota_baixa")) === 1, "professora é avisada da nota baixa");
conferir((await contar(PROFESSOR, "exercicio_feito")) === 0, "\"exercício enviado\" vem desligado por padrão");

await como(ALUNO, `update public.perfis set preferencias_notificacao = '{"aula_liberada": false}' where id = '${ALUNO}'`);
const { rows: [{ id: aulaBase2 }] } = await como(PROFESSOR, "insert into public.aulas (curso_id, numero, titulo) values ($1, 2, 'Números') returning id", [idCursoBase]);
await como(PROFESSOR, "insert into public.aulas_liberadas (turma_id, aula_id) values ($1, $2)", [idTurmaBase, aulaBase2]);
conferir((await contar(ALUNO, "aula_liberada")) === 1, "quem desliga um tipo deixa de receber");

await como(ALUNO, "update public.notificacoes set lida_em = now()");
conferir((await numero(ALUNO, "select count(*) from public.notificacoes where lida_em is null")) === 0, "aluno marca as suas como lidas");
conferir(
  await barrado(ALUNO, "update public.notificacoes set lida_em = now() where para <> auth.uid()", async () => (await numero(PROFESSOR, "select count(*) from public.notificacoes where lida_em is null")) > 0),
  "ninguém marca as notificações dos outros",
);

// ----------------------------------------------------------------------------- fluxo da professora (não admin)
console.log("Fluxo da professora");
const contarNotif = async (uid, tipo) => Number((await db.query("select count(*) as n from public.notificacoes where para = $1 and tipo = $2", [uid, tipo])).rows[0].n);
const { rows: [{ id: cursoProf }] } = await como(PROFESSOR, "insert into public.cursos (titulo, idioma, nivel) values ('Upper-Intermediate', 'ingles', 5) returning id");
conferir(!!cursoProf, "professora cria curso e já recebe o id de volta");
const criada = await como(PROFESSOR, "insert into public.turmas (nome, curso_id) values ('Upper-Intermediate · terça 20h30', $1) returning id, codigo", [cursoProf]).catch(() => null);
conferir(!!criada?.rows?.[0]?.id, "professora cria turma e já recebe o id e o código de volta (permite abrir a turma logo depois)");
const { rows: listadas } = await como(PROFESSOR, "select t.id, c.titulo, (select count(*) from public.matriculas m where m.turma_id = t.id) as alunos from public.turmas t join public.cursos c on c.id = t.curso_id where t.curso_id = $1", [cursoProf]);
conferir(listadas.length === 1, "a turma criada continua aparecendo na lista da professora");
conferir((await numero(PROFESSOR, "select count(*) from public.cursos where id = $1", [cursoProf])) === 1, "o curso criado continua aparecendo");

// Liberar vários de uma vez gera um aviso só por aluno.
const turmaLote = criada?.rows?.[0]?.id;
await como(PROFESSOR, "insert into public.matriculas (turma_id, aluno_id, situacao) select $1, $2, 'aprovada'", [turmaLote, ALUNO]).catch(() => null);
await db.query("insert into public.matriculas (turma_id, aluno_id, situacao) values ($1, $2, 'aprovada') on conflict do nothing", [turmaLote, ALUNO]);
const antesExtras = await contarNotif(ALUNO, "extra_liberado");
await como(PROFESSOR, "insert into public.turma_listas (turma_id, lista_id) select $1, id from public.listas where origem = 'exemplo' and nivel <= 2 and status = 'publicada'", [turmaLote]);
const { rows: [{ n: quantosExtras }] } = await db.query("select count(*) as n from public.turma_listas where turma_id = $1", [turmaLote]);
conferir(Number(quantosExtras) > 1, `liberou ${quantosExtras} exercícios de uma vez`);
conferir((await contarNotif(ALUNO, "extra_liberado")) - antesExtras === 1, "o aluno recebe um aviso só pelos exercícios liberados em lote");
const { rows: [{ titulo: tituloAviso }] } = await db.query("select titulo from public.notificacoes where para = $1 and tipo = 'extra_liberado' order by criada_em desc limit 1", [ALUNO]);
conferir(/exercícios extras novos/.test(tituloAviso), `o aviso diz quantos foram (“${tituloAviso}”)`);

// ----------------------------------------------------------------------------- biblioteca de aulas em PDF
console.log("Biblioteca de aulas");
const { rows: [{ id: materialA }] } = await como(PROFESSOR, "insert into public.materiais (titulo, idioma, arquivo, nome_original, tamanho) values ('Countries and Nationalities', 'ingles', 'biblioteca-a.pdf', 'ENGLISH CLASS - COUNTRIES AND NATIONALITIES.pdf', 2048) returning id");
conferir(!!materialA, "professora adiciona um PDF à biblioteca (nível ainda em branco)");
conferir((await numero(ALUNO, "select count(*) from public.materiais")) === 0, "aluno não vê a biblioteca");
conferir(await falhaComo(ALUNO, "insert into public.materiais (titulo, idioma, arquivo) values ('x', 'ingles', 'y.pdf')"), "aluno não adiciona à biblioteca");
conferir(await falhaComo(PROFESSOR, "insert into public.materiais (titulo, idioma, arquivo) values ('copia', 'ingles', 'biblioteca-a.pdf')"), "o mesmo arquivo não entra duas vezes");
await como(PROFESSOR, "update public.materiais set nivel = 2, titulo = 'Countries & Nationalities' where id = $1", [materialA]);
conferir((await numero(PROFESSOR, "select count(*) from public.materiais where nivel = 2")) === 1, "professora define o nível e ajusta o título");
// Duas aulas de cursos diferentes usam o mesmo PDF.
const { rows: [{ id: cursoBib }] } = await como(PROFESSOR, "insert into public.cursos (titulo, idioma, nivel) values ('Curso da biblioteca', 'ingles', 2) returning id");
await como(PROFESSOR, "insert into public.aulas (curso_id, numero, titulo, material_arquivo, material_nome) values ($1, 1, 'Countries', 'biblioteca-a.pdf', 'Countries.pdf'), ($1, 2, 'Countries de novo', 'biblioteca-a.pdf', 'Countries.pdf')", [cursoBib]);
conferir(await falhaComo(PROFESSOR, "delete from public.materiais where id = $1", [materialA]), "PDF em uso por aulas não pode ser apagado da biblioteca");
const { rows: [{ id: materialB }] } = await como(PROFESSOR, "insert into public.materiais (titulo, idioma, arquivo) values ('Sem uso', 'espanhol', 'biblioteca-b.pdf') returning id");
await como(PROFESSOR, "delete from public.materiais where id = $1", [materialB]);
conferir((await numero(PROFESSOR, "select count(*) from public.materiais where id = $1", [materialB])) === 0, "PDF sem uso pode ser apagado");
await como(PROFESSOR, "insert into storage.objects (bucket_id, name) values ('materiais', 'biblioteca-a.pdf')");
await como(PROFESSOR, "insert into public.turmas (nome, curso_id) values ('Turma da biblioteca', $1)", [cursoBib]);
const { rows: [{ id: turmaBib }] } = await como(PROFESSOR, "select id from public.turmas where curso_id = $1", [cursoBib]);
await db.query("insert into public.matriculas (turma_id, aluno_id, situacao) values ($1, $2, 'aprovada') on conflict do nothing", [turmaBib, OUTRO_ALUNO]);
conferir((await numero(OUTRO_ALUNO, "select count(*) from storage.objects where name = 'biblioteca-a.pdf'")) === 0, "aula não liberada: o PDF da biblioteca continua fechado para o aluno");
await db.query("insert into public.aulas_liberadas (turma_id, aula_id) select $1, id from public.aulas where curso_id = $2 and numero = 2", [turmaBib, cursoBib]);
conferir((await numero(OUTRO_ALUNO, "select count(*) from storage.objects where name = 'biblioteca-a.pdf'")) === 1, "aula liberada: o aluno abre o PDF compartilhado pela aula");

// ----------------------------------------------------------------------------- registro de exclusões
console.log("Registro de exclusões");
const { rows: [{ id: cursoApagado }] } = await como(PROFESSOR, "insert into public.cursos (titulo, idioma, nivel) values ('Curso que será apagado', 'ingles', 1) returning id");
await como(PROFESSOR, "insert into public.aulas (curso_id, numero, titulo) values ($1, 1, 'Aula do curso apagado')", [cursoApagado]);
await como(PROFESSOR, "delete from public.cursos where id = $1", [cursoApagado]);
const { rows: apagados } = await como(ADMIN, "select tabela, linha ->> 'titulo' as titulo, por, via from public.registro_exclusoes where linha ->> 'titulo' like '%apagad%' order by tabela");
conferir(apagados.length === 2 && apagados.some((r) => r.tabela === "cursos" && r.titulo === "Curso que será apagado"), "apagar um curso anota o curso e as aulas que sumiram junto");
conferir(apagados.every((r) => r.por === PROFESSOR), "o registro diz quem apagou");
conferir(apagados.every((r) => r.via === "SQL direto"), "sem o site no meio, o registro diz que foi SQL direto");
conferir((await numero(PROFESSOR, "select count(*) from public.registro_exclusoes")) === 0, "só o admin lê o registro de exclusões");
conferir(await falhaComo(ADMIN, "insert into public.registro_exclusoes (tabela, linha) values ('x', '{}')"), "ninguém escreve no registro pela API");
conferir(await falhaComo(ADMIN, "delete from public.registro_exclusoes"), "ninguém apaga o registro pela API");
await db.exec("select set_config('request.method', 'DELETE', false), set_config('request.path', '/cursos', false)");
const { rows: [{ id: cursoSite }] } = await como(PROFESSOR, "insert into public.cursos (titulo, idioma, nivel) values ('Pelo site apagado', 'ingles', 1) returning id");
await como(PROFESSOR, "delete from public.cursos where id = $1", [cursoSite]);
await db.exec("select set_config('request.method', '', false), set_config('request.path', '', false)");
const { rows: [doSite] } = await como(ADMIN, "select via from public.registro_exclusoes where linha ->> 'titulo' = 'Pelo site apagado'");
conferir(doSite?.via === "DELETE /cursos", "quando vem do site, o registro guarda o pedido (DELETE /cursos)");

// ----------------------------------------------------------------------------- perfil: nome e edição
console.log("Perfil");
await db.exec(`insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000d1', 'google@teste', '{"full_name":"Ana Souza (Google)","avatar_url":"https://x/foto.png"}'),
  ('00000000-0000-0000-0000-0000000000d2', 'ambos@teste', '{"nome":"Nome do cadastro","full_name":"Nome do Google"}'),
  ('00000000-0000-0000-0000-0000000000d3', 'vazio@teste', '{}'),
  ('00000000-0000-0000-0000-0000000000d4', 'espacos@teste', '{"nome":"   ","name":"  Só o name  "}')`);
const nomeDe = async (id) => (await db.query("select nome from public.perfis where id = $1", [id])).rows[0].nome;
conferir((await nomeDe("00000000-0000-0000-0000-0000000000d1")) === "Ana Souza (Google)", "quem entra com Google ganha o nome do Google");
conferir((await nomeDe("00000000-0000-0000-0000-0000000000d2")) === "Nome do cadastro", "o nome do cadastro por e-mail vem primeiro");
conferir((await nomeDe("00000000-0000-0000-0000-0000000000d3")) === "", "sem nome nenhum, o perfil nasce em branco (a pessoa preenche em Meu perfil)");
conferir((await nomeDe("00000000-0000-0000-0000-0000000000d4")) === "Só o name", "nome só com espaços é ignorado e o espaço sobrando é cortado");
await como(ALUNO, `update public.perfis set nome = 'Aluno com nome novo' where id = '${ALUNO}'`);
conferir((await nomeDe(ALUNO)) === "Aluno com nome novo", "a pessoa muda o próprio nome");
conferir(
  await barrado(ALUNO, `update public.perfis set nome = 'Invasor' where id = '${OUTRO_ALUNO}'`, async () => (await nomeDe(OUTRO_ALUNO)) !== "Invasor"),
  "ninguém muda o nome de outra pessoa",
);
conferir(await falhaComo(ALUNO, `update public.perfis set email = 'outro@x' where id = '${ALUNO}'`), "a pessoa não muda o e-mail do perfil");

// ----------------------------------------------------------------------------- aula ao vivo
console.log("Aula ao vivo");
const PENDENTE = "00000000-0000-0000-0000-0000000000b3";
await como(PROFESSOR, `insert into public.turma_encontros (turma_id, link, horarios) values ($1, 'https://meet.google.com/abc-defg-hij', '[{"dia":2,"inicio":"19:00","fim":"20:00"}]')`, [idTurmaBase]);
conferir((await numero(ALUNO, "select count(*) from public.turma_encontros where link like 'https://meet%'")) === 1, "aluno aprovado vê o link da aula");
conferir((await numero(PENDENTE, "select count(*) from public.turma_encontros")) === 0, "quem está com o pedido pendente não vê o link");
conferir((await numero(OUTRO_ALUNO, "select count(*) from public.turma_encontros where turma_id = $1", [idTurmaBase])) === 0, "aluno de outra turma não vê o link");
conferir(
  await barrado(ALUNO, "update public.turma_encontros set link = 'https://golpe.example'", async () => (await numero(PROFESSOR, "select count(*) from public.turma_encontros where link like 'https://meet%'")) === 1),
  "aluno não muda o link",
);
conferir(await falhaComo(PROFESSOR, "update public.turma_encontros set link = 'javascript:alert(1)' where turma_id = $1", [idTurmaBase]), "só aceita link https");
await como(PROFESSOR, "update public.turma_encontros set aviso = 'Hoje às 20h', aviso_ate = current_date where turma_id = $1", [idTurmaBase]);
conferir((await numero(ALUNO, "select count(*) from public.turma_encontros where aviso = 'Hoje às 20h'")) === 1, "aluno vê o aviso do dia");

// Mesmo caminho do site (salvarEncontros): turma sem link cria a linha; turma com link só atualiza.
{
  const { rows: [{ id: cursoMeet }] } = await como(PROFESSOR, "insert into public.cursos (titulo, idioma, nivel) values ('Curso Meet', 'ingles', 1) returning id");
  const { rows: [{ id: turmaMeet }] } = await como(PROFESSOR, "insert into public.turmas (nome, curso_id) values ('Turma Meet', $1) returning id", [cursoMeet]);
  const atualizar = (link) => como(PROFESSOR, "update public.turma_encontros set link = $2, atualizado_em = now() where turma_id = $1 returning turma_id", [turmaMeet, link]);
  conferir((await atualizar("https://meet.google.com/aaa-bbbb-ccc")).rows.length === 0, "turma sem link: a atualização não acha linha (e o site cria)");
  await como(PROFESSOR, "insert into public.turma_encontros (turma_id, link) values ($1, 'https://meet.google.com/aaa-bbbb-ccc')", [turmaMeet]);
  conferir((await atualizar("https://meet.google.com/ddd-eeee-fff")).rows.length === 1, "professora troca o link que já estava salvo");
  conferir(
    await falhaComo(PROFESSOR, "insert into public.turma_encontros (turma_id, link) values ($1, 'https://x.example') on conflict (turma_id) do update set turma_id = excluded.turma_id, link = excluded.link", [turmaMeet]),
    "o upsert do PostgREST continua barrado (por isso o site não pode usá-lo nesta tabela)",
  );
}

// ----------------------------------------------------------------------------- exercícios do curso
console.log("Exercícios do curso");
const novaListaDoCurso = async (titulo, status = "publicada") => {
  const dados = {
    titulo, idioma: "ingles", nivel: 2, status,
    secoes: [{ id: crypto.randomUUID(), titulo: "S1", tipo_estimulo: "nenhum", estimulo: {}, questoes: [{ id: crypto.randomUUID(), formato: "verdadeiro_falso", enunciado: "VF", gabarito: { valor: true } }] }],
  };
  return (await como(PROFESSOR, "select public.salvar_lista($1::jsonb)", [JSON.stringify(dados)])).rows[0].salvar_lista;
};
const [plurais, thereIs, foraDoCurso] = [await novaListaDoCurso("Plurals"), await novaListaDoCurso("There is / there are"), await novaListaDoCurso("Fora do curso")];
const { rows: [{ id: cursoElem }] } = await como(PROFESSOR, "insert into public.cursos (titulo, idioma, nivel) values ('Inglês Elementary', 'ingles', 2) returning id");
const { rows: [{ id: turmaElem }] } = await como(PROFESSOR, "insert into public.turmas (nome, curso_id) values ('Elementary · segunda', $1) returning id", [cursoElem]);
await db.query("insert into public.matriculas (turma_id, aluno_id, situacao) values ($1, $2, 'aprovada')", [turmaElem, OUTRO_ALUNO]);
const veQuantas = (uid) => numero(uid, "select count(*) from public.listas where id = any($1::uuid[])", [[plurais, thereIs, foraDoCurso]]);

// Turma de outra responsável no mesmo curso: também recebe os exercícios, mesmo sem a professora gerenciá-la.
const { rows: [{ id: turmaDaOutra }] } = await como(ADMIN, "insert into public.turmas (nome, curso_id) values ('Elementary · terça', $1) returning id", [cursoElem]);
await db.query("insert into public.matriculas (turma_id, aluno_id, situacao) values ($1, $2, 'aprovada')", [turmaDaOutra, PENDENTE]);

const antesCurso = await contarNotif(OUTRO_ALUNO, "exercicio_liberado");
await como(PROFESSOR, "insert into public.curso_listas (curso_id, lista_id, ordem) values ($1, $2, 0), ($1, $3, 1)", [cursoElem, plurais, thereIs]);
conferir((await numero(PROFESSOR, "select count(*) from public.curso_listas where curso_id = $1", [cursoElem])) === 2, "professora coloca vários exercícios no curso de uma vez");
conferir((await veQuantas(OUTRO_ALUNO)) === 2, "entrou no curso: o aluno da turma já vê, sem aprovação manual");
conferir((await veQuantas(PENDENTE)) === 2, "as outras turmas do curso também recebem");
conferir((await numero(OUTRO_ALUNO, "select count(*) from public.curso_listas where curso_id = $1", [cursoElem])) === 2, "o aluno vê a ordem dos exercícios do curso");
conferir((await contarNotif(OUTRO_ALUNO, "exercicio_liberado")) - antesCurso === 1, "adicionar vários de uma vez gera um aviso só");
conferir((await veQuantas(ALUNO)) === 0, "aluno de outra turma não vê os exercícios do curso");
conferir(await falhaComo(OUTRO_ALUNO, "insert into public.curso_listas (curso_id, lista_id) values ($1, $2)", [cursoElem, foraDoCurso]), "aluno não coloca exercício no curso");
conferir(await falhaComo(OUTRO_ALUNO, "delete from public.curso_listas_liberadas where turma_id = $1", [turmaElem]) || (await veQuantas(OUTRO_ALUNO)) === 2, "aluno não recolhe exercício do curso");
conferir(await falhaComo(PROFESSOR, "insert into public.curso_listas_liberadas (turma_id, lista_id) values ($1, $2)", [turmaElem, foraDoCurso]), "não dá para liberar na turma um exercício que não está no curso dela");

await como(PROFESSOR, "delete from public.curso_listas_liberadas where turma_id = $1 and lista_id = $2", [turmaElem, thereIs]);
conferir((await veQuantas(OUTRO_ALUNO)) === 1, "recolher na turma esconde o exercício de novo");
conferir((await veQuantas(PENDENTE)) === 2, "recolher numa turma não mexe nas outras");
await como(PROFESSOR, "insert into public.curso_listas_liberadas (turma_id, lista_id) values ($1, $2)", [turmaElem, thereIs]);
conferir((await veQuantas(OUTRO_ALUNO)) === 2, "a professora pode liberar de novo o que recolheu");

// Rascunho entra no curso, mas só aparece (e só avisa) quando for publicado.
const rascunho = await novaListaDoCurso("Ainda em rascunho", "rascunho");
const veRascunho = (uid) => numero(uid, "select count(*) from public.listas where id = $1", [rascunho]);
const antesRascunho = await contarNotif(OUTRO_ALUNO, "exercicio_liberado");
await como(PROFESSOR, "insert into public.curso_listas (curso_id, lista_id, ordem) values ($1, $2, 2)", [cursoElem, rascunho]);
conferir((await veRascunho(OUTRO_ALUNO)) === 0, "rascunho no curso: o aluno ainda não vê");
conferir((await contarNotif(OUTRO_ALUNO, "exercicio_liberado")) === antesRascunho, "rascunho no curso: sem aviso ao aluno");
await como(PROFESSOR, "update public.listas set status = 'publicada' where id = $1", [rascunho]);
conferir((await veRascunho(OUTRO_ALUNO)) === 1, "publicou: o aluno já vê, sem outra etapa");
conferir((await contarNotif(OUTRO_ALUNO, "exercicio_liberado")) - antesRascunho === 1, "publicou: o aluno recebe um aviso");
await como(PROFESSOR, "update public.listas set status = 'rascunho' where id = $1", [rascunho]);
await como(PROFESSOR, "update public.listas set status = 'publicada' where id = $1", [rascunho]);

// Turma criada depois já nasce com os exercícios do curso.
const { rows: [{ id: turmaNova }] } = await como(PROFESSOR, "insert into public.turmas (nome, curso_id) values ('Elementary · nova', $1) returning id", [cursoElem]);
conferir((await numero(PROFESSOR, "select count(*) from public.curso_listas_liberadas where turma_id = $1", [turmaNova])) === 3, "turma nova nasce com os exercícios que o curso já tem");

await como(PROFESSOR, "delete from public.curso_listas where curso_id = $1 and lista_id = $2", [cursoElem, plurais]);
conferir((await veQuantas(OUTRO_ALUNO)) === 1, "tirar o exercício do curso também esconde (mesmo já liberado)");

// ----------------------------------------------------------------------------- monitor de erros
console.log("Monitor de erros");
const relatar = (uid, ...valores) => como(uid, "select public.registrar_erro($1, $2, $3, $4, $5, $6)", valores);
const lerErros = async () => (await db.query("select * from public.erros_do_site where origem <> 'teste' order by primeiro_em")).rows;

await relatar(ALUNO, "banco", "POST turma_encontros: permission denied for table turma_encontros", "código 42501", "/turmas/11111111-1111-1111-1111-111111111111", "Firefox", "abc1234");
await relatar(OUTRO_ALUNO, "banco", "POST turma_encontros: permission denied for table turma_encontros", "", "/turmas/22222222-2222-2222-2222-222222222222", "Chrome", "abc1234");
await relatar(ALUNO, "banco", "POST turma_encontros: permission denied for table turma_encontros", "", "/turmas/33333333-3333-3333-3333-333333333333", "Chrome", "abc1234");
let [agrupado, ...sobrando] = await lerErros();
conferir(sobrando.length === 0 && agrupado.ocorrencias === 3, "o mesmo erro em turmas diferentes fica numa linha só");
conferir(agrupado.pessoas.length === 2, "conta cada pessoa uma vez");
conferir(agrupado.detalhe === "código 42501", "repetição sem detalhe não apaga o detalhe que já havia");

// Visitante também relata: a tela de login pode quebrar.
await db.exec("set role anon; select set_config('teste.uid', '', false);");
await db.query("select public.registrar_erro('tela', 'Tela de login quebrou', '', '/entrar', '', '')");
await db.exec("reset role;");
conferir((await lerErros()).some((e) => e.rota === "/entrar" && e.pessoas.length === 0 && e.ultimo_por === null), "visitante sem login consegue relatar");

await relatar(ALUNO, "inventada", "Texto de maria@escola.com com token eyJabc.def.ghi e ?key=segredo123", "AIzaSyA1234567890123456789012345678901234", "/convite/CODIGOSECRETO?x=1#y", "", "");
const sensivel = (await lerErros()).find((e) => e.mensagem.startsWith("Texto de"));
conferir(sensivel.origem === "pagina", "origem desconhecida não entra como veio");
conferir(!/maria@|eyJabc|segredo123/.test(sensivel.mensagem), "tira e-mail, token e chave da mensagem");
conferir(!sensivel.detalhe.includes("AIza"), "tira chave do Google do detalhe");
conferir(sensivel.rota === "/convite/:codigo", "não guarda o código do convite nem os parâmetros do link");

await relatar(ALUNO, "pagina", "x".repeat(9000), "y".repeat(9000), "/", "z".repeat(9000), "v".repeat(900));
const longo = (await lerErros()).find((e) => e.mensagem.startsWith("xxx"));
conferir(longo.mensagem.length === 500 && longo.detalhe.length === 4000 && longo.navegador.length === 200 && longo.versao.length === 40, "corta textos enormes");
await relatar(ALUNO, "pagina", "   ", "", "", "", "");
conferir(!(await lerErros()).some((e) => e.mensagem.trim() === ""), "mensagem vazia não vira erro");

// Quem lê e quem mexe.
const idErro = agrupado.id;
conferir((await numero(ALUNO, "select count(*) from public.erros_do_site")) === 0, "aluno não lê os erros");
conferir((await numero(PROFESSOR, "select count(*) from public.erros_do_site")) === 0, "professor não lê os erros");
conferir((await numero(ADMIN, "select count(*) from public.erros_do_site")) === (await lerErros()).length, "admin lê os erros");
conferir(await falhaComo(ADMIN, "insert into public.erros_do_site (assinatura, origem, mensagem) values ('a', 'tela', 'b')"), "nem o admin grava direto: só pela função");
conferir(await falhaComo(ADMIN, `update public.erros_do_site set mensagem = 'outra' where id = '${idErro}'`), "admin não reescreve a mensagem do erro");
conferir(await barrado(ALUNO, `update public.erros_do_site set resolvido_em = now() where id = '${idErro}'`, async () => (await db.query(`select resolvido_em from public.erros_do_site where id = '${idErro}'`)).rows[0].resolvido_em === null), "aluno não marca como resolvido");
conferir(await barrado(ALUNO, `delete from public.erros_do_site where id = '${idErro}'`, async () => (await db.query(`select 1 from public.erros_do_site where id = '${idErro}'`)).rows.length === 1), "aluno não apaga erros");

// Resolvido que acontece de novo reabre.
await como(ADMIN, `update public.erros_do_site set resolvido_em = now(), voltou = false where id = '${idErro}'`);
await relatar(ALUNO, "banco", "POST turma_encontros: permission denied for table turma_encontros", "", "/turmas/44444444-4444-4444-4444-444444444444", "Chrome", "def5678");
const reaberto = (await lerErros()).find((e) => e.id === idErro);
conferir(reaberto.resolvido_em === null && reaberto.voltou === true && reaberto.versao === "def5678", "erro resolvido que acontece de novo reabre, com a marca de que voltou");

// Limites contra enxurrada (a chave do site é pública).
await db.exec("delete from public.erros_do_site");
await db.exec("insert into public.erros_do_site (assinatura, origem, mensagem) select 'a' || g, 'tela', 'm' from generate_series(1, 200) g");
await relatar(ALUNO, "pagina", "novo durante a enxurrada", "", "/", "", "");
conferir(!(await lerErros()).some((e) => e.mensagem === "novo durante a enxurrada"), "limite de erros novos por hora");
await db.exec("delete from public.erros_do_site");
await db.exec("insert into public.erros_do_site (assinatura, origem, mensagem, primeiro_em, ultimo_em) values ('velho', 'tela', 'parado', now() - interval '91 days', now() - interval '91 days')");
await relatar(ALUNO, "pagina", "erro novo", "", "/", "", "");
conferir((await lerErros()).map((e) => e.mensagem).join() === "erro novo", "erro parado há mais de 90 dias é apagado");

// Verificações do banco.
conferir(await falhaComo(PROFESSOR, "select public.diagnostico_banco(array['perfis'])"), "só o admin roda as verificações");
const { rows: [{ d: diag }] } = await como(ADMIN, "select public.diagnostico_banco(array['perfis', 'enviar_tentativa', 'notificar_exercicio_publicado', 'nao_existe_isso']) as d");
conferir(JSON.stringify(diag.faltando) === '["nao_existe_isso"]', "acha tabela, função e gatilho, e aponta o que falta");
conferir(diag.tabelas_sem_rls.length === 0, `todas as tabelas têm regras de acesso (sem: ${diag.tabelas_sem_rls})`);
conferir(diag.buckets_faltando.length === 0, "os buckets existem");
await db.exec("insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f0', 'sem@perfil')");
await db.exec("delete from public.perfis where id = '00000000-0000-0000-0000-0000000000f0'");
const { rows: [{ d: diag2 }] } = await como(ADMIN, "select public.diagnostico_banco('{}') as d");
conferir(Number(diag2.contas_sem_perfil) === 1, "aponta conta sem perfil");

console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} verificação(ões) falharam.`);
process.exit(falhas === 0 ? 0 : 1);
