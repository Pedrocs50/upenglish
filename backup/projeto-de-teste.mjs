// Cria e apaga o projeto temporário do teste de restauração, pela API do Supabase. Veja docs/backup.md.
//
// Uso:  node projeto-de-teste.mjs criar | apagar
// "criar" entrega os dados de acesso às próximas etapas do GitHub Actions, sem mostrá-los no registro.
import crypto from "node:crypto";
import fs from "node:fs";

const API = process.env.SUPABASE_API ?? "https://api.supabase.com";
const PROJETO_REAL = "txzjjmufcevisnsvtjwt";
const PREFIXO = "teste-restauracao-";
const REGIAO = "sa-east-1";
const PRAZO_MS = Number(process.env.PRAZO_MS ?? 10 * 60_000);
const INTERVALO_MS = Number(process.env.INTERVALO_MS ?? 15_000);

const { SUPABASE_ACCESS_TOKEN: token, ORGANIZACAO: organizacao, GITHUB_ENV: arquivoEnv, PROJETO_TESTE_REF: refAtual, GITHUB_RUN_ID: execucao } = process.env;
if (!token) throw new Error("Defina SUPABASE_ACCESS_TOKEN.");

async function api(metodo, caminho, corpo) {
  const resposta = await fetch(`${API}${caminho}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const texto = await resposta.text();
  let dados = null;
  try {
    dados = JSON.parse(texto);
  } catch {
    // Algumas respostas não têm JSON.
  }
  return { status: resposta.status, ok: resposta.ok, dados, motivo: dados?.message ?? dados?.error ?? "" };
}

function exigir(resposta, acao) {
  if (resposta.ok) return resposta.dados;
  // Só o motivo: as respostas de sucesso desta API trazem chaves e nunca são mostradas.
  const faltando = resposta.dados?.missing_permissions ? ` Permissões que faltam: ${JSON.stringify(resposta.dados.missing_permissions)}.` : "";
  throw new Error(`Não foi possível ${acao} (HTTP ${resposta.status}): ${resposta.motivo}.${faltando}`);
}

function entregar(nome, valor, { secreto = true } = {}) {
  if (secreto) console.log(`::add-mask::${valor}`);
  fs.appendFileSync(arquivoEnv, `${nome}=${valor}\n`);
}

async function esperarPronto(ref) {
  const limite = Date.now() + PRAZO_MS;
  for (;;) {
    const { status } = exigir(await api("GET", `/v1/projects/${ref}`), "consultar o projeto de teste");
    if (status === "ACTIVE_HEALTHY") return;
    if (Date.now() > limite) throw new Error(`O projeto de teste não ficou pronto a tempo (situação: ${status}).`);
    await new Promise((pronto) => setTimeout(pronto, INTERVALO_MS));
  }
}

async function criar() {
  if (!organizacao) throw new Error("Defina ORGANIZACAO.");
  if (!arquivoEnv) throw new Error("Este comando roda dentro do GitHub Actions.");
  const senha = crypto.randomBytes(24).toString("hex");
  console.log(`::add-mask::${senha}`);
  const projeto = exigir(
    await api("POST", "/v1/projects", { name: `${PREFIXO}${execucao ?? Date.now()}`, organization_slug: organizacao, db_pass: senha, region: REGIAO }),
    "criar o projeto de teste",
  );
  const ref = projeto.ref ?? projeto.id;
  if (!ref || ref === PROJETO_REAL) throw new Error("Resposta inesperada ao criar o projeto de teste.");
  // Antes de tudo: se algo falhar daqui em diante, a etapa de apagar já sabe qual projeto apagar.
  entregar("PROJETO_TESTE_REF", ref, { secreto: false });
  console.log(`Projeto de teste criado: ${ref}. Esperando ficar pronto...`);

  await esperarPronto(ref);

  const chaves = exigir(await api("GET", `/v1/projects/${ref}/api-keys?reveal=true`), "ler as chaves do projeto de teste");
  const chave = chaves.find((c) => c.type === "secret")?.api_key ?? chaves.find((c) => c.name === "service_role")?.api_key;
  if (!chave) throw new Error("O projeto de teste veio sem chave secreta.");

  const poolers = exigir(await api("GET", `/v1/projects/${ref}/config/database/pooler`), "ler a conexão do projeto de teste");
  const pooler = poolers.find((p) => p.database_type === "PRIMARY") ?? poolers[0];
  if (!pooler?.db_host || !pooler?.db_user) throw new Error("O projeto de teste veio sem conexão.");

  entregar("TESTE_SUPABASE_URL", `https://${ref}.supabase.co`, { secreto: false });
  entregar("TESTE_SUPABASE_SERVICE_KEY", chave);
  // Porta 5432 do pooler: o modo de sessão, o único que aceita a restauração.
  entregar("TESTE_SUPABASE_DB_URL", `postgresql://${pooler.db_user}:${senha}@${pooler.db_host}:5432/postgres`);
  console.log("Projeto de teste pronto.");
}

async function apagar() {
  if (!refAtual) throw new Error("Nenhum projeto de teste para apagar.");
  if (refAtual === PROJETO_REAL) throw new Error("Recusado: este é o projeto REAL.");
  const projeto = exigir(await api("GET", `/v1/projects/${refAtual}`), "consultar o projeto antes de apagar");
  if (projeto.ref !== refAtual && projeto.id !== refAtual) throw new Error("Recusado: a resposta não é do projeto criado neste teste.");
  if (!String(projeto.name ?? "").startsWith(PREFIXO)) throw new Error(`Recusado: "${projeto.name}" não é um projeto de teste.`);
  exigir(await api("DELETE", `/v1/projects/${refAtual}`), "apagar o projeto de teste");
  console.log(`Projeto de teste ${refAtual} apagado.`);
}

const modo = process.argv[2];
if (modo === "criar") await criar();
else if (modo === "apagar") await apagar();
else throw new Error("Uso: node projeto-de-teste.mjs criar|apagar");
