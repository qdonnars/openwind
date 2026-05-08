import type { AggregatedLeg } from "./aggregateLegs";

// "Conditions vues du bateau" — North-up compass with the boat rotated to its
// true heading. Wind / waves / current sit at their absolute compass bearings
// around the dial; the boat points where it's going.
//
// Color code (also rendered in the legend below the diagram):
//   white = vent, amber wavy = vagues,
//   green/orange/grey arrow = courant (portant / contraire / travers).

const SIZE = 320;
const CENTER = SIZE / 2;
const COMPASS_R = 104;
const ARROW_TAIL_R = 100;
const ARROW_TIP_R = 58;
const LABEL_R = 122;

const COLORS = {
  wind: "var(--ow-fg-0)",
  waves: "var(--ow-warn)",
  currentPortant: "var(--ow-ok)",
  currentContraire: "#fb923c",  // distinct from waves' amber
  currentTravers: "#3b82f6",    // blue-500 — clearly visible in both themes (grey washed out in light)
};

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
    ? { anchor: "start", dx: 4 }
    : { anchor: "end", dx: -4 };
}

// Double-shaft arrow for the wind — two parallel lines so the eye can pick
// it out among the wavy line and the current flow field. The shaft stops a
// few px short of the tip so the lines don't poke through the arrowhead.
function WindArrow({
  fromR,
  toR,
  angleDeg,
  color,
}: {
  fromR: number;
  toR: number;
  angleDeg: number;
  color: string;
}) {
  const [x1, y1] = polarXY(angleDeg, fromR);
  const [x2, y2] = polarXY(angleDeg, toR);
  const dirRad = Math.atan2(y2 - y1, x2 - x1);
  const perpRad = dirRad + Math.PI / 2;
  const off = 2.6;
  const ox = Math.cos(perpRad) * off;
  const oy = Math.sin(perpRad) * off;
  const tipBack = 8;
  const sx = x2 - Math.cos(dirRad) * tipBack;
  const sy = y2 - Math.sin(dirRad) * tipBack;
  const head = 10, wing = 5.5;
  const hx1 = x2 - Math.cos(dirRad) * head + Math.sin(dirRad) * wing;
  const hy1 = y2 - Math.sin(dirRad) * head - Math.cos(dirRad) * wing;
  const hx2 = x2 - Math.cos(dirRad) * head - Math.sin(dirRad) * wing;
  const hy2 = y2 - Math.sin(dirRad) * head + Math.cos(dirRad) * wing;
  return (
    <g stroke={color} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <line x1={x1 + ox} y1={y1 + oy} x2={sx + ox} y2={sy + oy} />
      <line x1={x1 - ox} y1={y1 - oy} x2={sx - ox} y2={sy - oy} />
      <path d={`M ${hx1} ${hy1} L ${x2} ${y2} L ${hx2} ${hy2}`} />
    </g>
  );
}

