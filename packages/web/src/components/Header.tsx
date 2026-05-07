import { useEffect, useState } from "react";
import type { Spot } from "../types";
import { SpotSearch } from "./SpotSearch";
import { ThemeToggle } from "../design/theme";
import { InfoPanel } from "./InfoPanel";


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

function InfoIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

function InfoModal({ onClose }: { onClose: () => void }) {
  // Close on Escape; restore body scroll on unmount.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-end lg:items-center justify-center animate-fade-in"
      onClick={onClose}
      style={{ background: "rgba(0,0,0,0.6)" }}
      role="dialog"
      aria-modal="true"
      aria-label="À propos d'OpenWind"
    >
      <div
        className="relative w-full lg:max-w-2xl max-h-[92vh] overflow-y-auto rounded-t-2xl lg:rounded-2xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--ow-bg-0)",
          border: "1px solid var(--ow-line)",
        }}
      >
        <button
          onClick={onClose}
          aria-label="Fermer"
          className="absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center text-base font-semibold transition-colors"
          style={{
            background: "var(--ow-bg-1)",
            color: "var(--ow-fg-1)",
            border: "1px solid var(--ow-line)",
          }}
        >
          ✕
        </button>
        <InfoPanel />
      </div>
    </div>
  );
}

export function Header({
  onSelectSpot,
  canSave,
  onSave,
}: HeaderProps) {
  const [showInfo, setShowInfo] = useState(false);
  return (
    <>
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
          <button
            onClick={() => setShowInfo(true)}
            aria-label="À propos d'OpenWind"
            title="À propos"
            className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-all hover:scale-105 active:scale-95"
            style={{
              background: 'var(--ow-accent-soft)',
              color: 'var(--ow-accent)',
              border: '1px solid var(--ow-accent-line)',
            }}
          >
            <InfoIcon />
          </button>
          <ThemeToggle />
        </div>
      </header>
      {showInfo && <InfoModal onClose={() => setShowInfo(false)} />}
    </>
  );
}
