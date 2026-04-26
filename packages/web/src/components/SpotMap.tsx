import { useEffect, useRef, useCallback, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Spot, ModelForecast } from "../types";
import { QUICK_SPOTS } from "../spots";
import { getWindColor } from "../utils/colors";

function createArrowSvg(
  degrees: number,
  speed: number,
  color: string,
  label: string,
  length: number
): string {
  const bg = getWindColor(speed);
  const rad = ((degrees + 180) * Math.PI) / 180;
  const tipX = 150 + Math.sin(rad) * length;
  const tipY = 150 - Math.cos(rad) * length;
  const headLen = 8;
  const headAng = 0.4;
  const lx = tipX - headLen * Math.sin(rad - headAng);
  const ly = tipY + headLen * Math.cos(rad - headAng);
  const rx = tipX - headLen * Math.sin(rad + headAng);
  const ry = tipY + headLen * Math.cos(rad + headAng);
  const lblX = tipX + Math.sin(rad) * 14;
  const lblY = tipY - Math.cos(rad) * 14;

  return `<svg width="300" height="300" viewBox="0 0 300 300" style="overflow:visible;position:absolute;top:0;left:0">
    <line x1="150" y1="150" x2="${tipX}" y2="${tipY}" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>
    <polygon points="${tipX},${tipY} ${lx},${ly} ${rx},${ry}" fill="${color}"/>
    <text x="${lblX}" y="${lblY}" text-anchor="middle" dominant-baseline="middle"
      font-size="9" font-weight="700" fill="#fff"
      style="text-shadow:0 0 3px #000,0 0 6px #000">${Math.round(speed)}</text>
    <text x="${lblX}" y="${lblY + 11}" text-anchor="middle" dominant-baseline="middle"
      font-size="7" fill="${bg}"
      style="text-shadow:0 0 3px #000">${label}</text>
  </svg>`;
}

async function reverseGeocode(lat: number, lon: number): Promise<string> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=10`,
      { headers: { "Accept-Language": "fr" } }
    );
    const data = await res.json();
    const addr = data.address || {};
    return (
      addr.city ||
      addr.town ||
      addr.village ||
      addr.municipality ||
      addr.county ||
      data.display_name?.split(",")[0] ||
      `${lat.toFixed(3)}, ${lon.toFixed(3)}`
    );
  } catch {
    return `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
  }
}

interface SpotMapProps {
  current: Spot;
  customSpots: Spot[];
  onSelectSpot: (spot: Spot) => void;
  onAddSpot: (spot: Spot) => void;
  onRemoveSpot: (spot: Spot) => void;
  onRenameSpot: (spot: Spot, name: string) => void;
  forecasts: ModelForecast[];
  selectedHour: string | null;
}

function spotKey(s: Spot) {
  return `${s.latitude},${s.longitude}`;
}

