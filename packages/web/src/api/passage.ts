import type { PassageResponse, Archetype } from "../plan/types";

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "https://qdonnars-openwind-mcp.hf.space";

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

export async function fetchArchetypes(): Promise<Archetype[]> {
  const res = await fetch(`${API_BASE}/api/v1/archetypes`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<Archetype[]>;
}
