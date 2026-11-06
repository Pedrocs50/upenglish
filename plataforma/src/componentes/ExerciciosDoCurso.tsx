import { useState } from "react";
import { Link } from "react-router";
import { ArrowDown, ArrowUp, ClipboardList, Layers, ListOrdered, Pencil, Plus, Search, X } from "lucide-react";
import { supabase, traduzirErro } from "../lib/supabase";
import { nomeNivel, useConsulta, type Idioma } from "../lib/dados";
import { CEFR } from "../lib/idiomas";
import { casarPorTitulo, ordemNatural } from "../lib/biblioteca";
import { Aviso, Botao, Etiqueta } from "./ui";

type ListaResumo = { id: string; titulo: string; nivel: number; status: "rascunho" | "publicada" };
type AulaResumo = { id: string; numero: number; titulo: string };
type Dados = { doCurso: { lista_id: string; ordem: number }[]; listas: ListaResumo[] };

/**
 * Ordem "certinha" para os exercícios: primeiro os que combinam com uma aula (na ordem das aulas), depois o resto
 * em ordem natural do título ("Unit 2" antes de "Unit 10").
 */
function ordenarPelasAulas(listas: ListaResumo[], aulas: AulaResumo[]) {
  const casados = casarPorTitulo(listas, aulas);
  const chave = (l: ListaResumo) => casados.get(l.id)?.numero ?? Number.POSITIVE_INFINITY;
  return [...listas].sort((a, b) => chave(a) - chave(b) || a.nivel - b.nivel || ordemNatural(a.titulo, b.titulo));
}

/**
 * Exercícios do curso (migração 0018): ficam no curso, separados das aulas, e cada turma libera os que quiser.
 * Entram vários de uma vez (por nível), já em ordem; a ordem dá para ajustar depois.
 */