export function SpotMap({
  current,
  customSpots,
  onSelectSpot,
  onAddSpot,
  onRemoveSpot,
  onRenameSpot,
  forecasts,
  selectedHour,
}: SpotMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Map<string, L.CircleMarker>>(new Map());
  const arrowLayerRef = useRef<L.Marker | null>(null);
  const onSelectRef = useRef(onSelectSpot);
  onSelectRef.current = onSelectSpot;
  const onAddRef = useRef(onAddSpot);
  onAddRef.current = onAddSpot;
  const onRemoveRef = useRef(onRemoveSpot);
  onRemoveRef.current = onRemoveSpot;
  const onRenameRef = useRef(onRenameSpot);
  onRenameRef.current = onRenameSpot;

  // pendingSpot: creating a new spot or renaming an existing one
  const [pendingSpot, setPendingSpot] = useState<{
    lat: number;
    lng: number;
    name: string;
    editingSpot?: Spot;
  } | null>(null);
  const setPendingRef = useRef(setPendingSpot);
  setPendingRef.current = setPendingSpot;

  // pendingEdit: long-pressed an existing marker → show rename/delete choice
  const [pendingEdit, setPendingEdit] = useState<Spot | null>(null);
  const setPendingEditRef = useRef(setPendingEdit);
  setPendingEditRef.current = setPendingEdit;

  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelPressRef = useRef<() => void>(() => {});
  // Maps each marker's SVG element → its spot (for native long-press detection)
  const elementToSpotRef = useRef<Map<Element, Spot>>(new Map());

  // Init map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: false,
    }).setView([current.latitude, current.longitude], 10);

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      maxZoom: 19,
    }).addTo(map);

    L.control.attribution({ position: "bottomright", prefix: false })
      .addAttribution('&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>')
      .addTo(map);

    // Custom pane for wind arrows (below markers)
    map.createPane("windArrows");
    map.getPane("windArrows")!.style.zIndex = "450";

    mapRef.current = map;

    // Long press detection via Pointer Events (covers mouse + touch, one event stream)
    const el = containerRef.current!;
    let startX = 0;
    let startY = 0;

    const cancelPress = () => {
      if (pressTimerRef.current) { clearTimeout(pressTimerRef.current); pressTimerRef.current = null; }
    };
    cancelPressRef.current = cancelPress;

    let activePointers = 0;

    const handlePointerDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      activePointers++;
      if (activePointers > 1) { cancelPress(); return; }

      startX = e.clientX;
      startY = e.clientY;
      const target = e.target as Element;

      // Check if pressing on a known custom marker
      const editSpot = elementToSpotRef.current.get(target);
      if (editSpot) {
        pressTimerRef.current = setTimeout(() => {
          setPendingEditRef.current(editSpot);
        }, 800);
        return;
      }

      // If pressing on any other SVG marker (non-custom), just skip
      const tag = target.tagName.toLowerCase();
      if (tag === "circle" || tag === "path") return;

      // Press on the map background → add new spot
      pressTimerRef.current = setTimeout(async () => {
        const rect = el.getBoundingClientRect();
        const point = L.point(startX - rect.left, startY - rect.top);
        const latlng = map.containerPointToLatLng(point);
        const name = await reverseGeocode(latlng.lat, latlng.lng);
        setPendingRef.current({ lat: latlng.lat, lng: latlng.lng, name });
      }, 800);
    };

    const handlePointerUp = () => {
      activePointers = Math.max(0, activePointers - 1);
      cancelPress();
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (Math.abs(e.clientX - startX) > 10 || Math.abs(e.clientY - startY) > 10) {
        cancelPress();
      }
    };

    el.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    // Create initial markers immediately + fix size after layout
    for (const spot of [...QUICK_SPOTS, ...customSpots]) {
      const key = spotKey(spot);
      const active =
        spot.latitude === current.latitude &&
        spot.longitude === current.longitude;
      const isCustom = customSpots.some((s) => spotKey(s) === key);
      const marker = L.circleMarker([spot.latitude, spot.longitude], {
        radius: active ? 10 : 7,
        color: active ? "#ffffff" : "#9ca3af",
        fillColor: active ? "#2dd4bf" : "#6b7280",
        fillOpacity: active ? 0.9 : 0.6,
        weight: active ? 2.5 : 1,
        bubblingMouseEvents: false,
      })
        .bindTooltip(spot.name, {
          direction: "top",
          offset: [0, -10],
          className: "spot-tooltip",
        })
        .on("click", () => onSelectRef.current(spot))
        .addTo(map);
      if (isCustom) {
        const svgEl = (marker as any)._path as Element | undefined;
        if (svgEl) elementToSpotRef.current.set(svgEl, spot);
      }
      markersRef.current.set(key, marker);
    }

    setTimeout(() => map.invalidateSize(), 200);

    // Re-invalidate map when container resizes (e.g. mobile collapse, desktop layout)
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el);

    return () => {
      cancelPress();
      ro.disconnect();
      el.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  const syncMarkers = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    const allSpots = [...QUICK_SPOTS, ...customSpots];
    const desiredKeys = new Set(allSpots.map(spotKey));

    // Remove old markers
    for (const [key, marker] of markersRef.current) {
      if (!desiredKeys.has(key)) {
        const svgEl = (marker as any)._path as Element | undefined;
        if (svgEl) elementToSpotRef.current.delete(svgEl);
        marker.remove();
        markersRef.current.delete(key);
      }
    }

    // Add or update
    for (const spot of allSpots) {
      const key = spotKey(spot);
      const active =
        spot.latitude === current.latitude &&
        spot.longitude === current.longitude;
      const style = {
        radius: active ? 10 : 7,
        color: active ? "#ffffff" : "#9ca3af",
        fillColor: active ? "#2dd4bf" : "#6b7280",
        fillOpacity: active ? 0.9 : 0.6,
        weight: active ? 2.5 : 1,
      };

      const isCustom = customSpots.some((cs) => spotKey(cs) === key);
      let marker = markersRef.current.get(key);
      if (!marker) {
        const s = spot;
        marker = L.circleMarker([s.latitude, s.longitude], {
          ...style,
          bubblingMouseEvents: false,
        })
          .bindTooltip(s.name, {
            direction: "top",
            offset: [0, -10],
            className: "spot-tooltip",
          })
          .on("click", () => onSelectRef.current(s))
          .addTo(map);
        if (isCustom) {
          const svgEl = (marker as any)._path as Element | undefined;
          if (svgEl) elementToSpotRef.current.set(svgEl, s);
        }
        markersRef.current.set(key, marker);
      } else {
        marker.setStyle(style);
      }
    }
  }, [current, customSpots]);

  // Sync markers on changes
  useEffect(() => {
    if (!mapRef.current) return;
    syncMarkers();
    mapRef.current.setView([current.latitude, current.longitude], 10, { animate: true });
  }, [current, customSpots, syncMarkers]);

  // Wind arrows
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (arrowLayerRef.current) {
      arrowLayerRef.current.remove();
      arrowLayerRef.current = null;
    }

    if (!selectedHour || forecasts.length === 0) return;

    let svgContent = "";
    for (const forecast of forecasts) {
      const timeIdx = forecast.hourly.time.indexOf(selectedHour);
      if (timeIdx === -1) continue;
      const dir = forecast.hourly.wind_direction_10m[timeIdx];
      const spd = forecast.hourly.wind_speed_10m[timeIdx];
      if (dir == null || spd == null) continue;
      const color = "#ffffff";
      const length = Math.min(36 + spd * 2.4, 120);
      svgContent += createArrowSvg(dir, spd, color, forecast.modelName, length);
    }

    if (!svgContent) return;

    const icon = L.divIcon({
      html: `<div style="position:relative;width:300px;height:300px;pointer-events:none">${svgContent}</div>`,
      className: "",
      iconSize: [300, 300],
      iconAnchor: [150, 150],
    });

    arrowLayerRef.current = L.marker([current.latitude, current.longitude], {
      icon,
      interactive: false,
      pane: "windArrows",
    }).addTo(map);
  }, [selectedHour, forecasts, current]);

  return (
    <div className="w-full h-full relative">
      <div ref={containerRef} className="w-full h-full overflow-hidden" />
      {/* Marker long-press: rename or delete */}
      {pendingEdit && (
        <div className="absolute inset-0 flex items-center justify-center z-[1000] bg-black/50 backdrop-blur-sm animate-fade-in" role="dialog" aria-label="Spot options">
          <div className="bg-gray-800/95 backdrop-blur rounded-xl p-5 mx-4 w-full max-w-xs shadow-2xl border border-gray-700/50 animate-modal-in">
            <p className="text-white text-sm font-semibold mb-1">{pendingEdit.name}</p>
            <p className="text-gray-400 text-xs mb-4">
              {pendingEdit.latitude.toFixed(4)}, {pendingEdit.longitude.toFixed(4)}
            </p>
            <div className="flex flex-col gap-2">
              <button
                className="w-full min-h-[44px] py-2.5 rounded-lg bg-gray-700 text-white text-sm font-medium hover:bg-gray-600 active:bg-gray-500 active:scale-[0.98] transition-all"
                onClick={() => {
                  const s = pendingEdit;
                  setPendingEdit(null);
                  setPendingSpot({ lat: s.latitude, lng: s.longitude, name: s.name, editingSpot: s });
                }}
              >
                Rename
              </button>
              <button
                className="w-full min-h-[44px] py-2.5 rounded-lg bg-red-700/80 text-white text-sm font-medium hover:bg-red-600 active:bg-red-500 active:scale-[0.98] transition-all"
                onClick={() => {
                  onRemoveRef.current(pendingEdit);
                  setPendingEdit(null);
                }}
              >
                Delete
              </button>
              <button
                className="w-full min-h-[44px] py-2.5 rounded-lg border border-gray-600 text-gray-300 text-sm hover:bg-gray-700/50 hover:text-gray-200 active:scale-[0.98] transition-all"
                onClick={() => setPendingEdit(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New spot / rename spot */}
      {pendingSpot && (
        <div className="absolute inset-0 flex items-center justify-center z-[1000] bg-black/50 backdrop-blur-sm animate-fade-in" role="dialog" aria-label={pendingSpot.editingSpot ? "Rename spot" : "New spot"}>
          <div className="bg-gray-800/95 backdrop-blur rounded-xl p-5 mx-4 w-full max-w-xs shadow-2xl border border-gray-700/50 animate-modal-in">
            <p className="text-white text-sm font-semibold mb-1">
              {pendingSpot.editingSpot ? "Rename spot" : "New spot"}
            </p>
            <p className="text-gray-400 text-xs mb-3">
              {pendingSpot.lat.toFixed(4)}, {pendingSpot.lng.toFixed(4)}
            </p>
            <input
              className="w-full bg-gray-700 text-white text-sm rounded-lg px-3 py-2.5 mb-4 outline-none border border-gray-600 focus:border-teal-500 focus:ring-1 focus:ring-teal-500/30 transition-colors"
              value={pendingSpot.name}
              onChange={(e) => setPendingSpot({ ...pendingSpot, name: e.target.value })}
              autoFocus
              aria-label="Spot name"
            />
            <div className="flex gap-2">
              <button
                className="flex-1 min-h-[44px] py-2.5 rounded-lg border border-gray-600 text-gray-300 text-sm font-medium hover:bg-gray-700/50 hover:text-gray-200 active:scale-[0.98] transition-all"
                onClick={() => setPendingSpot(null)}
              >
                Cancel
              </button>
              <button
                className="flex-1 min-h-[44px] py-2.5 rounded-lg bg-teal-600 text-white text-sm font-semibold hover:bg-teal-500 active:scale-[0.98] transition-all"
                onClick={() => {
                  if (pendingSpot.editingSpot) {
                    onRenameRef.current(pendingSpot.editingSpot, pendingSpot.name);
                  } else {
                    onAddRef.current({
                      name: pendingSpot.name,
                      latitude: pendingSpot.lat,
                      longitude: pendingSpot.lng,
                    });
                  }
                  setPendingSpot(null);
                }}
              >
                {pendingSpot.editingSpot ? "Rename" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
