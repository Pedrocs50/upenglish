// Copia para public/pdfjs (fora do git) o que o PDF.js busca sob demanda. Sem isso, imagens JPEG2000 somem dos slides
// e fontes não embutidas saem trocadas. O npm roda este script antes de "dev" e de "build". Usado em src/componentes/LeitorPdf.tsx.
import { cpSync } from "node:fs";

for (const pasta of ["wasm", "standard_fonts", "cmaps", "iccs"]) {
  cpSync(new URL(`../node_modules/pdfjs-dist/${pasta}`, import.meta.url), new URL(`../public/pdfjs/${pasta}`, import.meta.url), { recursive: true });
}
