import type { AggregatedLeg } from "./aggregateLegs";

// "Conditions vues du bateau" — top-down boat compass showing where wind,
// waves and current come from relative to the boat's heading. The boat sits in
// the middle pointing up (= its course); each force has a labelled marker.
//
// Color code: white = wind, amber = waves, green/orange/grey = current
// (favourable / against / cross). Keep this aligned with the legend at the
// bottom of the card.

const SIZE = 280;
const CENTER = SIZE / 2;
const COMPASS_R = 96;
const ARROW_TAIL_R = 92;
const ARROW_TIP_R = 56;
const CURRENT_TAIL_R = 38;
const CURRENT_TIP_R = 88;
const LABEL_R = 116;

const COLORS = {
  wind: "var(--ow-fg-0)",
  waves: "var(--ow-warn)",
  currentPortant: "var(--ow-ok)",
  currentContraire: "#fb923c", // distinct from waves' amber so the eye doesn't merge them
  currentTravers: "var(--ow-fg-1)",
};

const COMPASS_16 = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"] as const;
const compass16 = (deg: number): string =>
  COMPASS_16[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];

// 0° = up (12 o'clock), increasing clockwise. Returns [x, y] in SVG coords.
function polarXY(angleDeg: number, r: number): [number, number] {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return [CENTER + Math.cos(rad) * r, CENTER + Math.sin(rad) * r];
}

// Pick label anchor + small dx so a force label outside the dial reads clean.
function labelLayout(angleDeg: number): { anchor: "start" | "middle" | "end"; dx: number } {
  const a = ((angleDeg % 360) + 360) % 360;
  if (a < 15 || a > 345) return { anchor: "middle", dx: 0 };
  if (a > 165 && a < 195) return { anchor: "middle", dx: 0 };
  return a < 180
    ? { anchor: "start", dx: 4 }   // right hemisphere → label flows right
    : { anchor: "end", dx: -4 };   // left hemisphere → label flows left
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
      <path
        d={`M ${hx1} ${hy1} L ${x2} ${y2} L ${hx2} ${hy2}`}
        stroke={color}
        strokeWidth={width}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>
  );
}

// Wavy line tangent to the radius at `angleDeg`. Drawn outside the boat,
// pointing toward the dial — visually distinct from straight arrows.
function WaveMark({ angleDeg, color }: { angleDeg: number; color: string }) {
  const [tipX, tipY] = polarXY(angleDeg, ARROW_TIP_R + 8);
  const [tailX, tailY] = polarXY(angleDeg, ARROW_TAIL_R - 4);
  const dx = tipX - tailX;
  const dy = tipY - tailY;
  const len = Math.hypot(dx, dy);
  const ux = dx / len, uy = dy / len;
  const nx = -uy, ny = ux;
  const amp = 3.2;
  const N = 18;
  const points: string[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const ax = tailX + ux * len * t;
    const ay = tailY + uy * len * t;
    const o = Math.sin(t * Math.PI * 3) * amp;
    points.push(`${ax + nx * o},${ay + ny * o}`);
  }
  return <polyline points={points.join(" ")} stroke={color} strokeWidth="1.7" fill="none" strokeLinecap="round" />;
}

// ── Top-down hull silhouette ─────────────────────────────────────────────────
// Pointed bow at top, gentle widening to midship, flat transom at the bottom.
// Path is centred on (0,0) so it can be translated to the SVG centre.
function BoatHull() {
  return (
    <g>
      {/* Hull outline */}
      <path
        d="
          M 0 -34
          C -8 -28, -14 -16, -14 -2
          C -14 8, -14 16, -13 22
          L 13 22
          C 14 16, 14 8, 14 -2
          C 14 -16, 8 -28, 0 -34
          Z
        "
        fill="var(--ow-bg-2)"
        stroke="var(--ow-fg-0)"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      {/* Centerline (suggests the keel/mast axis) */}
      <line x1="0" y1="-26" x2="0" y2="20" stroke="var(--ow-fg-2)" strokeWidth="0.8" />
      {/* Mast (small dot just forward of midship) */}
      <circle cx="0" cy="-4" r="2.2" fill="var(--ow-accent)" />
      {/* Tiny bow indicator triangle to reinforce the heading direction */}
      <path d="M 0 -34 L -3 -28 L 3 -28 Z" fill="var(--ow-fg-0)" stroke="none" />
    </g>
  );
}

