import { useEffect, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { BarChart3, Bell, BookMarked, Bug, FileStack, ClipboardList, GraduationCap, LogOut, Menu, Moon, PenLine, Settings, Sun, UserRound, Users, UsersRound, X, type LucideIcon } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useTema } from "../lib/tema";
import { useContadores } from "../lib/notificacoes";
import { NOMES_PAPEIS, type Papel } from "../lib/supabase";
import { Marca } from "./ui";
import LimiteDeErro from "./LimiteDeErro";
import Avatar from "./Avatar";

/** emConstrucao: parte em espera; só o admin vê (com selo), para acompanhar tudo o que existe. */
type ItemMenu = { para: string; rotulo: string; icone: LucideIcon; emConstrucao?: boolean; contador?: keyof Contadores };
type Contadores = { naoLidas: number; pedidos: number; erros: number };
type SecaoMenu = { titulo: string; itens: ItemMenu[] };

const SOBRE: SecaoMenu = { titulo: "UP English", itens: [{ para: "/sobre", rotulo: "Sobre a professora", icone: UserRound }] };

// Dia a dia (turmas e resultados) separado da biblioteca (o conteúdo, montado uma vez e usado por várias turmas).
const ENSINO: SecaoMenu = {
  titulo: "Ensino",
  itens: [
    { para: "/professor", rotulo: "Início", icone: GraduationCap },
    { para: "/notificacoes", rotulo: "Notificações", icone: Bell, contador: "naoLidas" },
    { para: "/turmas", rotulo: "Turmas", icone: UsersRound, contador: "pedidos" },
    { para: "/resultados", rotulo: "Resultados", icone: BarChart3 },
  ],
};
const BIBLIOTECA: SecaoMenu = {
  titulo: "Biblioteca",
  itens: [
    { para: "/biblioteca", rotulo: "Aulas em PDF", icone: FileStack },
    { para: "/cursos", rotulo: "Cursos e aulas", icone: BookMarked },
    { para: "/exercicios", rotulo: "Exercícios", icone: ClipboardList },
    { para: "/aluno", rotulo: "Visão do aluno", icone: PenLine },
  ],
};

/** Tira do menu o que está em construção (para todos, menos o admin). */
const semEmConstrucao = (secoes: SecaoMenu[]) => secoes.map((s) => ({ ...s, itens: s.itens.filter((i) => !i.emConstrucao) }));

const MENUS: Record<Papel, SecaoMenu[]> = {
  admin: [
    ENSINO,
    BIBLIOTECA,
    {
      titulo: "Administração",
      itens: [
        { para: "/admin", rotulo: "Usuários", icone: Users },
        { para: "/admin/configuracoes", rotulo: "Configurações", icone: Settings },
        { para: "/admin/erros", rotulo: "Erros e testes", icone: Bug, contador: "erros" },
      ],
    },
    SOBRE,
  ],
  professor: semEmConstrucao([ENSINO, BIBLIOTECA, SOBRE]),
  aluno: semEmConstrucao([
    {
      titulo: "Estudos",
      itens: [
        { para: "/aluno", rotulo: "Minhas turmas", icone: GraduationCap },
        { para: "/notificacoes", rotulo: "Notificações", icone: Bell, contador: "naoLidas" },
      ],
    },
    SOBRE,
  ]),
};

