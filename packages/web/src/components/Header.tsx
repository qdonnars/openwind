import type { Spot } from "../types";
import { SpotSearch } from "./SpotSearch";
import { ThemeToggle } from "../design/theme";


interface HeaderProps {
  onSelectSpot: (spot: Spot) => void;
  canSave: boolean;
  onSave: () => void;
}

function WindIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--ow-accent)' }}>
      <path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2" />
      <path d="M9.6 4.6A2 2 0 1 1 11 8H2" />
      <path d="M12.6 19.4A2 2 0 1 0 14 16H2" />
    </svg>
  );
}

export function Header({
  onSelectSpot,
  canSave,
  onSave,
}: HeaderProps) {
  return (
    <header
      className="sticky top-0 z-30 backdrop-blur-lg px-3 py-2 lg:px-6"
      style={{ background: 'var(--ow-surface-glass)', borderBottom: '1px solid var(--ow-accent-line)' }}
    >
      <div className="flex items-center gap-3 max-w-screen-2xl mx-auto">
        <div className="flex items-center gap-2 shrink-0">
          <WindIcon />
          <h1 className="hidden sm:block text-xl font-extrabold tracking-tight">
            <span style={{ color: 'var(--ow-fg-0)' }}>Open</span>
            <span style={{ color: 'var(--ow-accent)' }}>Wind</span>
          </h1>
        </div>
        <div className="flex-1 flex justify-center">
          <SpotSearch onSelect={onSelectSpot} />
        </div>
        {canSave && (
          <button
            onClick={onSave}
            className="shrink-0 min-h-[44px] px-4 rounded-xl bg-teal-500/15 text-teal-300 text-sm font-semibold hover:bg-teal-500/25 active:bg-teal-500/35 active:scale-95 transition-all whitespace-nowrap border border-teal-500/30"
          >
            + Save
          </button>
        )}
        <ThemeToggle />
      </div>
    </header>
  );
}
