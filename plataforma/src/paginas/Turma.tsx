import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import {
  ArrowLeft, BarChart3, BookOpen, Check, ClipboardList, Copy, Eye, FileText, Link2, Lock, Plus, Sparkles, Trash2, Unlock, UserCheck, UserMinus, Users, UserX, Video,
} from "lucide-react";
import { supabase, traduzirErro, type Perfil } from "../lib/supabase";
import { IDIOMAS, nomeNivel, useConsulta, type Aula, type Curso, type Turma as TipoTurma } from "../lib/dados";
import { linkDeConvite, mensagemDeAula, mensagemDeConvite, mensagemDeExercicios, mensagemDeExtras, type SituacaoMatricula } from "../lib/turmas";
import { recontar } from "../lib/notificacoes";
import CopiarTexto from "../componentes/CopiarTexto";
import { quandoFoi } from "../lib/resultados";
import { CabecalhoPagina } from "../componentes/Painel";
import ExerciciosDaAula from "../componentes/ExerciciosDaAula";
import EditorAoVivo from "../componentes/EditorAoVivo";
import { Aviso, Botao, Etiqueta, TextoCarregando } from "../componentes/ui";

type Pessoa = Pick<Perfil, "id" | "nome" | "email">;
type Matricula = { situacao: SituacaoMatricula; criado_em: string; aprovada_em: string | null; perfis: Pessoa | null };
type TurmaCompleta = TipoTurma & {
  cursos: Curso & {
    aulas: (Aula & { aula_listas: { lista_id: string }[] })[];
    curso_listas: { lista_id: string; ordem: number; listas: { titulo: string; status: "rascunho" | "publicada" } | null }[];
  };
  curso_listas_liberadas: { lista_id: string; liberada_em: string }[];
  matriculas: Matricula[];
  aulas_liberadas: { aula_id: string; liberada_em: string }[];
  turma_listas: { lista_id: string; ordem: number; listas: { titulo: string } | null }[];
};
type Aba = "aulas" | "exercicios" | "aovivo" | "extras" | "alunos";

function BotaoAba({ ativa, onClick, icone: Icone, children, contador, alerta }: {
  ativa: boolean; onClick: () => void; icone: typeof BookOpen; children: ReactNode; contador?: number; alerta?: number;
}) {
  return (
    <button
      role="tab"
      aria-selected={ativa}
      onClick={onClick}
      className={`-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold whitespace-nowrap transition ${
        ativa ? "border-marca text-marca" : "border-transparent text-suave hover:text-texto"
      }`}
    >
      <Icone className="size-4" /> {children}
      {contador !== undefined && <span className="rounded-full bg-creme px-2 py-0.5 text-xs text-suave">{contador}</span>}
      {!!alerta && <span className="rounded-full bg-coral px-2 py-0.5 text-xs text-white">{alerta} {alerta === 1 ? "pedido" : "pedidos"}</span>}
    </button>
  );
}

