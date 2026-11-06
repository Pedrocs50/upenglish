import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { ehArquivoVelho, recarregarUmaVez, relatarErro } from "../lib/monitor";
import { Botao } from "./ui";

type Props = {
  children: ReactNode;
  /** Quando muda (a pessoa foi para outra página), a tela tenta aparecer de novo. */
  chave?: string;
};

/** Se uma tela quebrar, mostra uma saída em vez da página em branco e registra o erro para o admin. */
export default class LimiteDeErro extends Component<Props, { falhou: boolean }> {
  state = { falhou: false };

  static getDerivedStateFromError() {
    return { falhou: true };
  }

  componentDidCatch(erro: Error, info: ErrorInfo) {
    if (ehArquivoVelho(erro) && recarregarUmaVez()) return;
    void relatarErro("tela", erro, info.componentStack ?? "");
  }

  componentDidUpdate(anteriores: Props) {
    if (this.state.falhou && anteriores.chave !== this.props.chave) this.setState({ falhou: false });
  }

  render() {
    if (!this.state.falhou) return this.props.children;
    return (
      <div className="mx-auto my-12 max-w-md rounded-2xl border border-borda bg-superficie p-6 text-center" role="alert">
        <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-erro-suave text-erro"><AlertTriangle className="size-6" /></span>
        <h1 className="mt-4 text-xl font-bold text-marca">Algo deu errado nesta tela</h1>
        <p className="mt-2 text-sm text-suave">O problema já foi registrado para a equipe. Recarregar costuma resolver; o que você já tinha enviado continua salvo.</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Botao onClick={() => window.location.reload()}>Recarregar a página</Botao>
          <Botao variante="secundario" onClick={() => window.location.assign("/")}>Ir para o início</Botao>
        </div>
      </div>
    );
  }
}
