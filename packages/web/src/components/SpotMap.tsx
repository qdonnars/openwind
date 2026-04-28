import { useEffect, useRef, useCallback, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Spot, ModelForecast } from "../types";
import { QUICK_SPOTS } from "../spots";
import { useTheme } from "../design/theme";

// Spot-map wind arrows are drawn into a single 300×300 SVG anchored at the spot
// (centre = 150,150). Each forecast contributes one arrow + one label.
//
// Labels naturally sit just past each arrow tip, in the arrow's direction. When
// two models predict similar directions their tips (and labels) collide. We run
// a small force-based relaxation pass: each pair of overlapping labels pushes
// the other away until none overlap (or we hit max iterations). Labels that
// drift away from their tip get a thin leader line back to it.
type ArrowItem = {
  rad: number;
  tipX: number;
  tipY: number;
  // label centre (relaxed)
  lblX: number;
  lblY: number;
  // natural label centre (before relaxation) — used to decide if a leader line is needed
  natLblX: number;
  natLblY: number;
  speed: number;
  modelName: string;
  color: string;
};

const SPOT_CX = 150;
const SPOT_CY = 150;
// Approximate label half-width and half-height (speed text 18px + model text 13px stacked).
const LABEL_HW = 32;
const LABEL_HH = 22;
// Don't let labels slide back over the spot marker itself.
const MIN_FROM_SPOT = 60;

function relaxLabels(items: ArrowItem[]): void {
  const ITERATIONS = 40;
  for (let iter = 0; iter < ITERATIONS; iter++) {
    let moved = false;
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i];
        const b = items[j];
        const dx = b.lblX - a.lblX;
        const dy = b.lblY - a.lblY;
        // AABB overlap on each axis
        const overlapX = LABEL_HW * 2 - Math.abs(dx);
        const overlapY = LABEL_HH * 2 - Math.abs(dy);
        if (overlapX > 0 && overlapY > 0) {
          // push along the smaller-overlap axis (minimum-translation vector)
          if (overlapX < overlapY) {
            const push = overlapX * 0.5 * Math.sign(dx || 1);
            a.lblX -= push;
            b.lblX += push;
          } else {
            const push = overlapY * 0.5 * Math.sign(dy || 1);
            a.lblY -= push;
            b.lblY += push;
          }
          moved = true;
        }
      }
    }
    // After each pass, project labels out of the spot-marker keep-out radius.
    for (const it of items) {
      const dx = it.lblX - SPOT_CX;
      const dy = it.lblY - SPOT_CY;
      const dist = Math.hypot(dx, dy);
      if (dist < MIN_FROM_SPOT && dist > 0.001) {
        const scale = MIN_FROM_SPOT / dist;
        it.lblX = SPOT_CX + dx * scale;
        it.lblY = SPOT_CY + dy * scale;
        moved = true;
      }
    }
    if (!moved) break;
  }
}

function arrowMarkup(it: ArrowItem): string {
  const headLen = 16;
  const headAng = 0.4;
  const lx = it.tipX - headLen * Math.sin(it.rad - headAng);
  const ly = it.tipY + headLen * Math.cos(it.rad - headAng);
  const rx = it.tipX - headLen * Math.sin(it.rad + headAng);
  const ry = it.tipY + headLen * Math.cos(it.rad + headAng);
  const dropColor = it.color === "#ffffff" ? "#000" : "#fff";
  return `<line x1="${SPOT_CX}" y1="${SPOT_CY}" x2="${it.tipX}" y2="${it.tipY}" stroke="${it.color}" stroke-width="5" stroke-linecap="round" style="filter:drop-shadow(0 0 2px ${dropColor})"/>
    <polygon points="${it.tipX},${it.tipY} ${lx},${ly} ${rx},${ry}" fill="${it.color}"/>`;
}

function leaderMarkup(it: ArrowItem): string {
  // Only draw a leader if the label has been displaced from its natural position.
  const drift = Math.hypot(it.lblX - it.natLblX, it.lblY - it.natLblY);
  if (drift < 6) return "";
  return `<line x1="${it.tipX}" y1="${it.tipY}" x2="${it.lblX}" y2="${it.lblY}" stroke="${it.color}" stroke-width="1.5" stroke-dasharray="3 3" opacity="0.55"/>`;
}

