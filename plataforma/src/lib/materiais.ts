import { supabase } from "./supabase";

/** Limite do bucket "materiais" (migração 0009). Os PDFs das aulas da escola têm de 1 a 3 MB. */
export const TAMANHO_MAXIMO_MB = 50;

export type FonteMaterial =
  | { tipo: "arquivo"; caminho: string; nome: string }
  | { tipo: "drive"; embed: string; original: string }
  | { tipo: "link"; url: string };

/** Envia o PDF da aula ao bucket privado e devolve o caminho e o nome original. */
export async function enviarMaterial(arquivo: File): Promise<{ caminho: string; nome: string }> {
  const ehPdf = arquivo.type === "application/pdf" || arquivo.name.toLowerCase().endsWith(".pdf");
  if (!ehPdf) throw new Error("Envie um arquivo PDF.");
  if (arquivo.size > TAMANHO_MAXIMO_MB * 1024 * 1024) {
    throw new Error(`O PDF tem ${(arquivo.size / 1024 / 1024).toFixed(1)} MB; o máximo é ${TAMANHO_MAXIMO_MB} MB.`);
  }
  const caminho = `${crypto.randomUUID()}.pdf`;
  const { error } = await supabase.storage.from("materiais").upload(caminho, arquivo, { contentType: "application/pdf" });
  if (error) throw new Error(`Não foi possível enviar o PDF: ${error.message}`);
  return { caminho, nome: arquivo.name };
}

/** Link temporário (1 hora) para ler um PDF do bucket privado. Só funciona para quem pode ver a aula. */
export async function linkDoArquivo(caminho: string): Promise<string> {
  const { data, error } = await supabase.storage.from("materiais").createSignedUrl(caminho, 3600);
  if (error || !data) throw new Error("Não foi possível abrir o material desta aula.");
  return data.signedUrl;
}

/**
 * Links do Google Drive, Docs e Slides viram a versão "preview", que abre dentro do site (inclusive no celular).
 * Exemplo: drive.google.com/file/d/ABC/view -> drive.google.com/file/d/ABC/preview
 */
export function embedDoGoogle(url: string): string | null {
  // "/u/0/" aparece em quem tem mais de uma conta Google. Links "/d/e/..." (publicados na web) não têm a versão preview.
  const arquivo = /drive\.google\.com\/file\/(?:u\/\d+\/)?d\/([\w-]+)/.exec(url);
  if (arquivo) return `https://drive.google.com/file/d/${arquivo[1]}/preview`;
  const aberto = /drive\.google\.com\/(?:open|uc)\?(?:[^#]*&)?id=([\w-]+)/.exec(url);
  if (aberto) return `https://drive.google.com/file/d/${aberto[1]}/preview`;
  const documento = /docs\.google\.com\/(document|presentation|spreadsheets)\/(?:u\/\d+\/)?d\/(?!e\/)([\w-]+)/.exec(url);
  if (documento) return `https://docs.google.com/${documento[1]}/d/${documento[2]}/preview`;
  return null;
}

/** De onde vem o material da aula: arquivo enviado tem prioridade sobre o link. */
export function fonteDoMaterial(aula: { material_arquivo?: string; material_nome?: string; material_url?: string }): FonteMaterial | null {
  if (aula.material_arquivo) return { tipo: "arquivo", caminho: aula.material_arquivo, nome: aula.material_nome || "Material da aula.pdf" };
  if (!aula.material_url) return null;
  const embed = embedDoGoogle(aula.material_url);
  return embed ? { tipo: "drive", embed, original: aula.material_url } : { tipo: "link", url: aula.material_url };
}
