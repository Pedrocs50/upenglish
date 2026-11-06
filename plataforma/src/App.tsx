import { lazy, Suspense, type ReactNode } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from "react-router";
import { comVolta, lerVolta } from "./lib/volta";
import { ProvedorAuth, useAuth } from "./lib/auth";
import type { Papel } from "./lib/supabase";
import Painel from "./componentes/Painel";
import { Aviso, Botao, CartaoAuth, Carregando, Marca } from "./componentes/ui";
import Entrar from "./paginas/Entrar";
import Cadastro from "./paginas/Cadastro";
import EsqueciSenha from "./paginas/EsqueciSenha";
import NovaSenha from "./paginas/NovaSenha";
import Sobre from "./paginas/Sobre";

const Admin = lazy(() => import("./paginas/Admin"));
const Configuracoes = lazy(() => import("./paginas/Configuracoes"));
const Monitor = lazy(() => import("./paginas/Monitor"));
const InicioProfessor = lazy(() => import("./paginas/Inicios").then((m) => ({ default: m.InicioProfessor })));
const MinhasTurmas = lazy(() => import("./paginas/MinhasTurmas").then((m) => ({ default: m.MinhasTurmas })));
const TurmaDoAluno = lazy(() => import("./paginas/MinhasTurmas").then((m) => ({ default: m.TurmaDoAluno })));
const AulaAluno = lazy(() => import("./paginas/AreaAluno").then((m) => ({ default: m.AulaAluno })));
const Cursos = lazy(() => import("./paginas/Cursos"));
const Curso = lazy(() => import("./paginas/Curso"));
const Turmas = lazy(() => import("./paginas/Turmas"));
const Turma = lazy(() => import("./paginas/Turma"));
const Listas = lazy(() => import("./paginas/Listas"));
const Convite = lazy(() => import("./paginas/Convite"));
const Biblioteca = lazy(() => import("./paginas/Biblioteca"));
const Perfil = lazy(() => import("./paginas/Perfil"));
const Notificacoes = lazy(() => import("./paginas/Notificacoes"));
const Resultados = lazy(() => import("./paginas/Resultados"));
const ResultadoLista = lazy(() => import("./paginas/Resultados").then((m) => ({ default: m.ResultadoLista })));
const ResultadoAluno = lazy(() => import("./paginas/Resultados").then((m) => ({ default: m.ResultadoAluno })));
const EditorLista = lazy(() => import("./paginas/EditorLista"));
const ListasDoAluno = lazy(() => import("./paginas/Praticar").then((m) => ({ default: m.ListasDoAluno })));
const ResponderLista = lazy(() => import("./paginas/Praticar").then((m) => ({ default: m.ResponderLista })));

const PAGINA_INICIAL: Record<Papel, string> = {
  admin: "/professor",
  professor: "/professor",
  aluno: "/aluno",
};

/** Telas de quem ainda não entrou; quem já está logado vai para a sua área. */
function SoDeslogado({ children }: { children: ReactNode }) {
  const { sessao, carregando } = useAuth();
  const local = useLocation();
  if (carregando) return <Carregando />;
  // Logado: vai para onde ia antes do login (ex.: o exercício compartilhado) ou para a sua área.
  return sessao ? <Navigate to={lerVolta(local.search) ?? "/"} replace /> : children;
}

/** Libera a rota para os papéis indicados. O admin acessa todas as áreas. */
function Protegida({ papeis }: { papeis: Papel[] }) {
  const { sessao, perfil, carregando, sair } = useAuth();
  const local = useLocation();
  if (carregando) return <Carregando />;
  if (!sessao) return <Navigate to={comVolta("/entrar", local.pathname + local.search)} replace />;
  if (!perfil) {
    return (
      <CartaoAuth titulo="Perfil não encontrado">
        <Aviso>Sua conta existe, mas o perfil não foi criado. Avise o administrador da plataforma.</Aviso>
        <Botao variante="secundario" onClick={sair} className="mt-4 w-full">Sair</Botao>
      </CartaoAuth>
    );
  }
  if (perfil.bloqueado) {
    return (
      <CartaoAuth titulo="Conta bloqueada" subtitulo="O acesso desta conta foi suspenso pela administração da UP English.">
        <Aviso tipo="info">Se você acha que isso é um engano, fale com a sua professora ou com a escola.</Aviso>
        <Botao variante="secundario" onClick={sair} className="mt-4 w-full">Sair</Botao>
      </CartaoAuth>
    );
  }
  if (perfil.papel !== "admin" && !papeis.includes(perfil.papel)) {
    return <Navigate to={PAGINA_INICIAL[perfil.papel]} replace />;
  }
  return <Painel />;
}

