import { useState } from "react";
import { ExternalLink, Info, Plus, Trash2, Video } from "lucide-react";
import { traduzirErro } from "../lib/supabase";
import { useConsulta } from "../lib/dados";
import { DIAS, buscarEncontros, ehLinkDoMeet, normalizarLink, resumoHorarios, salvarEncontros, type Encontros, type Horario } from "../lib/aoVivo";
import { Aviso, Botao, TextoCarregando } from "./ui";
import CopiarTexto from "./CopiarTexto";

const CONTROLE = "h-11 w-full rounded-xl border border-borda bg-superficie px-3 text-sm focus:border-destaque focus:outline-none focus:ring-4 focus:ring-destaque-suave";

/** Aba "Ao vivo" da turma: link fixo do Meet, horários das aulas e um aviso do dia. */
export default function EditorAoVivo({ idTurma, nomeTurma }: { idTurma: string; nomeTurma: string }) {
  const { dados, carregando, recarregar } = useConsulta<Encontros | null>(() => buscarEncontros(idTurma), [idTurma]);
  if (carregando && dados === null) return <TextoCarregando />;
  return <Formulario key={dados?.atualizado_em ?? "novo"} idTurma={idTurma} nomeTurma={nomeTurma} inicial={dados} aoSalvar={recarregar} />;
}

