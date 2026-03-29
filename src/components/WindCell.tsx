import { WindArrow } from "./WindArrow";
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
        className={`wind-cell min-w-[44px] lg:min-w-[52px] h-10 lg:h-14 bg-gray-800/40 text-center text-gray-600 text-xs align-middle cursor-pointer ${nowBorder} ${selectedStyle}`}
        onClick={onSelect}
      >
        —
      </td>
    );
  }

  const bg = getWindColor(speed);
  const color = getTextColor(speed);

  return (
    <td
      role="cell"
      className={`wind-cell min-w-[44px] lg:min-w-[52px] h-10 lg:h-14 text-center align-middle p-0 cursor-pointer ${nowBorder} ${selectedStyle}`}
      style={{ backgroundColor: bg, color }}
      onClick={onSelect}
      aria-label={`${Math.round(speed)} knots${gusts != null ? `, gusts ${Math.round(gusts)}` : ""}${direction != null ? `, direction ${direction}°` : ""}`}
    >
      <div className="flex flex-col items-center leading-none gap-0.5">
        <div className="flex items-center gap-0.5">
          {direction != null && <WindArrow degrees={direction} />}
          <span className="text-[17px] lg:text-[20px] font-bold">{Math.round(speed)}</span>
        </div>
        {gusts != null && (
          <span className="text-[11px] lg:text-[12px] opacity-85 font-semibold">{Math.round(gusts)}</span>
        )}
      </div>
    </td>
  );
}
