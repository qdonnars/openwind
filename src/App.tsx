import { useState, useEffect } from "react";
import type { Spot, ModelForecast } from "./types";
import { fetchAllModels } from "./api/openmeteo";
import { useCustomSpots } from "./hooks/useCustomSpots";
import { Header } from "./components/Header";
import { WindTable } from "./components/WindTable";
import { SpotMap } from "./components/SpotMap";

function App() {
  const [spot, setSpot] = useState<Spot | null>(null);
  const [forecasts, setForecasts] = useState<ModelForecast[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedHour, setSelectedHour] = useState<string | null>(null);
  const { customSpots, addSpot, removeSpot, isCustom } = useCustomSpots();

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

  // Default map center: Marseille area
  const mapCenter: Spot = spot ?? { name: "", latitude: 43.2, longitude: 5.7 };

  return (
    <div className="h-screen flex flex-col bg-gray-950 text-white overflow-hidden">
      <Header
        onSelectSpot={setSpot}
        canSave={canSave}
        isSaved={isSaved}
        onSave={() => spot && addSpot(spot)}
        onRemove={() => spot && removeSpot(spot)}
      />

      <div className="flex-1 min-h-0">
        <SpotMap
          current={mapCenter}
          customSpots={customSpots}
          onSelectSpot={setSpot}
          onAddSpot={(s) => { addSpot(s); setSpot(s); }}
          forecasts={forecasts}
          selectedHour={selectedHour}
        />
      </div>

      <div className="shrink-0">
        {spot ? (
          <WindTable
            forecasts={forecasts}
            isLoading={isLoading}
            selectedHour={selectedHour}
            onSelectHour={setSelectedHour}
          />
        ) : (
          <div className="text-gray-500 text-center py-4 text-sm">
            Appuie longuement sur la carte pour ajouter un spot
          </div>
        )}
        <footer className="text-center text-gray-600 text-[10px] py-1 border-t border-gray-800">
          <a
            href="https://open-meteo.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-gray-400"
          >
            Open-Meteo.com
          </a>{" "}
          (CC BY 4.0)
        </footer>
      </div>
    </div>
  );
}

export default App;
