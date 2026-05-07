import { describe, it, expect } from "vitest";
import {
  isCurrentsRelevant,
  isTidesRelevant,
  isWavesRelevant,
} from "./marine";
import type { MarineHourly } from "../types";

function emptyMarine(): MarineHourly {
  return {
    time: ["2026-05-08T00:00", "2026-05-08T01:00", "2026-05-08T02:00"],
    wave_height_m: [null, null, null],
    wave_period_s: [null, null, null],
    wave_direction_deg: [null, null, null],
    current_speed_kn: [null, null, null],
    current_direction_to_deg: [null, null, null],
    tide_height_m: [null, null, null],
  };
}

describe("isCurrentsRelevant", () => {
  it("returns false when null marine data", () => {
    expect(isCurrentsRelevant(null)).toBe(false);
  });

  it("returns false when all currents below 0.3 kt threshold (Mediterranean case)", () => {
    const m = emptyMarine();
    m.current_speed_kn = [0.05, 0.1, 0.2];
    expect(isCurrentsRelevant(m)).toBe(false);
  });

  it("returns true when at least one current reaches 0.3 kt threshold", () => {
    const m = emptyMarine();
    m.current_speed_kn = [0.05, 0.3, 0.2];
    expect(isCurrentsRelevant(m)).toBe(true);
  });

  it("returns true when current is well above threshold (Atlantic tidal pass)", () => {
    const m = emptyMarine();
    m.current_speed_kn = [0.1, 4.5, 3.2];
    expect(isCurrentsRelevant(m)).toBe(true);
  });
});

describe("isTidesRelevant", () => {
  it("returns false when null marine data", () => {
    expect(isTidesRelevant(null)).toBe(false);
  });

  it("returns false when range stays below 0.5 m (Mediterranean case)", () => {
    const m = emptyMarine();
    m.tide_height_m = [-0.15, 0.0, 0.15]; // range = 0.30
    expect(isTidesRelevant(m)).toBe(false);
  });

  it("returns true when range reaches 0.5 m threshold", () => {
    const m = emptyMarine();
    m.tide_height_m = [-0.25, 0.0, 0.25]; // range = 0.50
    expect(isTidesRelevant(m)).toBe(true);
  });

  it("returns true for Atlantic tidal range (several meters)", () => {
    const m = emptyMarine();
    m.tide_height_m = [-3.5, 0.0, 4.0]; // range = 7.5
    expect(isTidesRelevant(m)).toBe(true);
  });

  it("returns false when all tide values are null (no SMOC coverage)", () => {
    expect(isTidesRelevant(emptyMarine())).toBe(false);
  });
});

describe("isWavesRelevant", () => {
  it("returns false when null marine data", () => {
    expect(isWavesRelevant(null)).toBe(false);
  });

  it("returns true as long as any Hs is present", () => {
    const m = emptyMarine();
    m.wave_height_m = [null, 0.3, null];
    expect(isWavesRelevant(m)).toBe(true);
  });

  it("returns false when no Hs anywhere (no Marine coverage)", () => {
    expect(isWavesRelevant(emptyMarine())).toBe(false);
  });
});