/** "Sobre a professora" abre dentro do painel para quem está logado e numa página simples para visitantes. */
function PaginaSobre() {
  const { sessao, perfil, carregando } = useAuth();
  if (carregando) return <Carregando />;
  if (sessao && perfil) return <Painel><Sobre /></Painel>;
  return (
    <div className="min-h-dvh">
      <header className="flex items-center justify-between border-b border-borda bg-lateral px-4 py-3 sm:px-8">
        <Link to="/entrar" aria-label="UP English, página inicial"><Marca /></Link>
        <Link to="/entrar" className="rounded-xl bg-marca px-4 py-2 text-sm font-semibold text-sobre-marca hover:bg-marca-hover">Entrar</Link>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
        <Sobre />
      </main>
    </div>
  );
}

function Inicio() {
  const { sessao, perfil, carregando } = useAuth();
  if (carregando) return <Carregando />;
  if (!sessao) return <Navigate to="/entrar" replace />;
  return <Navigate to={perfil ? PAGINA_INICIAL[perfil.papel] : "/praticar"} replace />;
}

export default function App() {
  return (
    <ProvedorAuth>
      <BrowserRouter>
        <Suspense fallback={<Carregando />}>
        <Routes>
          <Route path="/" element={<Inicio />} />
          <Route path="/entrar" element={<SoDeslogado><Entrar /></SoDeslogado>} />
          <Route path="/cadastro" element={<SoDeslogado><Cadastro /></SoDeslogado>} />
          <Route path="/esqueci-senha" element={<SoDeslogado><EsqueciSenha /></SoDeslogado>} />
          <Route path="/nova-senha" element={<NovaSenha />} />
          <Route path="/sobre" element={<PaginaSobre />} />
          <Route path="/convite/:codigo" element={<Convite />} />
          <Route element={<Protegida papeis={["admin"]} />}>
            <Route path="/admin" element={<Admin />} />
            <Route path="/admin/configuracoes" element={<Configuracoes />} />
            <Route path="/admin/erros" element={<Monitor />} />
          </Route>
          <Route element={<Protegida papeis={["professor"]} />}>
            <Route path="/professor" element={<InicioProfessor />} />
            <Route path="/exercicios" element={<Listas />} />
            <Route path="/exercicios/nova" element={<EditorLista key="nova" />} />
            <Route path="/exercicios/:id" element={<EditorLista />} />
            <Route path="/resultados" element={<Resultados />} />
            <Route path="/resultados/listas/:id" element={<ResultadoLista />} />
            <Route path="/resultados/alunos/:id" element={<ResultadoAluno />} />
            <Route path="/biblioteca" element={<Biblioteca />} />
            <Route path="/cursos" element={<Cursos />} />
            <Route path="/cursos/:id" element={<Curso />} />
            <Route path="/turmas" element={<Turmas />} />
            <Route path="/turmas/:id" element={<Turma />} />
          </Route>
          <Route element={<Protegida papeis={["aluno", "professor"]} />}>
            <Route path="/aluno" element={<MinhasTurmas />} />
            <Route path="/aluno/turmas/:id" element={<TurmaDoAluno />} />
            <Route path="/notificacoes" element={<Notificacoes />} />
            <Route path="/perfil" element={<Perfil />} />
            <Route path="/aulas/:id" element={<AulaAluno />} />
            <Route path="/praticar" element={<ListasDoAluno />} />
            <Route path="/praticar/:id" element={<ResponderLista />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      </BrowserRouter>
    </ProvedorAuth>
  );
}
