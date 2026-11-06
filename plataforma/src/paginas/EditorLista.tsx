import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { AlertTriangle, ArrowDown, ArrowLeft, ArrowUp, BookOpen, ChevronDown, Copy, Eye, Lightbulb, MapPin, Plus, Save, Trash2 } from "lucide-react";
import { supabase, traduzirErro } from "../lib/supabase";
import { IDIOMAS, NIVEIS, type Idioma } from "../lib/dados";
import {
  ESTIMULOS,
  FORMATOS,
  novaLista,
  novaQuestao,
  novaSecao,
  novoId,
  problemasDaQuestao,
  problemasDoAudio,
  type Formato,
  type Lista,
  type Questao,
  type Secao,
  type TipoEstimulo,
} from "../lib/exercicios";
import EditorQuestao from "../componentes/EditorQuestao";
import EditorAudio from "../componentes/EditorAudio";
import CopiarLink from "../componentes/CopiarLink";
import { falantesDoRoteiro } from "../lib/vozes";
import PainelClaude from "../componentes/PainelClaude";
import PainelAssistente from "../componentes/PainelAssistente";
import type { ResultadoImportacao } from "../lib/importar";
import { Aviso, Botao, Etiqueta, TextoCarregando } from "../componentes/ui";

const CONTROLE =
  "w-full rounded-xl border border-borda bg-superficie px-3 py-2.5 text-sm text-texto placeholder:text-suave/70 focus:border-destaque focus:outline-none focus:ring-4 focus:ring-destaque-suave";

type LinhaGabarito = { gabarito: Questao["gabarito"]; explicacao: string };
type QuestaoBanco = Omit<Questao, "gabarito" | "explicacao"> & { ordem: number; gabaritos: LinhaGabarito | LinhaGabarito[] | null };
type SecaoBanco = Omit<Secao, "questoes"> & { ordem: number; questoes: QuestaoBanco[] };

/** Monta a lista do editor a partir das tabelas do banco. */
function daBase(dados: Omit<Lista, "secoes"> & { secoes: SecaoBanco[] }): Lista {
  return {
    ...dados,
    secoes: [...dados.secoes]
      .sort((a, b) => a.ordem - b.ordem)
      .map(({ questoes, ...secao }) => ({
        ...secao,
        questoes: [...questoes]
          .sort((a, b) => a.ordem - b.ordem)
          .map(({ gabaritos, ...q }) => {
            const g = Array.isArray(gabaritos) ? gabaritos[0] : gabaritos;
            return { ...q, gabarito: g?.gabarito ?? {}, explicacao: g?.explicacao ?? "" };
          }),
      })),
  };
}

function mover<T>(itens: T[], de: number, para: number): T[] {
  if (para < 0 || para >= itens.length) return itens;
  const copia = [...itens];
  const [item] = copia.splice(de, 1);
  copia.splice(para, 0, item);
  return copia;
}

type AulaDestino = {
  id: string;
  numero: number;
  titulo: string;
  subtitulo: string;
  curso_id: string;
  cursos: { titulo: string; idioma: Idioma; nivel: number };
};
type Usos = {
  aula_listas: { aulas: { id: string; numero: number; titulo: string; curso_id: string; cursos: { titulo: string } | null } | null }[];
  turma_listas: { turmas: { id: string; nome: string } | null }[];
  curso_listas: { cursos: { id: string; titulo: string } | null }[];
};
type CursoDestino = { id: string; titulo: string; idioma: Idioma; nivel: number };

