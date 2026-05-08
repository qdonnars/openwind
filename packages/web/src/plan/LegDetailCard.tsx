import type { AggregatedLeg } from "./aggregateLegs";

// "Comment c'est calculé" — top-down boat compass showing where wind, waves
// and current come from relative to the boat's heading. The boat sits in the
// middle pointing up (= its course); each force has a labelled arrow around it.
//
// Numbers come from `aggregateLegs` (segment-level math weighted by distance).

const SIZE = 240;
const CENTER = SIZE / 2;
const COMPASS_R = 88;
const ARROW_TIP_R = 56;   // wind/wave tip closes in toward the boat
const ARROW_TAIL_R = 86;
const CURRENT_TAIL_R = 38;
const CURRENT_TIP_R = 84;
const LABEL_R = 102;

const COMPASS_16 = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"] as const;
const compass16 = (deg: number): string =>
  COMPASS_16[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];

// 0° = up (12 o'clock), increasing clockwise. Returns [x, y] in SVG coords.
function polarXY(angleDeg: number, r: number): [number, number] {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return [CENTER + Math.cos(rad) * r, CENTER + Math.sin(rad) * r];
}

// Anchor a label so it stays readable on either side of the dial.
function textAnchor(angleDeg: number): "start" | "middle" | "end" {
  const a = ((angleDeg % 360) + 360) % 360;
  if (a < 20 || a > 340) return "middle";
  if (a > 160 && a < 200) return "middle";
  return a < 180 ? "start" : "end";
}

