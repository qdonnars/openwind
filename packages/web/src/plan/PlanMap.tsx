import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useTheme } from "../design/theme";
import type { SegmentReport } from "./types";
import { cxLevel, CX_COLORS } from "./types";

interface PlanMapProps {
  waypoints: [number, number][];
  segments?: SegmentReport[];
  isStale?: boolean;
  onWptMove: (idx: number, lat: number, lon: number) => void;
}

function waypointIcon(label: string, bg: string): L.DivIcon {
  return L.divIcon({
    html: `<div style="
      width:28px;height:28px;border-radius:50%;
      background:${bg};border:2px solid rgba(255,255,255,0.9);
      display:flex;align-items:center;justify-content:center;
      font-size:11px;font-weight:700;color:#fff;
      box-shadow:0 1px 4px rgba(0,0,0,0.5);
      cursor:grab;
      font-family:system-ui,sans-serif;
      ">${label}</div>`,
    className: "",
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

export function PlanMap({ waypoints, segments, isStale, onWptMove }: PlanMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const polylinesRef = useRef<L.Polyline[]>([]);
  const markersRef = useRef<L.Marker[]>([]);
  const dragLineRef = useRef<L.Polyline | null>(null);
  const livePositionsRef = useRef<[number, number][]>(waypoints);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    livePositionsRef.current = waypoints;
  }, [waypoints]);

  // Switch tiles on theme change
  useEffect(() => {
    if (!tileLayerRef.current) return;
    const variant = resolvedTheme === "light" ? "light_all" : "dark_all";
    tileLayerRef.current.setUrl(`https://{s}.basemaps.cartocdn.com/${variant}/{z}/{x}/{y}{r}.png`);
  }, [resolvedTheme]);

  // Init map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const bounds = L.latLngBounds(waypoints.map(([lat, lon]) => L.latLng(lat, lon)));
    const map = L.map(containerRef.current, { zoomControl: false, attributionControl: false });

    const variant = resolvedTheme === "light" ? "light_all" : "dark_all";
    const tile = L.tileLayer(`https://{s}.basemaps.cartocdn.com/${variant}/{z}/{x}/{y}{r}.png`, {
      maxZoom: 19,
    }).addTo(map);
    tileLayerRef.current = tile;

    L.control.attribution({ position: "bottomright", prefix: false })
      .addAttribution('&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>')
      .addTo(map);

    L.control.zoom({ position: "bottomright" }).addTo(map);

    map.fitBounds(bounds, { padding: [40, 40] });
    mapRef.current = map;

    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(containerRef.current!);
    setTimeout(() => map.invalidateSize(), 100);

    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Draw draggable waypoint markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    for (const m of markersRef.current) m.remove();
    markersRef.current = [];

    waypoints.forEach(([lat, lon], i) => {
      const isFirst = i === 0;
      const isLast = i === waypoints.length - 1;
      const label = isFirst ? "▶" : isLast ? "■" : String(i);
      const bg = isFirst ? "#2dd4bf" : isLast ? "#e84118" : "#6b7280";
      const marker = L.marker([lat, lon], {
        icon: waypointIcon(label, bg),
        draggable: true,
      }).addTo(map);

      marker.on("drag", () => {
        const pos = marker.getLatLng();
        const positions = [...livePositionsRef.current];
        positions[i] = [pos.lat, pos.lng];
        livePositionsRef.current = positions;
        const lls = positions.map(([la, lo]) => L.latLng(la, lo));
        if (!dragLineRef.current) {
          dragLineRef.current = L.polyline(lls, {
            color: "#6b7280",
            weight: 3,
            dashArray: "6 4",
            opacity: 0.85,
          }).addTo(map);
        } else {
          dragLineRef.current.setLatLngs(lls);
        }
      });

      marker.on("dragend", () => {
        if (dragLineRef.current) {
          dragLineRef.current.remove();
          dragLineRef.current = null;
        }
        const pos = marker.getLatLng();
        onWptMove(i, pos.lat, pos.lng);
      });

      markersRef.current.push(marker);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waypoints]);

  // Draw polyline — gray while loading/stale, colored per segment when fresh
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    for (const p of polylinesRef.current) p.remove();
    polylinesRef.current = [];

    if (!segments || isStale) {
      const line = L.polyline(waypoints.map(([lat, lon]) => L.latLng(lat, lon)), {
        color: "#6b7280",
        weight: 3,
        dashArray: "6 4",
        opacity: 0.7,
      }).addTo(map);
      polylinesRef.current = [line];
      return;
    }

    for (const seg of segments) {
      const color = CX_COLORS[cxLevel(seg.tws_kn)];
      const line = L.polyline(
        [L.latLng(seg.start.lat, seg.start.lon), L.latLng(seg.end.lat, seg.end.lon)],
        { color, weight: 4, opacity: 0.9 }
      ).addTo(map);
      polylinesRef.current.push(line);
    }
  }, [waypoints, segments, isStale]);

  return <div ref={containerRef} className="w-full h-full" />;
}
