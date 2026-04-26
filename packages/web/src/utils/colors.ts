// Smooth gradient between Beaufort color stops using linear interpolation
const COLOR_STOPS: [number, [number, number, number]][] = [
  [0, [120, 144, 156]],   // calm - blue gray
  [1, [200, 230, 201]],   // light air - pale green
  [4, [165, 214, 167]],   // light breeze
  [7, [129, 199, 132]],   // gentle breeze
  [11, [102, 187, 106]],  // moderate breeze
  [17, [255, 235, 59]],   // fresh breeze - yellow
  [22, [255, 193, 7]],    // strong breeze - amber
  [28, [255, 152, 0]],    // near gale - orange
  [34, [255, 87, 34]],    // gale - deep orange
  [41, [211, 47, 47]],    // strong gale - red
  [48, [156, 39, 176]],   // storm - purple
  [56, [106, 27, 154]],   // violent storm - deep purple
];

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function interpolateColor(knots: number): [number, number, number] {
  if (knots <= COLOR_STOPS[0][0]) return COLOR_STOPS[0][1];
  if (knots >= COLOR_STOPS[COLOR_STOPS.length - 1][0])
    return COLOR_STOPS[COLOR_STOPS.length - 1][1];

  for (let i = 0; i < COLOR_STOPS.length - 1; i++) {
    const [k0, c0] = COLOR_STOPS[i];
    const [k1, c1] = COLOR_STOPS[i + 1];
    if (knots >= k0 && knots < k1) {
      const t = (knots - k0) / (k1 - k0);
      return [lerp(c0[0], c1[0], t), lerp(c0[1], c1[1], t), lerp(c0[2], c1[2], t)];
    }
  }
  return COLOR_STOPS[COLOR_STOPS.length - 1][1];
}

export function getWindColor(knots: number): string {
  const [r, g, b] = interpolateColor(knots);
  return `rgb(${r},${g},${b})`;
}

export function getTextColor(knots: number): string {
  const [r, g, b] = interpolateColor(knots);
  // Luminance-based contrast
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.5 ? "#1a1a1a" : "#ffffff";
}
