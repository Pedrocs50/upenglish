import { useState } from "react";
import { AlertTriangle, Bug, CheckCircle2, Copy, ExternalLink, FlaskConical, MinusCircle, PlayCircle, RotateCcw, Trash2, XCircle } from "lucide-react";
import { CabecalhoPagina } from "../componentes/Painel";
import { Aviso, Botao, Etiqueta, TextoCarregando } from "../componentes/ui";
import { useConsulta } from "../lib/dados";
import { criarVerificacoes, rodarComPrazo, type Resultado, type Verificacao } from "../lib/diagnostico";
import { relatarErro, VERSAO_DO_SITE } from "../lib/monitor";
import { recontar } from "../lib/notificacoes";
import { supabase, traduzirErro } from "../lib/supabase";

type ErroDoSite = {
  id: string;
  origem: string;
  mensagem: string;
  detalhe: string;
  rota: string;
  navegador: string;
  versao: string;
  ultimo_por: string | null;
  ocorrencias: number;
  pessoas: string[];
  primeiro_em: string;
  ultimo_em: string;
  resolvido_em: string | null;
  voltou: boolean;
};

const ROTULOS: Record<string, string> = {
  tela: "Tela quebrou",
  pagina: "Erro na página",
  promessa: "Erro em segundo plano",
  banco: "Banco de dados",
  arquivos: "Arquivos",
  funcao: "Função de IA",
  login: "Login",
  leitor_pdf: "Leitor de PDF",
  teste: "Teste",
};

const formatoData = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
const quando = (data: string) => formatoData.format(new Date(data));

/** O que o erro costuma significar, em português, para saber por onde começar. */
function pista(e: ErroDoSite): string | null {
  const texto = `${e.mensagem}\n${e.detalhe}`.toLowerCase();
  if (e.origem === "teste") return "Erro criado pelo botão de teste: se ele apareceu aqui, o monitor está funcionando.";
  if (/pgrst20|does not exist|could not find/.test(texto)) return "O site pediu algo que o banco não tem. Quase sempre é migração que falta rodar: veja as verificações acima.";
  if (/permission denied|row-level security|42501/.test(texto)) return "Uma regra de acesso do banco barrou a ação. Se essa pessoa deveria poder fazer isso, a regra ou o jeito de gravar está errado.";
  if (/dynamically imported|importing a module script|not a valid javascript/.test(texto)) return "Tela aberta de uma versão antiga, logo depois de publicar. Se parar de acontecer em seguida, pode marcar como resolvido.";
  if (e.origem === "funcao") return "A função de IA falhou. Veja se a chave do Gemini está certa e os registros da função no Supabase.";
  if (e.origem === "leitor_pdf") return "O PDF não abriu para alguém. Veja se o arquivo existe e rode as verificações do PDF acima.";
  return null;
}

function IconeSituacao({ situacao }: { situacao?: Resultado["situacao"] }) {
  if (situacao === "ok") return <CheckCircle2 className="size-5 shrink-0 text-sucesso" aria-label="Certo" />;
  if (situacao === "aviso") return <AlertTriangle className="size-5 shrink-0 text-coral" aria-label="Atenção" />;
  if (situacao === "falha") return <XCircle className="size-5 shrink-0 text-erro" aria-label="Falhou" />;
  return <MinusCircle className="size-5 shrink-0 text-suave/50" aria-label="Ainda não rodou" />;
}

