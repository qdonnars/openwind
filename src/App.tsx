import { useState, useEffect } from "react";
import type { Spot, ModelForecast } from "./types";
import { fetchAllModels } from "./api/openmeteo";
import { useCustomSpots } from "./hooks/useCustomSpots";
import { Header } from "./components/Header";
import { WindTable } from "./components/WindTable";
import { SpotMap } from "./components/SpotMap";

const RADE_MARSEILLE: Spot = { name: "", latitude: 43.3, longitude: 5.35 };

function App() {
  const { customSpots, addSpot, removeSpot, renameSpot, isCustom } = useCustomSpots();
  const [spot, setSpot] = useState<Spot | null>(() => customSpots[0] ?? null);
  const [forecasts, setForecasts] = useState<ModelForecast[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedHour, setSelectedHour] = useState<string | null>(null);

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

      {/* Mobile: stacked (map 35vh, table fills rest) / Desktop: side by side */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
        {/* Map — compact on mobile, sidebar on desktop */}
        <div className="h-[35vh] lg:h-full lg:w-[420px] xl:w-[480px] shrink-0 border-b border-gray-800/60 lg:border-b-0 lg:border-r lg:border-r-gray-800/60">
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

        {/* Wind data — main content */}
        <div className="flex-1 min-h-0 flex flex-col min-w-0">
          <div className="flex-1 min-h-0 overflow-y-auto">
            {spot ? (
              <WindTable
                forecasts={forecasts}
                isLoading={isLoading}
                selectedHour={selectedHour}
                onSelectHour={setSelectedHour}
              />
            ) : (
              <div className="flex items-center justify-center h-full px-6">
                <div className="text-center py-10">
                  <div className="text-3xl mb-3 opacity-60">🗺️</div>
                  <p className="text-gray-300 text-base font-medium mb-1">
                    Appuie longuement sur la carte
                  </p>
                  <p className="text-gray-500 text-sm">
                    pour ajouter un spot de vent
                  </p>
                </div>
              </div>
            )}
          </div>
          <footer className="text-center text-gray-600 text-[10px] py-1 border-t border-gray-800/40 shrink-0">
            <a
              href="https://open-meteo.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-gray-400 transition-colors"
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
