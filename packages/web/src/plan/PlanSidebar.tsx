import { useMemo, useState } from "react";
import { useTheme } from "../design/theme";
import type { PassageReport, ComplexityScore, SegmentReport, Archetype, PassageWindow } from "./types";
import { aggregateLegs, type AggregatedLeg } from "./aggregateLegs";
import { cxLevel, CX_COLORS } from "./types";
import { WindowsTable } from "./WindowsTable";
import { ModeToggle, TimeAnchorToggle, type PlanMode, type TimeAnchor } from "./ModeToggle";
import { LegDetailCard } from "./LegDetailCard";

// ── helpers ──────────────────────────────────────────────────────────────────

function fmtDuration(h: number): string {
  const hrs = Math.floor(h);
  const mins = Math.round((h - hrs) * 60);
  return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

// Format a Date as "YYYY-MM-DDTHH:MM" (local, naive — the format datetime-local expects).
function toLocalIso(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ── DepartureSlider ──────────────────────────────────────────────────────────

// Open-Meteo's forecast endpoint caps start_date/end_date at ~today+15. We cap
// the slider at 14 d to leave 1 d of margin (clock skew, TZ crossings).
const SLIDER_MAX_HOURS = 14 * 24;

function DepartureSlider({
  value,
  onChange,
  resolvedTheme,
  anchor: timeAnchor = "departure",
}: {
  value: string;
  onChange: (iso: string) => void;
  resolvedTheme: "light" | "dark";
  anchor?: TimeAnchor;
}) {
  const [showManual, setShowManual] = useState(false);

  // Anchor "now" once per mount so the slider's left edge stays fixed during interaction.
  const anchor = useMemo(() => {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    return d;
  }, []);

  const valueDate = useMemo(() => new Date(value), [value]);
  const valueHours = Math.max(
    0,
    Math.min(SLIDER_MAX_HOURS, Math.round((valueDate.getTime() - anchor.getTime()) / 3_600_000)),
  );

  function setHours(h: number) {
    const d = new Date(anchor.getTime() + h * 3_600_000);
    onChange(toLocalIso(d));
  }

  function resetToNow() {
    const d = new Date();
    d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
    onChange(toLocalIso(d));
  }

  // Display labels — section header changes with the time anchor.
  const sectionLabel = timeAnchor === "arrival" ? "Arrivée" : "Départ";
  const ariaLabel = timeAnchor === "arrival" ? "Heure d'arrivée souhaitée" : "Date de départ";
  const dateLabel = valueDate.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  const timeLabel = valueDate.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const dayDelta = Math.floor((valueDate.getTime() - anchor.getTime()) / 86_400_000);
  const offsetLabel =
    dayDelta <= 0 ? "Aujourd'hui" :
    dayDelta === 1 ? "Demain" :
    `Dans ${dayDelta} jours`;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: "var(--ow-fg-2)" }}>
          {sectionLabel}
        </span>
        <button
          type="button"
          onClick={() => setShowManual((v) => !v)}
          className="text-[10px] underline"
          style={{ color: "var(--ow-fg-2)" }}
        >
          {showManual ? "Slider" : "Ajuster"}
        </button>
      </div>

      <div className="text-sm font-semibold mb-2" style={{ color: "var(--ow-fg-0)" }}>
        <span className="capitalize">{dateLabel}</span>
        <span className="mx-1.5" style={{ color: "var(--ow-fg-2)" }}>·</span>
        <span className="tabular-nums" style={{ fontFamily: "var(--ow-font-mono)" }}>{timeLabel}</span>
        <span className="ml-2 text-[11px] font-normal" style={{ color: "var(--ow-fg-2)" }}>{offsetLabel}</span>
      </div>

      {showManual ? (
        <input
          type="datetime-local"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg px-3 py-1.5 text-sm font-semibold tabular-nums"
          style={{
            background: "var(--ow-bg-2)",
            color: "var(--ow-fg-0)",
            border: "1px solid var(--ow-line-2)",
            fontFamily: "var(--ow-font-mono)",
            colorScheme: resolvedTheme === "light" ? "light" : "dark",
          }}
        />
      ) : (
        <>
          <input
            type="range"
            min={0}
            max={SLIDER_MAX_HOURS}
            step={1}
            value={valueHours}
            onChange={(e) => setHours(Number(e.target.value))}
            className="ow-departure-slider w-full"
            aria-label={ariaLabel}
          />
          <div className="flex justify-between text-[10px] mt-1" style={{ color: "var(--ow-fg-2)" }}>
            {/* Maintenant is clickable: defaulting to J+1 lets the user pick a
                horizon, but a single tap still lands them back at "now". */}
            <button
              type="button"
              onClick={resetToNow}
              className="underline-offset-2 hover:underline"
              style={{ color: dayDelta <= 0 ? "var(--ow-accent)" : "var(--ow-fg-2)" }}
            >
              Maintenant
            </button>
            <span>+1 sem.</span>
            <span>+2 sem.</span>
          </div>
        </>
      )}
    </div>
  );
}



