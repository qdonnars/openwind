import { formatHour } from "../utils/format";
import type { ModelForecast } from "../types";
import type { TimezoneMode } from "../hooks/useTimezone";


interface TimelineHeaderProps {
  times: string[];
  selectedHour: string | null;
  onSelectHour: (time: string) => void;
  forecasts: ModelForecast[];
  nowHour: string;
  timezoneMode: TimezoneMode;
  visibleDay: string; // ISO date "2025-04-26" of leftmost visible day
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

function formatStickyDay(isoDate: string): [string, string] {
  if (!isoDate) return ["", ""];
  const d = new Date(isoDate + "T12:00:00Z");
  const weekday = d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }).toUpperCase();
  const day = d.toLocaleDateString("en-US", { day: "numeric", timeZone: "UTC" });
  return [weekday, day];
}

export function TimelineHeader({
  times,
  selectedHour,
  onSelectHour,
  forecasts,
  nowHour,
  timezoneMode,
  visibleDay,
}: TimelineHeaderProps) {
  function weatherCode(timeStr: string): number | null {
    for (const f of forecasts) {
      const idx = f.hourly.time.indexOf(timeStr);
      if (idx !== -1 && f.hourly.weather_code?.[idx] != null) {
        return f.hourly.weather_code[idx];
      }
    }
    return null;
  }

  // Mark the first column of each new day for subtle separators
  const dayStarts = new Set<string>();
  let prevDay = "";
  for (const t of times) {
    const day = t.slice(0, 10);
    if (day !== prevDay) { dayStarts.add(t); prevDay = day; }
  }

  const [weekday, dayNum] = formatStickyDay(visibleDay);

  return (
    <>
      {/* Row 1: weather icons — sticky left spans both rows, shows day */}
      <tr>
        <td
          rowSpan={2}
          className="sticky left-0 z-20 min-w-[56px] px-2 border-r border-b"
          style={{ background: 'var(--ow-bg-1)', borderColor: 'var(--ow-line-2)' }}
        >
          <div className="flex flex-col items-center justify-center h-full leading-none gap-[2px]">
            <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: 'var(--ow-accent)' }}>
              {weekday}
            </span>
            <span className="text-[14px] font-bold tabular-nums" style={{ color: 'var(--ow-fg-0)' }}>
              {dayNum}
            </span>
          </div>
        </td>
        {times.map((t, i) => (
          <td
            key={i}
            className="text-center p-0 ow-tbl-bg cursor-pointer leading-none"
            style={{
              fontSize: "13px",
              lineHeight: "20px",
              borderLeft: dayStarts.has(t) && i > 0 ? '1px solid var(--ow-line-2)' : undefined,
            }}
            onClick={() => onSelectHour(t)}
          >
            {wmoIcon(weatherCode(t))}
          </td>
        ))}
      </tr>

      {/* Row 2: hour numbers — no sticky left (spanned by row above) */}
      <tr>
        {times.map((t, i) => {
          const isNow = t.startsWith(nowHour);
          const isDayStart = dayStarts.has(t) && i > 0;
          return (
            <th
              key={i}
              scope="col"
              className={`text-[10px] lg:text-xs font-semibold py-1 cursor-pointer transition-colors relative border-b ${
                t === selectedHour
                  ? "text-white bg-teal-600"
                  : isNow
                  ? "text-teal-100 bg-teal-700/70 font-bold"
                  : "ow-hour-cell"
              }`}
              style={{
                borderColor: 'var(--ow-line-2)',
                borderLeft: isDayStart ? '1px solid var(--ow-line-2)' : undefined,
              }}
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
