import type { AggregatedLeg } from "./aggregateLegs";

// "Comment c'est calculé" — expanded leg detail. Layout:
//   1. Build-up of the target speed: polar → wave penalty → current → target
//   2. Four mini-tiles: polar pose, observed wind, sea sensitivity, current
// Numbers come from `aggregateLegs` (segment-level math weighted by distance,
// so the column sums match the displayed target).

const fmtKn = (kn: number, signed = false): string => {
  const r = Math.abs(kn) < 0.05 ? 0 : kn; // hide tiny rounding flips
  if (!signed) return `${r.toFixed(1)} kn`;
  const sign = r > 0 ? "+" : r < 0 ? "−" : "";
  return `${sign}${Math.abs(r).toFixed(1)} kn`;
};

function compass16(deg: number): string {
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return dirs[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
}

// ── Inline icons (kept tiny, design uses 11px line-art) ────────────────────────
function Icon({ name, size = 11, color = "currentColor" }: { name: "gauge" | "sail" | "wind" | "alert" | "route"; size?: number; color?: string }) {
  const stroke = { width: 1.6, color };
  const common = { width: size, height: size, viewBox: "0 0 16 16", fill: "none", stroke: stroke.color, strokeWidth: stroke.width, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (name) {
    case "gauge":
      return (<svg {...common}><path d="M3 12a5 5 0 0 1 10 0" /><path d="M8 12 11 8" /><circle cx="8" cy="12" r="0.7" fill={color} /></svg>);
    case "sail":
      return (<svg {...common}><path d="M8 2v11" /><path d="M8 2c-2.5 1 -4 5 -4 11h4z" /><path d="M2 14h12" /></svg>);
    case "wind":
      return (<svg {...common}><path d="M3 6h7a2 2 0 1 0-2-2" /><path d="M3 10h10a2 2 0 1 1-2 2" /></svg>);
    case "alert":
      return (<svg {...common}><path d="M8 2 14 13H2z" /><path d="M8 7v3" /><circle cx="8" cy="12" r="0.5" fill={color} /></svg>);
    case "route":
      return (<svg {...common}><path d="M3 12c2-4 5-1 7-3 1-1 2-3 3-3" /><circle cx="3" cy="12" r="1.4" fill={color} stroke="none" /><circle cx="13" cy="6" r="1.4" fill={color} stroke="none" /></svg>);
  }
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

// ── Mini visualizations ───────────────────────────────────────────────────────
function PolarMini({ twa }: { twa: number }) {
  const r = 16, cx = 20, cy = 20;
  // TWA is a relative angle (0..180). Place it on the right hemisphere of a half-circle.
  const a = Math.min(180, Math.max(0, Math.abs(twa) > 180 ? 360 - Math.abs(twa) : Math.abs(twa)));
  const angle = ((a - 90) * Math.PI) / 180;
  const tx = cx + Math.cos(angle) * r;
  const ty = cy + Math.sin(angle) * r;
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--ow-line-2)" strokeWidth="1" />
      <path
        d={`M ${cx} ${cy - r} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
        stroke="var(--ow-accent)"
        strokeWidth="1.5"
        fill="none"
      />
      <line x1={cx} y1={cy} x2={tx} y2={ty} stroke="var(--ow-accent)" strokeWidth="1.5" />
      <circle cx={tx} cy={ty} r="2.2" fill="var(--ow-accent)" />
    </svg>
  );
}

function CompassArrow({ deg, label }: { deg: number; label: string }) {
  // True wind direction is "from" — flip to "to" for the arrow tip.
  return (
    <div className="flex flex-col items-center gap-0.5">
      <svg width="26" height="26" viewBox="0 0 26 26" style={{ transform: `rotate(${deg + 180}deg)` }} aria-hidden="true">
        <line x1="13" y1="5" x2="13" y2="20" stroke="var(--ow-fg-1)" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M13 5 L9 10 M13 5 L17 10" stroke="var(--ow-fg-1)" strokeWidth="1.6" strokeLinecap="round" fill="none" />
      </svg>
      <span className="text-[8px] tabular-nums" style={{ color: "var(--ow-fg-2)", fontFamily: "var(--ow-font-mono)" }}>{label}</span>
    </div>
  );
}

function WaveMini({ steep }: { steep: boolean }) {
  // Tighter wavelength when steep (Hs/Tp high) — visual cue, not to scale.
  const path = steep
    ? "M0 13 Q 4 4 8 13 T 16 13 T 24 13 T 32 13 T 40 13"
    : "M0 13 Q 6 6 12 13 T 24 13 T 36 13 T 48 13";
  return (
    <svg width="40" height="20" viewBox="0 0 40 20" aria-hidden="true">
      <path d={path} stroke="var(--ow-warn)" strokeWidth="1.5" fill="none" />
    </svg>
  );
}

function CurrentArrow({ relative }: { relative: "portant" | "contraire" | "travers" }) {
  const color = relative === "portant" ? "var(--ow-ok)" : relative === "contraire" ? "var(--ow-warn)" : "var(--ow-fg-1)";
  // travers: short side-line; portant: forward arrow; contraire: backward arrow
  if (relative === "travers") {
    return (
      <svg width="40" height="20" viewBox="0 0 40 20" aria-hidden="true">
        <path d="M2 10 L38 10" stroke={color} strokeWidth="1.5" fill="none" />
        <path d="M22 6 L18 10 L22 14" stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg
      width="40"
      height="20"
      viewBox="0 0 40 20"
      aria-hidden="true"
      style={{ transform: relative === "contraire" ? "scaleX(-1)" : "none" }}
    >
      <path d="M2 10 Q 11 4 22 10 T 40 10" stroke={color} strokeWidth="1.5" fill="none" />
      <path d="M34 7 L40 10 L34 13" stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round" />
    </svg>
  );
}

// ── Factor tile (the 4 cards) ─────────────────────────────────────────────────
function FactorTile({
  icon,
  title,
  metric,
  caption,
  tone,
  extra,
}: {
  icon: "sail" | "wind" | "alert" | "route";
  title: string;
  metric: string;
  caption: string;
  tone?: "warn" | "ok";
  extra?: React.ReactNode;
}) {
  const accent = tone === "warn" ? "var(--ow-warn)" : tone === "ok" ? "var(--ow-ok)" : "var(--ow-fg-0)";
  return (
    <div
      className="rounded-lg p-2.5"
      style={{ background: "var(--ow-bg-1)", border: "1px solid var(--ow-line)" }}
    >
      <div className="flex items-center gap-1.5 mb-1.5" style={{ color: "var(--ow-fg-2)" }}>
        <Icon name={icon} size={11} />
        <span className="text-[9px] font-bold uppercase tracking-widest">{title}</span>
      </div>
      <div className="flex items-end justify-between gap-1.5">
        <div className="min-w-0">
          <div
            className="text-[15px] font-bold tabular-nums leading-none"
            style={{ color: accent, fontFamily: "var(--ow-font-mono)", letterSpacing: "-0.02em" }}
          >
            {metric}
          </div>
          <div className="text-[9px] mt-1 leading-tight" style={{ color: "var(--ow-fg-2)" }}>
            {caption}
          </div>
        </div>
        {extra && <div className="shrink-0">{extra}</div>}
      </div>
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
  const seaSub = leg.hs_avg_m != null
    ? `Hs ${leg.hs_avg_m.toFixed(1)} m${tpStr}${seaDir ? ` · de ${seaDir}` : ""}`
    : "Pas de donnée vagues";

  // Current sub-text
  const curSub = (() => {
    if (leg.current_speed_kn == null || leg.current_relative == null) return "Pas de donnée courant";
    const speed = leg.current_speed_kn.toFixed(1);
    const rel = leg.current_relative;
    return `${speed} kn ${rel}`;
  })();
  const gustStr = leg.gust_max_kn != null ? `rafales ${Math.round(leg.gust_max_kn)} kn · ` : "";

  // Steepness heuristic: short period for the height = steep mer courte.
  const steepSea = leg.hs_avg_m != null && leg.tp_avg_s != null && leg.hs_avg_m / leg.tp_avg_s > 0.3;

  return (
    <div className="px-4 pb-3 pt-1">
      {/* Section label */}
      <div
        className="flex items-center gap-1.5 mb-2.5 text-[10px] font-bold uppercase"
        style={{ color: "var(--ow-accent)", letterSpacing: "0.1em" }}
      >
        <Icon name="gauge" size={11} color="var(--ow-accent)" />
        Comment c'est calculé
      </div>

      {/* Build-up card */}
      <div
        className="rounded-lg p-3 mb-2.5"
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
          sub={`${archetypeLabel} · TWA ${twa}° / TWS ${tws} kn · efficacité ${effPct}%`}
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

      {/* 4 factor tiles */}
      <div className="grid grid-cols-2 gap-2">
        <FactorTile
          icon="sail"
          title="Finesse bateau"
          metric={`${leg.polar_after_eff_kn.toFixed(1)} kn`}
          caption={`${leg.point_of_sail.toLowerCase()} · TWA ${twa}°`}
          extra={<PolarMini twa={leg.twa_avg_deg} />}
        />
        <FactorTile
          icon="wind"
          title="Vent vu"
          metric={`${tws} kn`}
          caption={`${gustStr}${leg.point_of_sail.toLowerCase()}`}
          extra={<CompassArrow deg={leg.twd_avg_deg} label={compass16(leg.twd_avg_deg)} />}
        />
        <FactorTile
          icon="alert"
          title="Sensibilité vagues"
          metric={leg.hs_avg_m != null ? fmtKn(leg.wave_delta_kn, true) : "—"}
          caption={seaSub}
          tone="warn"
          extra={leg.hs_avg_m != null ? <WaveMini steep={steepSea} /> : null}
        />
        <FactorTile
          icon="route"
          title="Courant"
          metric={leg.current_delta_kn != null ? fmtKn(leg.current_delta_kn, true) : "—"}
          caption={curSub}
          tone={leg.current_delta_kn != null && leg.current_delta_kn >= 0 ? "ok" : "warn"}
          extra={leg.current_relative ? <CurrentArrow relative={leg.current_relative} /> : null}
        />
      </div>
    </div>
  );
}
