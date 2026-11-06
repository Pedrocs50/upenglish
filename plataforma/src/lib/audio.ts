import { fetchVigiado } from "./monitor";
import { supabase } from "./supabase";

export type ResultadoAudio = { url: string; caminho: string; hash: string; segundos: number; reaproveitado: boolean };

/** Identifica um áudio pelo conteúdo: mesmo roteiro e mesmas vozes reaproveitam o arquivo já gerado. */
export async function hashDoAudio(roteiro: string, vozes: Record<string, string>): Promise<string> {
  const normalizado = roteiro.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join("\n");
  const ordenadas = Object.keys(vozes).sort().map((f) => `${f}=${vozes[f]}`).join(";");
  const bytes = new TextEncoder().encode(`gemini-tts|${ordenadas}|${normalizado}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

/**
 * Converte o WAV (PCM 16 bits mono) devolvido pela função em MP3 de 64 kbps, aqui no navegador.
 * O encoder (~150 KB) só é baixado na primeira vez que alguém gera um áudio.
 */
export async function wavParaMp3(wav: ArrayBuffer): Promise<{ mp3: Blob; segundos: number }> {
  const { Mp3Encoder } = await import("@breezystack/lamejs");
  const v = new DataView(wav);
  const taxa = v.getUint32(24, true);
  const amostras = new Int16Array(wav, 44, (wav.byteLength - 44) / 2);
  const encoder = new Mp3Encoder(1, taxa, 64);
  const partes: Uint8Array[] = [];
  const bloco = 1152 * 20;
  for (let i = 0; i < amostras.length; i += bloco) partes.push(new Uint8Array(encoder.encodeBuffer(amostras.subarray(i, i + bloco))));
  partes.push(new Uint8Array(encoder.flush()));
  return { mp3: new Blob(partes as BlobPart[], { type: "audio/mpeg" }), segundos: amostras.length / taxa };
}

async function existe(url: string): Promise<boolean> {
  try {
    const resposta = await fetch(url, { method: "HEAD", cache: "no-store" });
    return resposta.ok;
  } catch {
    return false;
  }
}

/** Duração de um MP3 já publicado (para quando o áudio é reaproveitado do cache). */
function duracaoDe(url: string): Promise<number> {
  return new Promise((resolve) => {
    const audio = new Audio();
    audio.preload = "metadata";
    audio.onloadedmetadata = () => resolve(Number.isFinite(audio.duration) ? audio.duration : 0);
    audio.onerror = () => resolve(0);
    audio.src = url;
  });
}

/**
 * Gera (ou reaproveita) o áudio de um roteiro: chama a Edge Function "audio", converte para MP3
 * e guarda no bucket "audios" com o hash do conteúdo como nome.
 */
export async function gerarAudio(roteiro: string, vozes: Record<string, string>): Promise<ResultadoAudio> {
  const hash = await hashDoAudio(roteiro, vozes);
  const caminho = `${hash}.mp3`;
  const { data: publico } = supabase.storage.from("audios").getPublicUrl(caminho);
  if (await existe(publico.publicUrl)) {
    return { url: publico.publicUrl, caminho, hash, segundos: await duracaoDe(publico.publicUrl), reaproveitado: true };
  }

  const { data: sessao } = await supabase.auth.getSession();
  const token = sessao.session?.access_token;
  if (!token) throw new Error("Sua sessão expirou. Entre de novo.");
  const resposta = await fetchVigiado(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/audio`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ roteiro, vozes }),
  }).catch(() => null);
  if (!resposta) throw new Error("Não foi possível falar com o gerador de áudio. Verifique sua conexão.");
  if (!resposta.ok) {
    const corpo = await resposta.json().catch(() => null);
    throw new Error(corpo?.erro ?? `O gerador de áudio respondeu ${resposta.status}.`);
  }

  const { mp3, segundos } = await wavParaMp3(await resposta.arrayBuffer());
  const { error } = await supabase.storage.from("audios").upload(caminho, mp3, { contentType: "audio/mpeg", upsert: true, cacheControl: "31536000" });
  if (error) throw new Error(`O áudio foi gerado, mas não foi possível salvá-lo: ${error.message}`);
  return { url: publico.publicUrl, caminho, hash, segundos, reaproveitado: false };
}