/** Confere, no sistema de verdade e com o login do admin, as partes que costumam quebrar. */
function Verificacoes({ aoEnviarTeste }: { aoEnviarTeste: () => void }) {
  const [lista] = useState<Verificacao[]>(() => criarVerificacoes());
  const [resultados, setResultados] = useState<Record<string, Resultado>>({});
  const [rodando, setRodando] = useState(false);
  const concluidos = Object.values(resultados);
  const problemas = concluidos.filter((r) => r.situacao === "falha").length;

  async function rodar() {
    setRodando(true);
    setResultados({});
    // Cada rodada busca tudo de novo.
    const rodada = criarVerificacoes();
    await Promise.all(rodada.map(async (v) => {
      const resultado = await rodarComPrazo(v);
      setResultados((atuais) => ({ ...atuais, [v.id]: resultado }));
    }));
    setRodando(false);
  }

  return (
    <section className="rounded-2xl border border-borda bg-superficie p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-lg font-bold text-marca"><FlaskConical className="size-5" /> Verificações</h2>
          <p className="mt-1 text-sm text-suave">Confere o site de verdade, neste navegador. Só lê: não muda nenhum dado e não gasta cota de IA.</p>
        </div>
        <Botao onClick={rodar} carregando={rodando}><PlayCircle className="size-4" /> Rodar verificações</Botao>
      </div>

      {!rodando && concluidos.length > 0 && (
        <div className="mt-4">
          {problemas === 0
            ? <Aviso tipo="sucesso">Nenhuma falha. Os avisos, se houver, não impedem o uso.</Aviso>
            : <Aviso>{problemas} verificação(ões) com falha. Veja o motivo em cada uma.</Aviso>}
        </div>
      )}

      <ul className="mt-4 divide-y divide-borda">
        {lista.map((v) => {
          const r = resultados[v.id];
          return (
            <li key={v.id} className="flex gap-3 py-2.5">
              <IconeSituacao situacao={r?.situacao} />
              <div className="min-w-0">
                <p className="text-sm font-semibold">{v.titulo}</p>
                {r && <p className="text-sm break-words text-suave">{r.texto}</p>}
                {!r && rodando && <p className="text-sm text-suave">Conferindo…</p>}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="mt-4 space-y-3 border-t border-borda pt-4 text-sm text-suave">
        <p>
          <strong className="font-semibold text-texto">Testes automáticos:</strong> as regras do banco e as funções de IA são testadas a cada publicação, fora do site (eles precisam de um banco de teste).{" "}
          <a href="https://github.com/Pedrocs50/eegen/actions" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-destaque underline">Ver no GitHub Actions <ExternalLink className="size-3.5" /></a>
        </p>
        <p><strong className="font-semibold text-texto">Versão publicada:</strong> <code>{VERSAO_DO_SITE}</code>. Cada erro abaixo mostra em qual versão aconteceu.</p>
      </div>

      <TesteDoMonitor aoEnviar={aoEnviarTeste} />
    </section>
  );
}

function TesteDoMonitor({ aoEnviar }: { aoEnviar: () => void }) {
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<boolean | null>(null);
  async function testar() {
    setEnviando(true);
    const enviado = await relatarErro("teste", "Erro de teste, enviado pelo botão do monitor");
    setResultado(enviado);
    setEnviando(false);
    aoEnviar();
  }
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <Botao variante="secundario" onClick={testar} carregando={enviando}><Bug className="size-4" /> Enviar um erro de teste</Botao>
      {resultado === true && <span className="text-sm text-sucesso">Enviado: ele deve aparecer em "Erros abertos".</span>}
      {resultado === false && <span className="text-sm text-erro">Não foi possível enviar. Confira se a migração 0020 foi rodada.</span>}
    </div>
  );
}

function CartaoErro({ e, nome, aoMudar }: { e: ErroDoSite; nome?: string; aoMudar: () => void }) {
  const [erro, setErro] = useState("");
  const [copiado, setCopiado] = useState(false);
  const dica = pista(e);

  async function marcar(resolvido: boolean) {
    setErro("");
    const { error } = await supabase.from("erros_do_site").update({ resolvido_em: resolvido ? new Date().toISOString() : null, voltou: false }).eq("id", e.id);
    if (error) setErro(traduzirErro(error.message));
    else aoMudar();
  }

  async function copiar() {
    const texto = [
      `${ROTULOS[e.origem] ?? e.origem}: ${e.mensagem}`,
      `Tela: ${e.rota || "(não informada)"}`,
      `Aconteceu ${e.ocorrencias} vez(es), com ${e.pessoas.length} pessoa(s). Primeira: ${quando(e.primeiro_em)}. Última: ${quando(e.ultimo_em)}.`,
      `Versão: ${e.versao || "(não informada)"}`,
      `Navegador: ${e.navegador || "(não informado)"}`,
      e.detalhe && `Detalhes:\n${e.detalhe}`,
    ].filter(Boolean).join("\n");
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      setErro("O navegador não deixou copiar. Abra os detalhes e selecione o texto.");
    }
  }

  return (
    <li className="rounded-xl border border-borda p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Etiqueta tom={e.origem === "teste" ? "creme" : "azul"}>{ROTULOS[e.origem] ?? e.origem}</Etiqueta>
        {e.voltou && <Etiqueta tom="coral">Voltou depois de resolvido</Etiqueta>}
        <span className="ml-auto text-xs text-suave">Última vez: {quando(e.ultimo_em)}</span>
      </div>
      <p className="mt-2 text-sm font-semibold break-words">{e.mensagem}</p>
      <p className="mt-1 text-xs text-suave">
        {e.ocorrencias} {e.ocorrencias === 1 ? "vez" : "vezes"} · {e.pessoas.length === 0 ? "sem login" : `${e.pessoas.length} ${e.pessoas.length === 1 ? "pessoa" : "pessoas"}`}
        {nome && ` · por último: ${nome}`}
        {e.rota && ` · tela ${e.rota}`}
      </p>
      {dica && <p className="mt-2 rounded-lg bg-destaque-suave px-3 py-2 text-sm text-marca">{dica}</p>}

      <details className="mt-2 text-sm">
        <summary className="cursor-pointer font-semibold text-suave hover:text-texto">Detalhes técnicos</summary>
        <dl className="mt-2 space-y-1 text-xs text-suave">
          <div>Primeira vez: {quando(e.primeiro_em)}</div>
          <div>Versão do site: {e.versao || "não informada"}</div>
          <div className="break-words">Navegador: {e.navegador || "não informado"}</div>
        </dl>
        {e.detalhe && <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-fundo p-3 text-xs whitespace-pre-wrap">{e.detalhe}</pre>}
      </details>

      {erro && <div className="mt-2"><Aviso>{erro}</Aviso></div>}
      <div className="mt-3 flex flex-wrap gap-2">
        {e.resolvido_em
          ? <Botao variante="secundario" onClick={() => marcar(false)}><RotateCcw className="size-4" /> Reabrir</Botao>
          : <Botao variante="secundario" onClick={() => marcar(true)}><CheckCircle2 className="size-4" /> Marcar como resolvido</Botao>}
        <Botao variante="fantasma" onClick={copiar}><Copy className="size-4" /> {copiado ? "Copiado" : "Copiar tudo"}</Botao>
      </div>
    </li>
  );
}

function ListaDeErros({ atualizacao }: { atualizacao: number }) {
  const [resolvidos, setResolvidos] = useState(false);
  const [erroAcao, setErroAcao] = useState("");
  const { dados, erro, carregando, recarregar } = useConsulta<{ erros: ErroDoSite[]; nomes: Record<string, string> }>(async () => {
    let consulta = supabase.from("erros_do_site").select("*").order("ultimo_em", { ascending: false }).limit(200);
    consulta = resolvidos ? consulta.not("resolvido_em", "is", null) : consulta.is("resolvido_em", null);
    const { data, error } = await consulta;
    if (error) return { data: null, error };
    const erros = data as ErroDoSite[];
    const ids = [...new Set(erros.map((e) => e.ultimo_por).filter((x): x is string => !!x))];
    const nomes: Record<string, string> = {};
    if (ids.length) {
      const pessoas = await supabase.from("perfis").select("id, nome, email").in("id", ids);
      for (const p of (pessoas.data ?? []) as { id: string; nome: string; email: string }[]) nomes[p.id] = p.nome || p.email;
    }
    return { data: { erros, nomes }, error: null };
  }, [resolvidos, atualizacao]);

  function aoMudar() {
    void recarregar();
    recontar();
  }

  async function limparResolvidos() {
    if (!window.confirm("Apagar todos os erros resolvidos? Se um deles acontecer de novo, ele volta como erro novo.")) return;
    setErroAcao("");
    const { error } = await supabase.from("erros_do_site").delete().not("resolvido_em", "is", null);
    if (error) setErroAcao(traduzirErro(error.message));
    else aoMudar();
  }

  const lista = dados?.erros ?? [];

  return (
    <section className="mt-6 rounded-2xl border border-borda bg-superficie p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-bold text-marca"><Bug className="size-5" /> Erros {resolvidos ? "resolvidos" : "abertos"}</h2>
        <div className="flex flex-wrap gap-2">
          {resolvidos && lista.length > 0 && <Botao variante="fantasma" onClick={limparResolvidos}><Trash2 className="size-4" /> Apagar resolvidos</Botao>}
          <Botao variante="secundario" onClick={() => setResolvidos(!resolvidos)}>{resolvidos ? "Ver abertos" : "Ver resolvidos"}</Botao>
        </div>
      </div>
      <p className="mt-1 mb-4 text-sm text-suave">O que quebrou no navegador de quem usa o site, do mais recente ao mais antigo. Erros iguais ficam juntos, e um erro resolvido que acontecer de novo reabre sozinho.</p>
      {erro && <Aviso>{erro}</Aviso>}
      {erroAcao && <Aviso>{erroAcao}</Aviso>}
      {carregando && !dados && <TextoCarregando />}
      {dados && lista.length === 0 && <p className="py-6 text-center text-sm text-suave">{resolvidos ? "Nenhum erro resolvido." : "Nenhum erro aberto."}</p>}
      {lista.length > 0 && (
        <ul className="space-y-3">
          {lista.map((e) => <CartaoErro key={e.id} e={e} nome={e.ultimo_por ? dados?.nomes[e.ultimo_por] : undefined} aoMudar={aoMudar} />)}
        </ul>
      )}
    </section>
  );
}

/** Aba do admin: erros que aconteceram com os usuários e verificações para achar a causa. */
export default function Monitor() {
  const [atualizacao, setAtualizacao] = useState(0);
  return (
    <>
      <CabecalhoPagina
        etiqueta="Administração"
        titulo="Erros e testes"
        descricao="Veja o que deu errado para quem usa o site e confira se as partes principais estão funcionando."
      />
      <Verificacoes aoEnviarTeste={() => { setAtualizacao((n) => n + 1); recontar(); }} />
      <ListaDeErros atualizacao={atualizacao} />
    </>
  );
}
