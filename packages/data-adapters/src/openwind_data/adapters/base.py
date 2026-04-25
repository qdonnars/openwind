from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Protocol


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
