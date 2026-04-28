import { useState, useEffect, useRef } from "react";
import { parsePlanUrl, isParsedOk, buildPlanUrl } from "../plan/parseUrl";
import { PlanMap, type PlanMapHandle } from "../plan/PlanMap";
import { PlanSidebar } from "../plan/PlanSidebar";
import { fetchPassage, fetchArchetypes } from "../api/passage";
import { ThemeToggle } from "../design/theme";
import { SpotSearch } from "../components/SpotSearch";
import type { PassageReport, ComplexityScore, Archetype } from "../plan/types";

function CopyLinkButton() {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
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
  const mapRef = useRef<PlanMapHandle>(null);
  const initialParsed = parsePlanUrl(window.location.search);

  // Editable local state (does not trigger re-fetch automatically)
  const [waypoints, setWaypoints] = useState<[number, number][]>(
    isParsedOk(initialParsed) ? initialParsed.waypoints : []
  );
  const [archetype, setArchetype] = useState(
    isParsedOk(initialParsed) ? initialParsed.archetype : ""
  );
  // departure is not editable in V1 — kept as constant from URL
  const departure = isParsedOk(initialParsed) ? initialParsed.departure : "";

  const [passage, setPassage] = useState<PassageReport | null>(null);
  const [complexity, setComplexity] = useState<ComplexityScore | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [archetypes, setArchetypes] = useState<Archetype[]>([]);
  const [forecastUpdatedAt, setForecastUpdatedAt] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);

  useEffect(() => {
    fetchArchetypes().then(setArchetypes).catch(() => {});
  }, []);

  function doFetch(wpts: [number, number][], arch: string) {
    setIsLoading(true);
    setApiError(null);
    fetchPassage({ waypoints: wpts, departure, archetype: arch })
      .then((res) => {
        setPassage(res.passage);
        setComplexity(res.complexity);
        setForecastUpdatedAt(res.forecast_updated_at);
        setIsStale(false);
        // Persist canonical URL so Explore can show a "Plan" shortcut
        const ttl = 7 * 24 * 3600;
        document.cookie = `ow_last_trip=${encodeURIComponent(window.location.href)};max-age=${ttl};path=/;SameSite=Lax`;
      })
      .catch((e: Error) => setApiError(e.message))
      .finally(() => setIsLoading(false));
  }

  // Initial fetch
  useEffect(() => {
    if (!isParsedOk(initialParsed)) return;
    doFetch(initialParsed.waypoints, initialParsed.archetype);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleWptMove(idx: number, lat: number, lon: number) {
    const next = waypoints.map((wp, i): [number, number] => (i === idx ? [lat, lon] : wp));
    setWaypoints(next);
    setIsStale(true);
    window.history.replaceState(null, "", buildPlanUrl(next, departure, archetype));
  }

  function handleArchetypeChange(slug: string) {
    setArchetype(slug);
    setIsStale(true);
    window.history.replaceState(null, "", buildPlanUrl(waypoints, departure, slug));
  }

  function handleRefetch() {
    doFetch(waypoints, archetype);
  }

  if (!isParsedOk(initialParsed)) {
    return (
      <div
        className="h-screen flex flex-col items-center justify-center px-6"
        style={{ background: "var(--ow-bg-0)", color: "var(--ow-fg-0)" }}
      >
        <div className="max-w-sm text-center space-y-4">
          <p className="text-4xl">⚓</p>
          <h1 className="text-xl font-bold">URL invalide</h1>
          <p className="text-sm leading-relaxed" style={{ color: "var(--ow-fg-1)" }}>{initialParsed.error}</p>
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
        <div className="flex-1 flex justify-center px-2">
          <SpotSearch
            onSelect={(spot) => mapRef.current?.recenter(spot.latitude, spot.longitude)}
          />
        </div>
        <div className="flex items-center gap-1">
          <CopyLinkButton />
          <ThemeToggle />
        </div>
      </header>

      {/* Body: map + sidebar */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
        {/* Map */}
        <div className="flex-1 min-h-0">
          <PlanMap
            ref={mapRef}
            waypoints={waypoints}
            segments={passage?.segments}
            isStale={isStale}
            onWptMove={handleWptMove}
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
            archetypes={archetypes}
            currentArchetypeSlug={archetype}
            onArchetypeChange={handleArchetypeChange}
            isStale={isStale}
            onRefetch={handleRefetch}
            forecastUpdatedAt={forecastUpdatedAt}
          />
        </div>
      </div>
    </div>
  );
}
