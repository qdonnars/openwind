import { useState, useRef, useEffect } from "react";
import type { Spot, GeocodingResult } from "../types";
import { searchSpots } from "../api/openmeteo";

interface SpotSearchProps {
  onSelect: (spot: Spot) => void;
}

export function SpotSearch({ onSelect }: SpotSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodingResult[]>([]);
  const [open, setOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function handleChange(value: string) {
    setQuery(value);
    clearTimeout(timerRef.current);
    if (value.length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    timerRef.current = setTimeout(async () => {
      const r = await searchSpots(value);
      setResults(r);
      setOpen(r.length > 0);
    }, 300);
  }

  function handleSelect(r: GeocodingResult) {
    onSelect({
      name: r.name,
      latitude: r.latitude,
      longitude: r.longitude,
      country: r.country,
      admin1: r.admin1,
    });
    setQuery(r.name);
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative w-full max-w-md lg:max-w-lg">
      <div className="relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--ow-fg-2)' }} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.35-4.35" />
        </svg>
        <input
          type="text"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
          placeholder="Search..."
          className="ow-search-input w-full pl-9 pr-3 py-2.5 min-h-[44px] rounded-xl text-sm transition-all"
        />
      </div>
      {open && (
        <ul className="ow-search-dropdown absolute top-full left-0 right-0 mt-1.5 rounded-xl overflow-hidden z-50 animate-fade-in">
          {results.map((r) => (
            <li
              key={r.id}
              onClick={() => handleSelect(r)}
              className="ow-search-item px-3 py-2.5 min-h-[44px] flex items-center cursor-pointer text-sm transition-colors"
            >
              <span className="font-medium" style={{ color: 'var(--ow-fg-0)' }}>{r.name}</span>
              {r.admin1 && (
                <span style={{ color: 'var(--ow-fg-1)' }}>, {r.admin1}</span>
              )}
              <span style={{ color: 'var(--ow-fg-2)' }}> — {r.country}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
