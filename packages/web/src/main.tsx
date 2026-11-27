import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Shell } from "./shell/Shell";
import { AppState } from "./state";
import "./style.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppState>
      <Shell />
    </AppState>
  </StrictMode>,
);
