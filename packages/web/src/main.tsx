import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { PlanPage } from "./routes/PlanPage";
import { MethodologiePage } from "./routes/MethodologiePage";
import { ThemeProvider } from "./design/theme";

// GitHub Pages 404.html redirect: restore original path stored in sessionStorage
const spaRedirect = sessionStorage.getItem("spa_redirect");
if (spaRedirect) {
  sessionStorage.removeItem("spa_redirect");
  window.history.replaceState(null, "", spaRedirect);
}

const path = window.location.pathname;
const isPlan = path === "/plan";
const isMethodologie = path === "/methodologie";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      {isPlan ? <PlanPage /> : isMethodologie ? <MethodologiePage /> : <App />}
    </ThemeProvider>
  </StrictMode>
);
