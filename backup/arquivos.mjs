// Copia os arquivos do Storage (PDFs e áudios) para uma pasta, ou de volta para um projeto. O backup do banco não inclui arquivos.
//
// Uso:  node arquivos.mjs baixar <pasta>    node arquivos.mjs enviar <pasta>
// Precisa de SUPABASE_URL e SUPABASE_SERVICE_KEY. Veja docs/backup.md.
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

const [modo, pasta] = process.argv.slice(2);
const { SUPABASE_URL: url, SUPABASE_SERVICE_KEY: chave } = process.env;
if (!["baixar", "enviar"].includes(modo) || !pasta) throw new Error("Uso: node arquivos.mjs baixar|enviar <pasta>");
if (!url || !chave) throw new Error("Defina SUPABASE_URL e SUPABASE_SERVICE_KEY.");

const supabase = createClient(url, chave, { auth: { persistSession: false, autoRefreshToken: false } });
const TENTATIVAS = 3;
const AO_MESMO_TEMPO = 4;
const POR_PAGINA = 1000;

/** Repete o que falhou (rede) antes de desistir daquele arquivo. */
async function comRepeticao(acao) {
  for (let tentativa = 1; ; tentativa++) {
    try {
      return await acao();
    } catch (erro) {
      if (tentativa >= TENTATIVAS) throw erro;
      await new Promise((pronto) => setTimeout(pronto, 1000 * tentativa));
    }
  }
}

/** Todos os arquivos de um bucket, entrando nas subpastas. */
async function listar(bucket, prefixo = "") {
  const encontrados = [];
  for (let inicio = 0; ; inicio += POR_PAGINA) {
    const { data, error } = await supabase.storage.from(bucket).list(prefixo, { limit: POR_PAGINA, offset: inicio, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(`Não foi possível listar ${bucket}/${prefixo}: ${error.message}`);
    for (const item of data) {
      const nome = prefixo ? `${prefixo}/${item.name}` : item.name;
      // Pasta não tem id.
      if (item.id === null || item.id === undefined) encontrados.push(...(await listar(bucket, nome)));
      else encontrados.push({ bucket, nome, tamanho: item.metadata?.size ?? null, tipo: item.metadata?.mimetype ?? "application/octet-stream" });
    }
    if (data.length < POR_PAGINA) return encontrados;
  }
}

/** Caminho local do arquivo. Um nome como "../x" não pode escrever fora da pasta. */
function caminhoLocal(arquivo) {
  const base = path.resolve(pasta, arquivo.bucket);
  const destino = path.resolve(base, arquivo.nome);
  if (!destino.startsWith(base + path.sep)) throw new Error("Nome de arquivo inválido.");
  return destino;
}

async function paraCada(lista, acao) {
  const falhas = [];
  let proximo = 0;
  await Promise.all(Array.from({ length: AO_MESMO_TEMPO }, async () => {
    while (proximo < lista.length) {
      const item = lista[proximo++];
      try {
        await comRepeticao(() => acao(item));
      } catch (erro) {
        falhas.push(`${item.bucket}/${item.nome}: ${erro.message}`);
      }
    }
  }));
  return falhas;
}

async function baixar() {
  const { data: buckets, error } = await supabase.storage.listBuckets();
  if (error) throw new Error(`Não foi possível listar os buckets: ${error.message}`);
  if (!buckets.length) throw new Error("Nenhum bucket encontrado: a chave ou o projeto estão errados?");

  const arquivos = [];
  for (const b of buckets) arquivos.push(...(await listar(b.id)));

  const falhas = await paraCada(arquivos, async (a) => {
    const { data, error: erro } = await supabase.storage.from(a.bucket).download(a.nome);
    if (erro) throw new Error(erro.message || "download falhou");
    const conteudo = Buffer.from(await data.arrayBuffer());
    if (a.tamanho !== null && conteudo.length !== a.tamanho) throw new Error(`veio com ${conteudo.length} bytes; eram ${a.tamanho}`);
    const destino = caminhoLocal(a);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, conteudo);
  });

  fs.writeFileSync(path.join(pasta, "arquivos.json"), JSON.stringify(arquivos, null, 1));
  // Um arquivo com defeito não pode impedir a cópia do resto: a falha fica anotada e o fazer-backup.sh a informa.
  if (falhas.length) fs.writeFileSync(path.join(pasta, "falhas.txt"), falhas.join("\n") + "\n");
  console.log(`${arquivos.length - falhas.length} de ${arquivos.length} arquivo(s) copiados de ${buckets.length} bucket(s).`);
}

async function enviar() {
  const arquivos = JSON.parse(fs.readFileSync(path.join(pasta, "arquivos.json"), "utf8"));
  const falhas = await paraCada(arquivos, async (a) => {
    const conteudo = fs.readFileSync(caminhoLocal(a));
    const { error } = await supabase.storage.from(a.bucket).upload(a.nome, conteudo, { upsert: true, contentType: a.tipo });
    if (error) throw new Error(error.message);
  });
  console.log(`${arquivos.length - falhas.length} de ${arquivos.length} arquivo(s) enviados.`);
  if (falhas.length) {
    console.error(falhas.join("\n"));
    process.exit(1);
  }
}

await (modo === "baixar" ? baixar() : enviar());
