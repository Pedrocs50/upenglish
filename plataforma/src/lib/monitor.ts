/**
 * Relator de erros: manda para o banco o que quebra no navegador de quem usa o site (veja docs/monitor-de-erros.md).
 * Este arquivo não importa o Supabase, porque o próprio cliente do Supabase passa por aqui (fetchVigiado).
 */

export type OrigemErro = "tela" | "pagina" | "promessa" | "banco" | "arquivos" | "funcao" | "login" | "leitor_pdf" | "teste";

export type DadosDoErro = { origem: OrigemErro; mensagem: string; detalhe: string; rota: string; navegador: string; versao: string };

/** Commit publicado (o Cloudflare Pages informa no build). Mostra se o erro é de antes ou de depois de uma correção. */
export const VERSAO_DO_SITE: string = String(import.meta.env.CF_PAGES_COMMIT_SHA ?? "local").slice(0, 7);

const MAX_ENVIOS_POR_PAGINA = 20;
const ESPERA_ENTRE_REPETICOES_MS = 60_000;

let enviar: ((dados: DadosDoErro) => Promise<boolean>) | null = null;
let enviados = 0;
const ultimoEnvio = new Map<string, number>();

export function definirEnvioDeErros(fn: (dados: DadosDoErro) => Promise<boolean>) {
  enviar = fn;
}

function textoDoErro(erro: unknown) {
  if (erro instanceof Error) return erro.message || erro.name;
  if (typeof erro === "string") return erro;
  try {
    return JSON.stringify(erro) ?? String(erro);
  } catch {
    return String(erro);
  }
}

/** Registra um erro. Nunca lança nada e devolve se o envio deu certo: quem relata não pode quebrar por causa do relato. */
export async function relatarErro(origem: OrigemErro, erro: unknown, detalhe = ""): Promise<boolean> {
  try {
    const mensagem = textoDoErro(erro);
    const pilha = erro instanceof Error ? erro.stack ?? "" : "";
    const rota = window.location.pathname;
    if (origem !== "teste") {
      // Um erro em repetição (por exemplo, a cada segundo) não pode virar uma enxurrada de pedidos.
      const chave = `${origem}|${mensagem}|${rota}`;
      const agora = Date.now();
      if (enviados >= MAX_ENVIOS_POR_PAGINA || agora - (ultimoEnvio.get(chave) ?? 0) < ESPERA_ENTRE_REPETICOES_MS) return false;
      ultimoEnvio.set(chave, agora);
      enviados += 1;
    }
    if (!enviar) return false;
    const envio = enviar;
    // Fora do fluxo atual: o erro pode ter nascido dentro do próprio login do Supabase, que não aceita outro pedido ao mesmo tempo.
    await new Promise((pronto) => setTimeout(pronto, 0));
    return await envio({
      origem,
      mensagem,
      detalhe: [detalhe, pilha].filter(Boolean).join("\n\n"),
      rota,
      navegador: navigator.userAgent,
      versao: VERSAO_DO_SITE,
    });
  } catch {
    return false;
  }
}

type CorpoDaFalha = { code?: unknown; message?: unknown; details?: unknown; hint?: unknown; erro?: unknown; detalhe?: unknown; error?: unknown; statusCode?: unknown; msg?: unknown };

/**
 * Decide se uma resposta de erro do Supabase é um defeito a investigar. O que faz parte do uso normal fica de fora: senha
 * errada, sessão vencida, cota de IA do dia, mensagens das regras do banco ("esse convite não existe") e afins.
 */
