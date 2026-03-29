import { useState, useEffect } from "react";
import type { Spot, ModelForecast } from "./types";
import { fetchAllModels } from "./api/openmeteo";
import { useCustomSpots } from "./hooks/useCustomSpots";
import { Header } from "./components/Header";
import { WindTable } from "./components/WindTable";
import { SpotMap } from "./components/SpotMap";

const RADE_MARSEILLE: Spot = { name: "Rade de Marseille", latitude: 43.3, longitude: 5.35 };

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


function App() {
  const { customSpots, addSpot, removeSpot, renameSpot, isCustom } = useCustomSpots();
  const [spot, setSpot] = useState<Spot | null>(() => customSpots[0] ?? RADE_MARSEILLE);
  const [forecasts, setForecasts] = useState<ModelForecast[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedHour, setSelectedHour] = useState<string | null>(null);


  useEffect(() => {
    if (!spot) return;
    let cancelled = false;
    setIsLoading(true);
    fetchAllModels(spot.latitude, spot.longitude).then((data) => {
      if (!cancelled) {
        setForecasts(data);
        setIsLoading(false);
        // Auto-select current hour so wind arrows show by default
        const nowHour = new Date().toISOString().slice(0, 13);
        const timeline = data[0]?.hourly.time ?? [];
        const match = timeline.find((t) => t.startsWith(nowHour)) ?? timeline.find((t) => t > nowHour) ?? null;
        setSelectedHour(match);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [spot]);

  const isDefault = spot != null && spot.latitude === RADE_MARSEILLE.latitude && spot.longitude === RADE_MARSEILLE.longitude && !isCustom(spot);
  const canSave = spot != null && !isCustom(spot) && !isDefault;
  const isSaved = spot != null && isCustom(spot);

  const mapCenter: Spot = spot ?? RADE_MARSEILLE;

  return (
    <div className="h-screen flex flex-col bg-gray-950 text-white overflow-hidden">
      <Header
        onSelectSpot={setSpot}
        canSave={canSave}
        isSaved={isSaved}
        onSave={() => spot && addSpot(spot)}
        onRemove={() => { if (spot) { removeSpot(spot); setSpot(null); setForecasts([]); setSelectedHour(null); } }}
      />

      {/* Map fills remaining space, table as bottom panel */}
      <div className="flex-1 min-h-0 flex flex-col">
        {/* Map — fills all available space */}
        <div className="flex-1 min-h-0 relative">
          <SpotMap
            current={mapCenter}
            customSpots={customSpots}
            onSelectSpot={setSpot}
            onAddSpot={(s) => { addSpot(s); setSpot(s); }}
            onRemoveSpot={(s) => { removeSpot(s); if (spot?.latitude === s.latitude && spot?.longitude === s.longitude) { setSpot(null); setForecasts([]); setSelectedHour(null); } }}
            onRenameSpot={(s, name) => { renameSpot(s, name); if (spot?.latitude === s.latitude && spot?.longitude === s.longitude) setSpot({ ...s, name }); }}
            forecasts={forecasts}
            selectedHour={selectedHour}
          />
        </div>

        {/* Wind table — bottom panel */}
        <div className="shrink-0 max-h-[45vh] md:max-h-[40vh] overflow-y-auto bg-gray-950 border-t border-gray-700/50">
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
