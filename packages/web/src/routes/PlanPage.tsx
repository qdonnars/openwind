import { useState, useEffect, useRef } from "react";
import { parsePlanUrl, isParsedOk, buildPlanUrl } from "../plan/parseUrl";
import { PlanMap, type PlanMapHandle } from "../plan/PlanMap";
import { PlanSidebar } from "../plan/PlanSidebar";
import { fetchPassage, fetchPassageWindows, fetchArchetypes, friendlyError } from "../api/passage";
import { ThemeToggle } from "../design/theme";
import { SpotSearch } from "../components/SpotSearch";
import type { PassageReport, ComplexityScore, Archetype, PassageWindow } from "../plan/types";
import {
  loadLastSimulation,
  saveLastSimulation,
  waypointsEqual,
  type LastSimulation,
} from "../plan/lastSimulation";
import { ModeToggle, type PlanMode } from "../plan/ModeToggle";
import { cxLevel, CX_COLORS } from "../plan/types";
import { aggregateLegs } from "../plan/aggregateLegs";

// ── local helpers (mobile components) ────────────────────────────────────────

function nowRoundedLocal(): string {
  const d = new Date();
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Append local timezone offset to a naive "YYYY-MM-DDTHH:MM" string.
// If already timezone-aware (ends with Z or ±HH:MM), return as-is.
function toTzAware(iso: string): string {
  if (/Z$|[+-]\d{2}:\d{2}$/.test(iso)) return iso;
  const off = -new Date().getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${iso}:00${sign}${hh}:${mm}`;
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}
function fmtDuration(h: number) {
  const hrs = Math.floor(h);
  const mins = Math.round((h - hrs) * 60);
  return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
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
  waypoints,
  isLoading,
  error,
  isStale,
  onRefetch,
  mode,
  onModeChange,
}: {
  passage: PassageReport | null;
  complexity: ComplexityScore | null;
  waypoints: [number, number][];
  isLoading: boolean;
  error: string | null;
  isStale: boolean;
  onRefetch: () => void;
  mode: PlanMode;
  onModeChange: (m: PlanMode) => void;
}) {
  // Mode toggle is always visible at the top so the user can swap between
  // Simuler / Comparer even when single-mode results are showing.
  const header = (
    <div className="px-3 pt-3 pb-2" style={{ background: "var(--ow-bg-1)" }}>
      <ModeToggle value={mode} onChange={onModeChange} />
    </div>
  );

  if (isLoading) {
    return (
      <div>
        {header}
        <div className="p-3 space-y-2 animate-fade-in">
          {[0, 1, 2].map((i) => <div key={i} className="skeleton h-9 rounded-lg" />)}
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div>
        {header}
        <div className="p-3">
          <p className="text-xs rounded-lg px-3 py-2" style={{ background: "var(--ow-err-soft)", color: "var(--ow-err)" }}>{error}</p>
        </div>
      </div>
    );
  }
  if (!passage || !complexity) return header;

  const legs = aggregateLegs(passage.segments, waypoints);

  return (
    <div>
      {header}
      {/* Sticky header */}
      <div
        className="sticky top-0 z-10 flex items-center gap-2 px-3 py-2 border-b"
        style={{ background: "var(--ow-bg-1)", borderColor: "var(--ow-line)" }}
      >
        <span className="text-xs font-semibold flex-1" style={{ color: "var(--ow-fg-1)" }}>
          {legs.length} tronçon{legs.length > 1 ? "s" : ""} · {passage.distance_nm.toFixed(1)} nm
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

      {/* Leg rows */}
      <div>
        {legs.map((leg, i) => {
          const cx = cxLevel((leg.tws_min + leg.tws_max) / 2);
          const windLabel = Math.round(leg.tws_min) === Math.round(leg.tws_max)
            ? `${Math.round(leg.tws_min)} kn`
            : `${Math.round(leg.tws_min)}–${Math.round(leg.tws_max)} kn`;
          const seaLabel = leg.hs_avg_m == null
            ? null
            : `${leg.hs_avg_m.toFixed(1)}m ${leg.sea_direction}`;
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
                {leg.point_of_sail} · {windLabel}{seaLabel ? ` · ${seaLabel}` : ""} · {leg.boat_speed_kn.toFixed(1)} kn
              </span>
              <span className="tabular-nums shrink-0" style={{ color: "var(--ow-fg-2)", fontFamily: "var(--ow-font-mono)" }}>
                {fmtTime(leg.end_time)}
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

// ── ResizableMobileDrawer ────────────────────────────────────────────────────
// User-resizable bottom drawer: a 4 px grab-handle at the top responds to
// pointer drag (mouse or touch) and adjusts the drawer height in vh. The
// chosen height persists in localStorage so reload feels stable.

const DRAWER_HEIGHT_KEY = "ow_drawer_vh_v1";
const DRAWER_MIN_VH = 12;
const DRAWER_MAX_VH = 90;

function ResizableMobileDrawer({
  defaultVh,
  children,
}: {
  defaultVh: number;
  children: React.ReactNode;
}) {
  const [vh, setVh] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(DRAWER_HEIGHT_KEY);
      const parsed = raw ? Number(raw) : NaN;
      return Number.isFinite(parsed) ? Math.max(DRAWER_MIN_VH, Math.min(DRAWER_MAX_VH, parsed)) : defaultVh;
    } catch {
      return defaultVh;
    }
  });
  const dragRef = useRef<{ startY: number; startVh: number } | null>(null);

  function persist(next: number) {
    try { localStorage.setItem(DRAWER_HEIGHT_KEY, String(next)); } catch { /* best-effort */ }
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    dragRef.current = { startY: e.clientY, startVh: vh };
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    const dy = dragRef.current.startY - e.clientY; // up = positive
    const vhDelta = (dy / window.innerHeight) * 100;
    const next = Math.max(DRAWER_MIN_VH, Math.min(DRAWER_MAX_VH, dragRef.current.startVh + vhDelta));
    setVh(next);
  }
  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (dragRef.current) {
      persist(vh);
      dragRef.current = null;
    }
    (e.currentTarget as HTMLDivElement).releasePointerCapture?.(e.pointerId);
  }

  return (
    <div
      className="lg:hidden shrink-0 overflow-y-auto border-t flex flex-col"
      style={{ height: `${vh}vh`, background: "var(--ow-bg-1)", borderColor: "var(--ow-line)" }}
    >
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Redimensionner le panneau"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="shrink-0 flex items-center justify-center cursor-row-resize touch-none"
        style={{ height: 14, background: "var(--ow-bg-1)" }}
      >
        <span
          className="block rounded-full"
          style={{ width: 36, height: 4, background: "var(--ow-line-2)" }}
        />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>
    </div>
  );
}

// ── ResizableDesktopSidebar ──────────────────────────────────────────────────
// Desktop equivalent of ResizableMobileDrawer: vertical grab-handle on the left
// edge adjusts width in px. Persists in localStorage so reload feels stable.
// Useful when comparing windows — the 7-column table is cramped at 320–384 px.

const SIDEBAR_WIDTH_KEY = "ow_sidebar_px_v1";
const SIDEBAR_MIN_PX = 280;
const SIDEBAR_MAX_PX = 800;

function ResizableDesktopSidebar({
  defaultPx,
  children,
}: {
  defaultPx: number;
  children: React.ReactNode;
}) {
  const [px, setPx] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(SIDEBAR_WIDTH_KEY);
      const parsed = raw ? Number(raw) : NaN;
      return Number.isFinite(parsed)
        ? Math.max(SIDEBAR_MIN_PX, Math.min(SIDEBAR_MAX_PX, parsed))
        : defaultPx;
    } catch {
      return defaultPx;
    }
  });
  const dragRef = useRef<{ startX: number; startPx: number } | null>(null);

  function persist(next: number) {
    try { localStorage.setItem(SIDEBAR_WIDTH_KEY, String(next)); } catch { /* best-effort */ }
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startPx: px };
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    // Sidebar is on the right, so dragging left expands it.
    const dx = dragRef.current.startX - e.clientX;
    const next = Math.max(SIDEBAR_MIN_PX, Math.min(SIDEBAR_MAX_PX, dragRef.current.startPx + dx));
    setPx(next);
  }
  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (dragRef.current) {
      persist(px);
      dragRef.current = null;
    }
    (e.currentTarget as HTMLDivElement).releasePointerCapture?.(e.pointerId);
  }

  return (
    <div
      className="hidden lg:flex shrink-0"
      style={{ width: `${px}px`, background: "var(--ow-bg-1)" }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Redimensionner le panneau"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="group shrink-0 flex items-center justify-center cursor-col-resize touch-none transition-colors hover:bg-[var(--ow-bg-2)]"
        style={{
          width: 12,
          borderLeft: "1px solid var(--ow-line)",
          borderRight: "1px solid var(--ow-line)",
        }}
      >
        <span
          className="block rounded-full transition-colors group-hover:bg-[var(--ow-accent)]"
          style={{ width: 4, height: 56, background: "var(--ow-fg-3)" }}
        />
      </div>
      <div className="flex-1 min-w-0 overflow-y-auto">{children}</div>
    </div>
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
    isParsedOk(initialParsed) && initialParsed.archetype ? initialParsed.archetype : "cruiser_30ft"
  );
  const [departure, setDeparture] = useState(() => {
    const raw = isParsedOk(initialParsed) ? initialParsed.departure : "";
    if (!raw || new Date(raw) < new Date()) return nowRoundedLocal();
    return raw;
  });

  const [passage, setPassage] = useState<PassageReport | null>(null);
  const [complexity, setComplexity] = useState<ComplexityScore | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [archetypes, setArchetypes] = useState<Archetype[]>([]);
  const [forecastUpdatedAt, setForecastUpdatedAt] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);

  // Compare-windows mode (lifted from PlanSidebar in step 2)
  const [planMode, setPlanMode] = useState<"single" | "compare">("single");
  const [sweepEarliest, setSweepEarliest] = useState(() => departure);
  const [sweepLatest, setSweepLatest] = useState(() => {
    const d = new Date(departure);
    d.setDate(d.getDate() + 2);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  const [sweepInterval, setSweepInterval] = useState<number>(3);
  const [windows, setWindows] = useState<PassageWindow[] | null>(null);
  const [metaWarnings, setMetaWarnings] = useState<string[]>([]);

  useEffect(() => {
    fetchArchetypes().then(setArchetypes).catch(() => {});
  }, []);

  function doFetch(wpts: [number, number][], arch: string, dep: string) {
    setIsLoading(true);
    setApiError(null);
    fetchPassage({ waypoints: wpts, departure: toTzAware(dep), archetype: arch })
      .then((res) => {
        setPassage(res.passage);
        setComplexity(res.complexity);
        setForecastUpdatedAt(res.forecast_updated_at);
        setIsStale(false);
        // Update URL + cookie only on successful fetch
        const url = buildPlanUrl(wpts, dep, arch);
        window.history.replaceState(null, "", url);
        const ttl = 7 * 24 * 3600;
        document.cookie = `ow_last_trip=${encodeURIComponent(window.location.href)};max-age=${ttl};path=/;SameSite=Lax`;
        // Persist for next visit. Merge into existing cache so a previously
        // saved compare-mode result stays available.
        const prev = loadLastSimulation();
        const sameRoute =
          prev && waypointsEqual(prev.waypoints, wpts) && prev.archetype === arch;
        saveLastSimulation({
          waypoints: wpts,
          archetype: arch,
          single: {
            departure: dep,
            passage: res.passage,
            complexity: res.complexity,
            forecastUpdatedAt: res.forecast_updated_at,
          },
          compare: sameRoute ? prev?.compare : undefined,
          cachedAt: Date.now(),
        });
      })
      .catch((e: Error) => setApiError(friendlyError(e.message)))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => {
    if (!isParsedOk(initialParsed) || initialParsed.waypoints.length < 2) return;
    // Try the localStorage cache first: if we have a saved simulation for the
    // same route + archetype, hydrate state directly and skip the network call.
    // The user sees their last plan instantly on reload.
    const cached: LastSimulation | null = loadLastSimulation();
    const cacheMatches =
      cached &&
      waypointsEqual(cached.waypoints, initialParsed.waypoints) &&
      cached.archetype === initialParsed.archetype;
    if (cacheMatches) {
      // Restore single-mode result if its departure matches the URL departure.
      if (cached.single && cached.single.departure === departure) {
        setPassage(cached.single.passage);
        setComplexity(cached.single.complexity);
        setForecastUpdatedAt(cached.single.forecastUpdatedAt);
      }
      // Always restore compare-mode windows + sweep params if present —
      // sweep range isn't encoded in the URL, so we trust the cache.
      if (cached.compare) {
        setWindows(cached.compare.windows);
        setMetaWarnings(cached.compare.metaWarnings);
        setSweepEarliest(cached.compare.sweepEarliest);
        setSweepLatest(cached.compare.sweepLatest);
        setSweepInterval(cached.compare.sweepIntervalHours);
        if (!cached.single || cached.single.departure !== departure) {
          setForecastUpdatedAt(cached.compare.forecastUpdatedAt);
        }
      }
      // If we restored anything, skip the auto-fetch.
      if (cached.single || cached.compare) return;
    }
    doFetch(initialParsed.waypoints, initialParsed.archetype, departure);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Functional updaters avoid stale closure when clicks happen fast
  function handleMapClick(lat: number, lon: number) {
    setWaypoints((prev) => [...prev, [lat, lon]]);
  }

  function handleWptMove(idx: number, lat: number, lon: number) {
    setWaypoints((prev) => prev.map((wp, i): [number, number] => (i === idx ? [lat, lon] : wp)));
    setIsStale(true);
  }

  function handleWptAdd(afterIdx: number, lat: number, lon: number) {
    setWaypoints((prev) => {
      const next = [...prev];
      next.splice(afterIdx + 1, 0, [lat, lon]);
      return next;
    });
    setIsStale(true);
  }

  function handleWptDelete(idx: number) {
    setWaypoints((prev) => prev.filter((_, i) => i !== idx));
    setIsStale(true);
  }

  function handleArchetypeChange(slug: string) {
    setArchetype(slug);
    setIsStale(true);
  }

  function handleDepartureChange(iso: string) {
    setDeparture(iso);
    setIsStale(true);
  }

  function handleRefetch() {
    doFetch(waypoints, archetype, departure);
  }

  function doFetchWindows() {
    setIsLoading(true);
    setApiError(null);
    fetchPassageWindows({
      waypoints,
      earliest: toTzAware(sweepEarliest),
      latest: toTzAware(sweepLatest),
      archetype,
      intervalHours: sweepInterval,
    })
      .then((res) => {
        setWindows(res.windows);
        setMetaWarnings(res.meta_warnings);
        setForecastUpdatedAt(res.forecast_updated_at);
        // Don't clear single-mode results — render gates on `mode` instead.
        setIsStale(false);
        // Persist for next visit. Merge with existing single-mode cache if
        // the route still matches.
        const prev = loadLastSimulation();
        const sameRoute =
          prev && waypointsEqual(prev.waypoints, waypoints) && prev.archetype === archetype;
        saveLastSimulation({
          waypoints,
          archetype,
          single: sameRoute ? prev?.single : undefined,
          compare: {
            sweepEarliest,
            sweepLatest,
            sweepIntervalHours: sweepInterval,
            windows: res.windows,
            metaWarnings: res.meta_warnings,
            forecastUpdatedAt: res.forecast_updated_at,
          },
          cachedAt: Date.now(),
        });
      })
      .catch((e: Error) => setApiError(friendlyError(e.message)))
      .finally(() => setIsLoading(false));
  }

  function handleModeChange(next: "single" | "compare") {
    if (next === planMode) return;
    setPlanMode(next);
    setApiError(null);
    // Don't clear opposite-mode results: keeping `passage` and `windows`
    // both in memory lets the user toggle back and forth without re-fetching.
    // The render branches gate on `mode` so stale data never leaks visually.
  }

  // Drill-down from the compare-windows table: pick a window → switch to
  // single mode with that window's departure pre-filled.
  // Fast path: the sweep response already includes `passage` and
  // `complexity_full` per window — hydrate state directly, zero re-fetch.
  // Fallback: older HF Space deployments don't include those fields → call
  // doFetch as before so the UX still works during deployment lag.
  function handleWindowSelect(w: PassageWindow) {
    const d = new Date(w.departure);
    const pad = (n: number) => String(n).padStart(2, "0");
    const naiveDep = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

    setPlanMode("single");
    setDeparture(naiveDep);
    setMetaWarnings([]);
    setApiError(null);

    if (w.passage && w.complexity_full) {
      // Hydrate from the in-memory window — instant.
      setPassage(w.passage);
      setComplexity(w.complexity_full);
      setIsLoading(false);
      setIsStale(false);
      // Update URL + cookie so reload restores the same view.
      const url = buildPlanUrl(waypoints, naiveDep, archetype);
      window.history.replaceState(null, "", url);
      const ttl = 7 * 24 * 3600;
      document.cookie = `ow_last_trip=${encodeURIComponent(window.location.href)};max-age=${ttl};path=/;SameSite=Lax`;
      // Keep windows around so the user can switch back to compare mode and
      // see the table again without re-fetching the sweep.
      // setWindows(null) intentionally NOT called — user toggling back to
      // compare should see their table immediately.
    } else {
      // Backwards-compatible fallback: re-fetch.
      setWindows(null);
      doFetch(waypoints, archetype, naiveDep);
    }
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
            onWptAdd={waypoints.length >= 2 ? handleWptAdd : undefined}
            onWptDelete={handleWptDelete}
            onMapClick={handleMapClick}
          />
          {/* Back-to-explore FAB — mirrors the compass FAB on the home map */}
          <a
            href="/"
            className="absolute top-3 left-3 z-[400] w-20 h-20 rounded-full flex items-center justify-center shadow-lg transition-transform hover:scale-105 active:scale-95"
            style={{ background: "var(--ow-accent)", color: "#fff" }}
            title="Retour à l'exploration"
          >
            <img src="/wind-icon.png" alt="" width="88" height="88" className="select-none" draggable={false} />
          </a>
          {/* Hint overlay while building the route */}
          {waypoints.length < 2 && (
            <div className="absolute inset-x-4 bottom-4 z-[400] flex justify-center pointer-events-none">
              <div
                className="px-4 py-2 rounded-xl text-sm font-medium"
                style={{ background: "var(--ow-surface-glass)", backdropFilter: "blur(8px)", border: "1px solid var(--ow-line-2)", color: "var(--ow-fg-1)" }}
              >
                {waypoints.length === 0 ? "Cliquez pour placer le départ" : "Cliquez pour tracer votre route"}
              </div>
            </div>
          )}
          {/* Hero stats overlay — mobile only, floats above compact drawer */}
          {passage && complexity && (
            <div className="lg:hidden absolute bottom-2 left-2 right-2 z-[400] pointer-events-none">
              <PlanHeroStats passage={passage} complexity={complexity} />
            </div>
          )}
        </div>

        {/* Desktop sidebar — user-resizable via the handle on the left edge. */}
        <ResizableDesktopSidebar defaultPx={384}>
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
            waypointCount={waypoints.length}
            waypoints={waypoints}
            mode={planMode}
            onModeChange={handleModeChange}
            sweepEarliest={sweepEarliest}
            sweepLatest={sweepLatest}
            sweepIntervalHours={sweepInterval}
            onSweepEarliestChange={setSweepEarliest}
            onSweepLatestChange={setSweepLatest}
            onSweepIntervalChange={setSweepInterval}
            windows={windows}
            metaWarnings={metaWarnings}
            onCompareFetch={doFetchWindows}
            onWindowSelect={handleWindowSelect}
          />
        </ResizableDesktopSidebar>
      </div>

      {/* Mobile drawer — below map. User-resizable via the handle bar at the top. */}
      <ResizableMobileDrawer defaultVh={passage ? 38 : 60}>
        {passage && complexity && planMode === "single" ? (
          <CompactDrawer
            passage={passage}
            complexity={complexity}
            waypoints={waypoints}
            isLoading={isLoading}
            error={apiError}
            isStale={isStale}
            onRefetch={handleRefetch}
            mode={planMode}
            onModeChange={handleModeChange}
          />
        ) : (
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
            waypointCount={waypoints.length}
            waypoints={waypoints}
            mode={planMode}
            onModeChange={handleModeChange}
            sweepEarliest={sweepEarliest}
            sweepLatest={sweepLatest}
            sweepIntervalHours={sweepInterval}
            onSweepEarliestChange={setSweepEarliest}
            onSweepLatestChange={setSweepLatest}
            onSweepIntervalChange={setSweepInterval}
            windows={windows}
            metaWarnings={metaWarnings}
            onCompareFetch={doFetchWindows}
            onWindowSelect={handleWindowSelect}
          />
        )}
      </ResizableMobileDrawer>
    </div>
  );
}
