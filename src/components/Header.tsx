import type { Spot } from "../types";
import { SpotSearch } from "./SpotSearch";

interface HeaderProps {
  onSelectSpot: (spot: Spot) => void;
  canSave: boolean;
  isSaved: boolean;
  onSave: () => void;
  onRemove: () => void;
}

function WindIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="text-teal-400">
      <path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2" />
      <path d="M9.6 4.6A2 2 0 1 1 11 8H2" />
      <path d="M12.6 19.4A2 2 0 1 0 14 16H2" />
    </svg>
  );
}

export function Header({
  onSelectSpot,
  canSave,
  isSaved,
  onSave,
  onRemove,
}: HeaderProps) {
  return (
    <header className="sticky top-0 z-30 bg-gray-950/95 backdrop-blur-lg border-b border-gray-800/60 px-3 py-2 lg:px-6">
      <div className="flex items-center gap-3 max-w-screen-2xl mx-auto">
        <div className="flex items-center gap-2 shrink-0">
          <WindIcon />
          <h1 className="text-xl font-extrabold tracking-tight">
            <span className="text-white">Open</span>
            <span className="text-teal-400">Wind</span>
          </h1>
        </div>
        <SpotSearch onSelect={onSelectSpot} />
        {isSaved && (
          <button
            onClick={onRemove}
            className="shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl bg-gray-800/80 text-red-400 hover:bg-red-900/60 active:bg-red-900 active:scale-95 transition-all"
            title="Supprimer ce spot"
            aria-label="Supprimer ce spot"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        )}
        {canSave && (
          <button
            onClick={onSave}
            className="shrink-0 min-h-[44px] px-4 rounded-xl bg-teal-500/15 text-teal-300 text-sm font-semibold hover:bg-teal-500/25 active:bg-teal-500/35 active:scale-95 transition-all whitespace-nowrap border border-teal-500/30"
          >
            + Save
          </button>
        )}
      </div>
    </header>
  );
}
