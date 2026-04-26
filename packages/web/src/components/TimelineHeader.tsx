import { formatHour, formatDayHeader, groupHoursByDay } from "../utils/format";
import { getWindColor } from "../utils/colors";
import type { ModelForecast } from "../types";
import type { TimezoneMode } from "../hooks/useTimezone";

const TZ_LABELS: Record<TimezoneMode, string> = {
  local: "LCL",
  utc: "UTC",
  boat: "BOAT",
};

const TZ_TITLES: Record<TimezoneMode, string> = {
  local: "Browser local time — click to switch to UTC",
  utc: "UTC — click to switch to Boat (Europe/Paris)",
  boat: "Boat time (Europe/Paris) — click to switch to Local",
};

interface TimelineHeaderProps {
  times: string[];
  selectedHour: string | null;
  onSelectHour: (time: string) => void;
  forecasts: ModelForecast[];
  nowHour: string;
  timezoneMode: TimezoneMode;
  onCycleTimezone: () => void;
  visibleDay: string; // ISO date string "2025-04-26" of leftmost visible day
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

function formatStickyDay(isoDate: string): string {
  if (!isoDate) return "";
  const d = new Date(isoDate + "T12:00:00Z");
  return d.toLocaleDateString("en-US", { weekday: "short", day: "numeric", timeZone: "UTC" });
}

export function TimelineHeader({
  times,
  selectedHour,
  onSelectHour,
  forecasts,
  nowHour,
  timezoneMode,
  onCycleTimezone,
  visibleDay,
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
      {/* Day headers — sticky left cell shows currently-visible day */}
      <tr>
        <th
          className="sticky left-0 z-20 min-w-[56px] px-1 text-[10px] font-bold uppercase tracking-wide"
          style={{ background: 'var(--ow-bg-1)', color: 'var(--ow-accent)' }}
          scope="col"
        >
          {formatStickyDay(visibleDay)}
        </th>
        {Array.from(days.entries()).map(([dateKey, indices]) => (
          <th
            key={dateKey}
            colSpan={indices.length}
            scope="colgroup"
            className="ow-tbl-day-th text-[10px] lg:text-xs font-bold py-1.5 uppercase tracking-wide"
          >
            {formatDayHeader(times[indices[0]], timezoneMode)}
          </th>
        ))}
      </tr>
      {/* Weather icons */}
      <tr>
        <td className="sticky left-0 z-20 ow-tbl-bg min-w-[56px]" />
        {times.map((t, i) => (
          <td
            key={i}
            className="text-center p-0 ow-tbl-bg cursor-pointer leading-none"
            style={{ fontSize: "14px", lineHeight: "20px" }}
            onClick={() => onSelectHour(t)}
          >
            {wmoIcon(weatherCode(t))}
          </td>
        ))}
      </tr>
      {/* Color bar */}
      <tr>
        <td className="sticky left-0 z-20 ow-tbl-bg min-w-[56px]" />
        {times.map((t, i) => (
          <td
            key={i}
            className="h-2 p-0 cursor-pointer transition-colors"
            style={{ backgroundColor: getWindColor(avgSpeed(t)) }}
            onClick={() => onSelectHour(t)}
          />
        ))}
      </tr>
      {/* Hour numbers + timezone toggle */}
      <tr>
        <th
          className="sticky left-0 z-20 ow-tbl-bg min-w-[56px] px-1"
          scope="col"
        >
          <button
            onClick={onCycleTimezone}
            title={TZ_TITLES[timezoneMode]}
            aria-label={`Timezone: ${timezoneMode}. Click to cycle.`}
            className="text-[9px] lg:text-[10px] font-bold text-teal-400 hover:text-teal-200 active:scale-95 transition-all leading-none whitespace-nowrap"
          >
            {TZ_LABELS[timezoneMode]}
          </button>
        </th>
        {times.map((t, i) => {
          const isNow = t.startsWith(nowHour);
          return (
            <th
              key={i}
              scope="col"
              className={`text-[10px] lg:text-xs font-semibold py-1 cursor-pointer transition-colors relative ${
                t === selectedHour
                  ? "text-white bg-teal-600"
                  : isNow
                  ? "text-teal-100 bg-teal-700/70 font-bold"
                  : "ow-hour-cell"
              }`}
              onClick={() => onSelectHour(t)}
            >
              {formatHour(t, timezoneMode)}
              {isNow && (
                <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-teal-400" />
              )}
            </th>
          );
        })}
      </tr>
    </>
  );
}