/** Onde a lista está em uso (aulas, exercícios do curso e extras de turma). Sem nenhum, nenhum aluno a vê. */
function OndeAparece({ idLista, atualizar }: { idLista: string; atualizar: number }) {
  const [usos, setUsos] = useState<Usos | null>(null);
  useEffect(() => {
    supabase
      .from("listas")
      .select("aula_listas(aulas(id, numero, titulo, curso_id, cursos(titulo))), turma_listas(turmas(id, nome)), curso_listas(cursos(id, titulo))")
      .eq("id", idLista)
      .single()
      .then(({ data }) => setUsos(data as unknown as Usos | null));
  }, [idLista, atualizar]);
  if (!usos) return null;
  const aulas = usos.aula_listas.map((u) => u.aulas).filter((a): a is NonNullable<typeof a> => !!a);
  const turmas = usos.turma_listas.map((u) => u.turmas).filter((t): t is NonNullable<typeof t> => !!t);
  const cursos = usos.curso_listas.map((u) => u.cursos).filter((c): c is NonNullable<typeof c> => !!c);
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-borda bg-superficie px-4 py-3 text-sm">
      <MapPin className="size-4 shrink-0 text-suave" />
      {aulas.length === 0 && turmas.length === 0 && cursos.length === 0 ? (
        <span className="text-suave">
          Esta lista ainda não está em nenhum curso, aula ou extra de turma, então nenhum aluno a vê. Coloque-a nos exercícios de um curso (em Cursos e aulas) ou nos extras de uma turma.
        </span>
      ) : (
        <>
          <span className="text-suave">Aparece em:</span>
          {cursos.map((c) => (
            <Link key={c.id} to={`/cursos/${c.id}`} className="rounded-full bg-destaque-suave px-3 py-1 font-semibold text-marca hover:underline">
              Exercícios do curso · {c.titulo}
            </Link>
          ))}
          {aulas.map((a) => (
            <Link key={a.id} to={`/cursos/${a.curso_id}`} className="rounded-full bg-destaque-suave px-3 py-1 font-semibold text-marca hover:underline">
              Aula {a.numero} · {a.titulo}{a.cursos ? ` (${a.cursos.titulo})` : ""}
            </Link>
          ))}
          {turmas.map((t) => (
            <Link key={t.id} to={`/turmas/${t.id}?aba=extras`} className="rounded-full bg-creme px-3 py-1 font-semibold text-marca hover:underline">
              Extra · {t.nome}
            </Link>
          ))}
        </>
      )}
    </div>
  );
}