export default function ExerciciosDoCurso({ curso, aulas }: { curso: { id: string; idioma: Idioma; nivel: number }; aulas: AulaResumo[] }) {
  const { dados, erro: erroCarregar, recarregar, setDados } = useConsulta<Dados>(async () => {
    const [doCurso, listas] = await Promise.all([
      supabase.from("curso_listas").select("lista_id, ordem").eq("curso_id", curso.id),
      supabase.from("listas").select("id, titulo, nivel, status").eq("idioma", curso.idioma),
    ]);
    const error = doCurso.error ?? listas.error;
    if (error) return { data: null, error };
    return { data: { doCurso: doCurso.data, listas: listas.data } as Dados, error: null };
  }, [curso.id, curso.idioma]);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");

  if (erroCarregar) return <Aviso>{erroCarregar}</Aviso>;
  if (!dados) return <p className="text-sm text-suave">Carregando exercícios…</p>;

  const porId = new Map(dados.listas.map((l) => [l.id, l]));
  const ids = [...dados.doCurso].sort((a, b) => a.ordem - b.ordem).map((c) => c.lista_id);
  const noCurso = ids.map((id) => porId.get(id)).filter((l): l is ListaResumo => !!l);
  const aulaDe = casarPorTitulo(noCurso, aulas);

  function avisar(texto: string) {
    setAviso(texto);
    setTimeout(() => setAviso(""), 3500);
  }

  /** Grava a ordem nova (só as linhas que mudaram) e mostra na hora. */
  async function gravarOrdem(novos: string[]) {
    if (!dados) return;
    setErro("");
    const antes = new Map(dados.doCurso.map((c) => [c.lista_id, c.ordem]));
    setDados({ ...dados, doCurso: novos.map((lista_id, ordem) => ({ lista_id, ordem })) });
    const mudaram = novos.map((lista_id, ordem) => ({ lista_id, ordem })).filter(({ lista_id, ordem }) => antes.get(lista_id) !== ordem);
    const respostas = await Promise.all(mudaram.map(({ lista_id, ordem }) => supabase.from("curso_listas").update({ ordem }).eq("curso_id", curso.id).eq("lista_id", lista_id)));
    const falha = respostas.find((r) => r.error);
    if (falha?.error) {
      setErro(traduzirErro(falha.error.message));
      recarregar();
    }
  }

  const mover = (de: number, para: number) => {
    if (para < 0 || para >= ids.length) return;
    const novos = [...ids];
    const [item] = novos.splice(de, 1);
    novos.splice(para, 0, item);
    gravarOrdem(novos);
  };

  async function tirar(lista: ListaResumo) {
    if (!confirm(`Tirar "${lista.titulo}" do curso? As turmas deixam de ver este exercício (a lista continua em Exercícios).`)) return;
    setErro("");
    const { error } = await supabase.from("curso_listas").delete().eq("curso_id", curso.id).eq("lista_id", lista.id);
    if (error) setErro(traduzirErro(error.message));
    recarregar();
  }

  async function adicionar(novas: ListaResumo[]) {
    setErro("");
    const inicio = ids.length;
    const { error } = await supabase.from("curso_listas").insert(ordenarPelasAulas(novas, aulas).map((l, i) => ({ curso_id: curso.id, lista_id: l.id, ordem: inicio + i })));
    if (error) return setErro(traduzirErro(error.message));
    avisar(`${novas.length} ${novas.length === 1 ? "exercício entrou" : "exercícios entraram"} no curso e os alunos das turmas já podem fazer${novas.some((l) => l.status === "rascunho") ? " (os rascunhos, depois de publicados)" : ""}.`);
    await recarregar();
  }

  async function organizar() {
    const novos = ordenarPelasAulas(noCurso, aulas).map((l) => l.id);
    await gravarOrdem(novos);
    avisar("Exercícios organizados na ordem das aulas.");
  }

  return (
    <section aria-labelledby="exercicios-do-curso">
      <div className="mb-4">
        <h2 id="exercicios-do-curso" className="text-2xl font-bold text-marca">Exercícios do curso</h2>
        <p className="text-sm text-suave">Ficam no curso, separados das aulas, e aparecem na hora para os alunos de todas as turmas dele. Para segurar algum numa turma, recolha na aba <strong>Exercícios</strong> da turma.</p>
      </div>

      <AdicionarVarios curso={curso} listas={dados.listas} jaNoCurso={new Set(ids)} aulas={aulas} aberto={ids.length === 0} aoAdicionar={adicionar} />

      {erro && <div className="mb-3"><Aviso>{erro}</Aviso></div>}
      {aviso && <p className="mb-3 rounded-xl bg-sucesso-suave px-4 py-2 text-sm text-sucesso">{aviso}</p>}

      {noCurso.length > 0 && (
        <>
          <ol className="mb-3 space-y-2">
            {noCurso.map((lista, i) => {
              const aula = aulaDe.get(lista.id);
              return (
                <li key={lista.id} className="flex items-center gap-2 rounded-xl border border-borda bg-superficie px-3 py-2">
                  <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-creme text-xs font-bold text-suave">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{lista.titulo}</span>
                    <span className="flex flex-wrap gap-x-3 text-xs text-suave">
                      {lista.nivel !== curso.nivel && <span>{nomeNivel(curso.idioma, lista.nivel)}</span>}
                      {aula && <span>combina com a Aula {aula.numero} · {aula.titulo}</span>}
                      {lista.status === "rascunho" && <span className="font-bold text-coral uppercase">Rascunho: o aluno só vê depois de publicada</span>}
                    </span>
                  </span>
                  <button type="button" onClick={() => mover(i, i - 1)} disabled={i === 0} aria-label={`Subir ${lista.titulo}`} className="grid size-8 place-items-center pointer-coarse:size-11 rounded-lg text-suave hover:bg-fundo disabled:opacity-30"><ArrowUp className="size-4" /></button>
                  <button type="button" onClick={() => mover(i, i + 1)} disabled={i === noCurso.length - 1} aria-label={`Descer ${lista.titulo}`} className="grid size-8 place-items-center pointer-coarse:size-11 rounded-lg text-suave hover:bg-fundo disabled:opacity-30"><ArrowDown className="size-4" /></button>
                  <Link to={`/exercicios/${lista.id}`} aria-label={`Editar ${lista.titulo}`} title="Editar exercício" className="grid size-8 place-items-center pointer-coarse:size-11 rounded-lg text-suave hover:bg-fundo"><Pencil className="size-4" /></Link>
                  <button type="button" onClick={() => tirar(lista)} aria-label={`Tirar ${lista.titulo} do curso`} title="Tirar do curso" className="grid size-8 place-items-center pointer-coarse:size-11 rounded-lg text-suave hover:bg-erro-suave hover:text-erro"><X className="size-4" /></button>
                </li>
              );
            })}
          </ol>
          <div className="flex flex-wrap gap-2">
            {noCurso.length > 1 && aulas.length > 0 && (
              <Botao variante="secundario" onClick={organizar} title="Põe primeiro os exercícios que combinam com uma aula, na ordem das aulas; o resto vai depois, pelo nome">
                <ListOrdered className="size-4" /> Organizar na ordem das aulas
              </Botao>
            )}
            <Link to={`/exercicios/nova?curso=${curso.id}`} className="inline-flex h-11 items-center gap-1 rounded-xl px-3 text-sm font-semibold text-destaque hover:bg-destaque-suave">
              <Plus className="size-4" /> Criar exercício novo neste curso
            </Link>
          </div>
        </>
      )}
    </section>
  );
}

