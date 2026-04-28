import { useState, useEffect } from "react";
import { nowParisHourPrefix } from "./utils/format";
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
        <p className="text-base font-semibold mb-1.5" style={{ color: 'var(--ow-fg-0)' }}>
          Add a spot
        </p>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--ow-fg-1)' }}>
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
        const nowHour = nowParisHourPrefix();
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
    <div
      className="h-screen flex flex-col overflow-hidden"
      style={{ background: 'var(--ow-bg-0)', color: 'var(--ow-fg-0)' }}
    >
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
          {/* Plan FAB */}
          <a
            href="/plan"
            className="absolute top-3 left-3 z-[400] w-10 h-10 rounded-full flex items-center justify-center shadow-lg transition-transform hover:scale-105 active:scale-95"
            style={{ background: "var(--ow-accent)", color: "#fff" }}
            title="Planifier un passage"
          >
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 12 L8 2 L14 12" /><path d="M5 8 L11 8" />
            </svg>
          </a>
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
        <div
          className="shrink-0 max-h-[38vh] md:max-h-[40vh] overflow-y-auto"
          style={{ background: 'var(--ow-bg-0)', borderTop: '1px solid var(--ow-line)' }}
        >
          {spot ? (
            <WindTable
              forecasts={forecasts}
              isLoading={isLoading}
              selectedHour={selectedHour}
              onSelectHour={setSelectedHour}
            />
          ) : (
            <EmptyState />
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
