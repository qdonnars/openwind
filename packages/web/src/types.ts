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
  tide_height_m: (number | null)[];
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
