# OpenWind

**[Live App](https://openwind.fr)**

Free wind forecast. Compare wind predictions from multiple weather models side by side for any spot.

## Features

- **Multi-model comparison** — ECMWF, GFS, ICON, AROME displayed in a compact hourly table with Beaufort color scale
- **Interactive map** — Dark CARTO basemap with clickable spots and wind direction arrows per model
- **Time selection** — Tap any hour in the table to display wind arrows on the map for all models
- **Spot search** — Autocomplete geocoding via Open-Meteo API
- **Custom spots** — Save your own spots to localStorage, no account needed
- **Mobile-first** — Designed for phone screens with horizontal scroll on the forecast table

## Tech Stack

- React + TypeScript + Vite
- Tailwind CSS v4
- Leaflet (map)
- Open-Meteo API (free, no API key, no backend)

## Weather Models

| Model | Resolution | Horizon |
|-------|-----------|---------|
| ECMWF IFS | 9 km | 10 days |
| GFS | 13-22 km | 16 days |
| ICON | 13 km | 7 days |
| AROME | 1.25 km | 2 days |

## Development

```bash
npm install
npm run dev
```

## Deployment

Deployed automatically to GitHub Pages on push to `main` via GitHub Actions.

## Privacy

OpenWind is a **100% client-side application**. No server, no backend, no analytics.

- **No data is stored on any server.** All your spots and preferences are saved in your browser's `localStorage` only.
- **No account, no tracking, no cookies.** The app runs entirely in your browser.
- **External API calls are made directly from your browser:**
  - [Open-Meteo.com](https://open-meteo.com/) — weather forecasts (coordinates of your spots)
  - [Nominatim / OpenStreetMap](https://nominatim.openstreetmap.org/) — reverse geocoding to name a spot when you long-press the map (coordinates of the point you selected, not your location)
  - [CARTO](https://carto.com/) — map tiles
- **We do not collect, store, or transmit any personal information.**

## Credits

Weather data: [Open-Meteo.com](https://open-meteo.com/) (CC BY 4.0)
Map tiles: [CARTO](https://carto.com/) / [OpenStreetMap](https://www.openstreetmap.org/copyright)
