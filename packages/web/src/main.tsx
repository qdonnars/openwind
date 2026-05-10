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

// Normalise trailing slashes: GitHub Pages adds them automatically when a
// matching directory exists under public/ (e.g. ``public/methodologie/`` for
// the coverage map asset), which turns ``/methodologie`` into ``/methodologie/``
// during the 404→SPA redirect dance. Strip the trailing slash so route
// matches stay simple.
const rawPath = window.location.pathname;
const path = rawPath.length > 1 && rawPath.endsWith("/") ? rawPath.slice(0, -1) : rawPath;
const isPlan = path === "/plan";
const isMethodologie = path === "/methodologie";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      {isPlan ? <PlanPage /> : isMethodologie ? <MethodologiePage /> : <App />}
    </ThemeProvider>
  </StrictMode>
);
