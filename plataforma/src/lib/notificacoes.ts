import { useCallback, useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { BookOpen, CheckCircle2, ClipboardCheck, Sparkles, TrendingDown, UserPlus } from "lucide-react";
import { supabase } from "./supabase";
import type { Papel } from "./supabase";

export type Notificacao = { id: string; tipo: string; titulo: string; texto: string; link: string; criada_em: string; lida_em: string | null };

type Tipo = { rotulo: string; descricao: string; icone: LucideIcon; padrao: boolean };

/** Os tipos de notificação (o padrão aqui precisa bater com quer_notificacao, na migração 0012). */
export const TIPOS_EQUIPE: Record<string, Tipo> = {
  pedido_entrada: { rotulo: "Pedido para entrar na turma", descricao: "Um aluno usou o convite e está esperando a sua aprovação.", icone: UserPlus, padrao: true },
  nota_baixa: { rotulo: "Nota baixa", descricao: "Um aluno das suas turmas tirou menos de 60% num exercício.", icone: TrendingDown, padrao: true },
  exercicio_feito: { rotulo: "Exercício enviado", descricao: "Cada exercício que um aluno das suas turmas enviar. Pode ser bastante coisa.", icone: ClipboardCheck, padrao: false },
};
export const TIPOS_ALUNO: Record<string, Tipo> = {
  entrada_aprovada: { rotulo: "Entrada aprovada", descricao: "A professora aprovou a sua entrada numa turma.", icone: CheckCircle2, padrao: true },
  aula_liberada: { rotulo: "Aula nova", descricao: "Uma aula foi liberada, com o material e os exercícios.", icone: BookOpen, padrao: true },
  exercicio_liberado: { rotulo: "Exercício do curso", descricao: "A professora liberou exercícios do curso para a turma.", icone: ClipboardCheck, padrao: true },
  extra_liberado: { rotulo: "Exercício extra", descricao: "A professora liberou um exercício extra para a turma.", icone: Sparkles, padrao: true },
};
export const tiposDoPapel = (papel: Papel) => (papel === "aluno" ? TIPOS_ALUNO : TIPOS_EQUIPE);
export const iconeDoTipo = (tipo: string) => (TIPOS_EQUIPE[tipo] ?? TIPOS_ALUNO[tipo])?.icone ?? CheckCircle2;

/** Avisa o menu para recontar (depois de marcar como lida, aprovar alguém etc.). */
export const EVENTO_CONTADORES = "up:contadores";
export const recontar = () => window.dispatchEvent(new Event(EVENTO_CONTADORES));

/**
 * Números do menu: notificações não lidas, (para a equipe) pedidos de entrada pendentes e (para o admin) erros abertos.
 * Atualiza ao abrir, a cada minuto, quando a aba volta a ficar visível e quando alguém chama recontar().
 */
export function useContadores(papel: Papel | undefined, caminho: string) {
  const [contadores, setContadores] = useState({ naoLidas: 0, pedidos: 0, erros: 0 });
  const atualizar = useCallback(async () => {
    if (!papel) return;
    const [naoLidas, pedidos, erros] = await Promise.all([
      supabase.from("notificacoes").select("id", { count: "exact", head: true }).is("lida_em", null),
      papel === "aluno" ? null : supabase.from("matriculas").select("aluno_id", { count: "exact", head: true }).eq("situacao", "pendente"),
      papel === "admin" ? supabase.from("erros_do_site").select("id", { count: "exact", head: true }).is("resolvido_em", null) : null,
    ]);
    setContadores({ naoLidas: naoLidas.count ?? 0, pedidos: pedidos?.count ?? 0, erros: erros?.count ?? 0 });
  }, [papel]);

  useEffect(() => {
    void atualizar();
  }, [atualizar, caminho]);

  useEffect(() => {
    const intervalo = setInterval(() => {
      if (document.visibilityState === "visible") void atualizar();
    }, 60_000);
    const aoVoltar = () => document.visibilityState === "visible" && void atualizar();
    window.addEventListener(EVENTO_CONTADORES, atualizar);
    document.addEventListener("visibilitychange", aoVoltar);
    return () => {
      clearInterval(intervalo);
      window.removeEventListener(EVENTO_CONTADORES, atualizar);
      document.removeEventListener("visibilitychange", aoVoltar);
    };
  }, [atualizar]);

  return contadores;
}