function Formulario({ idTurma, nomeTurma, inicial, aoSalvar }: { idTurma: string; nomeTurma: string; inicial: Encontros | null; aoSalvar: () => void }) {
  const [link, setLink] = useState(inicial?.link ?? "");
  const [horarios, setHorarios] = useState<Horario[]>(inicial?.horarios?.length ? inicial.horarios : [{ dia: 2, inicio: "19:00", fim: "20:00" }]);
  const [aviso, setAviso] = useState(inicial?.aviso ?? "");
  const [avisoAte, setAvisoAte] = useState(inicial?.aviso_ate ?? "");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [salvo, setSalvo] = useState(false);

  const mudarHorario = (i: number, parcial: Partial<Horario>) => setHorarios(horarios.map((h, j) => (j === i ? { ...h, ...parcial } : h)));
  const linkLimpo = normalizarLink(link);
  const linkInvalido = linkLimpo !== "" && !/^https:\/\//i.test(linkLimpo);
  const naoEhMeet = linkLimpo !== "" && !linkInvalido && !ehLinkDoMeet(linkLimpo);
  const horariosRuins = horarios.some((h) => !h.inicio || !h.fim || h.fim === h.inicio);

  async function salvar() {
    if (linkInvalido) return setErro("O link precisa começar com https://");
    if (horariosRuins) return setErro("Confira os horários: cada aula precisa de início e fim diferentes.");
    setErro("");
    setSalvando(true);
    const { error } = await salvarEncontros(idTurma, {
      link: linkLimpo,
      horarios,
      aviso: aviso.trim(),
      aviso_ate: aviso.trim() && avisoAte ? avisoAte : null,
      atualizado_em: new Date().toISOString(),
    });
    setSalvando(false);
    if (error) setErro(traduzirErro(error.message));
    else {
      setLink(linkLimpo);
      setSalvo(true);
      setTimeout(() => setSalvo(false), 2500);
      aoSalvar();
    }
  }

  const textoGrupo = [
    `🎥 Link das aulas ao vivo da turma ${nomeTurma}:`,
    linkLimpo,
    "",
    ...resumoHorarios(horarios).map((r) => `🗓️ ${r} (horário de Brasília)`),
    "",
    "O link também fica sempre na plataforma, na página da turma (botão Entrar na aula).",
  ].join("\n");

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <section className="space-y-6 rounded-2xl border border-borda bg-superficie p-5 sm:p-6">
        {erro && <Aviso>{erro}</Aviso>}

        <div>
          <label htmlFor="link-meet" className="mb-1.5 block text-sm font-semibold">Link da reunião</label>
          <div className="flex gap-2">
            <input id="link-meet" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://meet.google.com/abc-defg-hij" className={CONTROLE} inputMode="url" />
            {linkLimpo && !linkInvalido && (
              <a href={linkLimpo} target="_blank" rel="noreferrer" className="grid size-11 shrink-0 place-items-center rounded-xl border border-borda text-suave hover:bg-fundo hover:text-texto" title="Testar o link" aria-label="Testar o link">
                <ExternalLink className="size-4" />
              </a>
            )}
          </div>
          <a href="https://meet.google.com/new" target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-destaque hover:underline">
            <Video className="size-4" /> Criar reunião no Google Meet
          </a>
          <p className="text-xs text-suave">Abre o Meet na sua conta Google, em outra aba. Copie o link da reunião e cole aqui.</p>
          {linkInvalido && <p className="mt-1.5 text-xs text-erro">O link precisa começar com https://</p>}
          {naoEhMeet && <p className="mt-1.5 text-xs text-suave">Não parece um link do Google Meet. Tudo bem se for outra plataforma (Zoom, Teams...).</p>}
          <p className="mt-1.5 text-xs text-suave">Só os alunos aprovados nesta turma veem o link.</p>
        </div>

        <div>
          <p className="mb-1.5 text-sm font-semibold">Horários das aulas <span className="font-normal text-suave">(horário de Brasília)</span></p>
          <ul className="space-y-2">
            {horarios.map((h, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <label className="min-w-36 flex-1">
                  <span className="sr-only">Dia</span>
                  <select value={h.dia} onChange={(e) => mudarHorario(i, { dia: Number(e.target.value) })} className={CONTROLE}>
                    {DIAS.map((d, n) => <option key={d} value={n}>{d}</option>)}
                  </select>
                </label>
                <label className="w-28">
                  <span className="sr-only">Início</span>
                  <input type="time" value={h.inicio} onChange={(e) => mudarHorario(i, { inicio: e.target.value })} className={CONTROLE} />
                </label>
                <span className="text-sm text-suave">até</span>
                <label className="w-28">
                  <span className="sr-only">Fim</span>
                  <input type="time" value={h.fim} onChange={(e) => mudarHorario(i, { fim: e.target.value })} className={CONTROLE} />
                </label>
                <button
                  type="button"
                  onClick={() => setHorarios(horarios.filter((_, j) => j !== i))}
                  aria-label="Tirar este horário"
                  className="grid size-11 place-items-center rounded-xl text-suave hover:bg-erro-suave hover:text-erro"
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => setHorarios([...horarios, { ...(horarios[horarios.length - 1] ?? { dia: 2, inicio: "19:00", fim: "20:00" }), dia: ((horarios[horarios.length - 1]?.dia ?? 0) + 2) % 7 }])}
            className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-destaque hover:underline"
          >
            <Plus className="size-4" /> Adicionar outro dia
          </button>
        </div>

        <div>
          <label htmlFor="aviso-aula" className="mb-1.5 block text-sm font-semibold">Aviso do dia <span className="font-normal text-suave">(opcional)</span></label>
          <textarea
            id="aviso-aula"
            value={aviso}
            onChange={(e) => setAviso(e.target.value)}
            rows={2}
            placeholder="Ex.: Hoje a aula começa às 20h. / Sem aula nesta quinta (feriado)."
            className="w-full rounded-xl border border-borda bg-superficie px-3 py-2.5 text-sm focus:border-destaque focus:outline-none focus:ring-4 focus:ring-destaque-suave"
          />
          {aviso.trim() && (
            <label className="mt-2 flex flex-wrap items-center gap-2 text-sm text-suave">
              Mostrar até
              <input type="date" value={avisoAte} onChange={(e) => setAvisoAte(e.target.value)} className="h-10 rounded-xl border border-borda bg-superficie px-3 text-sm text-texto" />
              <span className="text-xs">(em branco: até você apagar)</span>
            </label>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-borda pt-5">
          <Botao onClick={salvar} carregando={salvando}><Video className="size-4" /> {salvo ? "Salvo!" : "Salvar"}</Botao>
          {linkLimpo && !linkInvalido && <CopiarTexto texto={textoGrupo}>Copiar link e horários para o grupo</CopiarTexto>}
        </div>
      </section>

      <aside className="h-fit space-y-3 rounded-2xl bg-destaque-suave p-5 text-sm">
        <p className="flex items-center gap-2 font-bold text-marca"><Info className="size-4" /> Como ter um link fixo do Meet</p>
        <p className="text-texto">Um link fixo vale para todas as aulas: os alunos sempre entram pelo mesmo lugar.</p>
        <ol className="list-decimal space-y-1.5 pl-5 text-texto">
          <li>No <a href="https://calendar.google.com/calendar/r/eventedit" target="_blank" rel="noreferrer" className="font-semibold underline">Google Agenda</a>, crie um evento no dia e horário da aula.</li>
          <li>Em <strong>Não se repete</strong>, escolha a repetição (ex.: toda terça e quinta).</li>
          <li>Clique em <strong>Adicionar videoconferência do Google Meet</strong> e salve.</li>
          <li>Abra o evento, copie o link <em>meet.google.com/...</em> e cole aqui.</li>
        </ol>
        <p className="text-suave">Outro jeito: em meet.google.com, clique em <strong>Nova reunião → Criar uma reunião para depois</strong> e copie o link.</p>
        <p className="text-suave">No dia, o aluno vê "Entrar na aula" em destaque a partir de 15 minutos antes.</p>
      </aside>
    </div>
  );
}