// ModeToggle moved to ./ModeToggle so CompactDrawer can reuse it.

// ── DepartureRangeSlider ─────────────────────────────────────────────────────
// Dual-thumb slider for the compare-windows form. Two overlapping native ranges
// keyed in hours-from-now; the right thumb is constrained to stay >= 1 h after
// the left thumb. Constraints by construction = no out-of-range dates can be
// picked, replacing the error-prone datetime-local pair.

const RANGE_MAX_HOURS = 14 * 24; // mirror Open-Meteo cap (today+14d)

function DepartureRangeSlider({
  earliestHours,
  latestHours,
  onChange,
}: {
  earliestHours: number;
  latestHours: number;
  onChange: (earliest: number, latest: number) => void;
}) {
  const anchor = useMemo(() => {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    return d;
  }, []);

  const eClamped = Math.max(0, Math.min(RANGE_MAX_HOURS - 1, earliestHours));
  const lClamped = Math.max(eClamped + 1, Math.min(RANGE_MAX_HOURS, latestHours));

  function setEarliest(h: number) {
    const next = Math.max(0, Math.min(RANGE_MAX_HOURS - 1, h));
    const newLatest = Math.max(next + 1, lClamped);
    onChange(next, Math.min(RANGE_MAX_HOURS, newLatest));
  }
  function setLatest(h: number) {
    const next = Math.min(RANGE_MAX_HOURS, Math.max(eClamped + 1, h));
    onChange(eClamped, next);
  }

  function fmt(hours: number): { date: string; time: string; offset: string } {
    const d = new Date(anchor.getTime() + hours * 3_600_000);
    return {
      date: d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" }),
      time: d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }),
      offset: (() => {
        const days = Math.floor(hours / 24);
        if (days === 0) return "Aujourd'hui";
        if (days === 1) return "Demain";
        return `J+${days}`;
      })(),
    };
  }

  const eFmt = fmt(eClamped);
  const lFmt = fmt(lClamped);
  const windowHours = lClamped - eClamped;
  const windowLabel = windowHours >= 24
    ? `${(windowHours / 24).toFixed(windowHours % 24 === 0 ? 0 : 1)} j`
    : `${windowHours} h`;

  // Track fill % for visual fill between thumbs
  const fillStart = (eClamped / RANGE_MAX_HOURS) * 100;
  const fillEnd = (lClamped / RANGE_MAX_HOURS) * 100;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: "var(--ow-fg-2)" }}>
          Fenêtre de départ
        </span>
        <span className="text-[10px] tabular-nums" style={{ color: "var(--ow-accent)" }}>
          {windowLabel}
        </span>
      </div>

      {/* Two readouts, one per thumb */}
      <div className="flex items-baseline justify-between text-xs mb-2 tabular-nums" style={{ fontFamily: "var(--ow-font-mono)" }}>
        <div>
          <div className="capitalize font-semibold" style={{ color: "var(--ow-fg-0)" }}>
            {eFmt.date} · {eFmt.time}
          </div>
          <div className="text-[10px]" style={{ color: "var(--ow-fg-2)" }}>{eFmt.offset}</div>
        </div>
        <div className="text-right">
          <div className="capitalize font-semibold" style={{ color: "var(--ow-fg-0)" }}>
            {lFmt.date} · {lFmt.time}
          </div>
          <div className="text-[10px]" style={{ color: "var(--ow-fg-2)" }}>{lFmt.offset}</div>
        </div>
      </div>

      <div className="ow-range-track">
        <div className="ow-range-track-bg" />
        <div
          className="ow-range-track-fill"
          style={{ left: `${fillStart}%`, right: `${100 - fillEnd}%` }}
        />
        <input
          type="range"
          min={0}
          max={RANGE_MAX_HOURS}
          step={1}
          value={eClamped}
          onChange={(e) => setEarliest(Number(e.target.value))}
          className="ow-range-input"
          aria-label="Départ au plus tôt"
          style={{ zIndex: eClamped > RANGE_MAX_HOURS / 2 ? 3 : 2 }}
        />
        <input
          type="range"
          min={0}
          max={RANGE_MAX_HOURS}
          step={1}
          value={lClamped}
          onChange={(e) => setLatest(Number(e.target.value))}
          className="ow-range-input"
          aria-label="Départ au plus tard"
          style={{ zIndex: eClamped > RANGE_MAX_HOURS / 2 ? 2 : 3 }}
        />
      </div>

      <div className="flex justify-between text-[10px] mt-1" style={{ color: "var(--ow-fg-2)" }}>
        <span>Maintenant</span>
        <span>+1 sem.</span>
        <span>+2 sem.</span>
      </div>
    </div>
  );
}