function ConteudoMenu({ aoFechar, contadores }: { aoFechar?: () => void; contadores: Contadores }) {
  const { perfil, sair } = useAuth();
  const { tema, alternar } = useTema();
  if (!perfil) return null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-5 py-5">
        <Marca />
        {aoFechar && (
          <button onClick={aoFechar} aria-label="Fechar menu" className="grid size-10 place-items-center rounded-xl text-suave hover:bg-fundo lg:hidden">
            <X className="size-5" />
          </button>
        )}
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-2" aria-label="Principal">
        {MENUS[perfil.papel].map((secao) => (
          <div key={secao.titulo}>
            <p className="px-3 pb-2 text-[11px] font-bold tracking-[0.14em] text-suave uppercase">{secao.titulo}</p>
            <ul className="space-y-1">
              {secao.itens.map(({ para, rotulo, icone: Icone, emConstrucao, contador }) => (
                <li key={para}>
                  <NavLink
                    to={para}
                    end={para === "/professor" || para === "/admin"}
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded-xl border-l-4 px-3 py-2.5 text-sm transition ${
                        isActive
                          ? "border-marca bg-destaque-suave font-semibold text-marca"
                          : "border-transparent text-suave hover:bg-fundo hover:text-texto"
                      }`
                    }
                  >
                    <Icone className="size-5 shrink-0" />
                    <span className="flex-1">{rotulo}</span>
                    {contador && contadores[contador] > 0 && (
                      <span
                        className="min-w-6 rounded-full bg-coral px-1.5 py-0.5 text-center text-[11px] font-bold text-white"
                        aria-label={contador === "pedidos" ? `${contadores[contador]} pedidos para entrar` : contador === "erros" ? `${contadores[contador]} erros abertos` : `${contadores[contador]} não lidas`}
                      >
                        {contadores[contador] > 99 ? "99+" : contadores[contador]}
                      </span>
                    )}
                    {emConstrucao && <span className="rounded-full bg-creme px-2 py-0.5 text-[11px] font-bold text-suave uppercase" title="Parte em construção: só o admin vê">Em obra</span>}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="space-y-3 border-t border-borda p-3">
        <button
          onClick={alternar}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-suave hover:bg-fundo hover:text-texto"
        >
          {tema === "claro" ? <Moon className="size-5" /> : <Sun className="size-5" />}
          {tema === "claro" ? "Tema escuro" : "Tema claro"}
        </button>
        <div className="flex items-center gap-3 rounded-xl bg-fundo p-3">
          <NavLink to="/perfil" title="Meu perfil" className="flex min-w-0 flex-1 items-center gap-3 rounded-lg hover:opacity-80">
            <Avatar />
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-sm font-semibold">{perfil.nome || perfil.email}</span>
              <span className="block text-xs text-suave">{NOMES_PAPEIS[perfil.papel]} · Meu perfil</span>
            </span>
          </NavLink>
          <button onClick={sair} aria-label="Sair" title="Sair" className="grid size-9 shrink-0 place-items-center rounded-lg text-suave pointer-coarse:size-11 hover:bg-superficie hover:text-erro">
            <LogOut className="size-5" />
          </button>
        </div>
      </div>
    </div>
  );
}

/** Moldura das áreas logadas: menu lateral fixo no computador e gaveta no celular. */
export default function Painel({ children }: { children?: ReactNode }) {
  const [aberto, setAberto] = useState(false);
  const local = useLocation();
  const { perfil } = useAuth();
  const contadores = useContadores(perfil?.papel, local.pathname);

  useEffect(() => {
    setAberto(false);
  }, [local.pathname]);

  return (
    <div className="min-h-dvh lg:pl-72">
      <aside className="fixed inset-y-0 left-0 hidden w-72 border-r border-borda bg-lateral lg:block">
        <ConteudoMenu contadores={contadores} />
      </aside>

      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-borda bg-lateral/95 px-4 py-3 backdrop-blur lg:hidden">
        <Marca />
        <div className="flex items-center gap-1">
          <NavLink to="/notificacoes" aria-label={`Notificações${contadores.naoLidas ? `: ${contadores.naoLidas} não lidas` : ""}`} className="relative grid size-10 place-items-center rounded-xl text-texto hover:bg-fundo">
            <Bell className="size-5" />
            {contadores.naoLidas > 0 && <span className="absolute top-1.5 right-1.5 size-2.5 rounded-full bg-coral ring-2 ring-lateral" />}
          </NavLink>
          <button onClick={() => setAberto(true)} aria-label="Abrir menu" aria-expanded={aberto} className="relative grid size-10 place-items-center rounded-xl text-texto hover:bg-fundo">
            <Menu className="size-6" />
            {contadores.pedidos + contadores.erros > 0 && <span className="absolute top-1.5 right-1.5 size-2.5 rounded-full bg-coral ring-2 ring-lateral" />}
          </button>
        </div>
      </header>

      {aberto && (
        <div className="fixed inset-0 z-30 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button className="absolute inset-0 bg-marinho-900/50" aria-label="Fechar menu" onClick={() => setAberto(false)} />
          <aside className="absolute inset-y-0 left-0 w-80 max-w-[85vw] bg-lateral shadow-xl">
            <ConteudoMenu aoFechar={() => setAberto(false)} contadores={contadores} />
          </aside>
        </div>
      )}

      <main className="max-w-6xl px-4 py-8 sm:px-8 lg:px-12 lg:py-10"><LimiteDeErro chave={local.pathname}>{children ?? <Outlet />}</LimiteDeErro></main>
    </div>
  );
}

/** Cabeçalho padrão das páginas internas: etiqueta pequena, título serifado e descrição. */
export function CabecalhoPagina({ etiqueta, titulo, descricao, acoes }: { etiqueta?: string; titulo: string; descricao?: string; acoes?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        {etiqueta && <p className="text-[11px] font-bold tracking-[0.14em] text-destaque uppercase">{etiqueta}</p>}
        <h1 className="mt-1 text-3xl font-bold text-marca">{titulo}</h1>
        {descricao && <p className="mt-2 max-w-2xl text-suave">{descricao}</p>}
      </div>
      {acoes}
    </div>
  );
}
