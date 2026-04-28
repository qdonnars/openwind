import { useState, useEffect } from "react";
import { parsePlanUrl, isParsedOk } from "../plan/parseUrl";
import { PlanMap } from "../plan/PlanMap";
import { PlanSidebar } from "../plan/PlanSidebar";
import { fetchPassage, fetchArchetypes } from "../api/passage";
import { ThemeToggle } from "../design/theme";
import type { PassageReport, ComplexityScore, Archetype } from "../plan/types";

function CopyLinkButton() {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback for older browsers
      const el = document.createElement("textarea");
      el.value = window.location.href;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }
  return (
    <button
      onClick={copy}
      className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
      style={{
        background: copied ? "var(--ow-accent-soft)" : "var(--ow-bg-2)",
        color: copied ? "var(--ow-accent)" : "var(--ow-fg-1)",
        border: "1px solid var(--ow-line-2)",
      }}
    >
      {copied ? "Copié ✓" : "Copier le lien"}
    </button>
  );
}

export function PlanPage() {
  const parsed = parsePlanUrl(window.location.search);
  const [passage, setPassage] = useState<PassageReport | null>(null);
  const [complexity, setComplexity] = useState<ComplexityScore | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [archetypes, setArchetypes] = useState<Archetype[]>([]);
  const [forecastUpdatedAt, setForecastUpdatedAt] = useState<string | null>(null);

  useEffect(() => {
    fetchArchetypes().then(setArchetypes).catch(() => {});
  }, []);

  useEffect(() => {
    if (!isParsedOk(parsed)) return;
    setIsLoading(true);
    setApiError(null);
    fetchPassage({
      waypoints: parsed.waypoints,
      departure: parsed.departure,
      archetype: parsed.archetype,
    })
      .then((res) => {
        setPassage(res.passage);
        setComplexity(res.complexity);
        setForecastUpdatedAt(res.forecast_updated_at);
      })
      .catch((e: Error) => setApiError(e.message))
      .finally(() => setIsLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!isParsedOk(parsed)) {
    return (
      <div
        className="h-screen flex flex-col items-center justify-center px-6"
        style={{ background: "var(--ow-bg-0)", color: "var(--ow-fg-0)" }}
      >
        <div className="max-w-sm text-center space-y-4">
          <p className="text-4xl">⚓</p>
          <h1 className="text-xl font-bold">URL invalide</h1>
          <p className="text-sm leading-relaxed" style={{ color: "var(--ow-fg-1)" }}>{parsed.error}</p>
          <a
            href="/"
            className="inline-block mt-4 px-4 py-2 rounded-xl text-sm font-semibold transition-colors"
            style={{ background: "var(--ow-accent)", color: "#fff" }}
          >
            ← Explorer la météo
          </a>
        </div>
      </div>
    );
  }

  const archetypeName =
    archetypes.find((a) => a.slug === parsed.archetype)?.name ?? parsed.archetype;

  return (
    <div
      className="h-screen flex flex-col overflow-hidden"
      style={{ background: "var(--ow-bg-0)", color: "var(--ow-fg-0)" }}
    >
      {/* Header */}
      <header
        className="shrink-0 h-12 flex items-center px-3 gap-2 border-b"
        style={{ background: "var(--ow-bg-1)", borderColor: "var(--ow-line)" }}
      >
        <a
          href="/"
          className="shrink-0 flex items-center gap-1.5 text-sm font-medium transition-colors"
          style={{ color: "var(--ow-fg-1)" }}
        >
          ← Explorer
        </a>
        <span className="flex-1 text-center text-sm font-semibold truncate hidden sm:block" style={{ color: "var(--ow-fg-0)" }}>
          Plan de navigation
        </span>
        <div className="ml-auto flex items-center gap-1">
          <CopyLinkButton />
          <ThemeToggle />
        </div>
      </header>

      {/* Body: map + sidebar */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
        {/* Map */}
        <div className="flex-1 min-h-0">
          <PlanMap
            waypoints={parsed.waypoints}
            segments={passage?.segments}
          />
        </div>

        {/* Sidebar */}
        <div
          className="shrink-0 max-h-[50vh] lg:max-h-none lg:h-auto lg:w-80 xl:w-96 overflow-y-auto border-t lg:border-t-0 lg:border-l"
          style={{ background: "var(--ow-bg-1)", borderColor: "var(--ow-line)" }}
        >
          <PlanSidebar
            passage={passage}
            complexity={complexity}
            isLoading={isLoading}
            error={apiError}
            archetypeName={archetypeName}
            forecastUpdatedAt={forecastUpdatedAt}
          />
        </div>
      </div>
    </div>
  );
}
