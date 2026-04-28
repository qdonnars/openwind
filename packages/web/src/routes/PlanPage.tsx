import { useState, useEffect, useRef } from "react";
import { parsePlanUrl, isParsedOk, buildPlanUrl } from "../plan/parseUrl";
import { PlanMap, type PlanMapHandle } from "../plan/PlanMap";
import { PlanSidebar } from "../plan/PlanSidebar";
import { fetchPassage, fetchArchetypes } from "../api/passage";
import { ThemeToggle } from "../design/theme";
import { SpotSearch } from "../components/SpotSearch";
import type { PassageReport, ComplexityScore, Archetype } from "../plan/types";
import { cxLevel, CX_COLORS } from "../plan/types";

// ── local helpers (mobile components) ────────────────────────────────────────

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}
function fmtDuration(h: number) {
  const hrs = Math.floor(h);
  const mins = Math.round((h - hrs) * 60);
  return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
}
function compassDir(deg: number) {
  return ["N", "NE", "E", "SE", "S", "SO", "O", "NO"][Math.round(deg / 45) % 8];
}

function RefetchIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13.5 2.5A7 7 0 1 0 14.5 9" /><path d="M14 1v4h-4" />
    </svg>
  );
}

// Hero stats overlay — absolute, bottom of map, mobile only
function PlanHeroStats({ passage, complexity }: { passage: PassageReport; complexity: ComplexityScore }) {
  const stats = [
    { label: "ETA", value: fmtTime(passage.arrival_time) },
    { label: "Durée", value: fmtDuration(passage.duration_h) },
    { label: "Dist", value: `${passage.distance_nm.toFixed(1)} nm` },
    { label: "Cx", value: `${complexity.level}/5`, color: CX_COLORS[complexity.level] },
  ];
  return (
    <div className="flex gap-1.5">
      {stats.map(({ label, value, color }) => (
        <div
          key={label}
          className="flex-1 rounded-xl px-2 py-1.5 text-center"
          style={{ background: "var(--ow-surface-glass)", backdropFilter: "blur(8px)", border: "1px solid var(--ow-line-2)" }}
        >
          <div className="text-[9px] font-semibold uppercase tracking-wide" style={{ color: "var(--ow-fg-2)" }}>{label}</div>
          <div className="text-xs font-bold tabular-nums leading-tight mt-0.5" style={{ color: color ?? "var(--ow-fg-0)", fontFamily: "var(--ow-font-mono)" }}>{value}</div>
        </div>
      ))}
    </div>
  );
}