function ForceArrow({
  fromR,
  toR,
  angleDeg,
  color,
  width = 2,
}: {
  fromR: number;
  toR: number;
  angleDeg: number;
  color: string;
  width?: number;
}) {
  const [x1, y1] = polarXY(angleDeg, fromR);
  const [x2, y2] = polarXY(angleDeg, toR);
  // Build a small arrowhead at (x2, y2) pointing in the direction (fromR → toR).
  const dirRad = Math.atan2(y2 - y1, x2 - x1);
  const head = 7;
  const wing = 4;
  const hx1 = x2 - Math.cos(dirRad) * head + Math.sin(dirRad) * wing;
  const hy1 = y2 - Math.sin(dirRad) * head - Math.cos(dirRad) * wing;
  const hx2 = x2 - Math.cos(dirRad) * head - Math.sin(dirRad) * wing;
  const hy2 = y2 - Math.sin(dirRad) * head + Math.cos(dirRad) * wing;
  return (
    <g>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={width} strokeLinecap="round" />
      <path d={`M ${hx1} ${hy1} L ${x2} ${y2} L ${hx2} ${hy2}`} stroke={color} strokeWidth={width} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

// A wavy line drawn along the chord at the given angle — visually distinct
// from straight arrows so the eye knows it's the swell.
function WaveMark({ angleDeg, color }: { angleDeg: number; color: string }) {
  const [tipX, tipY] = polarXY(angleDeg, ARROW_TIP_R + 4);
  const [tailX, tailY] = polarXY(angleDeg, ARROW_TAIL_R - 4);
  // Build a wavy path between tail and tip with 3 oscillations.
  const dx = tipX - tailX;
  const dy = tipY - tailY;
  const len = Math.hypot(dx, dy);
  const ux = dx / len, uy = dy / len; // unit along
  const nx = -uy, ny = ux;            // unit normal
  const amp = 3;
  const N = 18;
  const points: string[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const ax = tailX + ux * len * t;
    const ay = tailY + uy * len * t;
    const o = Math.sin(t * Math.PI * 3) * amp;
    points.push(`${ax + nx * o},${ay + ny * o}`);
  }
  return <polyline points={points.join(" ")} stroke={color} strokeWidth="1.6" fill="none" strokeLinecap="round" />;
}

// ── Main component ────────────────────────────────────────────────────────────
export function LegDetailCard({ leg, archetypeLabel }: { leg: AggregatedLeg; archetypeLabel: string }) {
  // Wind: TWA is unsigned (0..180) in our model — show wind on the starboard
  // side by convention so port/starboard ambiguity doesn't lie about the trim.
  const twa = Math.abs(leg.twa_avg_deg) > 180 ? 360 - Math.abs(leg.twa_avg_deg) : Math.abs(leg.twa_avg_deg);
  const windAngle = twa; // 0..180, wind comes from this side of the bow
  const tws = Math.round(leg.tws_avg_kn);
  const gustNote =
    leg.gust_max_kn != null && leg.gust_max_kn > tws + 1
      ? ` · raf. ${Math.round(leg.gust_max_kn)}`
      : "";

  // Waves: in absence of a propagated wave_direction, assume waves track the
  // wind (Med wind-wave dominant). Slight offset to visually separate wave
  // from wind arrows.
  const waveAngle = windAngle + 4;
  const hasWaves = leg.hs_avg_m != null;

  // Current: relative direction from boat bow = (current_to - bearing).
  // The arrow points OUTWARD (current pushes the boat in that direction).
  let currentAngle: number | null = null;
  if (leg.current_direction_to_deg != null) {
    const rel = ((leg.current_direction_to_deg - leg.bearing_avg_deg) % 360 + 360) % 360;
    currentAngle = rel;
  }
  const currentColor =
    leg.current_relative === "portant" ? "var(--ow-ok)" :
    leg.current_relative === "contraire" ? "var(--ow-warn)" :
    "var(--ow-fg-1)";

  // Label positions
  const [windLx, windLy] = polarXY(windAngle, LABEL_R);
  const [waveLx, waveLy] = polarXY(waveAngle, LABEL_R);
  const [curLx, curLy] = currentAngle != null ? polarXY(currentAngle, LABEL_R) : [0, 0];

  return (
    <div className="px-4 pb-4 pt-1">
      {/* Section header */}
      <div
        className="flex items-center gap-1.5 mb-2 text-[10px] font-bold uppercase"
        style={{ color: "var(--ow-accent)", letterSpacing: "0.1em" }}
      >
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="8" cy="8" r="6" />
          <path d="M8 4 L8 8 L11 10" />
        </svg>
        Conditions vues du bateau
      </div>

      {/* Speed pill */}
      <div className="flex items-baseline gap-2 mb-2">
        <span
          className="text-2xl font-bold tabular-nums"
          style={{ color: "var(--ow-accent)", fontFamily: "var(--ow-font-mono)", letterSpacing: "-0.02em", lineHeight: 1 }}
        >
          {leg.target_speed_kn.toFixed(1)} kn
        </span>
        <span className="text-[10px]" style={{ color: "var(--ow-fg-2)" }}>
          vitesse cible
        </span>
      </div>

      {/* Compass diagram */}
      <div className="flex justify-center">
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-label="Conditions autour du bateau">
          {/* Outer dashed dial */}
          <circle cx={CENTER} cy={CENTER} r={COMPASS_R} fill="none" stroke="var(--ow-line-2)" strokeWidth="1" strokeDasharray="2 4" />

          {/* Cap (heading) tick at top */}
          <line x1={CENTER} y1={CENTER - COMPASS_R - 4} x2={CENTER} y2={CENTER - COMPASS_R + 4} stroke="var(--ow-fg-2)" strokeWidth="1.5" />
          <text x={CENTER} y={CENTER - COMPASS_R - 8} textAnchor="middle" fontSize="9" fill="var(--ow-fg-2)" style={{ fontFamily: "var(--ow-font-mono)" }}>
            cap {Math.round(leg.bearing_avg_deg)}°
          </text>

          {/* Boat hull pointing up */}
          <g transform={`translate(${CENTER} ${CENTER})`}>
            <path
              d="M 0 -28 Q -11 -14 -11 12 Q -11 24 0 30 Q 11 24 11 12 Q 11 -14 0 -28 Z"
              fill="var(--ow-bg-2)"
              stroke="var(--ow-fg-0)"
              strokeWidth="1.6"
            />
            {/* centerline */}
            <line x1="0" y1="-22" x2="0" y2="26" stroke="var(--ow-fg-2)" strokeWidth="0.8" />
            {/* mast dot */}
            <circle cx="0" cy="-2" r="2" fill="var(--ow-accent)" />
          </g>

          {/* Wind arrow: tail on dial, tip near boat (wind comes from the angle) */}
          <ForceArrow fromR={ARROW_TAIL_R} toR={ARROW_TIP_R} angleDeg={windAngle} color="var(--ow-fg-0)" />
          <text
            x={windLx}
            y={windLy}
            textAnchor={textAnchor(windAngle)}
            dominantBaseline="middle"
            fontSize="10"
            fill="var(--ow-fg-0)"
            style={{ fontFamily: "var(--ow-font-mono)", fontWeight: 600 }}
          >
            <tspan>{tws} kn{gustNote}</tspan>
            <tspan x={windLx} dy="11" fill="var(--ow-fg-2)">{compass16(leg.twd_avg_deg)}</tspan>
          </text>

          {/* Waves wavy line — same hemisphere as wind, slight angular offset */}
          {hasWaves && (
            <>
              <WaveMark angleDeg={waveAngle} color="var(--ow-warn)" />
              <text
                x={waveLx}
                y={waveLy + 18}
                textAnchor={textAnchor(waveAngle)}
                dominantBaseline="middle"
                fontSize="10"
                fill="var(--ow-warn)"
                style={{ fontFamily: "var(--ow-font-mono)", fontWeight: 600 }}
              >
                <tspan>Hs {leg.hs_avg_m!.toFixed(1)} m</tspan>
                <tspan x={waveLx} dy="11" fill="var(--ow-fg-2)" fontWeight="500">
                  {leg.tp_avg_s != null ? `Tp ${leg.tp_avg_s.toFixed(1)} s` : "—"}
                </tspan>
              </text>
            </>
          )}

          {/* Current: arrow pushes outward in the direction water flows */}
          {currentAngle != null && (
            <>
              <ForceArrow fromR={CURRENT_TAIL_R} toR={CURRENT_TIP_R} angleDeg={currentAngle} color={currentColor} />
              <text
                x={curLx}
                y={curLy}
                textAnchor={textAnchor(currentAngle)}
                dominantBaseline="middle"
                fontSize="10"
                fill={currentColor}
                style={{ fontFamily: "var(--ow-font-mono)", fontWeight: 600 }}
              >
                <tspan>{leg.current_speed_kn?.toFixed(1) ?? "—"} kn</tspan>
                <tspan x={curLx} dy="11" fill="var(--ow-fg-2)" fontWeight="500">
                  {leg.current_relative ?? ""}
                </tspan>
              </text>
            </>
          )}
        </svg>
      </div>

      {/* Footer line: who and how */}
      <div className="text-[10px] mt-2 leading-relaxed" style={{ color: "var(--ow-fg-2)", fontFamily: "var(--ow-font-mono)" }}>
        Polaire {archetypeLabel} · TWA {Math.round(twa)}° · efficacité {Math.round(leg.efficiency * 100)}%
      </div>
    </div>
  );
}
