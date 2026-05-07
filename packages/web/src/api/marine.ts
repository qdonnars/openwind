import type {
  MarineHourly,
} from "../types";
import {
  CURRENT_RELEVANCE_THRESHOLD_KN,
  TIDE_RANGE_RELEVANCE_THRESHOLD_M,
} from "../types";

const MARINE_URL = "https://marine-api.open-meteo.com/v1/marine";

// 8 vars on Marine endpoint (waves x5 + currents x2 + tide x1) — under the
// 10-var-per-call cap. Mirrors packages/data-adapters/.../openmeteo.py:_MARINE_VARS.
const MARINE_VARS =
  "wave_height,wave_period,wave_direction,wind_wave_height,swell_wave_height," +
  "ocean_current_velocity,ocean_current_direction,sea_level_height_msl";

// Open-Meteo Marine returns ocean_current_velocity in km/h by default.
// 1 nautical mile = 1852 m → 1 kn = 1.852 km/h.
const KMH_TO_KN = 1 / 1.852;

const cache = new Map<string, { data: MarineHourly; fetchedAt: number }>();
const CACHE_TTL = 30 * 60 * 1000;

interface RawHourly {
  time?: string[];
  wave_height?: (number | null)[];
  wave_period?: (number | null)[];
  wave_direction?: (number | null)[];
  ocean_current_velocity?: (number | null)[];
  ocean_current_direction?: (number | null)[];
  sea_level_height_msl?: (number | null)[];
}

function pad(arr: (number | null)[] | undefined, n: number): (number | null)[] {
  const out: (number | null)[] = new Array(n).fill(null);
  if (!arr) return out;
  for (let i = 0; i < Math.min(arr.length, n); i++) out[i] = arr[i] ?? null;
  return out;
}

export async function fetchMarine(lat: number, lon: number): Promise<MarineHourly | null> {
  const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    return cached.data;
  }
  const url =
    `${MARINE_URL}?latitude=${lat}&longitude=${lon}` +
    `&hourly=${MARINE_VARS}&timezone=Europe/Paris&forecast_days=7`;
  let raw: { hourly?: RawHourly };
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    raw = await resp.json();
  } catch {
    return null;
  }
  const h = raw.hourly;
  if (!h || !h.time) return null;
  const n = h.time.length;
  const data: MarineHourly = {
    time: h.time,
    wave_height_m: pad(h.wave_height, n),
    wave_period_s: pad(h.wave_period, n),
    wave_direction_deg: pad(h.wave_direction, n),
    current_speed_kn: pad(h.ocean_current_velocity, n).map((v) =>
      v == null ? null : v * KMH_TO_KN
    ),
    current_direction_to_deg: pad(h.ocean_current_direction, n),
    tide_height_m: pad(h.sea_level_height_msl, n),
  };
  cache.set(key, { data, fetchedAt: Date.now() });
  return data;
}

export function isCurrentsRelevant(marine: MarineHourly | null): boolean {
  if (!marine) return false;
  return marine.current_speed_kn.some(
    (v): v is number => v != null && v >= CURRENT_RELEVANCE_THRESHOLD_KN
  );
}

export function isTidesRelevant(marine: MarineHourly | null): boolean {
  if (!marine) return false;
  const valid = marine.tide_height_m.filter((v): v is number => v != null);
  if (valid.length === 0) return false;
  return Math.max(...valid) - Math.min(...valid) >= TIDE_RANGE_RELEVANCE_THRESHOLD_M;
}

export function isWavesRelevant(marine: MarineHourly | null): boolean {
  // Waves are always relevant offshore; show the pill whenever any Hs is
  // present. Coastal-only spots without Marine coverage will see the pill
  // hidden.
  if (!marine) return false;
  return marine.wave_height_m.some((v) => v != null);
}