// Current flow field — short fine arrows distributed around the boat, all
// pointing in the direction the water flows. Visually evokes a river current
// (the user's red drawing).
function CurrentFlowField({ flowAngleDeg, color }: { flowAngleDeg: number; color: string }) {
  const flowRad = ((flowAngleDeg - 90) * Math.PI) / 180;
  const fx = Math.cos(flowRad), fy = Math.sin(flowRad);
  const px = -fy, py = fx; // perpendicular unit
  const lineLen = 38;       // longer than before so the field reads as flow, not many small arrows
  const HEAD = 4, WING = 2.2; // smaller arrowhead so the flow stays subtle
  const positions: Array<[number, number]> = [];
  // 2 rows of 3 lines either side of the boat — quieter than the prior 3×3 grid.
  const perpOffsets = [-58, 58];
  const alongOffsets = [-46, 0, 46];
  for (const a of alongOffsets) {
    for (const p of perpOffsets) {
      positions.push([CENTER + fx * a + px * p, CENTER + fy * a + py * p]);
    }
  }

  return (
    <g stroke={color} strokeWidth="1" fill="none" strokeLinecap="round" strokeLinejoin="round" opacity="0.5">
      {positions.map(([cx, cy], i) => {
        const distC = Math.hypot(cx - CENTER, cy - CENTER);
        if (distC > COMPASS_R - 4) return null;
        if (distC < 30) return null; // keep clear of the hull
        const tailX = cx - fx * lineLen / 2;
        const tailY = cy - fy * lineLen / 2;
        const tipX = cx + fx * lineLen / 2;
        const tipY = cy + fy * lineLen / 2;
        const hx1 = tipX - fx * HEAD + px * WING;
        const hy1 = tipY - fy * HEAD + py * WING;
        const hx2 = tipX - fx * HEAD - px * WING;
        const hy2 = tipY - fy * HEAD - py * WING;
        return (
          <g key={i}>
            <line x1={tailX} y1={tailY} x2={tipX} y2={tipY} />
            <path d={`M ${hx1} ${hy1} L ${tipX} ${tipY} L ${hx2} ${hy2}`} />
          </g>
        );
      })}
    </g>
  );
}

function WaveMark({ angleDeg, color }: { angleDeg: number; color: string }) {
  const [tipX, tipY] = polarXY(angleDeg, ARROW_TIP_R + 8);
  const [tailX, tailY] = polarXY(angleDeg, ARROW_TAIL_R - 4);
  const dx = tipX - tailX;
  const dy = tipY - tailY;
  const len = Math.hypot(dx, dy);
  const ux = dx / len, uy = dy / len;
  const nx = -uy, ny = ux;
  const amp = 3.2;
  // Reserve a straight section just before the tip so the arrowhead reads as
  // a clean chevron (not jammed into the last sinusoid bump).
  const TAIL_STRAIGHT = 10;
  const wavyEnd = len - TAIL_STRAIGHT;
  const N = 16;
  const points: string[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const dist = wavyEnd * t;
    const o = Math.sin(t * Math.PI * 3) * amp * (1 - t * 0.5); // taper amp toward the tip
    points.push(`${tailX + ux * dist + nx * o},${tailY + uy * dist + ny * o}`);
  }
  // Continue with a straight segment to the tip.
  points.push(`${tipX},${tipY}`);

  // Arrowhead at the tip — drawn along the radial direction, so it lands on
  // the straight tail section above and reads as a clean ▶.
  const HEAD = 7, WING = 4;
  const hx1 = tipX - ux * HEAD + nx * WING;
  const hy1 = tipY - uy * HEAD + ny * WING;
  const hx2 = tipX - ux * HEAD - nx * WING;
  const hy2 = tipY - uy * HEAD - ny * WING;
  return (
    <g stroke={color} strokeWidth="1.7" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <polyline points={points.join(" ")} />
      <path d={`M ${hx1} ${hy1} L ${tipX} ${tipY} L ${hx2} ${hy2}`} />
    </g>
  );
}

// Top-down hull silhouette — pointed bow up, flat transom at the bottom.
// Drawn centred on (0,0) so it can be translated + rotated by bearing.
function BoatHull() {
  return (
    <g>
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
      <line x1="0" y1="-26" x2="0" y2="20" stroke="var(--ow-fg-2)" strokeWidth="0.8" />
      <circle cx="0" cy="-4" r="2.2" fill="var(--ow-accent)" />
      <path d="M 0 -34 L -3 -28 L 3 -28 Z" fill="var(--ow-fg-0)" stroke="none" />
    </g>
  );
}

