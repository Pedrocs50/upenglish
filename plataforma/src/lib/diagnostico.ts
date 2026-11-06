import { supabase } from "./supabase";
import { linkDoArquivo } from "./materiais";
import { abrirPdf, RECURSOS_PDF } from "./pdf";

export type Resultado = { situacao: "ok" | "aviso" | "falha"; texto: string };
export type Verificacao = { id: string; titulo: string; rodar: () => Promise<Resultado> };

type DadosDoBanco = {
  faltando: string[];
  tabelas_sem_rls: string[];
  contas_sem_perfil: number;
  buckets_faltando: string[];
  ia_24h: number;
  ia_falhas_24h: number;
  ia_ultima_falha: string | null;
};

/**
 * Uma marca de cada migração (a 0020 é a própria função que confere). Ao criar uma migração nova, acrescente aqui algo que
 * só ela cria: assim esta tela avisa quando o site foi publicado e a migração não foi rodada no Supabase.
 */
const MARCAS_DAS_MIGRACOES: Record<string, string> = {
  "0001": "proteger_perfil",
  "0002": "entrar_na_turma",
  "0003": "enviar_tentativa",
  "0004": "geracoes_ia",
  "0007": "ativo",
  "0009": "aula_listas",
  "0010": "resultados_lista",
  "0011": "lista_visivel",
  "0012": "notificacoes",
  "0013": "turma_encontros",
  "0014": "notificar_aulas_liberadas",
  "0015": "proteger_material_em_uso",
  "0016": "registro_exclusoes",
  "0018": "notificar_exercicios_do_curso",
  "0019": "notificar_exercicio_publicado",
};

/** Um arquivo de cada pasta do leitor de PDF. O site responde "200 com a página inicial" para arquivo que não existe: olhar só o status engana. */
const ARQUIVOS_DO_LEITOR = [`${RECURSOS_PDF.wasmUrl}openjpeg.wasm`, `${RECURSOS_PDF.standardFontDataUrl}FoxitDingbats.pfb`, `${RECURSOS_PDF.iccUrl}CGATS001Compat-v2-micro.icc`];

const FUNCOES = ["assistente", "audio"];
const PRAZO_MS = 20_000;

const ok = (texto: string): Resultado => ({ situacao: "ok", texto });
const aviso = (texto: string): Resultado => ({ situacao: "aviso", texto });
const falha = (texto: string): Resultado => ({ situacao: "falha", texto });

/** Roda uma verificação com prazo; um erro inesperado vira resultado em vez de travar a lista. */
export async function rodarComPrazo(v: Verificacao): Promise<Resultado> {
  let relogio: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      v.rodar(),
      new Promise<Resultado>((pronto) => {
        relogio = setTimeout(() => pronto(falha(`Não respondeu em ${PRAZO_MS / 1000} segundos.`)), PRAZO_MS);
      }),
    ]);
  } catch (e) {
    return falha((e as Error).message || "Erro inesperado.");
  } finally {
    clearTimeout(relogio);
  }
}

