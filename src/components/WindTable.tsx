import { useEffect, useRef, useState, useCallback } from "react";
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
  AROME: "Arome",
  ICON: "Icon",
  GFS: "GFS",
  ECMWF: "ECMWF",
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
}: WindTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrolledEnd, setScrolledEnd] = useState(false);
  const resolution = autoResolution(forecasts);
  const fullTimeline = getMasterTimeline(forecasts);
  const masterTimeline = fullTimeline.filter(
    (t) => parseInt(t.slice(11, 13)) % resolution === 0
  );

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

  if (isLoading) {
    return <SkeletonTable />;
  }

  if (forecasts.length === 0) {
    return (
      <div className="text-gray-500 text-center py-8 text-sm">
        Aucune donnee disponible
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <div className={`scroll-container ${scrolledEnd ? "scrolled-end" : ""}`}>
        <div ref={scrollRef} className="overflow-x-auto wind-table-scroll">
          <table className="border-collapse">
            <thead>
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
                  <tr key={forecast.modelName}>
                    <td className="sticky left-0 z-10 bg-gray-900 px-2 py-1 whitespace-nowrap border-r border-gray-700 min-w-[52px]">
                      <div className="flex flex-col items-center leading-tight">
                        <span className="text-[11px] font-bold text-gray-100 tracking-wide">kn</span>
                        <span className="text-[10px] font-medium text-gray-400">{MODEL_LABELS[forecast.modelName] ?? forecast.modelName}</span>
                      </div>
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