// Cardinal direction markers (N, E, S, W) just outside the dial.
function CardinalMarkers() {
  const items: { label: string; deg: number }[] = [
    { label: "N", deg: 0 },
    { label: "E", deg: 90 },
    { label: "S", deg: 180 },
    { label: "W", deg: 270 },
  ];
  return (
    <g>
      {items.map(({ label, deg }) => {
        const [x, y] = polarXY(deg, COMPASS_R + 14);
        return (
          <text
            key={label}
            x={x}
            y={y}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize="10"
            fill="var(--ow-fg-3)"
            style={{ fontFamily: "var(--ow-font-mono)", fontWeight: 600 }}
          >
            {label}
          </text>
        );
      })}
    </g>
  );
}


// ── Main component ────────────────────────────────────────────────────────────
export function LegDetailCard({ leg }: { leg: AggregatedLeg }) {
  // Absolute compass bearings — boat is rotated to its actual heading and
  // every force sits at its true direction on the North-up dial. Waves
  // track wind in our current Med model; we offset the wave marker by a
  // fixed 30° so the two arrows never share a shaft. Robust by construction:
  // 30° is the minimum gap that keeps labels (≈ 50-60 px wide at LABEL_R)
  // from overlapping at 12 pt. Picking the offset away from the boat's bow
  // also avoids stacking wave on top of the boat hull.
  const windAngle = leg.twd_avg_deg;
  const waveAngle = leg.twd_avg_deg + 30;
  const tws = Math.round(leg.tws_avg_kn);
  const windLine =
    leg.gust_max_kn != null && leg.gust_max_kn > tws + 1
      ? `${tws} (${Math.round(leg.gust_max_kn)}) kn`
      : `${tws} kn`;
  const fmtFR1 = (n: number) => n.toFixed(1).replace(".", ",");
  const waveLine = leg.hs_avg_m != null
    ? `${fmtFR1(leg.hs_avg_m)} m${leg.tp_avg_s != null ? ` (${Math.round(leg.tp_avg_s)} s)` : ""}`
    : "";
  const hasWaves = leg.hs_avg_m != null;

  // Current arrow points OUTWARD from the boat in the direction water flows.
  const currentAngle = leg.current_direction_to_deg ?? null;
  const currentColor =
    leg.current_relative === "portant" ? COLORS.currentPortant :
    leg.current_relative === "contraire" ? COLORS.currentContraire :
    COLORS.currentTravers;

  // Each force gets its own label outside the dial at its own angle.
  // Wind & wave are spread by construction (30° angular offset). The current's
  // angle is independent — when it lands within 40° of either wind or wave,
  // pin its label opposite the wind direction so labels never share screen
  // space. Two-line labels (caption + value) made the previous radial bump
  // insufficient. The user is fine with the current label's position being
  // arbitrary in this case; the on-dial flow field still shows the true
  // flow direction.
  const angularGap = (a: number, b: number): number => {
    const d = ((a - b + 540) % 360) - 180;
    return Math.abs(d);
  };
  let currentLabelAngle = currentAngle ?? 0;
  if (currentAngle != null) {
    const tooCloseToWind = angularGap(currentAngle, windAngle) < 40;
    const tooCloseToWave = angularGap(currentAngle, waveAngle) < 40;
    if (tooCloseToWind || tooCloseToWave) {
      currentLabelAngle = (windAngle + 180) % 360;
    }
  }

  const [windLx, windLy] = polarXY(windAngle, LABEL_R);
  const windLabel = labelLayout(windAngle);
  const [waveLx, waveLy] = polarXY(waveAngle, LABEL_R);
  const waveLabel = labelLayout(waveAngle);
  const [curLx, curLy] = currentAngle != null ? polarXY(currentLabelAngle, LABEL_R) : [0, 0];
  const curLabel = currentAngle != null ? labelLayout(currentLabelAngle) : { anchor: "middle" as const, dx: 0 };

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

      {/* Speed + allure + cap */}
      <div className="flex items-baseline justify-between mb-2">
        <div className="flex items-baseline gap-3">
          <span
            className="text-2xl font-bold tabular-nums"
            style={{ color: "var(--ow-accent)", fontFamily: "var(--ow-font-mono)", letterSpacing: "-0.02em", lineHeight: 1 }}
          >
            {leg.target_speed_kn.toFixed(1)} kn
          </span>
          <span
            className="text-xl font-bold"
            style={{ color: "var(--ow-fg-0)", letterSpacing: "-0.01em", lineHeight: 1 }}
          >
            {leg.point_of_sail}
          </span>
        </div>
        <span className="text-[10px] tabular-nums" style={{ color: "var(--ow-fg-2)", fontFamily: "var(--ow-font-mono)" }}>
          cap {Math.round(leg.bearing_avg_deg)}°
        </span>
      </div>

      {/* Compass diagram */}
      <div className="flex justify-center">
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          aria-label="Conditions autour du bateau (vue Nord en haut)"
          style={{ overflow: "visible" }}
        >
          {/* Outer dashed dial */}
          <circle cx={CENTER} cy={CENTER} r={COMPASS_R} fill="none" stroke="var(--ow-line-2)" strokeWidth="1" strokeDasharray="2 4" />

          {/* Cardinal markers */}
          <CardinalMarkers />

          {/* Boat hull rotated to its true bearing */}
          <g transform={`translate(${CENTER} ${CENTER}) rotate(${leg.bearing_avg_deg})`}>
            <BoatHull />
          </g>

          {/* Wind arrow (double-shaft, distinctive) */}
          <WindArrow fromR={ARROW_TAIL_R} toR={ARROW_TIP_R} angleDeg={windAngle} color={COLORS.wind} />

          {/* Wind label — caption above the value, same color & font as the arrow */}
          <text
            x={windLx + windLabel.dx}
            y={windLy - 7}
            textAnchor={windLabel.anchor}
            dominantBaseline="middle"
            fill={COLORS.wind}
            style={{ fontFamily: "var(--ow-font-mono)" }}
          >
            <tspan fontSize="9" fontWeight="500">
              {leg.gust_max_kn != null && leg.gust_max_kn > tws + 1 ? "Vent (rafales)" : "Vent"}
            </tspan>
            <tspan x={windLx + windLabel.dx} dy="13" fontSize="12" fontWeight="700">
              {windLine}
            </tspan>
          </text>

          {/* Waves wavy line at wave direction (offset 30° from wind so they
              never share a shaft), with its own captioned label */}
          {hasWaves && (
            <>
              <WaveMark angleDeg={waveAngle} color={COLORS.waves} />
              <text
                x={waveLx + waveLabel.dx}
                y={waveLy - 7}
                textAnchor={waveLabel.anchor}
                dominantBaseline="middle"
                fill={COLORS.waves}
                style={{ fontFamily: "var(--ow-font-mono)" }}
              >
                <tspan fontSize="9" fontWeight="500">
                  {leg.tp_avg_s != null ? "Hauteur vagues (période)" : "Hauteur vagues"}
                </tspan>
                <tspan x={waveLx + waveLabel.dx} dy="13" fontSize="12" fontWeight="700">
                  {waveLine}
                </tspan>
              </text>
            </>
          )}

          {/* Current flow field — short fine arrows around the boat */}
          {currentAngle != null && (
            <>
              <CurrentFlowField flowAngleDeg={currentAngle} color={currentColor} />
              <text
                x={curLx + curLabel.dx}
                y={curLy - 7}
                textAnchor={curLabel.anchor}
                dominantBaseline="middle"
                fill={currentColor}
                style={{ fontFamily: "var(--ow-font-mono)" }}
              >
                <tspan fontSize="9" fontWeight="500">Courant</tspan>
                <tspan x={curLx + curLabel.dx} dy="13" fontSize="12" fontWeight="700">
                  {leg.current_speed_kn != null ? `${leg.current_speed_kn.toFixed(1).replace(".", ",")} kn` : "— kn"}
                </tspan>
              </text>
            </>
          )}
        </svg>
      </div>
    </div>
  );
}