// ── Legend ────────────────────────────────────────────────────────────────────
function LegendItem({ color, swatch, label }: { color: string; swatch: "arrow" | "wave"; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px]" style={{ color: "var(--ow-fg-1)" }}>
      {swatch === "arrow" ? (
        <svg width="20" height="8" viewBox="0 0 20 8" aria-hidden="true">
          <line x1="2" y1="4" x2="14" y2="4" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
          <path d="M 11 1 L 16 4 L 11 7" stroke={color} strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg width="20" height="8" viewBox="0 0 20 8" aria-hidden="true">
          <path d="M 1 4 Q 5 0 9 4 T 17 4" stroke={color} strokeWidth="1.6" fill="none" strokeLinecap="round" />
        </svg>
      )}
      <span>{label}</span>
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function LegDetailCard({ leg, archetypeLabel }: { leg: AggregatedLeg; archetypeLabel: string }) {
  // Wind: TWA is unsigned (0..180) in our model — show wind on the starboard
  // side by convention so port/starboard ambiguity doesn't lie about the trim.
  const twa = Math.abs(leg.twa_avg_deg) > 180 ? 360 - Math.abs(leg.twa_avg_deg) : Math.abs(leg.twa_avg_deg);
  const windAngle = twa;
  const tws = Math.round(leg.tws_avg_kn);
  const gustNote =
    leg.gust_max_kn != null && leg.gust_max_kn > tws + 1
      ? ` · raf. ${Math.round(leg.gust_max_kn)}`
      : "";

  // Waves: in absence of a propagated wave_direction, assume waves track the
  // wind (Med wind-wave dominant). Place on the opposite hemisphere when the
  // wind is forward (TWA < 30°) so the two labels never stack vertically.
  const waveAngle = windAngle < 30 ? -windAngle - 18 : windAngle + 22;
  const hasWaves = leg.hs_avg_m != null;

  // Current: relative direction from boat bow = (current_to - bearing).
  // Arrow points OUTWARD (current pushes the boat in that direction).
  const currentAngle = leg.current_direction_to_deg != null
    ? ((leg.current_direction_to_deg - leg.bearing_avg_deg) % 360 + 360) % 360
    : null;
  const currentColor =
    leg.current_relative === "portant" ? COLORS.currentPortant :
    leg.current_relative === "contraire" ? COLORS.currentContraire :
    COLORS.currentTravers;

  // Label positions
  const [windLx, windLy] = polarXY(windAngle, LABEL_R);
  const windLabel = labelLayout(windAngle);
  const [waveLx, waveLy] = polarXY(waveAngle, LABEL_R);
  const waveLabel = labelLayout(waveAngle);
  const [curLx, curLy] = currentAngle != null ? polarXY(currentAngle, LABEL_R) : [0, 0];
  const curLabel = currentAngle != null ? labelLayout(currentAngle) : { anchor: "middle" as const, dx: 0 };

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

          {/* Cap (heading) tick + label at top */}
          <line x1={CENTER} y1={CENTER - COMPASS_R - 6} x2={CENTER} y2={CENTER - COMPASS_R + 4} stroke="var(--ow-fg-2)" strokeWidth="1.5" />
          <text
            x={CENTER}
            y={CENTER - COMPASS_R - 12}
            textAnchor="middle"
            fontSize="9"
            fill="var(--ow-fg-2)"
            style={{ fontFamily: "var(--ow-font-mono)" }}
          >
            cap {Math.round(leg.bearing_avg_deg)}°
          </text>

          {/* Boat hull pointing up (its course = true bearing) */}
          <g transform={`translate(${CENTER} ${CENTER})`}>
            <BoatHull />
          </g>

          {/* Wind arrow + label */}
          <ForceArrow fromR={ARROW_TAIL_R} toR={ARROW_TIP_R} angleDeg={windAngle} color={COLORS.wind} />
          <text
            x={windLx + windLabel.dx}
            y={windLy}
            textAnchor={windLabel.anchor}
            dominantBaseline="middle"
            fontSize="11"
            fill={COLORS.wind}
            style={{ fontFamily: "var(--ow-font-mono)", fontWeight: 600 }}
          >
            <tspan>{tws} kn{gustNote}</tspan>
            <tspan x={windLx + windLabel.dx} dy="12" fill="var(--ow-fg-2)" fontWeight="500">
              {compass16(leg.twd_avg_deg)}
            </tspan>
          </text>

          {/* Waves wavy line + label (offset hemisphere from wind) */}
          {hasWaves && (
            <>
              <WaveMark angleDeg={waveAngle} color={COLORS.waves} />
              <text
                x={waveLx + waveLabel.dx}
                y={waveLy}
                textAnchor={waveLabel.anchor}
                dominantBaseline="middle"
                fontSize="11"
                fill={COLORS.waves}
                style={{ fontFamily: "var(--ow-font-mono)", fontWeight: 600 }}
              >
                <tspan>Hs {leg.hs_avg_m!.toFixed(1)} m</tspan>
                <tspan x={waveLx + waveLabel.dx} dy="12" fill="var(--ow-fg-2)" fontWeight="500">
                  {leg.tp_avg_s != null ? `Tp ${leg.tp_avg_s.toFixed(1)} s` : leg.sea_direction ?? ""}
                </tspan>
              </text>
            </>
          )}

          {/* Current arrow + label (points outward — direction the water flows) */}
          {currentAngle != null && (
            <>
              <ForceArrow fromR={CURRENT_TAIL_R} toR={CURRENT_TIP_R} angleDeg={currentAngle} color={currentColor} />
              <text
                x={curLx + curLabel.dx}
                y={curLy}
                textAnchor={curLabel.anchor}
                dominantBaseline="middle"
                fontSize="11"
                fill={currentColor}
                style={{ fontFamily: "var(--ow-font-mono)", fontWeight: 600 }}
              >
                <tspan>{leg.current_speed_kn?.toFixed(1) ?? "—"} kn</tspan>
                <tspan x={curLx + curLabel.dx} dy="12" fill="var(--ow-fg-2)" fontWeight="500">
                  {leg.current_relative ?? ""}
                </tspan>
              </text>
            </>
          )}
        </svg>
      </div>

      {/* Color legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 justify-center mt-1 mb-2">
        <LegendItem color={COLORS.wind} swatch="arrow" label="Vent" />
        <LegendItem color={COLORS.waves} swatch="wave" label="Vagues" />
        <LegendItem color={COLORS.currentPortant} swatch="arrow" label="Courant portant" />
        <LegendItem color={COLORS.currentContraire} swatch="arrow" label="contraire" />
        <LegendItem color={COLORS.currentTravers} swatch="arrow" label="travers" />
      </div>

      {/* Footer line: who and how */}
      <div className="text-[10px] mt-1 leading-relaxed text-center" style={{ color: "var(--ow-fg-2)", fontFamily: "var(--ow-font-mono)" }}>
        Polaire {archetypeLabel} · TWA {Math.round(twa)}° · efficacité {Math.round(leg.efficiency * 100)}%
      </div>
    </div>
  );
}
