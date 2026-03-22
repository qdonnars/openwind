import { useEffect, useRef } from "react";
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

export function WindTable({
  forecasts,
  isLoading,
  selectedHour,
  onSelectHour,
}: WindTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const resolution = autoResolution(forecasts);
  const fullTimeline = getMasterTimeline(forecasts);
  const masterTimeline = fullTimeline.filter(
    (t) => parseInt(t.slice(11, 13)) % resolution === 0
  );

  useEffect(() => {
    if (!scrollRef.current || masterTimeline.length === 0) return;
    const now = new Date();
    const nowHour = now.toISOString().slice(0, 13);
    const idx = masterTimeline.findIndex((t) => t.startsWith(nowHour));
    const nearestIdx = idx >= 0 ? idx : masterTimeline.findIndex((t) => t > nowHour.slice(0, 13));
    if (nearestIdx > 0) {
      const cellWidth = 28;
      scrollRef.current.scrollLeft = Math.max(0, nearestIdx * cellWidth - 60);
    }
  }, [masterTimeline]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-20">
        <div className="animate-spin rounded-full h-6 w-6 border-2 border-gray-600 border-t-white" />
      </div>
    );
  }

  if (forecasts.length === 0) {
    return (
      <div className="text-gray-500 text-center py-6 text-sm">
        Aucune donnee disponible
      </div>
    );
  }

  return (
    <div>
    <div ref={scrollRef} className="overflow-x-auto -mx-3">
      <table className="border-collapse">
        <thead>
          <TimelineHeader
            times={masterTimeline}
            selectedHour={selectedHour}
            onSelectHour={onSelectHour}
            forecasts={forecasts}
          />
        </thead>
        <tbody>
          {forecasts.map((forecast) => {
            const timeIndex = buildTimeIndex(forecast.hourly.time);
            return (
              <tr key={forecast.modelName}>
                <td className="sticky left-0 z-10 bg-gray-900 px-1 py-0 whitespace-nowrap border-r border-gray-700">
                  <div className="flex flex-col items-center leading-tight">
                    <span className="text-[8px] font-bold text-gray-200">kn</span>
                    <span className="text-[7px] text-gray-400">{forecast.modelName}</span>
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
  );
}
