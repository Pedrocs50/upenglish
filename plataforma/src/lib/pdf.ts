import type { PDFDocumentLoadingTask } from "pdfjs-dist";

/** O que o PDF.js busca sob demanda (copiado antes do build, por scripts/copiar-pdfjs.mjs). */
export const RECURSOS_PDF = {
  wasmUrl: "/pdfjs/wasm/",
  standardFontDataUrl: "/pdfjs/standard_fonts/",
  cMapUrl: "/pdfjs/cmaps/",
  iccUrl: "/pdfjs/iccs/",
};

/**
 * Carrega o PDF.js só quando alguém abre uma aula (~1 MB entre biblioteca e worker).
 * Usa o build "legacy": o normal exige recursos muito novos do navegador e não abre em celulares um pouco mais antigos.
 * Sem os RECURSOS_PDF, imagens JPEG2000 somem dos slides e fontes não embutidas saem trocadas.
 */
export async function abrirPdf(url: string): Promise<PDFDocumentLoadingTask> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { default: worker } = await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  return pdfjs.getDocument({ url, ...RECURSOS_PDF });
}