// Compact drawer — replaces sidebar on mobile
function CompactDrawer({
  passage,
  complexity,
  isLoading,
  error,
  isStale,
  onRefetch,
}: {
  passage: PassageReport | null;
  complexity: ComplexityScore | null;
  isLoading: boolean;
  error: string | null;
  isStale: boolean;
  onRefetch: () => void;
}) {
  if (isLoading) {
    return (
      <div className="p-3 space-y-2 animate-fade-in">
        {[0, 1, 2].map((i) => <div key={i} className="skeleton h-9 rounded-lg" />)}
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-3">
        <p className="text-xs rounded-lg px-3 py-2" style={{ background: "var(--ow-err-soft)", color: "var(--ow-err)" }}>{error}</p>
      </div>
    );
  }
  if (!passage || !complexity) return null;

  return (
    <div>
      {/* Sticky header */}
      <div
        className="sticky top-0 z-10 flex items-center gap-2 px-3 py-2 border-b"
        style={{ background: "var(--ow-bg-1)", borderColor: "var(--ow-line)" }}
      >
        <span className="text-xs font-semibold flex-1" style={{ color: "var(--ow-fg-1)" }}>
          {passage.segments.length} segments · {passage.distance_nm.toFixed(1)} nm
        </span>
        {isStale && (
          <span className="text-[10px] font-medium shrink-0" style={{ color: "var(--ow-warn)" }}>⚠ Obsolète</span>
        )}
        <button
          onClick={onRefetch}
          className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold transition-colors"
          style={{
            background: isStale ? "var(--ow-accent)" : "var(--ow-bg-2)",
            color: isStale ? "#fff" : "var(--ow-fg-2)",
            border: `1px solid ${isStale ? "transparent" : "var(--ow-line-2)"}`,
          }}
        >
          <RefetchIcon />
          Recalculer
        </button>
      </div>

      {/* Segment rows */}
      <div>
        {passage.segments.map((seg, i) => {
          const cx = cxLevel(seg.tws_kn);
          return (
            <div
              key={i}
              className="flex items-center gap-2 px-3 py-2.5 border-b text-xs"
              style={{ borderColor: "var(--ow-line)" }}
            >
              <span
                className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center font-bold text-[10px]"
                style={{ background: CX_COLORS[cx], color: "#fff" }}
              >
                {i + 1}
              </span>
              <span className="flex-1 tabular-nums" style={{ color: "var(--ow-fg-1)", fontFamily: "var(--ow-font-mono)" }}>
                {seg.distance_nm.toFixed(1)} nm · {seg.tws_kn.toFixed(0)} kn · {compassDir(seg.twd_deg)}
              </span>
              <span className="tabular-nums shrink-0" style={{ color: "var(--ow-fg-2)", fontFamily: "var(--ow-font-mono)" }}>
                {fmtTime(seg.end_time)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── CopyLinkButton ────────────────────────────────────────────────────────────

function CopyLinkButton() {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(window.location.href);
    } catch {
      const el = document.createElement("textarea");
      el.value = window.location.href;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
      {copied ? "Copié ✓" : "🔗"}
    </button>
  );
}

// ── PlanPage ──────────────────────────────────────────────────────────────────

export function PlanPage() {
  const mapRef = useRef<PlanMapHandle>(null);
  const initialParsed = parsePlanUrl(window.location.search);

  const [waypoints, setWaypoints] = useState<[number, number][]>(
    isParsedOk(initialParsed) ? initialParsed.waypoints : []
  );
  const [archetype, setArchetype] = useState(
    isParsedOk(initialParsed) ? initialParsed.archetype : ""
  );
  const [departure, setDeparture] = useState(
    isParsedOk(initialParsed) ? initialParsed.departure : ""
  );

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
        const ttl = 7 * 24 * 3600;
        document.cookie = `ow_last_trip=${encodeURIComponent(window.location.href)};max-age=${ttl};path=/;SameSite=Lax`;
      })
      .catch((e: Error) => setApiError(e.message))
      .finally(() => setIsLoading(false));
  }

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

  function handleWptAdd(afterIdx: number, lat: number, lon: number) {
    const next = [...waypoints];
    next.splice(afterIdx + 1, 0, [lat, lon]);
    setWaypoints(next);
    setIsStale(true);
    window.history.replaceState(null, "", buildPlanUrl(next, departure, archetype));
  }

  function handleArchetypeChange(slug: string) {
    setArchetype(slug);
    setIsStale(true);
    window.history.replaceState(null, "", buildPlanUrl(waypoints, departure, slug));
  }

  function handleDepartureChange(iso: string) {
    setDeparture(iso);
    setIsStale(true);
    window.history.replaceState(null, "", buildPlanUrl(waypoints, iso, archetype));
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
          className="shrink-0 flex items-center gap-1 text-sm font-medium"
          style={{ color: "var(--ow-fg-1)" }}
        >
          ←
        </a>
        <div className="flex-1 flex justify-center px-1">
          <SpotSearch
            onSelect={(spot) => mapRef.current?.recenter(spot.latitude, spot.longitude)}
          />
        </div>
        <div className="flex items-center gap-1">
          <CopyLinkButton />
          <ThemeToggle />
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
        {/* Map — full height on mobile, flex-1 on desktop */}
        <div className="flex-1 min-h-0 relative">
          <PlanMap
            ref={mapRef}
            waypoints={waypoints}
            segments={passage?.segments}
            isStale={isStale}
            onWptMove={handleWptMove}
            onWptAdd={handleWptAdd}
          />
          {/* Hero stats overlay — mobile only, floats above compact drawer */}
          {passage && complexity && (
            <div className="lg:hidden absolute bottom-2 left-2 right-2 z-[400] pointer-events-none">
              <PlanHeroStats passage={passage} complexity={complexity} />
            </div>
          )}
        </div>

        {/* Desktop sidebar */}
        <div
          className="hidden lg:block shrink-0 w-80 xl:w-96 overflow-y-auto border-l"
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
            departure={departure}
            onDepartureChange={handleDepartureChange}
            isStale={isStale}
            onRefetch={handleRefetch}
            forecastUpdatedAt={forecastUpdatedAt}
          />
        </div>
      </div>

      {/* Mobile compact drawer — below map */}
      <div
        className="lg:hidden shrink-0 overflow-y-auto border-t"
        style={{ maxHeight: "38vh", background: "var(--ow-bg-1)", borderColor: "var(--ow-line)" }}
      >
        <CompactDrawer
          passage={passage}
          complexity={complexity}
          isLoading={isLoading}
          error={apiError}
          isStale={isStale}
          onRefetch={handleRefetch}
        />
      </div>
    </div>
  );
}
