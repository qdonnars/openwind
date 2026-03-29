import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import type { ModelForecast } from "../types";
import { TimelineHeader } from "./TimelineHeader";
import { WindCell } from "./WindCell";

// Native time step (hours) for each model — Open-Meteo interpolates to 1h,
// but these are the actual forecast resolution worth displaying
const MODEL_STEP: Record<string, number> = {
  AROME: 1,
  ICON: 3,
  GFS: 3,
  ECMWF: 6,
};

const MODEL_LABELS: Record<string, string> = {
  AROME: "AROME",
  ICON: "ICON",
  GFS: "GFS",
  ECMWF: "ECMWF",
};

const MODEL_DESCRIPTIONS: Record<string, string> = {
  AROME: "AROME — Modèle haute résolution (1h) — Météo-France",
  ICON: "ICON — Modèle global (3h) — DWD Allemagne",
  GFS: "GFS — Modèle global (3h) — NOAA États-Unis",
  ECMWF: "ECMWF — Modèle global (6h) — Centre européen",
};

function autoResolution(forecasts: ModelForecast[]): number {
  let finest = 6;
  for (const f of forecasts) {
    const step = MODEL_STEP[f.modelName] ?? 3;
    if (step < finest) finest = step;
  }
  return finest;
}

interface WindTableProps {
  forecasts: ModelForecast[];
  isLoading: boolean;
  selectedHour: string | null;
  onSelectHour: (time: string) => void;
  spotName?: string;
}

function getMasterTimeline(forecasts: ModelForecast[]): string[] {
  let longest: string[] = [];
  for (const f of forecasts) {
    if (f.hourly.time.length > longest.length) {
      longest = f.hourly.time;
    }
  }
  return longest;
}

function buildTimeIndex(times: string[]): Map<string, number> {
  const map = new Map<string, number>();
  times.forEach((t, i) => map.set(t, i));
  return map;
}

function SkeletonTable() {
  return (
    <div className="px-3 py-4 space-y-3 animate-fade-in">
      {/* Header skeleton */}
      <div className="flex gap-2 items-center">
        <div className="skeleton h-4 w-20" />
        <div className="skeleton h-4 flex-1 max-w-[200px]" />
      </div>
      {/* Rows */}
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex gap-1.5">
          <div className="skeleton h-12 w-14 shrink-0" />
          {Array.from({ length: 10 }).map((_, j) => (
            <div key={j} className="skeleton h-12 w-11 shrink-0" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function WindTable({
  forecasts,
  isLoading,
  selectedHour,
  onSelectHour,
  spotName,
}: WindTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrolledEnd, setScrolledEnd] = useState(false);

  const masterTimeline = useMemo(() => {
    const resolution = autoResolution(forecasts);
    const fullTimeline = getMasterTimeline(forecasts);
    return fullTimeline.filter(
      (t) => parseInt(t.slice(11, 13)) % resolution === 0
    );
  }, [forecasts]);

  const nowHour = new Date().toISOString().slice(0, 13);

  const checkScrollEnd = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 10;
    setScrolledEnd(atEnd);
  }, []);

  useEffect(() => {
    if (!scrollRef.current || masterTimeline.length === 0) return;
    const idx = masterTimeline.findIndex((t) => t.startsWith(nowHour));
    const nearestIdx = idx >= 0 ? idx : masterTimeline.findIndex((t) => t > nowHour.slice(0, 13));
    if (nearestIdx > 0) {
      const cellWidth = 44;
      scrollRef.current.scrollLeft = Math.max(0, nearestIdx * cellWidth - 60);
    }
    checkScrollEnd();
  }, [masterTimeline, nowHour, checkScrollEnd]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", checkScrollEnd, { passive: true });
    return () => el.removeEventListener("scroll", checkScrollEnd);
  }, [checkScrollEnd]);

  const scrollToNow = useCallback(() => {
    if (!scrollRef.current || masterTimeline.length === 0) return;
    const idx = masterTimeline.findIndex((t) => t.startsWith(nowHour));
    const nearestIdx = idx >= 0 ? idx : masterTimeline.findIndex((t) => t > nowHour.slice(0, 13));
    if (nearestIdx >= 0) {
      const cellWidth = 44;
      scrollRef.current.scrollTo({ left: Math.max(0, nearestIdx * cellWidth - 60), behavior: "smooth" });
    }
  }, [masterTimeline, nowHour]);

  if (isLoading) {
    return <SkeletonTable />;
  }

  if (forecasts.length === 0) {
    return (
      <div className="text-gray-500 text-center py-8 text-sm">
        No data available
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      {/* Spot name bar */}
      <div className="flex items-center px-3 py-1.5 bg-gray-900/80 border-b border-gray-800/60">
        {spotName ? (
          <div className="flex items-center gap-2 min-w-0">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-teal-400 shrink-0">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            <span className="text-sm font-semibold text-gray-200 truncate">{spotName}</span>
          </div>
        ) : (
          <div />
        )}
      </div>
      <div className={`scroll-container ${scrolledEnd ? "scrolled-end" : ""}`}>
        <div ref={scrollRef} className="overflow-x-auto wind-table-scroll">
          <table className="border-collapse" role="table">
            <thead className="sticky top-0 z-20">
              <TimelineHeader
                times={masterTimeline}
                selectedHour={selectedHour}
                onSelectHour={onSelectHour}
                forecasts={forecasts}
                nowHour={nowHour}
              />
            </thead>
            <tbody>
              {forecasts.map((forecast) => {
                const timeIndex = buildTimeIndex(forecast.hourly.time);
                return (
                  <tr key={forecast.modelName} className={forecasts.indexOf(forecast) % 2 === 1 ? "model-row-alt" : ""}>
                    <td className="sticky left-0 z-10 bg-gray-900 px-2 py-1.5 whitespace-nowrap border-r border-gray-700 min-w-[56px]" role="rowheader">
                      <span className="text-[12px] lg:text-[13px] font-bold text-gray-200 tracking-wide" title={MODEL_DESCRIPTIONS[forecast.modelName] ?? forecast.modelName}>{MODEL_LABELS[forecast.modelName] ?? forecast.modelName}</span>
                    </td>
                    {masterTimeline.map((t, i) => {
                      const idx = timeIndex.get(t);
                      const speed =
                        idx != null ? forecast.hourly.wind_speed_10m[idx] : null;
                      const gusts =
                        idx != null ? forecast.hourly.wind_gusts_10m[idx] : null;
                      const direction =
                        idx != null
                          ? forecast.hourly.wind_direction_10m[idx]
                          : null;
                      return (
                        <WindCell
                          key={i}
                          speed={speed}
                          gusts={gusts}
                          direction={direction}
                          selected={t === selectedHour}
                          isNow={t.startsWith(nowHour)}
                          onSelect={() => onSelectHour(t)}
                        />
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
