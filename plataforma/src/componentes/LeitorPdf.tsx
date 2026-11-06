import { useEffect, useRef, useState } from "react";
import { ExternalLink, FileText, Maximize2, Minimize2 } from "lucide-react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import { abrirMaterial } from "../lib/biblioteca";
import { fonteDoMaterial, linkDoArquivo, type FonteMaterial } from "../lib/materiais";
import { relatarErro } from "../lib/monitor";
import { abrirPdf } from "../lib/pdf";
import { Aviso } from "./ui";

/** Uma página do PDF: só é desenhada quando chega perto da tela (os slides das aulas passam de 30 páginas). */
function Pagina({ documento, numero, largura }: { documento: PDFDocumentProxy; numero: number; largura: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const caixa = useRef<HTMLDivElement>(null);
  const [visivel, setVisivel] = useState(numero <= 2);
  const [proporcao, setProporcao] = useState(9 / 16);
  const [falhou, setFalhou] = useState(false);

  useEffect(() => {
    if (visivel || !caixa.current) return;
    const observador = new IntersectionObserver((entradas) => {
      if (entradas.some((e) => e.isIntersecting)) setVisivel(true);
    }, { rootMargin: "600px 0px" });
    observador.observe(caixa.current);
    return () => observador.disconnect();
  }, [visivel]);

  useEffect(() => {
    if (!visivel || !canvas.current || largura === 0) return;
    let cancelado = false;
    let tarefa: { cancel: () => void } | null = null;
    setFalhou(false);
    documento.getPage(numero).then((pagina) => {
      if (cancelado || !canvas.current) return undefined;
      const base = pagina.getViewport({ scale: 1 });
      setProporcao(base.height / base.width);
      const densidade = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = pagina.getViewport({ scale: (largura / base.width) * densidade });
      canvas.current.width = viewport.width;
      canvas.current.height = viewport.height;
      const render = pagina.render({ canvas: canvas.current, viewport });
      tarefa = render;
      return render.promise;
    }).catch((e: { name?: string }) => {
      // Cancelar é normal (a janela mudou de tamanho ou a pessoa saiu da aula); o resto vira aviso em vez de página em branco.
      if (!cancelado && e?.name !== "RenderingCancelledException") {
        setFalhou(true);
        void relatarErro("leitor_pdf", e, `Ao desenhar a página ${numero}.`);
      }
    });
    return () => {
      cancelado = true;
      tarefa?.cancel();
    };
  }, [visivel, documento, numero, largura]);

  return (
    <div ref={caixa} className="relative overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-borda" style={{ aspectRatio: `1 / ${proporcao}` }}>
      <canvas ref={canvas} className="block h-full w-full" aria-label={`Página ${numero}`} role="img" />
      {falhou && <p className="absolute inset-0 grid place-items-center p-4 text-center text-sm text-suave">Não foi possível mostrar a página {numero}. Use "Abrir em outra aba".</p>}
    </div>
  );
}

function LeitorDeArquivo({ url, nome }: { url: string; nome: string }) {
  const area = useRef<HTMLDivElement>(null);
  const [documento, setDocumento] = useState<PDFDocumentProxy | null>(null);
  const [erro, setErro] = useState("");
  const [largura, setLargura] = useState(0);

  useEffect(() => {
    let ativo = true;
    let tarefa: PDFDocumentLoadingTask | null = null;
    setErro("");
    abrirPdf(url)
      .then((t) => {
        tarefa = t;
        if (!ativo) t.destroy();
        return t.promise;
      })
      .then((doc) => ativo && setDocumento(doc))
      .catch((e) => {
        if (!ativo) return;
        console.error("Leitor de PDF:", e);
        void relatarErro("leitor_pdf", e, `Ao abrir: ${nome}`);
        setErro("Não foi possível mostrar o PDF aqui.");
      });
    return () => {
      ativo = false;
      setDocumento(null);
      // Libera o worker e a memória do PDF ao sair da aula.
      tarefa?.destroy();
    };
  }, [url]);

  // Desenha na largura real da área (e redesenha se a janela mudar de tamanho).
  useEffect(() => {
    if (!area.current) return;
    const medir = () => setLargura(area.current?.clientWidth ?? 0);
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(area.current);
    return () => observador.disconnect();
  }, [documento]);

  if (erro) {
    return (
      <Aviso tipo="info">
        {erro} <a href={url} target="_blank" rel="noreferrer" className="font-semibold underline">Abrir {nome} em outra aba</a>
      </Aviso>
    );
  }
  if (!documento) return <p className="py-10 text-center text-suave" role="status">Abrindo o material…</p>;

  return (
    <div ref={area} className="space-y-3">
      <p className="text-xs text-suave">{documento.numPages} páginas</p>
      {Array.from({ length: documento.numPages }, (_, i) => (
        <Pagina key={i} documento={documento} numero={i + 1} largura={largura} />
      ))}
    </div>
  );
}

/** Mostra o material da aula dentro do site: PDF enviado (PDF.js), Google Drive (preview) ou link de PDF. */
export default function LeitorPdf({ aula }: { aula: { material_arquivo?: string; material_nome?: string; material_url?: string } }) {
  const fonte: FonteMaterial | null = fonteDoMaterial(aula);
  const [url, setUrl] = useState<string | null>(null);
  const [erro, setErro] = useState("");
  const [expandido, setExpandido] = useState(false);

  /** PDF enviado: pede um link novo na hora, porque o da página vence em 1 hora e a aula pode ter ficado aberta. */
  const abrirArquivoFora = (caminho: string) => abrirMaterial(caminho).catch((e) => setErro((e as Error).message));

  useEffect(() => {
    setErro("");
    setUrl(null);
    if (!fonte) return;
    if (fonte.tipo === "arquivo") linkDoArquivo(fonte.caminho).then(setUrl).catch((e) => {
      setErro((e as Error).message);
      void relatarErro("leitor_pdf", e, `Arquivo: ${fonte.caminho}`);
    });
    else setUrl(fonte.tipo === "drive" ? fonte.embed : fonte.url);
    // A fonte só muda quando os campos da aula mudam.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aula.material_arquivo, aula.material_url]);

  if (!fonte) return null;
  const abrirFora = fonte.tipo === "drive" ? fonte.original : url;

  return (
    <section className={`rounded-2xl border border-borda bg-superficie p-4 sm:p-5 ${expandido ? "" : ""}`} aria-label="Material da aula">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <FileText className="size-5 text-marca" aria-hidden="true" />
        <h2 className="flex-1 font-serif text-lg font-bold text-marca">Material da aula</h2>
        {fonte.tipo !== "drive" && (
          <button onClick={() => setExpandido(!expandido)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-suave hover:bg-fundo hover:text-texto">
            {expandido ? <><Minimize2 className="size-3.5" /> Reduzir</> : <><Maximize2 className="size-3.5" /> Ampliar</>}
          </button>
        )}
        {fonte.tipo === "arquivo" ? (
          <button type="button" onClick={() => abrirArquivoFora(fonte.caminho)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-destaque hover:bg-destaque-suave">
            <ExternalLink className="size-3.5" /> Abrir em outra aba
          </button>
        ) : abrirFora && (
          <a href={abrirFora} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-destaque hover:bg-destaque-suave">
            <ExternalLink className="size-3.5" /> Abrir em outra aba
          </a>
        )}
      </div>
      {erro && <Aviso>{erro}</Aviso>}
      {url && fonte.tipo === "drive" && (
        <iframe src={url} title="Material da aula" className="aspect-[4/3] w-full rounded-lg border border-borda sm:aspect-video" allow="autoplay" />
      )}
      {url && fonte.tipo !== "drive" && (
        <div className={expandido ? "" : "mx-auto max-w-3xl"}>
          <LeitorDeArquivo url={url} nome={fonte.tipo === "arquivo" ? fonte.nome : "o PDF"} />
        </div>
      )}
    </section>
  );
}
