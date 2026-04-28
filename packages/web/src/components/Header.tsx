import type { Spot } from "../types";
import { SpotSearch } from "./SpotSearch";
import { ThemeToggle } from "../design/theme";

function getLastTrip(): string | null {
  const match = document.cookie.split(";").find((c) => c.trim().startsWith("ow_last_trip="));
  if (!match) return null;
  try {
    return decodeURIComponent(match.split("=").slice(1).join("=").trim());
  } catch {
    return null;
  }
}

function PlanTab() {
  const lastTrip = getLastTrip();
  if (lastTrip) {
    return (
      <a
        href={lastTrip}
        className="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors"
        style={{ color: "var(--ow-accent)", background: "var(--ow-accent-soft)", border: "1px solid var(--ow-accent-line)" }}
      >
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 12 L8 2 L14 12" /><path d="M5 8 L11 8" />
        </svg>
        Plan
      </a>
    );
  }
  return (
    <span
      className="shrink-0 hidden sm:flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold cursor-default select-none"
      style={{ color: "var(--ow-fg-3)", border: "1px solid var(--ow-line)" }}
      title="Pas encore de plan. Génère-en un via Claude Desktop ou un assistant MCP."
    >
      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 12 L8 2 L14 12" /><path d="M5 8 L11 8" />
      </svg>
      Plan
    </span>
  );
}

interface HeaderProps {
  onSelectSpot: (spot: Spot) => void;
  canSave: boolean;
  isSaved: boolean;
  onSave: () => void;
  onRemove: () => void;
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
  isSaved,
  onSave,
  onRemove,
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
        <PlanTab />
        <div className="flex-1 flex justify-center">
          <SpotSearch onSelect={onSelectSpot} />
        </div>
        {isSaved && (
          <button
            onClick={onRemove}
            className="shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl bg-red-700/20 text-red-400 hover:bg-red-700/40 active:bg-red-700/60 active:scale-95 transition-all border border-red-700/30"
            title="Delete this spot"
            aria-label="Delete this spot"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
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
        <ThemeToggle />
      </div>
    </header>
  );
}
