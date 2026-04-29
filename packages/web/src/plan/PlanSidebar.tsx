import { useMemo, useState } from "react";
import { useTheme } from "../design/theme";
import type { PassageReport, ComplexityScore, SegmentReport, Archetype } from "./types";
import { aggregateLegs } from "./aggregateLegs";
import { cxLevel, CX_COLORS } from "./types";

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
}: {
  value: string;
  onChange: (iso: string) => void;
  resolvedTheme: "light" | "dark";
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

  // Display labels
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
          Départ
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
            aria-label="Date de départ"
          />
          <div className="flex justify-between text-[10px] mt-1" style={{ color: "var(--ow-fg-2)" }}>
            <span>Maintenant</span>
            <span>+1 sem.</span>
            <span>+2 sem.</span>
          </div>
        </>
      )}
    </div>
  );
}



// ── ModeToggle ───────────────────────────────────────────────────────────────

type PlanMode = "single" | "compare";

function ModeToggle({ value, onChange }: { value: PlanMode; onChange: (m: PlanMode) => void }) {
  return (
    <div
      className="flex p-1 rounded-xl text-xs font-semibold"
      style={{ background: "var(--ow-bg-2)", border: "1px solid var(--ow-line-2)" }}
      role="tablist"
      aria-label="Mode de planification"
    >
      {(
        [
          ["single", "Simuler ma route"],
          ["compare", "Comparer les fenêtres"],
        ] as const
      ).map(([m, label]) => {
        const active = value === m;
        return (
          <button
            key={m}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(m)}
            className="flex-1 px-3 py-1.5 rounded-lg transition-colors"
            style={{
              background: active ? "var(--ow-bg-1)" : "transparent",
              color: active ? "var(--ow-fg-0)" : "var(--ow-fg-2)",
              boxShadow: active ? "var(--ow-shadow-soft)" : "none",
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

// ── SweepForm ─────────────────────────────────────────────────────────────────

const SWEEP_INTERVALS: { value: number; label: string }[] = [
  { value: 1, label: "Toutes les heures" },
  { value: 3, label: "Toutes les 3h" },
  { value: 6, label: "Toutes les 6h" },
];

function SweepForm({
  earliest,
  latest,
  intervalHours,
  targetEta,
  onEarliestChange,
  onLatestChange,
  onIntervalChange,
  onTargetEtaChange,
  resolvedTheme,
}: {
  earliest: string;
  latest: string;
  intervalHours: number;
  targetEta: string;
  onEarliestChange: (iso: string) => void;
  onLatestChange: (iso: string) => void;
  onIntervalChange: (h: number) => void;
  onTargetEtaChange: (iso: string) => void;
  resolvedTheme: "light" | "dark";
}) {
  const colorScheme = resolvedTheme === "light" ? "light" : "dark";
  const [showEta, setShowEta] = useState(targetEta !== "");

  const inputStyle = {
    background: "var(--ow-bg-2)",
    color: "var(--ow-fg-0)",
    border: "1px solid var(--ow-line-2)",
    fontFamily: "var(--ow-font-mono)",
    colorScheme,
  } as const;

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--ow-fg-2)" }}>
          Départ au plus tôt
        </label>
        <input
          type="datetime-local"
          value={earliest}
          onChange={(e) => onEarliestChange(e.target.value)}
          className="w-full rounded-lg px-3 py-1.5 text-sm font-semibold tabular-nums"
          style={inputStyle}
        />
      </div>

      <div>
        <label className="block text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--ow-fg-2)" }}>
          Départ au plus tard
        </label>
        <input
          type="datetime-local"
          value={latest}
          onChange={(e) => onLatestChange(e.target.value)}
          className="w-full rounded-lg px-3 py-1.5 text-sm font-semibold tabular-nums"
          style={inputStyle}
        />
      </div>

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

      <div>
        <button
          type="button"
          onClick={() => {
            const next = !showEta;
            setShowEta(next);
            if (!next) onTargetEtaChange("");
          }}
          className="text-[10px] underline"
          style={{ color: "var(--ow-fg-2)" }}
        >
          {showEta ? "Retirer l'heure d'arrivée souhaitée" : "+ Heure d'arrivée souhaitée (option)"}
        </button>
        {showEta && (
          <input
            type="datetime-local"
            value={targetEta}
            onChange={(e) => onTargetEtaChange(e.target.value)}
            className="w-full rounded-lg px-3 py-1.5 text-sm font-semibold tabular-nums mt-1.5"
            style={inputStyle}
          />
        )}
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
}: PlanSidebarProps) {
  const { resolvedTheme } = useTheme();
  const canCalculate = waypointCount >= 2;

  // Step 1 (UI only): mode toggle + sweep form local state.
  // No API wiring yet — calculate stays disabled in compare mode with a hint.
  const [mode, setMode] = useState<PlanMode>("single");
  const [sweepEarliest, setSweepEarliest] = useState(() => departure);
  const [sweepLatest, setSweepLatest] = useState(() => {
    const d = new Date(departure);
    d.setDate(d.getDate() + 2);
    return toLocalIso(d);
  });
  const [sweepInterval, setSweepInterval] = useState(3);
  const [targetEta, setTargetEta] = useState("");

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

  if (!passage || !complexity) {
    return (
      <div className="p-4 space-y-4 animate-fade-in">
        {/* Waypoint progress */}
        <div className="flex items-center gap-3">
          {[0, 1].map((i) => (
            <div key={i} className="flex items-center gap-1.5">
              <span
                className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold"
                style={{
                  background: waypointCount > i ? (i === 0 ? "#2dd4bf" : "#e84118") : "var(--ow-bg-2)",
                  color: waypointCount > i ? "#fff" : "var(--ow-fg-3)",
                  border: `2px solid ${waypointCount > i ? "transparent" : "var(--ow-line-2)"}`,
                }}
              >
                {i === 0 ? "▶" : "■"}
              </span>
              <span className="text-xs" style={{ color: waypointCount > i ? "var(--ow-fg-1)" : "var(--ow-fg-3)" }}>
                {i === 0 ? "Départ" : "Arrivée"}
              </span>
            </div>
          ))}
        </div>

        {/* Instruction */}
        <p className="text-sm leading-relaxed" style={{ color: "var(--ow-fg-2)" }}>
          {waypointCount === 0
            ? "Cliquez sur la carte pour placer votre point de départ."
            : "Cliquez sur la carte pour placer votre point d'arrivée."}
        </p>

        {/* Mode toggle */}
        <ModeToggle value={mode} onChange={setMode} />

        {/* Departure (single) or sweep form (compare) */}
        {mode === "single" ? (
          <DepartureSlider value={departure} onChange={onDepartureChange} resolvedTheme={resolvedTheme} />
        ) : (
          <SweepForm
            earliest={sweepEarliest}
            latest={sweepLatest}
            intervalHours={sweepInterval}
            targetEta={targetEta}
            onEarliestChange={setSweepEarliest}
            onLatestChange={setSweepLatest}
            onIntervalChange={setSweepInterval}
            onTargetEtaChange={setTargetEta}
            resolvedTheme={resolvedTheme}
          />
        )}

        {/* Archetype */}
        <ArchetypeSelector
          currentSlug={currentArchetypeSlug}
          archetypes={archetypes}
          onChange={onArchetypeChange}
        />

        {/* Calculate button */}
        {mode === "single" ? (
          <button
            onClick={onRefetch}
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
            {canCalculate ? "Calculer le passage" : `${waypointCount}/2 waypoints`}
          </button>
        ) : (
          <button
            disabled
            title="Comparateur — branchement MCP à venir"
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold"
            style={{
              background: "var(--ow-bg-2)",
              color: "var(--ow-fg-3)",
              border: "1px dashed var(--ow-line-2)",
              cursor: "not-allowed",
            }}
          >
            Comparer les créneaux · à venir
          </button>
        )}
      </div>
    );
  }

  const hasWarnings = (complexity.warnings?.length ?? 0) > 0 || passage.warnings.length > 0;

  return (
    <div className="p-4 space-y-4 animate-fade-in">
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

      {/* Departure — editable */}
      <DepartureSlider value={departure} onChange={onDepartureChange} resolvedTheme={resolvedTheme} />

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

      {/* Legs — one row per user waypoint segment */}
      {(() => {
        const legs = aggregateLegs(passage.segments, waypoints);
        return (
          <div>
            <div className="flex items-center gap-2 mb-1 px-1 text-[9px]" style={{ color: "var(--ow-fg-3)" }}>
              <span className="w-5 shrink-0" />
              <span className="flex-1 grid grid-cols-4 gap-1">
                <span>Heure</span>
                <span>Allure</span>
                <span>Vent</span>
                <span className="text-right">Vitesse</span>
              </span>
            </div>
            <div className="space-y-1">
              {legs.map((leg, i) => {
                const cx = cxLevel((leg.tws_min + leg.tws_max) / 2);
                const windLabel = Math.round(leg.tws_min) === Math.round(leg.tws_max)
                  ? `${Math.round(leg.tws_min)} kn`
                  : `${Math.round(leg.tws_min)}–${Math.round(leg.tws_max)} kn`;
                return (
                  <div key={i} className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs" style={{ background: "var(--ow-bg-2)" }}>
                    <span
                      className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center font-bold text-[10px]"
                      style={{ background: CX_COLORS[cx], color: "#fff" }}
                    >
                      {i + 1}
                    </span>
                    <div className="flex-1 grid grid-cols-4 gap-1 tabular-nums" style={{ fontFamily: "var(--ow-font-mono)" }}>
                      <span style={{ color: "var(--ow-fg-1)" }}>{fmtTime(leg.end_time)}</span>
                      <span style={{ color: "var(--ow-fg-0)" }}>{leg.point_of_sail}</span>
                      <span style={{ color: "var(--ow-fg-1)" }}>{windLabel}</span>
                      <span className="text-right" style={{ color: "var(--ow-fg-0)" }}>{leg.boat_speed_kn.toFixed(1)} kn</span>
                    </div>
                  </div>
                );
              })}
            </div>
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