export default function EditorLista() {
  const { id } = useParams();
  const nova = !id || id === "nova";
  const navegar = useNavigate();
  // /exercicios/nova?aula=ID: a lista nasce de uma aula e entra nela no primeiro salvamento.
  const [parametros] = useSearchParams();
  const idAulaDestino = nova ? parametros.get("aula") : null;
  const [aulaDestino, setAulaDestino] = useState<AulaDestino | null>(null);
  // /exercicios/nova?curso=ID: a lista entra nos exercícios do curso no primeiro salvamento.
  const idCursoDestino = nova && !idAulaDestino ? parametros.get("curso") : null;
  const [cursoDestino, setCursoDestino] = useState<CursoDestino | null>(null);
  const [usosAtualizados, setUsosAtualizados] = useState(0);
  const [lista, setLista] = useState<Lista | null>(nova ? novaLista() : null);
  const [abertas, setAbertas] = useState<Set<string>>(new Set());
  const [sujo, setSujo] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  // O assistente abre sozinho nas listas novas, que é quando gerar com IA mais ajuda.
  const [painelAssistente, setPainelAssistente] = useState(nova);
  const [painelClaude, setPainelClaude] = useState(false);
  // Já existe no banco? (uma lista nova passa a existir no primeiro salvamento, manual ou automático).
  const [persistida, setPersistida] = useState(!nova);
  const [salvoAutomaticoEm, setSalvoAutomaticoEm] = useState<Date | null>(null);
  // Conta as alterações: se o professor digitou enquanto salvava, a lista continua "não salva".
  const versao = useRef(0);

  useEffect(() => {
    if (nova) return;
    supabase
      .from("listas")
      .select("*, secoes(*, questoes(*, gabaritos(gabarito, explicacao)))")
      .eq("id", id)
      .single()
      .then(({ data, error }) => {
        if (error) setErro(traduzirErro(error.message));
        else setLista(daBase(data));
      });
  }, [id, nova]);

  useEffect(() => {
    if (!idAulaDestino) return;
    supabase
      .from("aulas")
      .select("id, numero, titulo, subtitulo, curso_id, cursos(titulo, idioma, nivel)")
      .eq("id", idAulaDestino)
      .single()
      .then(({ data }) => {
        if (!data) return;
        const aula = data as unknown as AulaDestino;
        setAulaDestino(aula);
        // Idioma, nível e tema vêm do curso e da aula (sem marcar a lista como alterada).
        setLista((atual) =>
          atual && !atual.titulo && atual.secoes.every((s) => s.questoes.length === 0)
            ? { ...atual, idioma: aula.cursos.idioma, nivel: aula.cursos.nivel, tema: atual.tema || aula.titulo }
            : atual,
        );
      });
  }, [idAulaDestino]);

  useEffect(() => {
    if (!idCursoDestino) return;
    supabase
      .from("cursos")
      .select("id, titulo, idioma, nivel")
      .eq("id", idCursoDestino)
      .single()
      .then(({ data }) => {
        if (!data) return;
        const curso = data as CursoDestino;
        setCursoDestino(curso);
        setLista((atual) =>
          atual && !atual.titulo && atual.secoes.every((s) => s.questoes.length === 0) ? { ...atual, idioma: curso.idioma, nivel: curso.nivel } : atual,
        );
      });
  }, [idCursoDestino]);

  // Avisa antes de sair da página com alterações não salvas.
  useEffect(() => {
    if (!sujo) return;
    const aoSair = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", aoSair);
    return () => window.removeEventListener("beforeunload", aoSair);
  }, [sujo]);

  // Salva sozinho 3 s depois da última alteração. Lista sem título não é salva (o banco exige título);
  // lista publicada com pendências também não (publicada precisa estar completa).
  useEffect(() => {
    if (!lista || !sujo || salvando || !lista.titulo.trim()) return;
    if (lista.status === "publicada" && problemas.length > 0) return;
    const espera = setTimeout(() => salvar(lista.status, true), 3000);
    return () => clearTimeout(espera);
    // salvar é recriada a cada render; o que importa é a lista mudar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lista, sujo, salvando]);

  const problemas = useMemo(() => {
    if (!lista) return [];
    const lista_ = [] as string[];
    if (!lista.titulo.trim()) lista_.push("A lista precisa de um título.");
    let numero = 0;
    lista.secoes.forEach((secao, i) => {
      if (secao.tipo_estimulo !== "audio") return;
      const estimulo = secao.estimulo;
      for (const p of problemasDoAudio(estimulo, falantesDoRoteiro(estimulo.roteiro ?? ""))) lista_.push(`Seção ${i + 1} (áudio): ${p}`);
    });
    for (const secao of lista.secoes) {
      for (const q of secao.questoes) {
        numero += 1;
        for (const p of problemasDaQuestao(q)) lista_.push(`Questão ${numero}: ${p}`);
      }
    }
    if (numero === 0) lista_.push("Adicione pelo menos uma questão.");
    return lista_;
  }, [lista]);

  if (erro && !lista) return <Aviso>{erro}</Aviso>;
  if (!lista) return <TextoCarregando />;

  function atualizar(nova: Lista) {
    versao.current += 1;
    setLista(nova);
    setSujo(true);
    setAviso("");
  }
  const mudarLista = (parcial: Partial<Lista>) => atualizar({ ...lista!, ...parcial });
  const mudarSecao = (indice: number, secao: Secao) => mudarLista({ secoes: lista!.secoes.map((s, i) => (i === indice ? secao : s)) });
  const alternarAberta = (idQuestao: string) =>
    setAbertas((atual) => {
      const nova = new Set(atual);
      if (nova.has(idQuestao)) nova.delete(idQuestao);
      else nova.add(idQuestao);
      return nova;
    });

  function importar({ dados, secoes, avisos, totalQuestoes }: ResultadoImportacao, modo: "auto" | "substituir" | "adicionar" = "auto") {
    if (!lista) return;
    const vazia = modo === "substituir" || (modo === "auto" && !lista.secoes.some((s) => s.questoes.length > 0 || s.estimulo.texto));
    atualizar({
      ...lista,
      titulo: lista.titulo || dados.titulo,
      tema: lista.tema || dados.tema,
      descricao: lista.descricao || dados.descricao,
      // Numa lista vazia, idioma e nível vêm da resposta; numa lista em andamento, os do topo continuam.
      idioma: vazia && dados.idioma ? dados.idioma : lista.idioma,
      nivel: vazia && dados.nivel ? dados.nivel : lista.nivel,
      origem: modo === "auto" ? "claude" : "assistente",
      secoes: vazia ? secoes : [...lista.secoes, ...secoes],
    });
    setPainelClaude(false);
    setPainelAssistente(false);
    const extra = avisos.length ? ` Atenção: ${avisos.join(" ")}` : "";
    setAviso(`Importadas ${totalQuestoes} questões em ${secoes.length} seções. Revise à vontade: a lista é salva sozinha enquanto você edita.${extra}`);
  }

  async function salvar(status = lista!.status, automatico = false): Promise<boolean> {
    if (!lista) return false;
    if (status === "publicada" && problemas.length > 0) {
      if (!automatico) setErro("Corrija os itens da lista de pendências antes de publicar.");
      return false;
    }
    if (!automatico) setErro("");
    setSalvando(true);
    const versaoSalva = versao.current;
    const { error } = await supabase.rpc("salvar_lista", { dados: { ...lista, status } });
    setSalvando(false);
    if (error) {
      setErro(automatico ? `Não foi possível salvar automaticamente: ${traduzirErro(error.message)}` : traduzirErro(error.message));
      return false;
    }
    // Só o status muda aqui: substituir a lista inteira apagaria o que foi digitado durante o salvamento.
    setLista((atual) => (atual ? { ...atual, status } : atual));
    if (versao.current === versaoSalva) setSujo(false);
    if (automatico) setSalvoAutomaticoEm(new Date());
    else setAviso(status === "publicada" && lista.status !== "publicada" ? "Lista publicada: os alunos já podem responder." : "Alterações salvas.");
    if (!persistida) {
      setPersistida(true);
      // Troca o endereço sem recarregar a tela (recarregar fecharia a questão aberta no meio da edição).
      window.history.replaceState(window.history.state, "", `/exercicios/${lista.id}`);
      if (aulaDestino) {
        const { count } = await supabase.from("aula_listas").select("lista_id", { count: "exact", head: true }).eq("aula_id", aulaDestino.id);
        const { error: erroAula } = await supabase.from("aula_listas").insert({ aula_id: aulaDestino.id, lista_id: lista.id, ordem: count ?? 0 });
        if (erroAula) setErro(`A lista foi salva, mas não entrou na aula: ${traduzirErro(erroAula.message)}`);
        else setAviso(`Lista criada e colocada na Aula ${aulaDestino.numero} · ${aulaDestino.titulo}. Os alunos a veem quando ela estiver publicada e a aula liberada.`);
        setUsosAtualizados((n) => n + 1);
      }
      if (cursoDestino) {
        const { count } = await supabase.from("curso_listas").select("lista_id", { count: "exact", head: true }).eq("curso_id", cursoDestino.id);
        const { error: erroCurso } = await supabase.from("curso_listas").insert({ curso_id: cursoDestino.id, lista_id: lista.id, ordem: count ?? 0 });
        if (erroCurso) setErro(`A lista foi salva, mas não entrou no curso: ${traduzirErro(erroCurso.message)}`);
        else setAviso(`Lista criada e colocada nos exercícios do curso ${cursoDestino.titulo}. Os alunos das turmas do curso a veem assim que ela for publicada.`);
        setUsosAtualizados((n) => n + 1);
      }
    }
    return true;
  }

  async function testarComoAluno() {
    if (sujo && !(await salvar())) return;
    navegar(`/praticar/${lista!.id}`);
  }

  async function apagar() {
    if (!lista) return;
    if (!persistida) {
      navegar("/exercicios");
      return;
    }
    if (!confirm(`Apagar a lista "${lista.titulo || "sem título"}"? As respostas dos alunos também serão apagadas.`)) return;
    const { error } = await supabase.from("listas").delete().eq("id", lista.id);
    if (error) setErro(traduzirErro(error.message));
    else {
      setSujo(false);
      navegar("/exercicios", { replace: true });
    }
  }

  let numeroQuestao = 0;

  return (
    <div className="pb-24">
      <Link
        to={aulaDestino ? `/cursos/${aulaDestino.curso_id}` : cursoDestino ? `/cursos/${cursoDestino.id}` : "/exercicios"}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-suave hover:text-texto"
      >
        <ArrowLeft className="size-4" /> {aulaDestino ? `Voltar ao curso ${aulaDestino.cursos.titulo}` : cursoDestino ? `Voltar ao curso ${cursoDestino.titulo}` : "Exercícios"}
      </Link>
      {cursoDestino && !persistida && (
        <div className="mb-4 flex items-start gap-3 rounded-2xl border border-destaque/40 bg-destaque-suave p-4 text-sm">
          <BookOpen className="mt-0.5 size-5 shrink-0 text-marca" />
          <p>
            Esta lista vai entrar nos <strong>exercícios do curso {cursoDestino.titulo}</strong> assim que for salva. Idioma e nível já vieram do curso.
          </p>
        </div>
      )}
      {aulaDestino && !persistida && (
        <div className="mb-4 flex items-start gap-3 rounded-2xl border border-destaque/40 bg-destaque-suave p-4 text-sm">
          <BookOpen className="mt-0.5 size-5 shrink-0 text-marca" />
          <p>
            Esta lista vai entrar na <strong>Aula {aulaDestino.numero} · {aulaDestino.titulo}</strong> ({aulaDestino.cursos.titulo}) assim que for salva.
            Idioma, nível e tema já vieram da aula.
          </p>
        </div>
      )}
      {persistida && <OndeAparece idLista={lista.id} atualizar={usosAtualizados} />}

      {/* Dados da lista */}
      <section className="rounded-3xl bg-marinho-800 p-6 text-white sm:p-8">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-bold tracking-[0.14em] text-azul-300 uppercase">Hora de praticar!</span>
          <Etiqueta tom={lista.status === "publicada" ? "verde" : "creme"}>{lista.status === "publicada" ? "Publicada" : "Rascunho"}</Etiqueta>
        </div>
        <label htmlFor="titulo-lista" className="sr-only">Título da lista</label>
        <input
          id="titulo-lista"
          value={lista.titulo}
          onChange={(e) => mudarLista({ titulo: e.target.value })}
          placeholder="Título da lista (ex.: Prepositions of movement)"
          className="mt-3 w-full border-b-2 border-white/20 bg-transparent pb-2 font-serif text-3xl font-bold text-white placeholder:text-white/40 focus:border-azul-300 focus:outline-none"
        />
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <label className="block text-xs font-semibold text-azul-300">
            Idioma
            <select value={lista.idioma} onChange={(e) => mudarLista({ idioma: e.target.value as Idioma })} className="mt-1 h-10 w-full rounded-xl bg-white/10 px-3 text-sm text-white [&>option]:text-black">
              {Object.entries(IDIOMAS).map(([v, n]) => <option key={v} value={v}>{n}</option>)}
            </select>
          </label>
          <label className="block text-xs font-semibold text-azul-300">
            Nível
            <select value={lista.nivel} onChange={(e) => mudarLista({ nivel: Number(e.target.value) })} className="mt-1 h-10 w-full rounded-xl bg-white/10 px-3 text-sm text-white [&>option]:text-black">
              {NIVEIS[lista.idioma].map((n, i) => <option key={n} value={i + 1}>{n}</option>)}
            </select>
          </label>
          <label className="block text-xs font-semibold text-azul-300">
            Tema
            <input value={lista.tema} onChange={(e) => mudarLista({ tema: e.target.value })} placeholder="Prepositions" className="mt-1 h-10 w-full rounded-xl bg-white/10 px-3 text-sm text-white placeholder:text-white/40" />
          </label>
        </div>
        <label className="mt-3 block text-xs font-semibold text-azul-300">
          Frase de abertura
          <input
            value={lista.descricao}
            onChange={(e) => mudarLista({ descricao: e.target.value })}
            placeholder="Vamos aprender como indicar a direção certa?"
            className="mt-1 h-10 w-full rounded-xl bg-white/10 px-3 font-serif text-sm text-white italic placeholder:text-white/40"
          />
        </label>
      </section>

      <PainelAssistente
        lista={lista}
        aberto={painelAssistente}
        aoAlternar={() => setPainelAssistente(!painelAssistente)}
        aoUsar={importar}
        sugestaoInicial={aulaDestino ? `Exercícios para a aula "${aulaDestino.titulo}"${aulaDestino.subtitulo ? ` (${aulaDestino.subtitulo})` : ""}: 1 listening e cerca de 12 questões variadas` : undefined}
      />
      <PainelClaude lista={lista} aberto={painelClaude} aoAlternar={() => setPainelClaude(!painelClaude)} aoImportar={importar} />

      {erro && <div className="mt-4"><Aviso>{erro}</Aviso></div>}
      {aviso && <div className="mt-4"><Aviso tipo="sucesso">{aviso}</Aviso></div>}

      {/* Seções */}
      <div className="mt-6 space-y-6">
        {lista.secoes.map((secao, indiceSecao) => (
          <section key={secao.id} className="rounded-2xl border border-borda bg-superficie">
            <div className="flex flex-wrap items-start gap-3 border-b border-borda p-4 sm:p-5">
              <div className="min-w-0 flex-1 space-y-2">
                <input
                  value={secao.titulo}
                  onChange={(e) => mudarSecao(indiceSecao, { ...secao, titulo: e.target.value })}
                  placeholder={`Seção ${indiceSecao + 1} (ex.: Complete com a preposição)`}
                  aria-label={`Título da seção ${indiceSecao + 1}`}
                  className="w-full bg-transparent font-serif text-xl font-bold text-marca placeholder:text-suave/60 focus:outline-none"
                />
                <input
                  value={secao.instrucao}
                  onChange={(e) => mudarSecao(indiceSecao, { ...secao, instrucao: e.target.value })}
                  placeholder="Instrução para o aluno (opcional)"
                  aria-label={`Instrução da seção ${indiceSecao + 1}`}
                  className="w-full bg-transparent text-sm text-suave placeholder:text-suave/60 focus:outline-none"
                />
              </div>
              <select
                value={secao.tipo_estimulo}
                onChange={(e) => mudarSecao(indiceSecao, { ...secao, tipo_estimulo: e.target.value as TipoEstimulo })}
                aria-label="Tipo da seção"
                className="h-9 rounded-lg border border-borda bg-superficie px-2 text-xs"
              >
                {Object.entries(ESTIMULOS).map(([v, n]) => <option key={v} value={v}>{n}</option>)}
              </select>
              <div className="flex">
                <Botao variante="fantasma" className="h-9 px-2" onClick={() => mudarLista({ secoes: mover(lista.secoes, indiceSecao, indiceSecao - 1) })} aria-label="Subir seção"><ArrowUp className="size-4" /></Botao>
                <Botao variante="fantasma" className="h-9 px-2" onClick={() => mudarLista({ secoes: mover(lista.secoes, indiceSecao, indiceSecao + 1) })} aria-label="Descer seção"><ArrowDown className="size-4" /></Botao>
                <Botao
                  variante="fantasma"
                  className="h-9 px-2"
                  onClick={() => (secao.questoes.length === 0 || confirm("Apagar a seção e as questões dela?")) && mudarLista({ secoes: lista.secoes.filter((_, i) => i !== indiceSecao) })}
                  aria-label="Apagar seção"
                >
                  <Trash2 className="size-4" />
                </Botao>
              </div>
            </div>

            {(secao.tipo_estimulo === "texto" || secao.tipo_estimulo === "dica") && (
              <div className={`m-4 rounded-xl p-4 sm:m-5 ${secao.tipo_estimulo === "dica" ? "bg-coral-suave" : "border-l-4 border-marca bg-creme"}`}>
                <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-suave uppercase">
                  {secao.tipo_estimulo === "dica" && <Lightbulb className="size-4 text-coral" />}
                  {secao.tipo_estimulo === "dica" ? "Dica" : "Texto para o aluno ler"}
                </p>
                <textarea
                  rows={secao.tipo_estimulo === "dica" ? 3 : 6}
                  value={secao.estimulo.texto ?? ""}
                  onChange={(e) => mudarSecao(indiceSecao, { ...secao, estimulo: { ...secao.estimulo, texto: e.target.value } })}
                  className={`${CONTROLE} bg-superficie`}
                  aria-label="Texto da seção"
                />
              </div>
            )}

            {secao.tipo_estimulo === "audio" && (
              <div className="m-4 rounded-xl border-l-4 border-marca bg-creme p-4 sm:m-5">
                <p className="mb-3 text-xs font-bold text-suave uppercase">Listening</p>
                <EditorAudio estimulo={secao.estimulo} aoMudar={(estimulo) => mudarSecao(indiceSecao, { ...secao, estimulo })} />
              </div>
            )}

            {secao.tipo_estimulo !== "dica" && (
              <div className="space-y-3 p-4 sm:p-5">
                {secao.questoes.map((q, indiceQuestao) => {
                  numeroQuestao += 1;
                  const aberta = abertas.has(q.id);
                  const pendencias = problemasDaQuestao(q);
                  const mudarQuestao = (nova: Questao) => mudarSecao(indiceSecao, { ...secao, questoes: secao.questoes.map((x) => (x.id === q.id ? nova : x)) });
                  return (
                    <div key={q.id} className={`rounded-xl border ${aberta ? "border-destaque" : "border-borda"}`}>
                      <div className="flex items-center gap-2 p-3">
                        <button onClick={() => alternarAberta(q.id)} aria-expanded={aberta} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-marinho-800 text-sm font-bold text-white">{numeroQuestao}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-xs font-semibold text-destaque">{FORMATOS[q.formato].nome}</span>
                            <span className="block truncate text-sm">{q.enunciado || <span className="text-suave italic">Sem enunciado</span>}</span>
                          </span>
                          {pendencias.length > 0 && <AlertTriangle className="size-4 shrink-0 text-coral" aria-label="Questão com pendências" />}
                          <ChevronDown className={`size-4 shrink-0 text-suave transition ${aberta ? "rotate-180" : ""}`} />
                        </button>
                        <div className="flex shrink-0">
                          <Botao variante="fantasma" className="h-8 px-2" onClick={() => mudarSecao(indiceSecao, { ...secao, questoes: mover(secao.questoes, indiceQuestao, indiceQuestao - 1) })} aria-label="Subir questão"><ArrowUp className="size-4" /></Botao>
                          <Botao variante="fantasma" className="h-8 px-2" onClick={() => mudarSecao(indiceSecao, { ...secao, questoes: mover(secao.questoes, indiceQuestao, indiceQuestao + 1) })} aria-label="Descer questão"><ArrowDown className="size-4" /></Botao>
                          <Botao
                            variante="fantasma"
                            className="h-8 px-2"
                            onClick={() => {
                              const copia = { ...structuredClone(q), id: novoId() };
                              const questoes = [...secao.questoes];
                              questoes.splice(indiceQuestao + 1, 0, copia);
                              mudarSecao(indiceSecao, { ...secao, questoes });
                              setAbertas((a) => new Set(a).add(copia.id));
                            }}
                            aria-label="Duplicar questão"
                          >
                            <Copy className="size-4" />
                          </Botao>
                          <Botao variante="fantasma" className="h-8 px-2" onClick={() => mudarSecao(indiceSecao, { ...secao, questoes: secao.questoes.filter((x) => x.id !== q.id) })} aria-label="Apagar questão"><Trash2 className="size-4" /></Botao>
                        </div>
                      </div>
                      {aberta && (
                        <div className="border-t border-borda p-4">
                          <EditorQuestao questao={q} aoMudar={mudarQuestao} />
                          {pendencias.length > 0 && (
                            <ul className="mt-3 space-y-1 text-xs text-coral">
                              {pendencias.map((p) => <li key={p}>• {p}</li>)}
                            </ul>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                <div className="rounded-xl border-2 border-dashed border-borda p-3">
                  <p className="mb-2 text-xs font-semibold text-suave">Adicionar questão</p>
                  <div className="flex flex-wrap gap-2">
                    {(Object.keys(FORMATOS) as Formato[]).map((formato) => (
                      <button
                        key={formato}
                        onClick={() => {
                          // A habilidade segue a seção (áudio → listening, texto → reading); a professora pode trocar na questão.
                          const q = novaQuestao(formato, secao.tipo_estimulo === "audio" ? "listening" : secao.tipo_estimulo === "texto" ? "reading" : undefined);
                          mudarSecao(indiceSecao, { ...secao, questoes: [...secao.questoes, q] });
                          setAbertas((a) => new Set(a).add(q.id));
                        }}
                        title={FORMATOS[formato].descricao}
                        className="inline-flex items-center gap-1 rounded-lg border border-borda bg-superficie px-3 py-1.5 text-xs font-semibold text-texto hover:border-destaque hover:text-destaque"
                      >
                        <Plus className="size-3.5" /> {FORMATOS[formato].nome}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </section>
        ))}

        <button
          onClick={() => mudarLista({ secoes: [...lista.secoes, novaSecao()] })}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-borda py-4 text-sm font-semibold text-suave hover:border-destaque hover:text-destaque"
        >
          <Plus className="size-4" /> Nova seção
        </button>
      </div>

      {problemas.length > 0 && (
        <div className="mt-6 rounded-2xl border border-coral/30 bg-coral-suave p-4 text-sm">
          <p className="flex items-center gap-2 font-semibold text-coral"><AlertTriangle className="size-4" /> Pendências antes de publicar</p>
          <ul className="mt-2 space-y-0.5 text-texto">
            {problemas.slice(0, 8).map((p) => <li key={p}>• {p}</li>)}
            {problemas.length > 8 && <li>… e mais {problemas.length - 8}.</li>}
          </ul>
        </div>
      )}

      {/* Barra de ações fixa */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-borda bg-lateral/95 backdrop-blur lg:left-72">
        <div className="flex max-w-6xl flex-wrap items-center gap-2 px-4 py-3 sm:px-8 lg:px-12">
          <span className="mr-auto text-sm text-suave" role="status">
            {salvando
              ? "Salvando…"
              : sujo
                ? !lista.titulo.trim()
                  ? "Dê um título para a lista ser salva sozinha"
                  : lista.status === "publicada" && problemas.length > 0
                    ? "Lista publicada: corrija as pendências para salvar"
                    : "Alterações não salvas…"
                : salvoAutomaticoEm
                  ? `Salvo automaticamente às ${salvoAutomaticoEm.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
                  : persistida
                    ? "Tudo salvo"
                    : "Lista nova"}
          </span>
          <Botao variante="fantasma" onClick={apagar} aria-label="Apagar lista" title="Apagar lista"><Trash2 className="size-4" /></Botao>
          {persistida && <CopiarLink idLista={lista.id} publicada={lista.status === "publicada"} />}
          <Botao variante="secundario" onClick={testarComoAluno} disabled={salvando}><Eye className="size-4" /> Testar como aluno</Botao>
          {lista.status === "publicada" ? (
            <Botao variante="secundario" onClick={() => salvar("rascunho")} carregando={salvando}>Voltar a rascunho</Botao>
          ) : (
            <Botao variante="secundario" onClick={() => salvar("publicada")} carregando={salvando}>Publicar</Botao>
          )}
          <Botao onClick={() => salvar()} carregando={salvando}><Save className="size-4" /> Salvar</Botao>
        </div>
      </div>
    </div>
  );
}