// ── SweepForm ─────────────────────────────────────────────────────────────────

const SWEEP_INTERVALS: { value: number; label: string }[] = [
  { value: 1, label: "Toutes les heures" },
  { value: 3, label: "Toutes les 3h" },
  { value: 6, label: "Toutes les 6h" },
];

// Match the single-mode slider cap: Open-Meteo forecast tops out at ~today+15;
// we keep 14 d to leave 1 d of margin for clock skew / TZ crossings.
const SWEEP_HORIZON_DAYS = 14;
// Backend safety cap: 14 d × 24 h = 336 windows. Mirror it here so we can
// surface a friendly hint before sending an oversize request.
const MAX_SWEEP_WINDOWS = 336;

export interface SweepValidation {
  ok: boolean;
  message?: string;
}

export function validateSweep(earliest: string, latest: string, intervalHours: number): SweepValidation {
  if (!earliest || !latest) return { ok: false, message: "Renseignez une fenêtre de départ." };
  const e = new Date(earliest);
  const l = new Date(latest);
  if (Number.isNaN(e.getTime()) || Number.isNaN(l.getTime())) {
    return { ok: false, message: "Dates invalides." };
  }
  if (l.getTime() <= e.getTime()) {
    return { ok: false, message: "Le « plus tard » doit être après le « plus tôt »." };
  }
  const horizonMs = SWEEP_HORIZON_DAYS * 86_400_000;
  const now = new Date();
  if (l.getTime() - now.getTime() > horizonMs) {
    return {
      ok: false,
      message: `La météo n'est fiable que sur ${SWEEP_HORIZON_DAYS} jours. Choisissez une date plus tôt.`,
    };
  }
  const windows = Math.floor((l.getTime() - e.getTime()) / 3_600_000 / intervalHours) + 1;
  if (windows > MAX_SWEEP_WINDOWS) {
    return {
      ok: false,
      message: `Trop de créneaux à comparer (${windows}). Réduisez la fenêtre ou augmentez le pas.`,
    };
  }
  return { ok: true };
}

