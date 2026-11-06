import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import LimiteDeErro from "./componentes/LimiteDeErro";
import { iniciarMonitor } from "./lib/monitor";
import "./index.css";

iniciarMonitor();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LimiteDeErro>
      <App />
    </LimiteDeErro>
  </StrictMode>,
);
