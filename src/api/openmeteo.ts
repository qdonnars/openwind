import type { ModelForecast, GeocodingResult } from "../types";

const MODELS = [
  { name: "ECMWF", endpoint: "https://api.open-meteo.com/v1/ecmwf" },
  { name: "GFS", endpoint: "https://api.open-meteo.com/v1/gfs" },
  { name: "ICON", endpoint: "https://api.open-meteo.com/v1/dwd-icon" },
  {
    name: "AROME",
    endpoint: "https://api.open-meteo.com/v1/meteofrance",
    extraParams: "&models=arome_france",
  },
];

const PARAMS =
  "hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m,weather_code&wind_speed_unit=kn&timezone=Europe/Paris&forecast_days=7";

const cache = new Map<string, { models: ModelForecast[]; fetchedAt: number }>();
const CACHE_TTL = 30 * 60 * 1000;

export async function fetchAllModels(
  lat: number,
  lon: number
): Promise<ModelForecast[]> {
  const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    return cached.models;
  }

  const base = `?latitude=${lat}&longitude=${lon}&${PARAMS}`;

  const results = await Promise.allSettled(
    MODELS.map((model) =>
      fetch(`${model.endpoint}${base}${model.extraParams || ""}`)
        .then((r) => r.json())
        .then((data) => ({
          modelName: model.name,
          hourly: data.hourly,
        }))
    )
  );

  const models = results
    .filter(
      (r): r is PromiseFulfilledResult<ModelForecast> =>
        r.status === "fulfilled" && r.value.hourly != null
    )
    .map((r) => r.value);

  cache.set(key, { models, fetchedAt: Date.now() });
  return models;
}

export async function searchSpots(
  query: string
): Promise<GeocodingResult[]> {
  const res = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=5&language=fr`
  );
  const data = await res.json();
  return data.results || [];
}
