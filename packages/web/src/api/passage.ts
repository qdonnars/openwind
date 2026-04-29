import type { PassageResponse, MultiWindowResponse, Archetype } from "../plan/types";

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "https://qdonnars-openwind-mcp.hf.space";

// Translate known backend error messages to actionable French. Returns the
// original string if no rule matches, so unknown errors stay debuggable.
export function friendlyError(raw: string): string {
  if (/forecast horizon exceeded/i.test(raw)) {
    // Cause la plus fréquente : date > today+15 (cap Open-Meteo). Mais peut
    // aussi survenir transitoirement quand un modèle de la chaîne tombe ;
    // d'où la formulation prudente.
    return "Le service météo n'a pas pu couvrir cette période. Essayez une date plus proche, ou réessayez dans quelques instants.";
  }
  if (/at least 2 waypoints/i.test(raw)) {
    return "Placez au moins 2 waypoints sur la carte pour calculer une route.";
  }
  if (/unknown archetype/i.test(raw)) {
    return "Type de bateau inconnu. Sélectionnez un archétype dans la liste.";
  }
  if (/invalid (departure|latest_departure|target_eta)/i.test(raw)) {
    return "Date invalide. Vérifiez le format des champs date.";
  }
  if (/sweep would produce \d+ windows/i.test(raw)) {
    return "Trop de créneaux à comparer. Réduisez la fenêtre ou augmentez le pas d'échantillonnage.";
  }
  if (/Erreur serveur 5\d\d/.test(raw) || /HTTP 5\d\d/.test(raw)) {
    return "Le serveur météo est indisponible. Réessayez dans quelques instants.";
  }
  return raw;
}

export async function fetchPassage(params: {
  waypoints: [number, number][];
  departure: string;
  archetype: string;
  efficiency?: number;
}): Promise<PassageResponse> {
  const res = await fetch(`${API_BASE}/api/v1/passage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      waypoints: params.waypoints,
      departure: params.departure,
      archetype: params.archetype,
      efficiency: params.efficiency ?? 0.75,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as Record<string, string>;
    throw new Error(err["error"] ?? `Erreur serveur ${res.status}`);
  }
  return res.json() as Promise<PassageResponse>;
}

export async function fetchPassageWindows(params: {
  waypoints: [number, number][];
  earliest: string;
  latest: string;
  archetype: string;
  intervalHours: number;
  targetEta?: string;
  efficiency?: number;
}): Promise<MultiWindowResponse> {
  const body: Record<string, unknown> = {
    waypoints: params.waypoints,
    departure: params.earliest,
    archetype: params.archetype,
    efficiency: params.efficiency ?? 0.75,
    latest_departure: params.latest,
    sweep_interval_hours: params.intervalHours,
  };
  if (params.targetEta) body["target_eta"] = params.targetEta;

  const res = await fetch(`${API_BASE}/api/v1/passage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as Record<string, string>;
    throw new Error(err["error"] ?? `Erreur serveur ${res.status}`);
  }
  return res.json() as Promise<MultiWindowResponse>;
}

export async function fetchArchetypes(): Promise<Archetype[]> {
  const res = await fetch(`${API_BASE}/api/v1/archetypes`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<Archetype[]>;
}