export default function Turma() {
  const { id = "" } = useParams();
  const navegar = useNavigate();
  const [parametros, setParametros] = useSearchParams();
  const [erroAcao, setErroAcao] = useState("");
  const [copiado, setCopiado] = useState<"" | "link" | "mensagem">("");
  const [recemLiberada, setRecemLiberada] = useState<Aula | null>(null);
  const [recemLiberados, setRecemLiberados] = useState<{ id: string; titulo: string }[]>([]);
  const { dados: turma, erro, carregando, recarregar, setDados } = useConsulta<TurmaCompleta>(
    () =>
      supabase
        .from("turmas")
        .select("*, cursos(*, aulas(*, aula_listas(lista_id)), curso_listas(lista_id, ordem, listas(titulo, status))), curso_listas_liberadas(lista_id, liberada_em), matriculas(situacao, criado_em, aprovada_em, perfis(id, nome, email)), aulas_liberadas(aula_id, liberada_em), turma_listas(lista_id, ordem, listas(titulo))")
        .eq("id", id)
        .single(),
    [id],
  );

  if (carregando && !turma) return <TextoCarregando />;
  if (erro || !turma) return <Aviso>{erro || "Turma não encontrada."}</Aviso>;

  const aulas = [...turma.cursos.aulas].sort((a, b) => a.numero - b.numero);
  const liberadas = new Set(turma.aulas_liberadas.map((l) => l.aula_id));
  const pendentes = turma.matriculas.filter((m) => m.situacao === "pendente" && m.perfis);
  const aprovados = turma.matriculas.filter((m) => m.situacao === "aprovada" && m.perfis);
  const extras = [...turma.turma_listas].sort((a, b) => a.ordem - b.ordem).map((t) => t.lista_id);
  const exercicios = [...turma.cursos.curso_listas].sort((a, b) => a.ordem - b.ordem).filter((c) => c.listas);
  const exerciciosLiberados = new Map(turma.curso_listas_liberadas.map((l) => [l.lista_id, l.liberada_em]));
  const quantosLiberados = exercicios.filter((c) => exerciciosLiberados.has(c.lista_id)).length;
  const abaUrl = parametros.get("aba") as Aba | null;
  const aba: Aba = abaUrl ?? (pendentes.length ? "alunos" : "aulas");
  const mudarAba = (nova: Aba) => setParametros({ aba: nova }, { replace: true });

  async function acao(promessa: PromiseLike<{ error: { message: string } | null }>) {
    setErroAcao("");
    const { error } = await promessa;
    if (error) setErroAcao(traduzirErro(error.message));
    recarregar();
    recontar();
  }

  async function copiar(tipo: "link" | "mensagem") {
    if (!turma) return;
    try {
      await navigator.clipboard.writeText(tipo === "link" ? linkDeConvite(turma.codigo) : mensagemDeConvite(turma.nome, turma.codigo));
      setCopiado(tipo);
      setTimeout(() => setCopiado(""), 2500);
    } catch {
      setErroAcao("Não foi possível copiar. Selecione o link e copie manualmente.");
    }
  }

  async function alternarAula(aula: Aula) {
    if (!turma) return;
    setErroAcao("");
    const estavaLiberada = liberadas.has(aula.id);
    setRecemLiberada(estavaLiberada ? null : aula);
    // Atualiza na hora e desfaz se o banco recusar.
    setDados({
      ...turma,
      aulas_liberadas: estavaLiberada
        ? turma.aulas_liberadas.filter((l) => l.aula_id !== aula.id)
        : [...turma.aulas_liberadas, { aula_id: aula.id, liberada_em: new Date().toISOString() }],
    });
    const { error } = estavaLiberada
      ? await supabase.from("aulas_liberadas").delete().eq("turma_id", turma.id).eq("aula_id", aula.id)
      : await supabase.from("aulas_liberadas").insert({ turma_id: turma.id, aula_id: aula.id });
    if (error) {
      setErroAcao(traduzirErro(error.message));
      setRecemLiberada(null);
      recarregar();
    }
  }

  /** Libera de uma vez todas as aulas ainda bloqueadas (o aluno recebe um aviso só). */
  async function liberarTodas() {
    if (!turma) return;
    const faltam = turma.cursos.aulas.filter((a) => !liberadas.has(a.id));
    if (faltam.length === 0) return;
    if (!confirm(`Liberar ${faltam.length} ${faltam.length === 1 ? "aula" : "aulas"} para os alunos desta turma?`)) return;
    setErroAcao("");
    const { error } = await supabase.from("aulas_liberadas").insert(faltam.map((a) => ({ turma_id: turma.id, aula_id: a.id })));
    if (error) setErroAcao(traduzirErro(error.message));
    recarregar();
  }

  /** Libera (ou recolhe) exercícios do curso para esta turma. Vários de uma vez geram um aviso só para cada aluno. */
  async function liberarExercicios(ids: string[], liberar: boolean) {
    if (!turma || ids.length === 0) return;
    setErroAcao("");
    const agora = new Date().toISOString();
    setDados({
      ...turma,
      curso_listas_liberadas: liberar
        ? [...turma.curso_listas_liberadas, ...ids.map((lista_id) => ({ lista_id, liberada_em: agora }))]
        : turma.curso_listas_liberadas.filter((l) => !ids.includes(l.lista_id)),
    });
    const titulos = new Map(exercicios.map((c) => [c.lista_id, c.listas!.titulo]));
    setRecemLiberados(liberar ? ids.map((id) => ({ id, titulo: titulos.get(id) ?? "Exercício" })) : []);
    const { error } = liberar
      ? await supabase.from("curso_listas_liberadas").insert(ids.map((lista_id) => ({ turma_id: turma.id, lista_id })))
      : await supabase.from("curso_listas_liberadas").delete().eq("turma_id", turma.id).in("lista_id", ids);
    if (error) {
      setErroAcao(traduzirErro(error.message));
      setRecemLiberados([]);
      recarregar();
    }
  }

  /** Grava os extras na ordem escolhida: tira os removidos, inclui os novos e acerta a ordem. */
  async function salvarExtras(ids: string[]) {
    if (!turma) return;
    const titulos = new Map(turma.turma_listas.map((t) => [t.lista_id, t.listas]));
    setDados({ ...turma, turma_listas: ids.map((lista_id, ordem) => ({ lista_id, ordem, listas: titulos.get(lista_id) ?? null })) });
    setErroAcao("");
    const removidos = extras.filter((x) => !ids.includes(x));
    const novos = ids.filter((x) => !extras.includes(x));
    const respostas = await Promise.all([
      removidos.length ? supabase.from("turma_listas").delete().eq("turma_id", turma.id).in("lista_id", removidos) : null,
      novos.length ? supabase.from("turma_listas").insert(novos.map((lista_id) => ({ turma_id: turma.id, lista_id, ordem: ids.indexOf(lista_id) }))) : null,
      ...ids.filter((x) => extras.includes(x) && extras.indexOf(x) !== ids.indexOf(x))
        .map((lista_id) => supabase.from("turma_listas").update({ ordem: ids.indexOf(lista_id) }).eq("turma_id", turma.id).eq("lista_id", lista_id)),
    ]);
    const falha = respostas.find((r) => r?.error);
    if (falha?.error) setErroAcao(traduzirErro(falha.error.message));
    recarregar();
  }

  const aprovar = (alunos: Pessoa[]) =>
    acao(supabase.from("matriculas").update({ situacao: "aprovada", aprovada_em: new Date().toISOString() }).eq("turma_id", turma.id).in("aluno_id", alunos.map((a) => a.id)));
  const recusar = (aluno: Pessoa) => {
    if (confirm(`Recusar o pedido de ${aluno.nome || aluno.email}?`)) acao(supabase.from("matriculas").delete().eq("turma_id", turma.id).eq("aluno_id", aluno.id));
  };
  const remover = (aluno: Pessoa) => {
    if (confirm(`Remover ${aluno.nome || aluno.email} da turma? Ele deixa de ver as aulas e os exercícios dela.`)) acao(supabase.from("matriculas").delete().eq("turma_id", turma.id).eq("aluno_id", aluno.id));
  };
  async function apagarTurma() {
    if (!turma || !confirm(`Apagar a turma "${turma.nome}"? Os alunos perdem o acesso às aulas e aos exercícios dela.`)) return;
    const { error } = await supabase.from("turmas").delete().eq("id", turma.id);
    if (error) setErroAcao(traduzirErro(error.message));
    else navegar("/turmas", { replace: true });
  }

  return (
    <>
      <Link to="/turmas" className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-suave hover:text-texto">
        <ArrowLeft className="size-4" /> Turmas
      </Link>
      <CabecalhoPagina
        etiqueta={`${IDIOMAS[turma.cursos.idioma]} · ${nomeNivel(turma.cursos.idioma, turma.cursos.nivel)}`}
        titulo={turma.nome}
        descricao={`Segue o curso “${turma.cursos.titulo}”. ${aprovados.length} ${aprovados.length === 1 ? "aluno" : "alunos"} · ${liberadas.size} de ${aulas.length} aulas liberadas · ${quantosLiberados} de ${exercicios.length} exercícios liberados · ${extras.length} ${extras.length === 1 ? "extra" : "extras"}.`}
        acoes={
          <div className="flex flex-wrap gap-2">
            <Link to={`/resultados?turma=${turma.id}`} className="inline-flex h-11 items-center gap-2 rounded-xl border border-borda bg-superficie px-4 text-sm font-semibold hover:bg-fundo">
              <BarChart3 className="size-4" /> Resultados
            </Link>
            <Link to={`/aluno/turmas/${turma.id}`} className="inline-flex h-11 items-center gap-2 rounded-xl border border-borda bg-superficie px-4 text-sm font-semibold hover:bg-fundo">
              <Eye className="size-4" /> Ver como aluno
            </Link>
            <Botao variante="fantasma" onClick={apagarTurma} aria-label="Apagar turma" title="Apagar turma"><Trash2 className="size-4" /></Botao>
          </div>
        }
      />

      {erroAcao && <div className="mb-4"><Aviso>{erroAcao}</Aviso></div>}

      <div className="mb-6 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-borda [scrollbar-width:none]" role="tablist">
        <BotaoAba ativa={aba === "aulas"} onClick={() => mudarAba("aulas")} icone={BookOpen} contador={aulas.length}>Aulas</BotaoAba>
        <BotaoAba ativa={aba === "exercicios"} onClick={() => mudarAba("exercicios")} icone={ClipboardList} contador={exercicios.length}>Exercícios</BotaoAba>
        <BotaoAba ativa={aba === "aovivo"} onClick={() => mudarAba("aovivo")} icone={Video}>Ao vivo</BotaoAba>
        <BotaoAba ativa={aba === "extras"} onClick={() => mudarAba("extras")} icone={Sparkles} contador={extras.length}>Extras</BotaoAba>
        <BotaoAba ativa={aba === "alunos"} onClick={() => mudarAba("alunos")} icone={Users} contador={aprovados.length} alerta={pendentes.length}>Alunos</BotaoAba>
      </div>

      {aba === "aulas" && (
        <section>
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <p className="min-w-0 flex-1 text-sm text-suave">
              Libere cada aula depois de dá-la: o aluno vê o material e os exercícios dela. As aulas são montadas no curso{" "}
              <Link to={`/cursos/${turma.curso_id}`} className="font-semibold text-destaque underline">{turma.cursos.titulo}</Link>, que pode servir a várias turmas.
            </p>
            <Link
              to={`/cursos/${turma.curso_id}?nova=aula`}
              className="inline-flex h-11 shrink-0 items-center gap-2 rounded-xl bg-marca px-4 text-sm font-semibold text-sobre-marca hover:bg-marca-hover"
              title="A aula entra no curso (todas as turmas dele a veem bloqueada até liberar)"
            >
              <Plus className="size-4" /> Nova aula
            </Link>
          </div>
          {aulas.length > 1 && liberadas.size < aulas.length && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-borda bg-superficie p-4">
              <p className="text-sm text-suave">Ainda não vai dar as aulas? Libere uma a uma conforme acontecem. Se a turma já está adiantada, libere tudo de uma vez.</p>
              <Botao variante="secundario" onClick={liberarTodas}><Unlock className="size-4" /> Liberar todas ({aulas.length - liberadas.size})</Botao>
            </div>
          )}
          {recemLiberada && liberadas.has(recemLiberada.id) && (
            <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-sucesso/40 bg-sucesso-suave p-4">
              <Check className="size-5 shrink-0 text-sucesso" />
              <p className="min-w-0 flex-1 text-sm">
                <strong>Aula {recemLiberada.numero} liberada.</strong> Os alunos da turma já veem e receberam a notificação na plataforma. Quer avisar no grupo também?
              </p>
              <CopiarTexto texto={mensagemDeAula(recemLiberada)}>Copiar aviso para o grupo</CopiarTexto>
            </div>
          )}
          {aulas.length === 0 ? (
            <Aviso tipo="info">Este curso ainda não tem aulas. <Link to={`/cursos/${turma.curso_id}`} className="font-semibold underline">Adicionar aulas</Link></Aviso>
          ) : (
            <ol className="space-y-2">
              {aulas.map((aula) => {
                const liberada = liberadas.has(aula.id);
                const quando = turma.aulas_liberadas.find((l) => l.aula_id === aula.id)?.liberada_em;
                return (
                  <li key={aula.id} className={`flex flex-wrap items-center gap-3 rounded-2xl border p-3 sm:flex-nowrap ${liberada ? "border-borda bg-superficie" : "border-dashed border-borda bg-fundo"}`}>
                    <span className={`grid size-10 shrink-0 place-items-center rounded-xl font-serif font-bold ${liberada ? "bg-marinho-800 text-white" : "bg-creme text-suave"}`}>{aula.numero}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{aula.titulo}</span>
                      <span className="flex flex-wrap gap-1.5 pt-1">
                        {(aula.material_arquivo || aula.material_url) && <Etiqueta><FileText className="mr-1 size-3.5" /> Material</Etiqueta>}
                        <Etiqueta tom="creme"><ClipboardList className="mr-1 size-3.5" /> {aula.aula_listas.length} {aula.aula_listas.length === 1 ? "exercício" : "exercícios"}</Etiqueta>
                        {liberada && quando && <span className="text-xs text-suave">liberada {quandoFoi(quando)}</span>}
                      </span>
                    </span>
                    {liberada && <CopiarTexto texto={mensagemDeAula(aula)} compacto dica={`Copiar aviso da aula ${aula.numero} para o grupo`} />}
                    <Link to={`/aulas/${aula.id}`} className="grid size-9 place-items-center pointer-coarse:size-11 rounded-lg text-suave hover:bg-fundo hover:text-texto" title="Ver aula" aria-label={`Ver aula ${aula.numero}`}>
                      <Eye className="size-4" />
                    </Link>
                    <button
                      role="switch"
                      aria-checked={liberada}
                      aria-label={`Liberar aula ${aula.numero}`}
                      onClick={() => alternarAula(aula)}
                      className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition ${
                        liberada ? "bg-sucesso-suave text-sucesso" : "border border-borda bg-superficie text-suave hover:text-texto"
                      }`}
                    >
                      {liberada ? <><Unlock className="size-3.5" /> Liberada</> : <><Lock className="size-3.5" /> Liberar</>}
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      )}

      {aba === "exercicios" && (
        <section>
          <p className="mb-4 text-sm text-suave">
            Os exercícios do curso <Link to={`/cursos/${turma.curso_id}`} className="font-semibold text-destaque underline">{turma.cursos.titulo}</Link>, na ordem
            dele. Eles entram liberados e o aluno já vê os publicados. Para segurar algum nesta turma, é só recolher.
          </p>
          {exercicios.length === 0 ? (
            <Aviso tipo="info">
              O curso ainda não tem exercícios. <Link to={`/cursos/${turma.curso_id}`} className="font-semibold underline">Adicionar vários de uma vez no curso</Link>
            </Aviso>
          ) : (
            <>
              {quantosLiberados < exercicios.length && (
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-borda bg-superficie p-4">
                  <p className="text-sm text-suave">Há exercícios recolhidos nesta turma. Libere um a um ou todos de uma vez: os alunos recebem um aviso só.</p>
                  <Botao
                    variante="secundario"
                    onClick={() => {
                      const faltam = exercicios.filter((c) => !exerciciosLiberados.has(c.lista_id)).map((c) => c.lista_id);
                      if (confirm(`Liberar ${faltam.length} ${faltam.length === 1 ? "exercício" : "exercícios"} para os alunos desta turma?`)) liberarExercicios(faltam, true);
                    }}
                  >
                    <Unlock className="size-4" /> Liberar todos ({exercicios.length - quantosLiberados})
                  </Botao>
                </div>
              )}
              {recemLiberados.length > 0 && recemLiberados.every((l) => exerciciosLiberados.has(l.id)) && (
                <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-sucesso/40 bg-sucesso-suave p-4">
                  <Check className="size-5 shrink-0 text-sucesso" />
                  <p className="min-w-0 flex-1 text-sm">
                    <strong>{recemLiberados.length === 1 ? "Exercício liberado." : `${recemLiberados.length} exercícios liberados.`}</strong> Os alunos já veem e receberam a notificação. Quer avisar no grupo também?
                  </p>
                  <CopiarTexto texto={mensagemDeExercicios(recemLiberados)}>Copiar aviso para o grupo</CopiarTexto>
                </div>
              )}
              <ol className="space-y-2">
                {exercicios.map((c, i) => {
                  const quando = exerciciosLiberados.get(c.lista_id);
                  const liberado = quando !== undefined;
                  return (
                    <li key={c.lista_id} className={`flex flex-wrap items-center gap-3 rounded-2xl border p-3 sm:flex-nowrap ${liberado ? "border-borda bg-superficie" : "border-dashed border-borda bg-fundo"}`}>
                      <span className={`grid size-10 shrink-0 place-items-center rounded-xl font-serif font-bold ${liberado ? "bg-marinho-800 text-white" : "bg-creme text-suave"}`}>{i + 1}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{c.listas!.titulo}</span>
                        <span className="flex flex-wrap gap-1.5 pt-1">
                          {c.listas!.status === "rascunho" && <Etiqueta tom="coral">Rascunho: aparece depois de publicado</Etiqueta>}
                          {quando && <span className="text-xs text-suave">liberado {quandoFoi(quando)}</span>}
                        </span>
                      </span>
                      <Link to={`/praticar/${c.lista_id}`} className="grid size-9 place-items-center pointer-coarse:size-11 rounded-lg text-suave hover:bg-fundo hover:text-texto" title="Testar como aluno" aria-label={`Testar ${c.listas!.titulo}`}>
                        <Eye className="size-4" />
                      </Link>
                      <button
                        role="switch"
                        aria-checked={liberado}
                        aria-label={`Liberar ${c.listas!.titulo}`}
                        onClick={() => liberarExercicios([c.lista_id], !liberado)}
                        className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition ${
                          liberado ? "bg-sucesso-suave text-sucesso" : "border border-borda bg-superficie text-suave hover:text-texto"
                        }`}
                      >
                        {liberado ? <><Unlock className="size-3.5" /> Liberado</> : <><Lock className="size-3.5" /> Liberar</>}
                      </button>
                    </li>
                  );
                })}
              </ol>
            </>
          )}
        </section>
      )}

      {aba === "aovivo" && <EditorAoVivo idTurma={turma.id} nomeTurma={turma.nome} />}

      {aba === "extras" && (
        <section className="max-w-3xl rounded-2xl border border-borda bg-superficie p-5 sm:p-6">
          <ExerciciosDaAula
            selecionadas={extras}
            aoMudar={salvarExtras}
            rotulo="Exercícios extras da turma"
            descricao="Listas avulsas, além das aulas (revisão, prática extra, prova). Aparecem para os alunos desta turma na aba Extras, na ordem abaixo. Salva sozinho."
            porNivel={{ idioma: turma.cursos.idioma, nivel: turma.cursos.nivel }}
            doCurso={{ idioma: turma.cursos.idioma, nivel: turma.cursos.nivel }}
          />
          {turma.turma_listas.length > 0 && (
            <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-borda pt-4">
              <p className="min-w-0 flex-1 text-sm text-suave">Cada extra novo já avisa os alunos na plataforma. Para avisar no grupo, copie a mensagem com os links.</p>
              <CopiarTexto
                texto={mensagemDeExtras([...turma.turma_listas].sort((a, b) => a.ordem - b.ordem).map((t) => ({ id: t.lista_id, titulo: t.listas?.titulo ?? "Exercício" })))}
              >
                Copiar aviso dos extras
              </CopiarTexto>
            </div>
          )}
        </section>
      )}

      {aba === "alunos" && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="min-w-0 space-y-6">
            {pendentes.length > 0 && (
              <section className="rounded-2xl border-2 border-coral/50 bg-coral-suave p-5">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-lg font-bold text-marca">Pedidos para entrar ({pendentes.length})</h2>
                  {pendentes.length > 1 && (
                    <Botao onClick={() => aprovar(pendentes.map((m) => m.perfis!))}><UserCheck className="size-4" /> Aprovar todos</Botao>
                  )}
                </div>
                <ul className="space-y-2">
                  {pendentes.map(({ perfis: aluno, criado_em }) => aluno && (
                    <li key={aluno.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-superficie p-3">
                      <div className="w-full min-w-0 sm:w-auto sm:flex-1">
                        <p className="truncate font-semibold">{aluno.nome || "Sem nome"}</p>
                        <p className="truncate text-xs text-suave">{aluno.email} · pediu {quandoFoi(criado_em)}</p>
                      </div>
                      <Botao variante="secundario" className="flex-1 px-3 sm:flex-none" onClick={() => recusar(aluno)}><UserX className="size-4" /> Recusar</Botao>
                      <Botao className="flex-1 px-3 sm:flex-none" onClick={() => aprovar([aluno])}><UserCheck className="size-4" /> Aprovar</Botao>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-suave">Aprove só quem você reconhece como aluno da turma. Recusar apaga o pedido.</p>
              </section>
            )}

            <section>
              <h2 className="text-lg font-bold text-marca">Alunos da turma ({aprovados.length})</h2>
              {aprovados.length === 0 ? (
                <p className="mt-2 rounded-2xl border border-dashed border-borda p-6 text-center text-sm text-suave">
                  <Users className="mx-auto mb-2 size-6" /> Ninguém aprovado ainda. Envie o link de convite para a turma.
                </p>
              ) : (
                <ul className="mt-3 divide-y divide-borda rounded-2xl border border-borda bg-superficie">
                  {aprovados.map(({ perfis: aluno, aprovada_em, criado_em }) => aluno && (
                    <li key={aluno.id} className="flex items-center gap-3 p-4">
                      <div className="min-w-0 flex-1">
                        <Link to={`/resultados/alunos/${aluno.id}`} className="block truncate font-semibold hover:underline">{aluno.nome || "Sem nome"}</Link>
                        <p className="truncate text-xs text-suave">{aluno.email} · na turma desde {new Date(aprovada_em ?? criado_em).toLocaleDateString("pt-BR")}</p>
                      </div>
                      <Botao variante="fantasma" className="px-3" onClick={() => remover(aluno)} aria-label={`Remover ${aluno.nome || aluno.email}`} title="Remover da turma">
                        <UserMinus className="size-4" />
                      </Botao>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <aside className="h-fit rounded-2xl bg-marinho-800 p-6 text-white">
            <p className="text-[11px] font-bold tracking-[0.14em] text-azul-300 uppercase">Convite da turma</p>
            <p className="mt-1 font-mono text-4xl font-bold tracking-[0.3em]">{turma.codigo}</p>
            <p className="mt-3 text-sm break-all text-white/80">{linkDeConvite(turma.codigo)}</p>
            <p className="mt-4 text-[11px] font-bold tracking-[0.14em] text-azul-300 uppercase">Mensagem que será copiada</p>
            <p className="mt-1 max-h-56 overflow-y-auto rounded-xl bg-white/10 p-3 text-xs leading-relaxed whitespace-pre-line text-white/90">{mensagemDeConvite(turma.nome, turma.codigo)}</p>
            <p className="mt-3 text-sm text-white/75">
              {turma.ativa
                ? "Mande o link no grupo da turma. O aluno cria a conta pelo link e aparece aqui como pedido, para você aprovar."
                : "Entradas encerradas: o código não aceita novos pedidos até você reabrir."}
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <button onClick={() => copiar("mensagem")} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-marinho-800 hover:bg-white/90">
                {copiado === "mensagem" ? <><Check className="size-4" /> Mensagem copiada</> : <><Copy className="size-4" /> Copiar mensagem de convite</>}
              </button>
              <button onClick={() => copiar("link")} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-white/30 px-4 text-sm font-semibold text-white hover:bg-white/10">
                {copiado === "link" ? <><Check className="size-4" /> Link copiado</> : <><Link2 className="size-4" /> Copiar só o link</>}
              </button>
              <button
                onClick={() => acao(supabase.from("turmas").update({ ativa: !turma.ativa }).eq("id", turma.id))}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold text-white/80 hover:bg-white/10 hover:text-white"
              >
                {turma.ativa ? <><Lock className="size-4" /> Encerrar entradas</> : <><Unlock className="size-4" /> Reabrir entradas</>}
              </button>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
