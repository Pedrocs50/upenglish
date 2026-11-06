import { supabase } from "./supabase";

/** Um horário fixo da turma, no horário de Brasília. dia: 0 = domingo ... 6 = sábado. */
export type Horario = { dia: number; inicio: string; fim: string };
export type Encontros = { turma_id: string; link: string; horarios: Horario[]; aviso: string; aviso_ate: string | null; atualizado_em: string };

export const DIAS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
export const DIAS_CURTOS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const FUSO = "America/Sao_Paulo";
const SEMANA = 7 * 24 * 60;
/** O botão "Entrar na aula" ganha destaque a partir de quantos minutos antes. */
export const MINUTOS_ANTES = 15;

export async function buscarEncontros(idTurma: string) {
  const { data, error } = await supabase.from("turma_encontros").select("*").eq("turma_id", idTurma).maybeSingle();
  return { data: (data as Encontros | null) ?? null, error };
}

/**
 * Grava o link e os horários da turma. Atualiza e, se a turma ainda não tem linha, cria.
 * Não dá para usar upsert aqui: o PostgREST também regrava a chave (turma_id) no conflito, e a tabela só permite
 * alterar as colunas de conteúdo (migração 0013). O banco recusava todo salvamento com "permission denied".
 */
export async function salvarEncontros(idTurma: string, campos: Pick<Encontros, "link" | "horarios" | "aviso" | "aviso_ate" | "atualizado_em">) {
  const { data, error } = await supabase.from("turma_encontros").update(campos).eq("turma_id", idTurma).select("turma_id");
  if (error || data.length > 0) return { error };
  return supabase.from("turma_encontros").insert({ turma_id: idTurma, ...campos });
}

/**
 * Aceita o link do jeito que a pessoa colar: sem "https://" ou no meio do convite inteiro do Meet.
 * O que não dá para corrigir volta como veio, e a tela avisa.
 */
export function normalizarLink(texto: string) {
  const limpo = texto.trim();
  const meet = /(?:https?:\/\/)?meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}(?:\?\S*)?/i.exec(limpo)?.[0];
  if (meet) return `https://${meet.replace(/^https?:\/\//i, "")}`;
  return !limpo || /\s/.test(limpo) || /^[a-z][a-z0-9+.-]*:/i.test(limpo) ? limpo : `https://${limpo}`;
}

const paraMinutos = (hora: string) => {
  const [h, m] = hora.split(":").map(Number);
  return h * 60 + (m || 0);
};

/** Dia da semana, minutos do dia e a data (AAAA-MM-DD) agora, em Brasília, onde quer que o aluno esteja. */
export function agoraEmBrasilia(agora = new Date()) {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: FUSO, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(agora)
      .map((p) => [p.type, p.value]),
  );
  const dia = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(partes.weekday);
  return { dia, minutos: Number(partes.hour) * 60 + Number(partes.minute), data: `${partes.year}-${partes.month}-${partes.day}` };
}

export type SituacaoAula =
  | { tipo: "agora"; horario: Horario; terminaEm: number }
  | { tipo: "em_breve"; horario: Horario; comecaEm: number }
  | { tipo: "proxima"; horario: Horario; comecaEm: number }
  | { tipo: "sem_horario" };

/** Aula acontecendo agora, começando em breve ou a próxima da semana (minutos contados a partir de agora). */
export function situacaoDaAula(horarios: Horario[], agora = new Date()): SituacaoAula {
  const validos = horarios.filter((h) => h.inicio && h.fim && h.dia >= 0 && h.dia <= 6);
  if (validos.length === 0) return { tipo: "sem_horario" };
  const { dia, minutos } = agoraEmBrasilia(agora);
  const agoraNaSemana = dia * 24 * 60 + minutos;
  let melhor: { horario: Horario; comecaEm: number } | null = null;
  for (const h of validos) {
    const inicio = h.dia * 24 * 60 + paraMinutos(h.inicio);
    let fim = h.dia * 24 * 60 + paraMinutos(h.fim);
    if (fim <= inicio) fim += 24 * 60; // aula que passa da meia-noite
    // Acontecendo agora (também na virada da semana).
    for (const desloc of [0, -SEMANA]) {
      if (agoraNaSemana >= inicio + desloc && agoraNaSemana < fim + desloc) {
        return { tipo: "agora", horario: h, terminaEm: fim + desloc - agoraNaSemana };
      }
    }
    const comecaEm = (inicio - agoraNaSemana + SEMANA) % SEMANA;
    if (!melhor || comecaEm < melhor.comecaEm) melhor = { horario: h, comecaEm };
  }
  return melhor!.comecaEm <= MINUTOS_ANTES ? { tipo: "em_breve", ...melhor! } : { tipo: "proxima", ...melhor! };
}

/** "hoje às 19:00", "amanhã às 19:00" ou "terça às 19:00". */
export function quandoE(s: { horario: Horario; comecaEm: number }, agora = new Date()) {
  const { dia, minutos } = agoraEmBrasilia(agora);
  const diasAte = Math.floor((minutos + s.comecaEm) / (24 * 60));
  const nome = diasAte === 0 ? "hoje" : diasAte === 1 ? "amanhã" : DIAS[(dia + diasAte) % 7].toLowerCase();
  return `${nome} às ${s.horario.inicio}`;
}

export const duracaoTexto = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, "0") : ""}`);

/** Resumo para cards: "ter e qui · 19:00–20:00" (ou um por linha quando os horários mudam). */
export function resumoHorarios(horarios: Horario[]) {
  const ordenados = [...horarios].sort((a, b) => a.dia - b.dia || a.inicio.localeCompare(b.inicio));
  const porHora = new Map<string, number[]>();
  for (const h of ordenados) porHora.set(`${h.inicio}–${h.fim}`, [...(porHora.get(`${h.inicio}–${h.fim}`) ?? []), h.dia]);
  return [...porHora.entries()].map(([hora, dias]) => {
    const nomes = dias.map((d) => DIAS_CURTOS[d]);
    return `${nomes.length > 1 ? `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}` : nomes[0]} · ${hora}`;
  });
}

/** O aviso ainda vale hoje? (sem data, vale até a professora apagar) */
export function avisoValido(e: Pick<Encontros, "aviso" | "aviso_ate">, agora = new Date()) {
  if (!e.aviso.trim()) return false;
  return !e.aviso_ate || e.aviso_ate >= agoraEmBrasilia(agora).data;
}

export const ehLinkDoMeet = (link: string) => /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}(\?.*)?$/i.test(link.trim());
