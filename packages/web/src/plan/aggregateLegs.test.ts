import { describe, expect, it } from "vitest";
import { aggregateLegs } from "./aggregateLegs";
import type { SegmentReport } from "./types";

function seg(overrides: Partial<SegmentReport> = {}): SegmentReport {
  return {
    start: { lat: 43.0, lon: 5.0 },
    end: { lat: 43.1, lon: 5.1 },
    distance_nm: 5,
    bearing_deg: 90,
    start_time: "2026-05-08T10:00:00+02:00",
    end_time: "2026-05-08T11:00:00+02:00",
    tws_kn: 12,
    twd_deg: 270,
    twa_deg: 60,
    polar_speed_kn: 5.5,
    boat_speed_kn: 4.5,
    duration_h: 1,
    hs_m: 0.4,
    wave_derate_factor: 0.95,
    ...overrides,
  };
}

describe("aggregateLegs", () => {
  // Regression: adding a waypoint after a passage was simulated used to
  // crash the /plan page with a black screen because an empty leg range
  // caused `segs[0].start_time` to deref undefined. The function must
  // tolerate stale segments when waypoints have grown.
  it("does not crash when waypoints have grown beyond the rendered route", () => {
    const segments: SegmentReport[] = [
      seg({ start: { lat: 43.0, lon: 5.0 }, end: { lat: 43.1, lon: 5.1 } }),
      seg({ start: { lat: 43.1, lon: 5.1 }, end: { lat: 43.2, lon: 5.2 } }),
    ];
    // 4 waypoints but only 2 segments — the passage is from a 2-waypoint
    // simulation, the user just added two new waypoints past the destination.
    const waypoints: [number, number][] = [
      [43.0, 5.0],
      [43.2, 5.2],
      [43.4, 5.4],
      [43.6, 5.6],
    ];

    const legs = aggregateLegs(segments, waypoints);

    // No NaN, no crash. Empty-coverage legs are dropped rather than emitted
    // with garbage values.
    expect(() => legs).not.toThrow();
    for (const leg of legs) {
      expect(Number.isFinite(leg.distance_nm)).toBe(true);
      expect(Number.isFinite(leg.boat_speed_kn)).toBe(true);
      expect(typeof leg.start_time).toBe("string");
    }
  });

  it("returns one leg per segment span when waypoints align with segments", () => {
    const segments: SegmentReport[] = [
      seg({ start: { lat: 43.0, lon: 5.0 }, end: { lat: 43.1, lon: 5.1 } }),
      seg({ start: { lat: 43.1, lon: 5.1 }, end: { lat: 43.2, lon: 5.2 } }),
    ];
    const waypoints: [number, number][] = [
      [43.0, 5.0],
      [43.1, 5.1],
      [43.2, 5.2],
    ];

    const legs = aggregateLegs(segments, waypoints);
    expect(legs).toHaveLength(2);
    expect(legs[0].distance_nm).toBeGreaterThan(0);
    expect(legs[1].distance_nm).toBeGreaterThan(0);
  });

  it("returns empty array when there are fewer than 2 waypoints", () => {
    expect(aggregateLegs([seg()], [[43, 5]])).toEqual([]);
    expect(aggregateLegs([seg()], [])).toEqual([]);
  });

  it("returns empty array when there are no segments", () => {
    expect(aggregateLegs([], [[43, 5], [43.1, 5.1]])).toEqual([]);
  });
});
