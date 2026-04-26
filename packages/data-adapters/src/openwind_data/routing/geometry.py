"""Spherical geometry helpers — all distances in nautical miles, angles in degrees.

Earth radius is taken as 3440.065 NM (mean radius 6371.0088 km / 1.852).
For Mediterranean trips (max ~1000 NM), the WGS84 ellipsoid correction is
under 0.5% and is ignored.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from itertools import pairwise

EARTH_RADIUS_NM = 3440.065


@dataclass(frozen=True, slots=True)
class Point:
    lat: float
    lon: float


@dataclass(frozen=True, slots=True)
class Segment:
    start: Point
    end: Point
    distance_nm: float
    bearing_deg: float


def _angular_distance_rad(a: Point, b: Point) -> float:
    lat1, lon1 = math.radians(a.lat), math.radians(a.lon)
    lat2, lon2 = math.radians(b.lat), math.radians(b.lon)
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * math.asin(min(1.0, math.sqrt(h)))


def haversine_distance(a: Point, b: Point) -> float:
    """Great-circle distance in nautical miles."""
    return EARTH_RADIUS_NM * _angular_distance_rad(a, b)


def bearing(a: Point, b: Point) -> float:
    """Initial true bearing from a to b, in degrees [0, 360)."""
    lat1, lon1 = math.radians(a.lat), math.radians(a.lon)
    lat2, lon2 = math.radians(b.lat), math.radians(b.lon)
    dlon = lon2 - lon1
    x = math.sin(dlon) * math.cos(lat2)
    y = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlon)
    return (math.degrees(math.atan2(x, y)) + 360.0) % 360.0


def interpolate_great_circle(a: Point, b: Point, fraction: float) -> Point:
    """Spherical linear interpolation along the great circle from a to b.

    fraction=0 returns a, fraction=1 returns b.
    """
    delta = _angular_distance_rad(a, b)
    if delta < 1e-12:
        return a
    lat1, lon1 = math.radians(a.lat), math.radians(a.lon)
    lat2, lon2 = math.radians(b.lat), math.radians(b.lon)
    sin_delta = math.sin(delta)
    a_coef = math.sin((1.0 - fraction) * delta) / sin_delta
    b_coef = math.sin(fraction * delta) / sin_delta
    x = a_coef * math.cos(lat1) * math.cos(lon1) + b_coef * math.cos(lat2) * math.cos(lon2)
    y = a_coef * math.cos(lat1) * math.sin(lon1) + b_coef * math.cos(lat2) * math.sin(lon2)
    z = a_coef * math.sin(lat1) + b_coef * math.sin(lat2)
    lat = math.atan2(z, math.sqrt(x * x + y * y))
    lon = math.atan2(y, x)
    return Point(lat=math.degrees(lat), lon=math.degrees(lon))


def midpoint(a: Point, b: Point) -> Point:
    return interpolate_great_circle(a, b, 0.5)


def normalize_twa(twd: float, course: float) -> float:
    """True wind angle relative to course, in [0, 180].

    V1 ignores tack (port/starboard); polars are symmetric around the wind axis.
    """
    diff = (twd - course + 540.0) % 360.0 - 180.0
    return abs(diff)


def segment_route(waypoints: list[Point], segment_length_nm: float) -> list[Segment]:
    """Split a polyline into segments of approximately segment_length_nm length.

    Each leg between consecutive waypoints is divided into n = max(1, ceil(d/L))
    sub-segments of equal great-circle length d/n. Endpoints exactly hit the
    waypoints (no rounding drift).
    """
    if segment_length_nm <= 0:
        raise ValueError("segment_length_nm must be > 0")
    if len(waypoints) < 2:
        raise ValueError("need at least 2 waypoints")
    segments: list[Segment] = []
    for a, b in pairwise(waypoints):
        d = haversine_distance(a, b)
        n = max(1, math.ceil(d / segment_length_nm))
        for i in range(n):
            f1 = i / n
            f2 = (i + 1) / n
            start = a if i == 0 else interpolate_great_circle(a, b, f1)
            end = b if i == n - 1 else interpolate_great_circle(a, b, f2)
            seg_d = haversine_distance(start, end)
            seg_b = bearing(start, end)
            segments.append(Segment(start=start, end=end, distance_nm=seg_d, bearing_deg=seg_b))
    return segments
