import type { AggregatedLeg } from "./aggregateLegs";

// "Comment c'est calculé" — expanded leg detail. The card lays out the speed
// build-up that flows: polar (× efficiency) − wave penalty + current = target.
// Numbers come from `aggregateLegs` (segment-level math weighted by distance,
// so the column sums match the displayed target).

const fmtKn = (kn: number, signed = false): string => {
  const r = Math.abs(kn) < 0.05 ? 0 : kn; // hide tiny rounding flips
  if (!signed) return `${r.toFixed(1)} kn`;
  const sign = r > 0 ? "+" : r < 0 ? "−" : "";
  return `${sign}${Math.abs(r).toFixed(1)} kn`;
};

function GaugeIcon({ size = 11, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a5 5 0 0 1 10 0" />
      <path d="M8 12 11 8" />
      <circle cx="8" cy="12" r="0.7" fill={color} />
    </svg>
  );
}

// ── Build-up rows ─────────────────────────────────────────────────────────────
function BuildUpRow({
  label,
  sub,
  value,
  tone,
}: {
  label: string;
  sub: string;
  value: string;
  tone: "base" | "pos" | "neg" | "total";
}) {
  const colorMap: Record<typeof tone, string> = {
    base: "var(--ow-fg-1)",
    pos: "var(--ow-ok)",
    neg: "var(--ow-warn)",
    total: "var(--ow-accent)",
  };
  return (
    <div className="flex items-center gap-2 mt-1">
      <div className="flex-1 min-w-0">
        <div className="text-[11px]" style={{ color: "var(--ow-fg-0)", fontWeight: tone === "total" ? 600 : 500 }}>
          {label}
        </div>
        <div className="text-[9px] mt-0.5" style={{ color: "var(--ow-fg-2)", fontFamily: "var(--ow-font-mono)" }}>
          {sub}
        </div>
      </div>
      <span
        className="text-xs font-semibold tabular-nums"
        style={{ color: colorMap[tone], fontFamily: "var(--ow-font-mono)", letterSpacing: "-0.01em" }}
      >
        {value}
      </span>
    </div>
  );
}

// ── Main card ─────────────────────────────────────────────────────────────────
export function LegDetailCard({ leg, archetypeLabel }: { leg: AggregatedLeg; archetypeLabel: string }) {
  const twa = Math.round(Math.abs(leg.twa_avg_deg) > 180 ? 360 - Math.abs(leg.twa_avg_deg) : Math.abs(leg.twa_avg_deg));
  const tws = Math.round(leg.tws_avg_kn);
  const effPct = Math.round(leg.efficiency * 100);

  // Sea direction relative to the boat (hs_avg_m null → no sea data)
  const seaDir = leg.sea_direction; // "face" | "travers" | "arrière" | null
  const tpStr = leg.tp_avg_s != null ? ` · Tp ${leg.tp_avg_s.toFixed(1)} s` : "";

  // Wind sub-line: surface gust whenever it's meaningfully above TWS so the
  // sailor sees the volatility the build-up doesn't otherwise expose.
  const gustNote =
    leg.gust_max_kn != null && leg.gust_max_kn > tws + 1
      ? ` · rafales ${Math.round(leg.gust_max_kn)} kn`
      : "";

  return (
    <div className="px-4 pb-3 pt-1">
      {/* Section label */}
      <div
        className="flex items-center gap-1.5 mb-2.5 text-[10px] font-bold uppercase"
        style={{ color: "var(--ow-accent)", letterSpacing: "0.1em" }}
      >
        <GaugeIcon size={11} color="var(--ow-accent)" />
        Comment c'est calculé
      </div>

      {/* Build-up card */}
      <div
        className="rounded-lg p-3"
        style={{ background: "var(--ow-bg-1)", border: "1px solid var(--ow-line)" }}
      >
        <div
          className="text-[9px] mb-1.5 font-bold uppercase tracking-widest"
          style={{ color: "var(--ow-fg-2)", fontFamily: "var(--ow-font-mono)" }}
        >
          Vitesse cible · build-up
        </div>
        <BuildUpRow
          label="Polaire bateau"
          sub={`${archetypeLabel} · TWA ${twa}° / TWS ${tws} kn${gustNote} · efficacité ${effPct}%`}
          value={fmtKn(leg.polar_after_eff_kn, true)}
          tone="base"
        />
        {Math.abs(leg.wave_delta_kn) > 0.05 && (
          <BuildUpRow
            label="Pénalité vagues"
            sub={
              leg.hs_avg_m != null
                ? `Hs ${leg.hs_avg_m.toFixed(1)} m${tpStr}${seaDir ? ` · de ${seaDir}` : ""}`
                : "—"
            }
            value={fmtKn(leg.wave_delta_kn, true)}
            tone="neg"
          />
        )}
        {leg.current_delta_kn != null && Math.abs(leg.current_delta_kn) > 0.05 && (
          <BuildUpRow
            label="Courant"
            sub={
              leg.current_speed_kn != null
                ? `${leg.current_speed_kn.toFixed(1)} kn ${leg.current_relative ?? ""}`.trim()
                : "—"
            }
            value={fmtKn(leg.current_delta_kn, true)}
            tone={leg.current_delta_kn >= 0 ? "pos" : "neg"}
          />
        )}
        <div className="h-px my-1.5" style={{ background: "var(--ow-line)" }} />
        <BuildUpRow
          label="Cible retenue"
          sub="utilisée pour la durée"
          value={fmtKn(leg.target_speed_kn)}
          tone="total"
        />
      </div>
    </div>
  );
}
