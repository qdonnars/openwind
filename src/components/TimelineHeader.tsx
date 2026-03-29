import { formatHour, formatDayHeader, groupHoursByDay } from "../utils/format";
import { getWindColor } from "../utils/colors";
import type { ModelForecast } from "../types";

interface TimelineHeaderProps {
  times: string[];
  selectedHour: string | null;
  onSelectHour: (time: string) => void;
  forecasts: ModelForecast[];
  nowHour: string;
}

function wmoIcon(code: number | null): string {
  if (code == null) return "";
  if (code === 0) return "☀️";
  if (code === 1) return "🌤️";
  if (code === 2) return "⛅";
  if (code === 3) return "☁️";
  if (code === 45 || code === 48) return "🌫️";
  if (code >= 51 && code <= 57) return "🌦️";
  if (code >= 61 && code <= 67) return "🌧️";
  if (code >= 71 && code <= 77) return "🌨️";
  if (code >= 80 && code <= 82) return "🌧️";
  if (code === 85 || code === 86) return "🌨️";
  if (code >= 95) return "⛈️";
  return "";
}

export function TimelineHeader({
  times,
  selectedHour,
  onSelectHour,
  forecasts,
  nowHour,
}: TimelineHeaderProps) {
  const days = groupHoursByDay(times);

  function avgSpeed(timeStr: string): number {
    let sum = 0;
    let count = 0;
    for (const f of forecasts) {
      const idx = f.hourly.time.indexOf(timeStr);
      if (idx !== -1 && f.hourly.wind_speed_10m[idx] != null) {
        sum += f.hourly.wind_speed_10m[idx]!;
        count++;
      }
    }
    return count > 0 ? sum / count : 0;
  }

  function weatherCode(timeStr: string): number | null {
    for (const f of forecasts) {
      const idx = f.hourly.time.indexOf(timeStr);
      if (idx !== -1 && f.hourly.weather_code?.[idx] != null) {
        return f.hourly.weather_code[idx];
      }
    }
    return null;
  }

  return (
    <>
      {/* Day headers */}
      <tr>
        <th className="sticky left-0 z-20 bg-gray-900 min-w-[52px]" scope="col" />
        {Array.from(days.entries()).map(([dateKey, indices]) => (
          <th
            key={dateKey}
            colSpan={indices.length}
            scope="colgroup"
            className="bg-gray-900 text-gray-200 text-xs lg:text-sm font-bold py-2 border-b border-gray-700 border-l border-l-gray-600 uppercase tracking-wide"
          >
            {formatDayHeader(times[indices[0]])}
          </th>
        ))}
      </tr>
      {/* Weather icons */}
      <tr>
        <td className="sticky left-0 z-20 bg-gray-900 min-w-[52px]" />
        {times.map((t, i) => (
          <td
            key={i}
            className="text-center p-0 bg-gray-900 cursor-pointer leading-none"
            style={{ fontSize: "16px", lineHeight: "22px" }}
            onClick={() => onSelectHour(t)}
          >
            {wmoIcon(weatherCode(t))}
          </td>
        ))}
      </tr>
      {/* Color bar */}
      <tr>
        <td className="sticky left-0 z-20 bg-gray-900 min-w-[52px]" />
        {times.map((t, i) => (
          <td
            key={i}
            className="h-2 p-0 cursor-pointer transition-colors"
            style={{ backgroundColor: getWindColor(avgSpeed(t)) }}
            onClick={() => onSelectHour(t)}
          />
        ))}
      </tr>
      {/* Hour numbers */}
      <tr>
        <th className="sticky left-0 z-20 bg-gray-900 min-w-[52px]" scope="col">
          <span className="text-[11px] lg:text-[12px] font-semibold text-gray-400">kn</span>
        </th>
        {times.map((t, i) => {
          const isNow = t.startsWith(nowHour);
          return (
            <th
              key={i}
              scope="col"
              className={`text-xs lg:text-sm font-semibold py-1.5 cursor-pointer transition-colors relative ${
                t === selectedHour
                  ? "text-white bg-teal-600"
                  : isNow
                  ? "text-teal-300 bg-teal-900/40"
                  : "text-gray-400 bg-gray-900 hover:text-gray-200 hover:bg-gray-800"
              }`}
              onClick={() => onSelectHour(t)}
            >
              {formatHour(t)}
              {isNow && (
                <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-teal-400" />
              )}
            </th>
          );
        })}
      </tr>
    </>
  );
}
