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
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
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
          className="w-full pl-9 pr-3 py-2.5 min-h-[44px] bg-gray-800/80 border border-gray-700/60 rounded-xl text-sm text-white placeholder-gray-500 focus:outline-none focus:border-teal-500/60 focus:ring-1 focus:ring-teal-500/20 transition-all"
        />
      </div>
      {open && (
        <ul className="absolute top-full left-0 right-0 mt-1.5 bg-gray-800 border border-gray-700/60 rounded-xl overflow-hidden z-50 shadow-2xl animate-fade-in">
          {results.map((r) => (
            <li
              key={r.id}
              onClick={() => handleSelect(r)}
              className="px-3 py-2.5 min-h-[44px] flex items-center hover:bg-gray-700/80 active:bg-gray-600 cursor-pointer text-sm transition-colors border-b border-gray-700/30 last:border-b-0"
            >
              <span className="text-white font-medium">{r.name}</span>
              {r.admin1 && (
                <span className="text-gray-400">, {r.admin1}</span>
              )}
              <span className="text-gray-500"> — {r.country}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
