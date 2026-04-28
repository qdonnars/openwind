import type { PassageReport, ComplexityScore, SegmentReport } from "./types";
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

function fmtDeparture(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("fr-FR", {
    weekday: "short", day: "numeric", month: "short",
    hour: "2-digit", minute: "2-digit",
  });
}

function compassDir(deg: number): string {
  const dirs = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
  return dirs[Math.round(deg / 45) % 8];
}

// ── ComplexityBadge ───────────────────────────────────────────────────────────

function ComplexityBadge({ level, label }: { level: number; label: string }) {
  return (
    <div
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm font-bold"
      style={{ background: CX_COLORS[level] + "22", color: CX_COLORS[level], border: `1px solid ${CX_COLORS[level]}55` }}
    >
      <span
        className="w-2.5 h-2.5 rounded-full"
        style={{ background: CX_COLORS[level] }}
      />
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

// ── PlanSidebar ───────────────────────────────────────────────────────────────

interface PlanSidebarProps {
  passage: PassageReport | null;
  complexity: ComplexityScore | null;
  isLoading: boolean;
  error: string | null;
  archetypeName: string;
  forecastUpdatedAt: string | null;
}

export function PlanSidebar({
  passage,
  complexity,
  isLoading,
  error,
  archetypeName,
  forecastUpdatedAt,
}: PlanSidebarProps) {
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

  if (!passage || !complexity) return null;

  const hasWarnings = (complexity.warnings?.length ?? 0) > 0 || passage.warnings.length > 0;

  return (
    <div className="p-4 space-y-4 animate-fade-in">
      {/* Departure */}
      <div>
        <p className="text-[10px] uppercase tracking-widest mb-0.5 font-semibold" style={{ color: "var(--ow-fg-2)" }}>Départ</p>
        <p className="text-xl font-bold tabular-nums" style={{ fontFamily: "var(--ow-font-mono)", color: "var(--ow-fg-0)" }}>
          {fmtDeparture(passage.departure_time)}
        </p>
      </div>

      {/* Archetype */}
      <p className="text-sm" style={{ color: "var(--ow-fg-1)" }}>
        {archetypeName || passage.archetype}
      </p>

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

      {/* Legs */}
      <div>
        <p className="text-[10px] uppercase tracking-widest mb-2 font-semibold" style={{ color: "var(--ow-fg-2)" }}>
          Segments ({passage.segments.length})
        </p>
        <div className="space-y-1">
          {passage.segments.map((seg, i) => {
            const cx = cxLevel(seg.tws_kn);
            return (
              <div key={i} className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs" style={{ background: "var(--ow-bg-2)" }}>
                <span
                  className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center font-bold text-[10px]"
                  style={{ background: CX_COLORS[cx], color: "#fff" }}
                >
                  {i + 1}
                </span>
                <div className="flex-1 grid grid-cols-5 gap-1 tabular-nums" style={{ fontFamily: "var(--ow-font-mono)" }}>
                  <span className="text-right" style={{ color: "var(--ow-fg-1)" }}>{seg.distance_nm.toFixed(1)} nm</span>
                  <span className="text-right" style={{ color: "var(--ow-fg-0)" }}>{seg.tws_kn.toFixed(0)} kn</span>
                  <span className="text-right" style={{ color: "var(--ow-fg-1)" }}>{compassDir(seg.twd_deg)}</span>
                  <span className="text-right" style={{ color: "var(--ow-fg-0)" }}>{seg.boat_speed_kn.toFixed(1)} kn</span>
                  <span className="text-right" style={{ color: "var(--ow-fg-2)" }}>{fmtTime(seg.end_time)}</span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex justify-between text-[9px] mt-1 px-1" style={{ color: "var(--ow-fg-3)" }}>
          <span />
          <span className="grid grid-cols-5 gap-1 w-[calc(100%-28px)]">
            <span className="text-right">Dist</span>
            <span className="text-right">TWS</span>
            <span className="text-right">Dir</span>
            <span className="text-right">Vit</span>
            <span className="text-right">ETA</span>
          </span>
        </div>
      </div>

      {/* Footer */}
      {forecastUpdatedAt && (
        <p className="text-[10px] pt-1 border-t" style={{ color: "var(--ow-fg-2)", borderColor: "var(--ow-line)" }}>
          Données fraîches au {new Date(forecastUpdatedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })} · Open-Meteo.com (CC BY 4.0)
        </p>
      )}
    </div>
  );
}
