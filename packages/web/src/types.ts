export interface Spot {
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  admin1?: string;
}

export interface HourlyData {
  time: string[];
  wind_speed_10m: (number | null)[];
  wind_direction_10m: (number | null)[];
  wind_gusts_10m: (number | null)[];
  weather_code: (number | null)[];
  is_day?: (number | null)[];
}

export interface ModelForecast {
  modelName: string;
  hourly: HourlyData;
}

export interface MarineHourly {
  time: string[];
  wave_height_m: (number | null)[];
  wave_period_s: (number | null)[];
  wave_direction_deg: (number | null)[];
  current_speed_kn: (number | null)[];
  current_direction_to_deg: (number | null)[];
  // Tide height in MSL reference (Open-Meteo SMOC). Always populated when SMOC
  // covers the spot. Negative values are normal (water below mean sea level).
  tide_height_m: (number | null)[];
  // Tide height in ZH (Zéro Hydrographique / chart datum) reference. Populated
  // only when MARC PREVIMER covers the spot. Always ≥ 0 by construction (chart
  // datum is the lowest astronomical tide), so it matches what nautical charts,
  // SHOM annuals and tide gauges display.
  tide_height_zh_m?: (number | null)[];
  // Z0 used to convert tide_height_m → tide_height_zh_m
  // (zh = msl - z0_hydro_m). Single scalar per spot. Present only when MARC
  // covers the spot.
  z0_hydro_m?: number;
  // Provenance of tide+current data. ``"openmeteo_smoc"`` for the default
  // Open-Meteo path; ``"marc_<atlas>_<resolution>"`` (e.g. ``marc_finis_250m``)
  // when MARC overrides. Used to drive a small badge on the active pill.
  current_source?: string;
  // Resolution in metres of the MARC atlas used. Surfaces in the badge: 250 m
  // (FINIS), 700 m (MANGA, MANW, MANE, SUDBZH, AQUI), 2000 m (ATLNE).
  marc_resolution_m?: number;
}

// Surfacing thresholds, mirror of openwind_data.adapters.base. Below these,
// the data is noise — pills are hidden.
export const CURRENT_RELEVANCE_THRESHOLD_KN = 0.3;
export const TIDE_RANGE_RELEVANCE_THRESHOLD_M = 0.5;

export type MetricView = "wind" | "waves" | "tides" | "currents";

export interface GeocodingResult {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  country: string;
  admin1?: string;
}