/** Monta as verificações de uma rodada. Nenhuma grava nada nem gasta cota de IA. */
export function criarVerificacoes(): Verificacao[] {
  // Várias verificações usam os mesmos dados: cada um é buscado uma vez por rodada.
  let dadosDoBanco: Promise<DadosDoBanco> | null = null;
  const banco = () => {
    dadosDoBanco ??= (async () => {
      const { data, error } = await supabase.rpc("diagnostico_banco", { p_esperados: Object.values(MARCAS_DAS_MIGRACOES) });
      if (error) throw new Error(error.code === "PGRST202" ? "Falta rodar a migração 0020 no SQL Editor do Supabase." : error.message);
      return data as DadosDoBanco;
    })();
    return dadosDoBanco;
  };

  let linkDePdf: Promise<string | null> | null = null;
  const pdfDeExemplo = () => {
    linkDePdf ??= (async () => {
      const { data, error } = await supabase.from("aulas").select("material_arquivo").neq("material_arquivo", "").limit(1);
      if (error) throw new Error(error.message);
      const caminho = (data as { material_arquivo: string }[])[0]?.material_arquivo;
      return caminho ? linkDoArquivo(caminho) : null;
    })();
    return linkDePdf;
  };

  return [
    {
      id: "conexao",
      titulo: "O banco de dados responde",
      rodar: async () => {
        const inicio = performance.now();
        const { error } = await supabase.from("perfis").select("id", { count: "exact", head: true });
        const ms = Math.round(performance.now() - inicio);
        if (error) return falha(`O banco não respondeu: ${error.message || "sem detalhes"}. Veja se o projeto do Supabase está ativo.`);
        return ms > 3000 ? aviso(`Respondeu, mas devagar (${ms} ms).`) : ok(`Respondeu em ${ms} ms.`);
      },
    },
    {
      id: "migracoes",
      titulo: "Todas as migrações foram rodadas",
      rodar: async () => {
        const { faltando } = await banco();
        if (faltando.length === 0) return ok("O banco tem tudo o que esta versão do site espera.");
        const quais = Object.entries(MARCAS_DAS_MIGRACOES).filter(([, marca]) => faltando.includes(marca)).map(([numero]) => numero);
        return falha(`Falta rodar no SQL Editor: ${quais.join(", ")}. Enquanto isso, partes do site podem dar erro.`);
      },
    },
    {
      id: "rls",
      titulo: "As regras de acesso estão ligadas em todas as tabelas",
      rodar: async () => {
        const { tabelas_sem_rls: tabelas } = await banco();
        return tabelas.length === 0 ? ok("Nenhuma tabela está aberta.") : falha(`Sem regras de acesso: ${tabelas.join(", ")}. Qualquer pessoa logada pode conseguir ler ou mudar esses dados.`);
      },
    },
    {
      id: "perfis",
      titulo: "Toda conta tem perfil",
      rodar: async () => {
        const { contas_sem_perfil: n } = await banco();
        return n === 0 ? ok("Nenhuma conta sem perfil.") : falha(`${n} conta(s) sem perfil: essas pessoas veem "Perfil não encontrado" ao entrar.`);
      },
    },
    {
      id: "buckets",
      titulo: "As pastas de arquivos existem",
      rodar: async () => {
        const { buckets_faltando: faltando } = await banco();
        return faltando.length === 0 ? ok("PDFs e áudios têm onde ficar.") : falha(`Faltam no Storage: ${faltando.join(", ")}.`);
      },
    },
    {
      id: "pdf-arquivo",
      titulo: "Um PDF enviado pode ser baixado",
      rodar: async () => {
        const link = await pdfDeExemplo();
        if (!link) return aviso("Nenhuma aula tem PDF enviado ainda: não houve o que testar.");
        const resposta = await fetch(link, { headers: { Range: "bytes=0-4" } });
        if (!resposta.ok) return falha(`O Storage respondeu HTTP ${resposta.status}.`);
        const inicio = await resposta.text();
        return inicio.startsWith("%PDF") ? ok("O link temporário funcionou e o arquivo é um PDF.") : falha("O arquivo baixado não parece ser um PDF.");
      },
    },
    {
      id: "pdf-leitor",
      titulo: "O leitor consegue desenhar um PDF",
      rodar: async () => {
        const link = await pdfDeExemplo();
        if (!link) return aviso("Nenhuma aula tem PDF enviado ainda: não houve o que testar.");
        const tarefa = await abrirPdf(link);
        try {
          const documento = await tarefa.promise;
          const pagina = await documento.getPage(1);
          const canvas = document.createElement("canvas");
          const viewport = pagina.getViewport({ scale: 0.25 });
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          await pagina.render({ canvas, viewport }).promise;
          return ok(`Abriu um PDF de ${documento.numPages} página(s) e desenhou a primeira, neste navegador.`);
        } finally {
          void tarefa.destroy();
        }
      },
    },
    {
      id: "pdf-recursos",
      titulo: "Os arquivos do leitor de PDF foram publicados",
      rodar: async () => {
        const problemas: string[] = [];
        for (const arquivo of ARQUIVOS_DO_LEITOR) {
          const resposta = await fetch(arquivo);
          const tipo = resposta.headers.get("content-type") ?? "";
          await resposta.body?.cancel();
          if (!resposta.ok || tipo.includes("text/html")) problemas.push(arquivo);
        }
        return problemas.length === 0 ? ok("Imagens e fontes especiais dos slides vão aparecer.") : falha(`Não encontrados: ${problemas.join(", ")}. Sem eles, imagens e fontes podem sumir dos slides; confira se o build rodou scripts/copiar-pdfjs.mjs.`);
      },
    },
    {
      id: "funcoes",
      titulo: "As funções de IA estão publicadas",
      rodar: async () => {
        const base = import.meta.env.VITE_SUPABASE_URL;
        const fora: string[] = [];
        for (const nome of FUNCOES) {
          // OPTIONS só pergunta se a função existe: não chama a IA nem gasta cota.
          const resposta = await fetch(`${base}/functions/v1/${nome}`, { method: "OPTIONS" }).catch(() => null);
          if (!resposta?.ok) fora.push(nome);
        }
        return fora.length === 0 ? ok(`${FUNCOES.join(" e ")} respondem. Isto não testa a chave do Gemini: veja a verificação abaixo.`) : falha(`Não responderam: ${fora.join(", ")}. Veja a publicação em GitHub Actions.`);
      },
    },
    {
      id: "ia",
      titulo: "Listas e áudios gerados nas últimas 24 horas",
      rodar: async () => {
        const { ia_24h: total, ia_falhas_24h: falhas, ia_ultima_falha: ultima } = await banco();
        if (total === 0) return ok("Ninguém usou a IA nas últimas 24 horas: não houve o que conferir.");
        if (falhas === 0) return ok(`${total} pedido(s), nenhum com falha.`);
        return aviso(`${falhas} de ${total} pedido(s) falharam. Último motivo: ${ultima ?? "não informado"}`);
      },
    },
  ];
}
