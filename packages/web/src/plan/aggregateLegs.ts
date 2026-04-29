import type { SegmentReport } from "./types";

export interface AggregatedLeg {
  distance_nm: number;
  tws_min: number;
  tws_max: number;
  boat_speed_kn: number;
  end_time: string;
  point_of_sail: string;
  // Mean significant wave height (m) over the leg, distance-weighted. null if
  // no Hs data was available for any sub-segment.
  hs_avg_m: number | null;
  // Where the sea hits the boat relative to its course: "face", "travers",
  // "arrière", or null if Hs is null. Approximated from TWA (Med swell mostly
  // tracks wind in the absence of distant ocean swell).
  sea_direction: "face" | "travers" | "arrière" | null;
}

function circularMeanDeg(angles: number[]): number {
  const s = angles.reduce((sum, a) => sum + Math.sin((a * Math.PI) / 180), 0);
  const c = angles.reduce((sum, a) => sum + Math.cos((a * Math.PI) / 180), 0);
  return (((Math.atan2(s, c) * 180) / Math.PI) + 360) % 360;
}

function twaToPointOfSail(twa: number): string {
  // twa_deg is signed (-180..180) or unsigned (0..360), normalise to 0-180
  const a = Math.abs(twa) > 180 ? 360 - Math.abs(twa) : Math.abs(twa);
  if (a < 50) return "Près";
  if (a < 90) return "Travers";
  if (a < 135) return "Largue";
  return "Arrière";
}

function twaToSeaDirection(twa: number): "face" | "travers" | "arrière" {
  // 3-bucket split (vs 4 for point_of_sail) — sailors call out sea state in
  // coarser terms than sail trim.
  const a = Math.abs(twa) > 180 ? 360 - Math.abs(twa) : Math.abs(twa);
  if (a < 60) return "face";
  if (a < 120) return "travers";
  return "arrière";
}

export function aggregateLegs(
  segments: SegmentReport[],
  waypoints: [number, number][],
): AggregatedLeg[] {
  if (waypoints.length < 2 || segments.length === 0) return [];

  // For each intermediate waypoint, find the segment index that starts there
  const legStarts: number[] = [0];
  for (let w = 1; w < waypoints.length - 1; w++) {
    const [wlat, wlon] = waypoints[w];
    let best = legStarts[legStarts.length - 1] + 1;
    let bestD = Infinity;
    for (let i = best; i < segments.length; i++) {
      const d = Math.hypot(segments[i].start.lat - wlat, segments[i].start.lon - wlon);
      if (d < bestD) { bestD = d; best = i; }
    }
    legStarts.push(best);
  }
  legStarts.push(segments.length);

  return legStarts.slice(0, -1).map((start, li) => {
    const segs = segments.slice(start, legStarts[li + 1]);
    const totalDist = segs.reduce((s, seg) => s + seg.distance_nm, 0);
    const twsVals = segs.map((s) => s.tws_kn);
    const avgSpeed = segs.reduce((s, seg) => s + seg.boat_speed_kn * seg.distance_nm, 0) / totalDist;
    const avgTwa = circularMeanDeg(segs.map((s) => s.twa_deg));

    const hsSegs = segs.filter((s) => s.hs_m != null);
    const hsTotalDist = hsSegs.reduce((s, seg) => s + seg.distance_nm, 0);
    const hsAvg = hsTotalDist > 0
      ? hsSegs.reduce((s, seg) => s + (seg.hs_m as number) * seg.distance_nm, 0) / hsTotalDist
      : null;

    return {
      distance_nm: totalDist,
      tws_min: Math.min(...twsVals),
      tws_max: Math.max(...twsVals),
      boat_speed_kn: avgSpeed,
      end_time: segs[segs.length - 1].end_time,
      point_of_sail: twaToPointOfSail(avgTwa),
      hs_avg_m: hsAvg,
      sea_direction: hsAvg == null ? null : twaToSeaDirection(avgTwa),
    };
  });
}