export function classificarFalha(endereco: string, metodo: string, status: number, corpo: CorpoDaFalha): { origem: OrigemErro; mensagem: string; detalhe: string } | null {
  let caminho: string;
  try {
    caminho = new URL(endereco).pathname;
  } catch {
    return null;
  }
  if (caminho.endsWith("/rpc/registrar_erro")) return null; // Se o relato falhar, não há o que relatar.

  const codigo = String(corpo.code ?? "");
  const texto = String(corpo.detalhe ?? corpo.message ?? corpo.erro ?? corpo.error ?? corpo.msg ?? "");
  const partes = caminho.split("/").filter(Boolean);
  const alvo = partes.slice(2, 4).join("/");

  let origem: OrigemErro;
  let vale: boolean;
  if (caminho.startsWith("/rest/v1/")) {
    origem = "banco";
    // 42xxx: permissão ou coluna/tabela que não existe. PGRST2xx: o banco não tem o que o site pediu (falta migração).
    vale = status >= 500 || codigo.startsWith("42") || codigo.startsWith("PGRST2");
  } else if (caminho.startsWith("/storage/v1/")) {
    origem = "arquivos";
    vale = status >= 500 || /row-level security|permission denied/i.test(texto);
  } else if (caminho.startsWith("/functions/v1/")) {
    origem = "funcao";
    vale = status >= 500;
  } else if (caminho.startsWith("/auth/v1/")) {
    origem = "login";
    vale = status >= 500;
  } else {
    return null;
  }
  if (!vale) return null;

  const detalhes = [`HTTP ${status}`, codigo && `código ${codigo}`, corpo.details && `detalhes: ${String(corpo.details)}`, corpo.hint && `dica: ${String(corpo.hint)}`];
  return {
    origem,
    mensagem: `${metodo} ${alvo}: ${texto || `HTTP ${status}`}`,
    detalhe: detalhes.filter(Boolean).join("\n"),
  };
}

async function examinarFalha(endereco: string, metodo: string, resposta: Response) {
  const corpo = (await resposta.json().catch(() => ({}))) as CorpoDaFalha;
  const falha = classificarFalha(endereco, metodo, resposta.status, corpo ?? {});
  if (falha) await relatarErro(falha.origem, falha.mensagem, falha.detalhe);
}

/** fetch do cliente Supabase: guarda o motivo técnico das falhas, que na tela vira só "Você não tem permissão". */
export const fetchVigiado: typeof fetch = async (entrada, opcoes) => {
  const resposta = await fetch(entrada, opcoes);
  if (resposta.status >= 400) {
    try {
      const pedido = entrada instanceof Request ? entrada : null;
      const endereco = pedido ? pedido.url : String(entrada);
      void examinarFalha(endereco, (opcoes?.method ?? pedido?.method ?? "GET").toUpperCase(), resposta.clone());
    } catch {
      // A resposta segue para quem pediu, mesmo se não der para examiná-la.
    }
  }
  return resposta;
};

/** Depois de uma publicação, quem está com o site aberto pede arquivos que não existem mais. */
export function ehArquivoVelho(erro: unknown) {
  return /dynamically imported module|importing a module script failed|error loading dynamically|'text\/html' is not a valid javascript/i.test(textoDoErro(erro));
}

/** Recarrega para pegar a versão nova, uma vez só: se o erro continuar depois disso, ele é de verdade. */
export function recarregarUmaVez() {
  const CHAVE = "monitor.recarregou_em";
  try {
    if (Date.now() - Number(sessionStorage.getItem(CHAVE) ?? 0) < 5 * 60_000) return false;
    sessionStorage.setItem(CHAVE, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

/** Não são defeitos do site: internet do usuário, avisos inofensivos do navegador e pedidos cancelados. */
const RUIDO = /ResizeObserver loop|^Script error\.?$|AbortError|signal is aborted|Failed to fetch|NetworkError|Load failed|chrome-extension:|moz-extension:|safari-web-extension:/i;

function ehRuido(erro: unknown, arquivo = "") {
  const pilha = erro instanceof Error ? erro.stack ?? "" : "";
  return RUIDO.test(textoDoErro(erro)) || RUIDO.test(pilha) || RUIDO.test(arquivo) || (erro instanceof DOMException && erro.name === "AbortError");
}

/** Liga a captura dos erros que ninguém tratou. Chamar uma vez, ao abrir o site. */
export function iniciarMonitor() {
  window.addEventListener("error", (evento) => {
    const erro = evento.error ?? evento.message;
    if (!erro || ehRuido(erro, evento.filename) || (evento.filename && !evento.filename.startsWith(window.location.origin))) return;
    void relatarErro("pagina", erro, evento.filename ? `${evento.filename}:${evento.lineno}:${evento.colno}` : "");
  });
  window.addEventListener("unhandledrejection", (evento) => {
    if (!ehRuido(evento.reason)) void relatarErro("promessa", evento.reason);
  });
  // O Vite avisa quando não consegue baixar um pedaço do site (normal logo depois de publicar).
  window.addEventListener("vite:preloadError", (evento) => {
    if (recarregarUmaVez()) evento.preventDefault();
  });
}
