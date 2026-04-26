"""OpenWind domain logic — marine adapters, polars, routing, complexity."""

from openwind_data.adapters.base import (
    ForecastBundle,
    MarineDataAdapter,
    SeaPoint,
    SeaSeries,
    WindPoint,
    WindSeries,
)
from openwind_data.adapters.openmeteo import OpenMeteoAdapter
from openwind_data.routing import (
    BoatPolar,
    PassageReport,
    Point,
    Segment,
    SegmentReport,
    estimate_passage,
    get_polar,
    list_archetypes,
)

__all__ = [
    "BoatPolar",
    "ForecastBundle",
    "MarineDataAdapter",
    "OpenMeteoAdapter",
    "PassageReport",
    "Point",
    "SeaPoint",
    "SeaSeries",
    "Segment",
    "SegmentReport",
    "WindPoint",
    "WindSeries",
    "estimate_passage",
    "get_polar",
    "list_archetypes",
]