// Minimal "YYYY-MM-DDTHH:MM" formatter from a Date (local time).
function toLocalIsoMin(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function SweepForm({
  earliest,
  latest,
  intervalHours,
  onEarliestChange,
  onLatestChange,
  onIntervalChange,
}: {
  earliest: string;
  latest: string;
  intervalHours: number;
  onEarliestChange: (iso: string) => void;
  onLatestChange: (iso: string) => void;
  onIntervalChange: (h: number) => void;
}) {
  // Convert ISO local strings <-> hours-from-now so the slider can drive them.
  const anchor = useMemo(() => {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    return d;
  }, []);
  function isoToHours(iso: string): number {
    if (!iso) return 0;
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return 0;
    return Math.round((t - anchor.getTime()) / 3_600_000);
  }
  function hoursToIso(h: number): string {
    return toLocalIsoMin(new Date(anchor.getTime() + h * 3_600_000));
  }

  const earliestHours = Math.max(0, isoToHours(earliest));
  const latestHours = Math.max(earliestHours + 1, isoToHours(latest));

  const validation = validateSweep(earliest, latest, intervalHours);

  return (
    <div className="space-y-3">
      <DepartureRangeSlider
        earliestHours={earliestHours}
        latestHours={latestHours}
        onChange={(e, l) => {
          onEarliestChange(hoursToIso(e));
          onLatestChange(hoursToIso(l));
        }}
      />
      {!validation.ok && validation.message && (
        <p className="text-[11px]" style={{ color: "var(--ow-warn)" }}>
          {validation.message}
        </p>
      )}

      <div>
        <label className="block text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--ow-fg-2)" }}>
          Pas d'échantillonnage
        </label>
        <div className="flex gap-1.5">
          {SWEEP_INTERVALS.map(({ value, label }) => {
            const active = intervalHours === value;
            return (
              <button
                key={value}
                onClick={() => onIntervalChange(value)}
                className="flex-1 px-2 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                style={{
                  background: active ? "var(--ow-accent-soft)" : "var(--ow-bg-2)",
                  color: active ? "var(--ow-accent)" : "var(--ow-fg-1)",
                  border: `1px solid ${active ? "var(--ow-accent)" : "var(--ow-line-2)"}`,
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

    </div>
  );
}

// ── ComplexityBadge ───────────────────────────────────────────────────────────

function ComplexityBadge({ level, label }: { level: number; label: string }) {
  return (
    <div
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm font-bold"
      style={{ background: CX_COLORS[level] + "22", color: CX_COLORS[level], border: `1px solid ${CX_COLORS[level]}55` }}
    >
      <span className="w-2.5 h-2.5 rounded-full" style={{ background: CX_COLORS[level] }} />
      {level}/5 — {label}
    </div>
  );
}

// ── ComplexityBar ─────────────────────────────────────────────────────────────

function ComplexityBar({ segments }: { segments: SegmentReport[] }) {
  const total = segments.reduce((s, seg) => s + seg.distance_nm, 0);
  return (
    <div className="flex h-2.5 rounded-full overflow-hidden gap-[1px]" role="progressbar">
      {segments.map((seg, i) => (
        <div
          key={i}
          style={{
            width: `${(seg.distance_nm / total) * 100}%`,
            background: CX_COLORS[cxLevel(seg.tws_kn)],
            minWidth: 2,
          }}
        />
      ))}
    </div>
  );
}

// ── SegmentLegend ─────────────────────────────────────────────────────────────

function SegmentLegend() {
  const items: [number, string][] = [
    [1, "< 10 kn"], [2, "10–15"], [3, "15–20"], [4, "20–25"], [5, "> 25"],
  ];
  return (
    <div className="hidden lg:flex items-center gap-2 text-[10px]" style={{ color: "var(--ow-fg-2)" }}>
      {items.map(([lvl, label]) => (
        <div key={lvl} className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ background: CX_COLORS[lvl] }} />
          {label}
        </div>
      ))}
    </div>
  );
}

// ── ArchetypeSelector ─────────────────────────────────────────────────────────

function ArchetypeSelector({
  currentSlug,
  archetypes,
  onChange,
}: {
  currentSlug: string;
  archetypes: Archetype[];
  onChange: (slug: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = archetypes.find((a) => a.slug === currentSlug);
  const label = current?.name ?? currentSlug;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-sm transition-colors"
        style={{ color: "var(--ow-fg-1)" }}
        title="Changer le type de bateau"
      >
        {label}
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" style={{ opacity: 0.5 }}>
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
        </svg>
      </button>

      {open && (
        <>
          {/* backdrop */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            className="absolute left-0 top-7 z-20 min-w-[220px] rounded-xl shadow-xl border overflow-hidden"
            style={{ background: "var(--ow-bg-1)", borderColor: "var(--ow-line-2)", boxShadow: "var(--ow-shadow-pop)" }}
          >
            {archetypes.map((a) => (
              <button
                key={a.slug}
                onClick={() => { onChange(a.slug); setOpen(false); }}
                className="w-full text-left px-4 py-3 text-sm transition-colors"
                style={{
                  background: a.slug === currentSlug ? "var(--ow-accent-soft)" : "transparent",
                  color: a.slug === currentSlug ? "var(--ow-accent)" : "var(--ow-fg-0)",
                  borderBottom: "1px solid var(--ow-line)",
                }}
              >
                <div className="font-semibold">{a.name}</div>
                <div className="text-[11px] mt-0.5" style={{ color: "var(--ow-fg-2)" }}>
                  {a.length_ft} ft · {a.type} · {a.examples[0]}
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── LegList ──────────────────────────────────────────────────────────────────
// Click-to-expand list of legs, with the "Comment c'est calculé" build-up
// rendered inline for the open leg.

function LegRow({
  leg,
  index,
  expanded,
  archetypeLabel,
  onToggle,
}: {
  leg: AggregatedLeg;
  index: number;
  expanded: boolean;
  archetypeLabel: string;
  onToggle: () => void;
}) {
  const cx = cxLevel((leg.tws_min + leg.tws_max) / 2);
  const tws = Math.round(leg.tws_avg_kn);
  return (
    <div style={{ borderBottom: "1px solid var(--ow-line)", background: expanded ? "var(--ow-bg-2)" : "transparent" }}>
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left"
        aria-expanded={expanded}
      >
        <span
          className="shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-[11px] font-bold tabular-nums"
          style={{ background: CX_COLORS[cx], color: "#0B1D14", fontFamily: "var(--ow-font-mono)" }}
        >
          {index + 1}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold truncate" style={{ color: "var(--ow-fg-0)" }}>
            Tronçon {index + 1}
          </div>
          <div className="text-[10px] mt-0.5 tabular-nums" style={{ color: "var(--ow-fg-2)", fontFamily: "var(--ow-font-mono)" }}>
            {leg.distance_nm.toFixed(1)} nm · {leg.point_of_sail} · {tws} kn
          </div>
        </div>
        <span className="text-[11px] tabular-nums shrink-0" style={{ color: "var(--ow-fg-1)", fontFamily: "var(--ow-font-mono)" }}>
          {new Date(leg.end_time).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
        </span>
        <span
          aria-hidden="true"
          className="inline-flex"
          style={{
            color: expanded ? "var(--ow-accent)" : "var(--ow-fg-3)",
            transform: expanded ? "rotate(180deg)" : "none",
            transition: "transform 150ms ease, color 150ms ease",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6l5 5 5-5" />
          </svg>
        </span>
      </button>
      {expanded && <LegDetailCard leg={leg} archetypeLabel={archetypeLabel} />}
    </div>
  );
}

function LegList({ legs, archetypeLabel }: { legs: AggregatedLeg[]; archetypeLabel: string }) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  return (
    <div>
      <div
        className="flex items-center justify-between px-4 pt-3 pb-1.5 text-[10px] uppercase tracking-widest font-bold"
        style={{ color: "var(--ow-fg-2)" }}
      >
        Segments
        <span className="text-[9px] font-medium normal-case tracking-normal" style={{ color: "var(--ow-fg-3)", fontFamily: "var(--ow-font-mono)" }}>
          cliquez pour détailler
        </span>
      </div>
      <div style={{ borderTop: "1px solid var(--ow-line)" }}>
        {legs.map((leg, i) => (
          <LegRow
            key={i}
            leg={leg}
            index={i}
            expanded={openIdx === i}
            archetypeLabel={archetypeLabel}
            onToggle={() => setOpenIdx((cur) => (cur === i ? null : i))}
          />
        ))}
      </div>
    </div>
  );
}

// ── PlanSidebar ───────────────────────────────────────────────────────────────

interface PlanSidebarProps {
  passage: PassageReport | null;
  complexity: ComplexityScore | null;
  isLoading: boolean;
  error: string | null;
  archetypes: Archetype[];
  currentArchetypeSlug: string;
  onArchetypeChange: (slug: string) => void;
  departure: string;
  onDepartureChange: (iso: string) => void;
  isStale: boolean;
  onRefetch: () => void;
  forecastUpdatedAt: string | null;
  waypointCount: number;
  waypoints: [number, number][];
  // ETA-driven sub-mode for "Simuler ma route".
  timeAnchor: TimeAnchor;
  onTimeAnchorChange: (a: TimeAnchor) => void;
  // Compare-windows mode (lifted from local state in step 2)
  mode: PlanMode;
  onModeChange: (m: PlanMode) => void;
  sweepEarliest: string;
  sweepLatest: string;
  sweepIntervalHours: number;
  onSweepEarliestChange: (iso: string) => void;
  onSweepLatestChange: (iso: string) => void;
  onSweepIntervalChange: (h: number) => void;
  windows: PassageWindow[] | null;
  metaWarnings: string[];
  onCompareFetch: () => void;
  onWindowSelect?: (w: PassageWindow) => void;
}

export function PlanSidebar({
  passage,
  complexity,
  isLoading,
  error,
  archetypes,
  currentArchetypeSlug,
  onArchetypeChange,
  departure,
  onDepartureChange,
  isStale,
  onRefetch,
  forecastUpdatedAt,
  waypointCount,
  waypoints,
  timeAnchor,
  onTimeAnchorChange,
  mode,
  onModeChange,
  sweepEarliest,
  sweepLatest,
  sweepIntervalHours,
  onSweepEarliestChange,
  onSweepLatestChange,
  onSweepIntervalChange,
  windows,
  metaWarnings,
  onCompareFetch,
  onWindowSelect,
}: PlanSidebarProps) {
  const { resolvedTheme } = useTheme();
  const sweepValid = mode === "compare"
    ? validateSweep(sweepEarliest, sweepLatest, sweepIntervalHours)
    : { ok: true } as SweepValidation;
  const canCalculate = waypointCount >= 2 && (mode === "single" || sweepValid.ok);

  if (isLoading) {
    return (
      <div className="p-4 space-y-4 animate-fade-in">
        <div className="skeleton h-8 w-48 rounded-lg" />
        <div className="skeleton h-5 w-32 rounded" />
        <div className="grid grid-cols-4 gap-2">
          {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-14 rounded-lg" />)}
        </div>
        <div className="skeleton h-2.5 rounded-full" />
        {[0, 1, 2].map((i) => <div key={i} className="skeleton h-10 rounded-lg" />)}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <div className="rounded-xl p-4 text-sm" style={{ background: "var(--ow-err-soft)", color: "var(--ow-err)", border: "1px solid var(--ow-err-line)" }}>
          <p className="font-semibold mb-1">Erreur</p>
          <p className="leading-relaxed">{error}</p>
        </div>
      </div>
    );
  }

  // In compare mode we always show the form + (optional) windows table,
  // even if a single-mode `passage` is also in memory. That way toggling
  // back to single shows the cached single result without a re-fetch.
  if (mode === "compare" || !passage || !complexity) {
    return (
      <div className="p-4 space-y-4 animate-fade-in">
        {/* Mode toggle */}
        <ModeToggle value={mode} onChange={onModeChange} />

        {/* Departure (single) or sweep form (compare) */}
        {mode === "single" ? (
          <div className="space-y-2">
            <TimeAnchorToggle value={timeAnchor} onChange={onTimeAnchorChange} />
            <DepartureSlider
              value={departure}
              onChange={onDepartureChange}
              resolvedTheme={resolvedTheme}
              anchor={timeAnchor}
            />
          </div>
        ) : (
          <SweepForm
            earliest={sweepEarliest}
            latest={sweepLatest}
            intervalHours={sweepIntervalHours}
            onEarliestChange={onSweepEarliestChange}
            onLatestChange={onSweepLatestChange}
            onIntervalChange={onSweepIntervalChange}
          />
        )}

        {/* Archetype */}
        <ArchetypeSelector
          currentSlug={currentArchetypeSlug}
          archetypes={archetypes}
          onChange={onArchetypeChange}
        />

        {/* Calculate button */}
        <button
          onClick={mode === "single" ? onRefetch : onCompareFetch}
          disabled={!canCalculate}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all"
          style={{
            background: canCalculate ? "var(--ow-accent)" : "var(--ow-bg-2)",
            color: canCalculate ? "#fff" : "var(--ow-fg-3)",
            border: `1px solid ${canCalculate ? "transparent" : "var(--ow-line-2)"}`,
            cursor: canCalculate ? "pointer" : "not-allowed",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M13.5 2.5A7 7 0 1 0 14.5 9"/><path d="M14 1v4h-4"/>
          </svg>
          {canCalculate
            ? mode === "single" ? "Calculer le passage" : "Comparer les créneaux"
            : `${waypointCount}/2 waypoints`}
        </button>

        {/* Windows table — shown after a successful compare-mode fetch */}
        {mode === "compare" && windows && windows.length > 0 && (
          <div className="space-y-2">
            {metaWarnings.map((m, i) => (
              <p key={i} className="text-[11px] rounded-lg px-3 py-1.5"
                 style={{ background: "var(--ow-warn-soft)", color: "var(--ow-warn)" }}>
                {m}
              </p>
            ))}
            <div className="rounded-xl overflow-hidden border" style={{ borderColor: "var(--ow-line)" }}>
              <WindowsTable windows={windows} onSelect={onWindowSelect} />
            </div>
            <p className="text-[10px]" style={{ color: "var(--ow-fg-3)" }}>
              {windows.length} fenêtre{windows.length > 1 ? "s" : ""} comparée{windows.length > 1 ? "s" : ""} · cliquez sur une ligne pour ouvrir la simulation détaillée
            </p>
          </div>
        )}
      </div>
    );
  }

  const hasWarnings = (complexity.warnings?.length ?? 0) > 0 || passage.warnings.length > 0;

  return (
    <div className="p-4 space-y-4 animate-fade-in">
      {/* Mode toggle — always visible so the user can switch back to compare */}
      <ModeToggle value={mode} onChange={onModeChange} />

      {/* Recalculate — grows when stale */}
      <button
        onClick={onRefetch}
        className={`w-full flex items-center justify-center gap-2 rounded-xl font-bold transition-all ${isStale ? "py-3 text-base" : "py-1.5 text-xs"}`}
        style={{
          background: isStale ? "var(--ow-accent)" : "var(--ow-bg-2)",
          color: isStale ? "#fff" : "var(--ow-fg-2)",
          border: `1px solid ${isStale ? "transparent" : "var(--ow-line-2)"}`,
        }}
      >
        <svg width={isStale ? 16 : 12} height={isStale ? 16 : 12} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M13.5 2.5A7 7 0 1 0 14.5 9"/><path d="M14 1v4h-4"/>
        </svg>
        Recalculer
      </button>

      {/* Time anchor + slider — both editable in the result view too. */}
      <TimeAnchorToggle value={timeAnchor} onChange={onTimeAnchorChange} />
      <DepartureSlider
        value={departure}
        onChange={onDepartureChange}
        resolvedTheme={resolvedTheme}
        anchor={timeAnchor}
      />

      {/* Archetype dropdown */}
      <ArchetypeSelector
        currentSlug={currentArchetypeSlug}
        archetypes={archetypes}
        onChange={onArchetypeChange}
      />

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {[
          { label: "Distance", value: `${passage.distance_nm.toFixed(1)} nm` },
          { label: "Durée", value: fmtDuration(passage.duration_h) },
          { label: "Arrivée", value: fmtTime(passage.arrival_time) },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-xl p-3" style={{ background: "var(--ow-bg-2)" }}>
            <p className="text-[9px] uppercase tracking-widest mb-1 font-semibold" style={{ color: "var(--ow-fg-2)" }}>{label}</p>
            <p className="text-sm font-bold tabular-nums" style={{ color: "var(--ow-fg-0)", fontFamily: "var(--ow-font-mono)" }}>{value}</p>
          </div>
        ))}
        <div className="rounded-xl p-3" style={{ background: "var(--ow-bg-2)" }}>
          <p className="text-[9px] uppercase tracking-widest mb-1 font-semibold" style={{ color: "var(--ow-fg-2)" }}>Complexité</p>
          <p className="text-sm font-bold" style={{ color: CX_COLORS[complexity.level], fontFamily: "var(--ow-font-mono)" }}>
            {complexity.level}/5 — {complexity.label}
          </p>
        </div>
      </div>

      {/* Complexity bar */}
      <div className="space-y-1.5">
        <ComplexityBar segments={passage.segments} />
        <SegmentLegend />
      </div>

      {/* Complexity badge */}
      <ComplexityBadge level={complexity.level} label={complexity.label} />

      {/* Warnings */}
      {hasWarnings && (
        <div className="space-y-1.5">
          {complexity.warnings?.map((w, i) => (
            <div key={i} className="flex items-start gap-2 rounded-lg px-3 py-2 text-xs" style={{ background: "var(--ow-warn-soft)", color: "var(--ow-warn)", border: "1px solid var(--ow-warn-line)" }}>
              <span className="shrink-0 mt-0.5">⚠</span>
              <span>{w.message}</span>
            </div>
          ))}
          {passage.warnings.map((w, i) => (
            <div key={`pw-${i}`} className="flex items-start gap-2 rounded-lg px-3 py-2 text-xs" style={{ background: "var(--ow-warn-soft)", color: "var(--ow-warn)", border: "1px solid var(--ow-warn-line)" }}>
              <span className="shrink-0 mt-0.5">⚠</span>
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}

      {/* Legs — click any row to see the "Comment c'est calculé" build-up */}
      {(() => {
        const legs = aggregateLegs(passage.segments, waypoints, passage.efficiency);
        const archetype = archetypes.find((a) => a.slug === currentArchetypeSlug);
        const archetypeLabel = archetype?.name ?? currentArchetypeSlug;
        // LegList has its own padding; cancel the page's px-4 so the rows
        // stretch edge-to-edge like the design.
        return (
          <div className="-mx-4">
            <LegList legs={legs} archetypeLabel={archetypeLabel} />
          </div>
        );
      })()}

      {/* Footer */}
      {forecastUpdatedAt && (
        <p className="text-[10px] pt-1 border-t" style={{ color: "var(--ow-fg-2)", borderColor: "var(--ow-line)" }}>
          Données fraîches au {new Date(forecastUpdatedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })} · Open-Meteo.com (CC BY 4.0)
        </p>
      )}
    </div>
  );
}
