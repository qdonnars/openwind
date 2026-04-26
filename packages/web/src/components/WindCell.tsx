import { getWindColor, getTextColor } from "../utils/colors";

interface WindCellProps {
  speed: number | null;
  gusts: number | null;
  direction: number | null;
  selected: boolean;
  isNow: boolean;
  onSelect: () => void;
}

export function WindCell({ speed, gusts, direction, selected, isNow, onSelect }: WindCellProps) {
  const nowBorder = isNow ? "border-l-2 border-l-teal-400" : "";
  const selectedStyle = selected ? "ring-2 ring-teal-400/70 ring-inset bg-teal-400/10" : "";

  if (speed == null) {
    return (
      <td
        role="cell"
        className={`wind-cell min-w-[44px] lg:min-w-[52px] h-12 lg:h-16 bg-gray-800/40 text-center text-gray-600 text-xs align-middle cursor-pointer ${nowBorder} ${selectedStyle}`}
        onClick={onSelect}
      >
        —
      </td>
    );
  }

  const bg = getWindColor(speed);
  const color = getTextColor(speed);

  // Gusts are visually subdued when close to wind speed (within 5 kn)
  const gustClose = gusts != null && gusts <= speed + 5;
  const gustOpacity = gustClose ? "opacity-70" : "opacity-90";

  return (
    <td
      role="cell"
      className={`wind-cell min-w-[44px] lg:min-w-[52px] h-12 lg:h-16 text-center align-middle p-0 cursor-pointer ${nowBorder} ${selectedStyle}`}
      style={{ backgroundColor: bg, color }}
      onClick={onSelect}
      aria-label={`${Math.round(speed)} knots${gusts != null ? `, gusts ${Math.round(gusts)}` : ""}${direction != null ? `, direction ${direction}°` : ""}`}
    >
      <div className="flex flex-col items-center justify-center leading-none gap-[3px]">
        {/* Row 1: arrow + speed (dominant) */}
        <div className="flex items-center gap-0.5">
          {direction != null && (
            <svg
              width="14"
              height="14"
              className="lg:w-4 lg:h-4 shrink-0"
              viewBox="0 0 16 16"
              style={{ transform: `rotate(${direction + 180}deg)`, transition: "transform 0.3s ease" }}
            >
              <polygon points="8,1 13,15 8,10 3,15" fill="currentColor" />
            </svg>
          )}
          <span className="text-[22px] lg:text-[26px] font-bold tabular-nums leading-none">
            {Math.round(speed)}
          </span>
        </div>
        {/* Row 2: gust, smaller, slightly subdued */}
        {gusts != null && (
          <span
            className={`text-[12px] lg:text-[13px] font-semibold tabular-nums leading-none ${gustOpacity}`}
          >
            ↑{Math.round(gusts)}
          </span>
        )}
      </div>
    </td>
  );
}
