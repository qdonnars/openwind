import { useState, useEffect } from "react";
import type { Spot, ModelForecast } from "./types";
import { fetchAllModels } from "./api/openmeteo";
import { useCustomSpots } from "./hooks/useCustomSpots";
import { Header } from "./components/Header";
import { WindTable } from "./components/WindTable";
import { SpotMap } from "./components/SpotMap";

const RADE_MARSEILLE: Spot = { name: "", latitude: 43.3, longitude: 5.35 };

function EmptyState() {
  return (
    <div className="flex items-center justify-center h-full px-6">
      <div className="text-center py-10 max-w-xs mx-auto">
        <div className="mb-4 inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-teal-500/10 animate-empty-pulse">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-teal-400">
            <path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2" />
            <path d="M9.6 4.6A2 2 0 1 1 11 8H2" />
            <path d="M12.6 19.4A2 2 0 1 0 14 16H2" />
          </svg>
        </div>
        <p className="text-gray-200 text-base font-semibold mb-1.5">
          Add a spot
        </p>
        <p className="text-gray-400 text-sm leading-relaxed">
          <span className="lg:hidden">Long press on the map to place a wind spot</span>
          <span className="hidden lg:inline">Long click on the map to place a wind spot</span>
        </p>
      </div>
    </div>
  );
}

function MapToggle({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={`lg:hidden z-20 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-gray-300 text-xs font-medium border border-gray-700/60 hover:bg-gray-800 active:scale-95 transition-all ${
        collapsed
          ? "mx-2 mt-1.5 mb-0.5 bg-gray-800/80"
          : "absolute bottom-2 right-2 bg-gray-900/90 backdrop-blur"
      }`}
      aria-label={collapsed ? "Expand map" : "Collapse map"}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        {collapsed ? (
          <><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></>
        ) : (
          <><path d="M4 14h6v6M14 4h6v6M10 14l-7 7M20 4l-6 6" /></>
        )}
      </svg>
      {collapsed ? "Map" : "Collapse"}
    </button>
  );
}

function App() {
  const { customSpots, addSpot, removeSpot, renameSpot, isCustom } = useCustomSpots();
  const [spot, setSpot] = useState<Spot | null>(() => customSpots[0] ?? null);
  const [forecasts, setForecasts] = useState<ModelForecast[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedHour, setSelectedHour] = useState<string | null>(null);
  const [mapCollapsed, setMapCollapsed] = useState(false);

  useEffect(() => {
    if (!spot) return;
    let cancelled = false;
    setIsLoading(true);
    setSelectedHour(null);
    fetchAllModels(spot.latitude, spot.longitude).then((data) => {
      if (!cancelled) {
        setForecasts(data);
        setIsLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [spot]);

  const canSave = spot != null && !isCustom(spot);
  const isSaved = spot != null && isCustom(spot);

  const mapCenter: Spot = spot ?? RADE_MARSEILLE;

  return (
    <div className="h-screen flex flex-col bg-gray-950 text-white overflow-hidden">
      <Header
        onSelectSpot={setSpot}
        canSave={canSave}
        isSaved={isSaved}
        onSave={() => spot && addSpot(spot)}
        onRemove={() => spot && removeSpot(spot)}
      />

      {/* Mobile: stacked / Tablet: stacked smaller / Desktop: side by side */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
        {/* Map — collapsible on mobile, sidebar on desktop */}
        <div className="relative shrink-0 lg:contents">
          <div className={`overflow-hidden border-b border-gray-700/50 lg:border-b-0 lg:border-r lg:border-r-gray-700/50 transition-[height] duration-300 ease-in-out ${
            mapCollapsed ? "h-0 border-b-0" : "h-[30vh] md:h-[32vh]"
          } lg:h-full lg:w-[35%] lg:max-w-[480px] lg:min-w-[340px]`}>
            <SpotMap
              current={mapCenter}
              customSpots={customSpots}
              onSelectSpot={setSpot}
              onAddSpot={(s) => { addSpot(s); setSpot(s); }}
              onRemoveSpot={(s) => { removeSpot(s); if (spot?.latitude === s.latitude && spot?.longitude === s.longitude) setSpot(null); }}
              onRenameSpot={(s, name) => { renameSpot(s, name); if (spot?.latitude === s.latitude && spot?.longitude === s.longitude) setSpot({ ...s, name }); }}
              forecasts={forecasts}
              selectedHour={selectedHour}
            />
          </div>
          <MapToggle collapsed={mapCollapsed} onToggle={() => setMapCollapsed((v) => !v)} />
        </div>

        {/* Wind data — main content */}
        <div className="flex-1 min-h-0 flex flex-col min-w-0 bg-gray-950">
          <div className="flex-1 min-h-0 overflow-y-auto">
            {spot ? (
              <WindTable
                forecasts={forecasts}
                isLoading={isLoading}
                selectedHour={selectedHour}
                onSelectHour={setSelectedHour}
                spotName={spot?.name}
              />
            ) : (
              <EmptyState />
            )}
          </div>
          <footer className="text-center text-gray-400 text-[11px] py-1 shrink-0">
            Data by{" "}
            <a
              href="https://open-meteo.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-gray-200 transition-colors"
            >
              Open-Meteo.com
            </a>{" "}
            (CC BY 4.0)
          </footer>
        </div>
      </div>
    </div>
  );
}

export default App;
