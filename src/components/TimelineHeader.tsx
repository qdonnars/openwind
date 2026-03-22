import { formatHour, formatDayHeader, groupHoursByDay } from "../utils/format";
import { getWindColor } from "../utils/colors";
import type { ModelForecast } from "../types";

interface TimelineHeaderProps {
  times: string[];
  selectedHour: string | null;
  onSelectHour: (time: string) => void;
  forecasts: ModelForecast[];
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
        <th className="sticky left-0 z-10 bg-gray-900 min-w-[40px]" />
        {Array.from(days.entries()).map(([dateKey, indices]) => (
          <th
            key={dateKey}
            colSpan={indices.length}
            className="bg-gray-900 text-gray-200 text-[9px] font-semibold py-1 border-b border-gray-700 border-l border-l-gray-600"
          >
            {formatDayHeader(times[indices[0]])}
          </th>
        ))}
      </tr>
      {/* Weather icons */}
      <tr>
        <td className="sticky left-0 z-10 bg-gray-900 min-w-[40px]" />
        {times.map((t, i) => (
          <td
            key={i}
            className="text-center p-0 bg-gray-900 cursor-pointer leading-none"
            style={{ fontSize: "14px", lineHeight: "16px" }}
            onClick={() => onSelectHour(t)}
          >
            {wmoIcon(weatherCode(t))}
          </td>
        ))}
      </tr>
      {/* Color bar */}
      <tr>
        <td className="sticky left-0 z-10 bg-gray-900 min-w-[40px]" />
        {times.map((t, i) => (
          <td
            key={i}
            className="h-1.5 p-0 cursor-pointer"
            style={{ backgroundColor: getWindColor(avgSpeed(t)) }}
            onClick={() => onSelectHour(t)}
          />
        ))}
      </tr>
      {/* Hour numbers */}
      <tr>
        <th className="sticky left-0 z-10 bg-gray-900 min-w-[40px]" />
        {times.map((t, i) => (
          <th
            key={i}
            className={`text-[8px] font-normal py-px cursor-pointer ${
              t === selectedHour
                ? "text-white bg-red-600"
                : "text-gray-500 bg-gray-900 hover:text-gray-300"
            }`}
            onClick={() => onSelectHour(t)}
          >
            {formatHour(t)}
          </th>
        ))}
      </tr>
    </>
  );
}
