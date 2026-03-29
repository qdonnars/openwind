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

  if (speed == null) {
    return (
      <td
        className={`wind-cell min-w-[44px] h-12 bg-gray-800/40 text-center text-gray-600 text-xs align-middle cursor-pointer ${nowBorder} ${
          selected ? "outline outline-2 outline-teal-400 -outline-offset-1" : ""
        }`}
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
      className={`wind-cell min-w-[44px] h-12 text-center align-middle p-0 cursor-pointer ${nowBorder} ${
        selected ? "outline outline-2 outline-teal-400 -outline-offset-1" : ""
      }`}
      style={{ backgroundColor: bg, color }}
      onClick={onSelect}
    >
      <div className="flex flex-col items-center leading-none gap-0.5">
        <div className="flex items-center gap-0.5">
          {direction != null && <WindArrow degrees={direction} />}
          <span className="text-[13px] font-bold">{Math.round(speed)}</span>
        </div>
        {gusts != null && (
          <span className="text-[10px] opacity-70 font-medium">{Math.round(gusts)}</span>
        )}
      </div>
    </td>
  );
}