/** Marca os níveis, confere a lista (já na ordem em que vão entrar) e adiciona tudo de uma vez. */
function AdicionarVarios({ curso, listas, jaNoCurso, aulas, aberto, aoAdicionar }: {
  curso: { idioma: Idioma; nivel: number };
  listas: ListaResumo[];
  jaNoCurso: Set<string>;
  aulas: AulaResumo[];
  aberto: boolean;
  aoAdicionar: (listas: ListaResumo[]) => Promise<void>;
}) {
  const [niveis, setNiveis] = useState<Set<number>>(new Set([curso.nivel]));
  const [busca, setBusca] = useState("");
  // Publicadas entram marcadas e rascunhos desmarcados; aqui ficam só as escolhas que a professora mudou.
  const [trocados, setTrocados] = useState<Set<string>>(new Set());
  const [adicionando, setAdicionando] = useState(false);

  const fora = listas.filter((l) => !jaNoCurso.has(l.id));
  if (listas.length === 0) {
    return (
      <p className="mb-4 rounded-2xl border border-dashed border-borda p-4 text-sm text-suave">
        Ainda não há exercícios deste idioma. <Link to={`/exercicios/nova`} className="font-semibold text-destaque underline">Criar o primeiro</Link>.
      </p>
    );
  }
  if (fora.length === 0) return null;

  const termo = busca.trim().toLowerCase();
  const candidatos = ordenarPelasAulas(
    fora.filter((l) => niveis.has(l.nivel) && (!termo || l.titulo.toLowerCase().includes(termo))),
    aulas,
  );
  const marcado = (l: ListaResumo) => (l.status === "publicada") !== trocados.has(l.id);
  const escolhidos = candidatos.filter(marcado);
  const aulaDe = casarPorTitulo(candidatos, aulas);
  const contagem = (n: number) => fora.filter((l) => l.nivel === n).length;

  const alternar = <T,>(conjunto: Set<T>, valor: T) => {
    const novo = new Set(conjunto);
    if (novo.has(valor)) novo.delete(valor);
    else novo.add(valor);
    return novo;
  };
  const marcarTodos = (marcar: boolean) => {
    const novo = new Set(trocados);
    for (const l of candidatos) {
      const mudar = (l.status === "publicada") !== marcar;
      if (mudar) novo.add(l.id);
      else novo.delete(l.id);
    }
    setTrocados(novo);
  };

  async function adicionar() {
    setAdicionando(true);
    await aoAdicionar(escolhidos);
    setTrocados(new Set());
    setAdicionando(false);
  }

  return (
    <details open={aberto} className="mb-4 rounded-2xl border border-destaque/40 bg-destaque-suave">
      <summary className="flex cursor-pointer list-none items-center gap-3 p-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-superficie text-marca"><Layers className="size-5" /></span>
        <span className="min-w-0 flex-1">
          <span className="block font-bold text-marca">Adicionar vários exercícios de uma vez</span>
          <span className="block text-sm text-suave">{fora.length} {fora.length === 1 ? "exercício ainda fora" : "exercícios ainda fora"} deste curso. Marque o nível e eles entram já em ordem.</span>
        </span>
      </summary>
      <div className="border-t border-destaque/30 p-4">
        <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Níveis">
          {CEFR.map((c, i) => {
            const n = i + 1;
            const total = contagem(n);
            const ativo = niveis.has(n);
            return (
              <button
                key={n}
                type="button"
                onClick={() => setNiveis(alternar(niveis, n))}
                aria-pressed={ativo}
                disabled={total === 0 && !ativo}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition disabled:opacity-40 ${ativo ? "bg-marca text-sobre-marca" : "border border-borda bg-superficie text-suave hover:text-texto"}`}
              >
                {c} · {nomeNivel(curso.idioma, n)} ({total})
              </button>
            );
          })}
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <label className="relative min-w-48 flex-1">
            <span className="sr-only">Buscar exercício</span>
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-suave" />
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar pelo nome" className="h-10 w-full rounded-xl border border-borda bg-superficie pr-3 pl-9 text-sm focus:border-destaque focus:outline-none" />
          </label>
          {candidatos.length > 1 && (
            <>
              <button type="button" onClick={() => marcarTodos(true)} className="h-10 rounded-xl px-3 text-sm font-semibold text-destaque hover:bg-superficie">Marcar todos</button>
              <button type="button" onClick={() => marcarTodos(false)} className="h-10 rounded-xl px-3 text-sm font-semibold text-suave hover:bg-superficie">Desmarcar todos</button>
            </>
          )}
        </div>
        {candidatos.length > 0 ? (
          <ul className="mb-4 max-h-80 space-y-0.5 overflow-y-auto rounded-xl bg-superficie p-2 text-sm">
            {candidatos.map((l) => {
              const aula = aulaDe.get(l.id);
              return (
                <li key={l.id}>
                  <label className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-fundo">
                    <input type="checkbox" checked={marcado(l)} onChange={() => setTrocados(alternar(trocados, l.id))} className="size-4 accent-[var(--c-marca)]" />
                    <span className="w-6 shrink-0 text-right text-suave">{marcado(l) ? `${escolhidos.indexOf(l) + 1}.` : ""}</span>
                    <span className="min-w-0 flex-1 truncate">{l.titulo}</span>
                    {aula && <span className="hidden shrink-0 text-xs text-suave sm:inline">Aula {aula.numero}</span>}
                    {niveis.size > 1 && <span className="shrink-0 text-xs text-suave">{nomeNivel(curso.idioma, l.nivel)}</span>}
                    {l.status === "rascunho" && <Etiqueta tom="coral">Rascunho</Etiqueta>}
                  </label>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mb-4 text-sm text-suave">{niveis.size === 0 ? "Marque um nível para ver os exercícios." : "Nenhum exercício com esse filtro."}</p>
        )}
        <Botao onClick={adicionar} carregando={adicionando} disabled={escolhidos.length === 0}>
          <ClipboardList className="size-4" /> {escolhidos.length === 0 ? "Marque pelo menos um exercício" : `Adicionar ${escolhidos.length} ${escolhidos.length === 1 ? "exercício" : "exercícios"} ao curso`}
        </Botao>
        <p className="mt-2 text-xs text-suave">
          A ordem segue as aulas do curso (pelo nome do exercício) e depois o nome. Rascunhos vêm desmarcados: o aluno só os vê depois de publicados.
        </p>
      </div>
    </details>
  );
}
