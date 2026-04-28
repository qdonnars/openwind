from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Protocol


class ForecastHorizonError(RuntimeError):
    """Raised when a forecast model's horizon does not cover the requested time.

    Carries the failing model, the requested timestamp, and a human-actionable
    message suggesting longer-horizon fallbacks. Open-Meteo silently returns
    empty rows past horizon, so detection happens after the fetch.
    """

    def __init__(self, model: str, requested_time: datetime) -> None:
        self.model = model
        self.requested_time = requested_time
        super().__init__(
            f"forecast horizon exceeded for model {model!r} at "
            f"{requested_time.isoformat()}; AROME ~48h, ICON-EU ~5d, "
            f"ECMWF ~10d, GFS ~16d — try a longer-range model "
            f"or pass model='auto' to fall back automatically"
        )


@dataclass(frozen=True, slots=True)
class WindPoint:
    time: datetime
    speed_kn: float
    direction_deg: float
    gust_kn: float | None


@dataclass(frozen=True, slots=True)
class SeaPoint:
    time: datetime
    wave_height_m: float | None
    wave_period_s: float | None
    wave_direction_deg: float | None
    wind_wave_height_m: float | None
    swell_wave_height_m: float | None


@dataclass(frozen=True, slots=True)
class WindSeries:
    model: str
    points: tuple[WindPoint, ...]


@dataclass(frozen=True, slots=True)
class SeaSeries:
    points: tuple[SeaPoint, ...]


@dataclass(frozen=True, slots=True)
class ForecastBundle:
    lat: float
    lon: float
    start: datetime
    end: datetime
    wind_by_model: dict[str, WindSeries] = field(default_factory=dict)
    sea: SeaSeries = field(default_factory=lambda: SeaSeries(points=()))
    requested_at: datetime | None = None


class MarineDataAdapter(Protocol):
    async def fetch(
        self,
        lat: float,
        lon: float,
        start: datetime,
        end: datetime,
        models: list[str] | None = None,
    ) -> ForecastBundle: ...