function labelMarkup(it: ArrowItem): string {
  const shadow = it.color === "#ffffff"
    ? "0 0 3px #000,0 0 6px #000"
    : "0 0 3px #fff,0 0 5px #fff";
  return `<text x="${it.lblX}" y="${it.lblY}" text-anchor="middle" dominant-baseline="middle" font-size="18" font-weight="700" fill="${it.color}" style="text-shadow:${shadow}">${Math.round(it.speed)}</text>
    <text x="${it.lblX}" y="${it.lblY + 20}" text-anchor="middle" dominant-baseline="middle" font-size="13" fill="#fff" style="text-shadow:0 0 3px #000,0 0 5px #000">${it.modelName}</text>`;
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
  const tileLayerRef = useRef<L.TileLayer | null>(null);

  const { resolvedTheme } = useTheme();

  // Switch Carto tiles when theme changes
  useEffect(() => {
    if (!mapRef.current) return;
    const variant = resolvedTheme === "light" ? "light_all" : "dark_all";
    const url = `https://{s}.basemaps.cartocdn.com/${variant}/{z}/{x}/{y}{r}.png`;
    if (tileLayerRef.current) {
      tileLayerRef.current.setUrl(url);
    }
  }, [resolvedTheme]);

  // Init map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: false,
    }).setView([current.latitude, current.longitude], 10);

    const variant = resolvedTheme === "light" ? "light_all" : "dark_all";
    const tile = L.tileLayer(`https://{s}.basemaps.cartocdn.com/${variant}/{z}/{x}/{y}{r}.png`, {
      maxZoom: 19,
    }).addTo(map);
    tileLayerRef.current = tile;

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
        }, 400);
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
      }, 400);
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

    const items: ArrowItem[] = [];
    for (const forecast of forecasts) {
      const timeIdx = forecast.hourly.time.indexOf(selectedHour);
      if (timeIdx === -1) continue;
      const dir = forecast.hourly.wind_direction_10m[timeIdx];
      const spd = forecast.hourly.wind_speed_10m[timeIdx];
      if (dir == null || spd == null) continue;
      const color = resolvedTheme === "light" ? "#64748b" : "#ffffff";
      const rad = ((dir + 180) * Math.PI) / 180;
      const length = Math.min(72 + spd * 4.8, 240);
      const tipX = SPOT_CX + Math.sin(rad) * length;
      const tipY = SPOT_CY - Math.cos(rad) * length;
      const natLblX = tipX + Math.sin(rad) * 26;
      const natLblY = tipY - Math.cos(rad) * 26;
      items.push({
        rad, tipX, tipY,
        lblX: natLblX, lblY: natLblY,
        natLblX, natLblY,
        speed: spd,
        modelName: forecast.modelName,
        color,
      });
    }

    if (items.length === 0) return;
    relaxLabels(items);

    // Render order: arrows (back) → leader lines → labels (front, on top of arrows)
    let svgContent = "";
    for (const it of items) svgContent += arrowMarkup(it);
    for (const it of items) svgContent += leaderMarkup(it);
    for (const it of items) svgContent += labelMarkup(it);

    const icon = L.divIcon({
      html: `<svg width="300" height="300" viewBox="0 0 300 300" style="overflow:visible;pointer-events:none">${svgContent}</svg>`,
      className: "",
      iconSize: [300, 300],
      iconAnchor: [150, 150],
    });

    arrowLayerRef.current = L.marker([current.latitude, current.longitude], {
      icon,
      interactive: false,
      pane: "windArrows",
    }).addTo(map);
  }, [selectedHour, forecasts, current, resolvedTheme]);

  return (
    <div className="w-full h-full relative">
      <div ref={containerRef} className="w-full h-full overflow-hidden" />
      {/* Marker long-press: rename or delete */}
      {pendingEdit && (
        <div className="absolute inset-0 flex items-center justify-center z-[1000] bg-black/50 backdrop-blur-sm animate-fade-in" role="dialog" aria-label="Spot options">
          <div className="ow-modal-surface backdrop-blur rounded-xl p-5 mx-4 w-full max-w-xs animate-modal-in">
            <p className="text-sm font-semibold mb-1" style={{ color: 'var(--ow-fg-0)' }}>{pendingEdit.name}</p>
            <p className="text-xs mb-4" style={{ color: 'var(--ow-fg-1)' }}>
              {pendingEdit.latitude.toFixed(4)}, {pendingEdit.longitude.toFixed(4)}
            </p>
            <div className="flex flex-col gap-2">
              <button
                className="ow-modal-btn w-full min-h-[44px] py-2.5 rounded-lg text-sm font-medium transition-all"
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
                className="ow-modal-btn-outline w-full min-h-[44px] py-2.5 rounded-lg text-sm transition-all"
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
          <div className="ow-modal-surface backdrop-blur rounded-xl p-5 mx-4 w-full max-w-xs animate-modal-in">
            <p className="text-sm font-semibold mb-1" style={{ color: 'var(--ow-fg-0)' }}>
              {pendingSpot.editingSpot ? "Rename spot" : "New spot"}
            </p>
            <p className="text-xs mb-3" style={{ color: 'var(--ow-fg-1)' }}>
              {pendingSpot.lat.toFixed(4)}, {pendingSpot.lng.toFixed(4)}
            </p>
            <input
              className="ow-modal-input w-full text-sm rounded-lg px-3 py-2.5 mb-4 transition-colors"
              value={pendingSpot.name}
              onChange={(e) => setPendingSpot({ ...pendingSpot, name: e.target.value })}
              autoFocus
              aria-label="Spot name"
            />
            <div className="flex gap-2">
              <button
                className="ow-modal-btn-outline flex-1 min-h-[44px] py-2.5 rounded-lg text-sm font-medium transition-all"
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
