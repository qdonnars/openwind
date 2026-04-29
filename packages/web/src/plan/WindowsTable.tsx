import { useMemo, useState } from "react";
import type { PassageWindow } from "./types";
import { CX_COLORS } from "./types";

type SortKey = "departure" | "duration" | "complexity";

const SAIL_LABELS: Record<string, string> = {
  pres: "Près",
  travers: "Travers",
  largue: "Largue",
  portant: "Portant",
};

function fmtDeparture(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
  const hh = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return `${day} · ${hh}`;
}

function fmtDuration(h: number): string {
  const hrs = Math.floor(h);
  const mins = Math.round((h - hrs) * 60);
  return mins > 0 ? `${hrs}h${String(mins).padStart(2, "0")}` : `${hrs}h`;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function fmtRange(min: number, max: number, unit: string, decimals = 0): string {
  const a = min.toFixed(decimals);
  const b = max.toFixed(decimals);
  return a === b ? `${a} ${unit}` : `${a}–${b} ${unit}`;
}

function fmtHsRange(min: number | null, max: number | null): string {
  if (min === null || max === null) return "—";
  return fmtRange(min, max, "m", 1);
}

export interface WindowsTableProps {
  windows: PassageWindow[];
  onSelect?: (w: PassageWindow) => void;
}

export function WindowsTable({ windows, onSelect }: WindowsTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("departure");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const sorted = useMemo(() => {
    const list = [...windows];
    list.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "departure") {
        cmp = new Date(a.departure).getTime() - new Date(b.departure).getTime();
      } else if (sortKey === "duration") {
        cmp = a.duration_h - b.duration_h;
      } else if (sortKey === "complexity") {
        cmp = a.complexity.level - b.complexity.level;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [windows, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "complexity" ? "asc" : "asc");
    }
  }

  function SortHeader({ k, label, align = "left" }: { k: SortKey; label: string; align?: "left" | "right" | "center" }) {
    const active = sortKey === k;
    const arrow = active ? (sortDir === "asc" ? "▲" : "▼") : "";
    return (
      <button
        onClick={() => toggleSort(k)}
        className="flex items-center gap-1 transition-colors w-full"
        style={{
          color: active ? "var(--ow-fg-0)" : "var(--ow-fg-3)",
          justifyContent: align === "right" ? "flex-end" : align === "center" ? "center" : "flex-start",
          fontWeight: 600,
        }}
      >
        {label} <span className="text-[8px] opacity-60">{arrow || "↕"}</span>
      </button>
    );
  }

  return (
    <div>
      <div
        className="grid items-center gap-2 px-2 py-1.5 text-[9px] uppercase tracking-widest border-b"
        style={{
          gridTemplateColumns: "1.4fr 0.7fr 0.7fr 0.9fr 0.9fr 0.9fr 0.55fr",
          borderColor: "var(--ow-line)",
          color: "var(--ow-fg-3)",
        }}
      >
        <SortHeader k="departure" label="Départ" />
        <SortHeader k="duration" label="Durée" />
        <span className="text-left">ETA</span>
        <span className="text-left">Allure</span>
        <span className="text-left">Vent (kn)</span>
        <span className="text-left">Mer</span>
        <SortHeader k="complexity" label="⚡" align="center" />
      </div>

      <div className="divide-y" style={{ borderColor: "var(--ow-line)" }}>
        {sorted.map((w) => {
          const cs = w.conditions_summary;
          return (
            <button
              key={w.departure}
              onClick={() => onSelect?.(w)}
              className="w-full text-left grid items-center gap-2 px-2 py-2 text-xs transition-colors hover:bg-[var(--ow-bg-2)]"
              style={{
                gridTemplateColumns: "1.4fr 0.7fr 0.7fr 0.9fr 0.9fr 0.9fr 0.55fr",
                fontFamily: "var(--ow-font-mono)",
                color: "var(--ow-fg-1)",
              }}
              title="Voir le détail de cette fenêtre"
            >
              <span className="tabular-nums" style={{ color: "var(--ow-fg-0)" }}>
                {fmtDeparture(w.departure)}
              </span>
              <span className="tabular-nums">{fmtDuration(w.duration_h)}</span>
              <span className="tabular-nums">{fmtTime(w.arrival)}</span>
              <span className="capitalize" style={{ color: "var(--ow-fg-1)" }}>
                {SAIL_LABELS[cs.predominant_sail_angle] ?? cs.predominant_sail_angle}
              </span>
              <span className="tabular-nums">{fmtRange(cs.tws_min_kn, cs.tws_max_kn, "")}</span>
              <span className="tabular-nums">{fmtHsRange(cs.hs_min_m, cs.hs_max_m)}</span>
              <span className="flex justify-center">
                <span
                  className="inline-flex items-center justify-center w-7 h-6 rounded-md text-[11px] font-bold"
                  style={{
                    background: CX_COLORS[w.complexity.level] + "22",
                    color: CX_COLORS[w.complexity.level],
                    border: `1px solid ${CX_COLORS[w.complexity.level]}55`,
                  }}
                  title={`${w.complexity.label} — ${w.complexity.rationale}`}
                >
                  {w.complexity.level}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
