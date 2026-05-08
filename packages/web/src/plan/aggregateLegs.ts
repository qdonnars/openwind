import type { SegmentReport } from "./types";

export interface AggregatedLeg {
  // ── Distances & timing (carried from the segment span) ─────────────────────
  distance_nm: number;
  end_time: string;

  // ── Wind summary ──────────────────────────────────────────────────────────
  tws_min: number;
  tws_max: number;
  tws_avg_kn: number;
  twa_avg_deg: number; // signed -180..180 like SegmentReport.twa_deg
  twd_avg_deg: number; // 0..360 (true wind direction)
  gust_max_kn: number | null;
  point_of_sail: string;

  // ── Boat speed build-up (all in knots) ────────────────────────────────────
  // Distance-weighted means computed per-segment then averaged, so the
  // build-up adds up exactly: polar_after_eff_kn + wave_delta_kn (≤ 0)
  // ≈ boat_speed_kn, and boat_speed_kn + current_delta_kn = target_speed_kn.
  polar_after_eff_kn: number; // polar lookup × passage efficiency (no waves, no current)
  wave_delta_kn: number; // ≤ 0 — loss from wave_derate
  current_delta_kn: number | null; // signed — gain when along, loss when against; null without current data
  boat_speed_kn: number; // STW (polar × efficiency × derate)
  target_speed_kn: number; // SOG when current modelled, else STW — used for duration
  efficiency: number; // passage-wide constant, for display

  // ── Sea state ─────────────────────────────────────────────────────────────
  hs_avg_m: number | null;
  hs_max_m: number | null;
  tp_avg_s: number | null;
  // Where the sea hits the boat relative to its course: "face", "travers",
  // "arrière", or null if Hs is null. Approximated from TWA (Med swell mostly
  // tracks wind in the absence of distant ocean swell).
  sea_direction: "face" | "travers" | "arrière" | null;

  // ── Current ───────────────────────────────────────────────────────────────
  current_speed_kn: number | null;
  current_direction_to_deg: number | null;
  // Sign of current_delta_kn translated to a sailor-friendly label.
  current_relative: "portant" | "contraire" | "travers" | null;
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

function classifyCurrent(deltaKn: number, currentSpeedKn: number | null): "portant" | "contraire" | "travers" {
  // |delta| / current_speed ~ |cos(angle)|. > 0.5 → mostly along (portant or contraire); < 0.5 → mostly travers.
  if (currentSpeedKn != null && currentSpeedKn > 0 && Math.abs(deltaKn) / currentSpeedKn < 0.5) return "travers";
  return deltaKn >= 0 ? "portant" : "contraire";
}

export function aggregateLegs(
  segments: SegmentReport[],
  waypoints: [number, number][],
  efficiency = 0.75,
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
    const wsum = (pick: (s: SegmentReport) => number): number =>
      segs.reduce((acc, seg) => acc + pick(seg) * seg.distance_nm, 0) / totalDist;

    // Wind aggregates
    const twsVals = segs.map((s) => s.tws_kn);
    const tws_avg_kn = wsum((s) => s.tws_kn);
    const twa_avg_deg = circularMeanDeg(segs.map((s) => s.twa_deg));
    const twd_avg_deg = circularMeanDeg(segs.map((s) => s.twd_deg));
    const gusts = segs.map((s) => s.gust_kn).filter((g): g is number => g != null);
    const gust_max_kn = gusts.length > 0 ? Math.max(...gusts) : null;

    // Speed build-up (per-segment, then weighted averaged so the additions stay coherent)
    const polar_after_eff_kn = wsum((s) => s.polar_speed_kn * efficiency);
    const boat_speed_kn = wsum((s) => s.boat_speed_kn);
    const wave_delta_kn = boat_speed_kn - polar_after_eff_kn; // ≤ 0

    // Current — only if every segment in the leg has SOG (avoid mixing)
    const allHaveSog = segs.every((s) => s.sog_kn != null);
    const current_delta_kn = allHaveSog ? wsum((s) => (s.sog_kn as number) - s.boat_speed_kn) : null;
    const target_speed_kn = allHaveSog ? wsum((s) => s.sog_kn as number) : boat_speed_kn;

    // Current speed/direction (max speed for "worst case", circular mean direction)
    const curSpeeds = segs.map((s) => s.current_speed_kn).filter((v): v is number => v != null);
    const current_speed_kn = curSpeeds.length > 0 ? Math.max(...curSpeeds) : null;
    const curDirs = segs.map((s) => s.current_direction_to_deg).filter((v): v is number => v != null);
    const current_direction_to_deg = curDirs.length > 0 ? circularMeanDeg(curDirs) : null;
    const current_relative = current_delta_kn != null
      ? classifyCurrent(current_delta_kn, current_speed_kn)
      : null;

    // Sea state
    const hsSegs = segs.filter((s) => s.hs_m != null);
    const hsTotalDist = hsSegs.reduce((s, seg) => s + seg.distance_nm, 0);
    const hs_avg_m = hsTotalDist > 0
      ? hsSegs.reduce((s, seg) => s + (seg.hs_m as number) * seg.distance_nm, 0) / hsTotalDist
      : null;
    const hs_max_m = hsSegs.length > 0 ? Math.max(...hsSegs.map((s) => s.hs_m as number)) : null;
    const tpSegs = segs.filter((s) => s.wave_period_s != null);
    const tpTotalDist = tpSegs.reduce((s, seg) => s + seg.distance_nm, 0);
    const tp_avg_s = tpTotalDist > 0
      ? tpSegs.reduce((s, seg) => s + (seg.wave_period_s as number) * seg.distance_nm, 0) / tpTotalDist
      : null;

    return {
      distance_nm: totalDist,
      end_time: segs[segs.length - 1].end_time,
      tws_min: Math.min(...twsVals),
      tws_max: Math.max(...twsVals),
      tws_avg_kn,
      twa_avg_deg,
      twd_avg_deg,
      gust_max_kn,
      point_of_sail: twaToPointOfSail(twa_avg_deg),
      polar_after_eff_kn,
      wave_delta_kn,
      current_delta_kn,
      boat_speed_kn,
      target_speed_kn,
      efficiency,
      hs_avg_m,
      hs_max_m,
      tp_avg_s,
      sea_direction: hs_avg_m == null ? null : twaToSeaDirection(twa_avg_deg),
      current_speed_kn,
      current_direction_to_deg,
      current_relative,
    };
  });
}
