from __future__ import annotations

from datetime import UTC, datetime

import httpx
import pytest
import respx

from openwind_data.adapters.openmeteo import (
    DEFAULT_MODEL,
    FORECAST_URL,
    MARINE_URL,
    OpenMeteoAdapter,
)


def _start_end():
    start = datetime(2026, 4, 26, 0, 0, tzinfo=UTC)
    end = datetime(2026, 4, 26, 23, 0, tzinfo=UTC)
    return start, end


@respx.mock
async def test_fetch_returns_bundle_with_default_model(
    forecast_marseille_arome, marine_porquerolles
):
    forecast_route = respx.get(FORECAST_URL).mock(
        return_value=httpx.Response(200, json=forecast_marseille_arome)
    )
    marine_route = respx.get(MARINE_URL).mock(
        return_value=httpx.Response(200, json=marine_porquerolles)
    )

    adapter = OpenMeteoAdapter()
    start, end = _start_end()
    bundle = await adapter.fetch(lat=43.30, lon=5.35, start=start, end=end)

    assert forecast_route.call_count == 1
    assert marine_route.call_count == 1
    assert DEFAULT_MODEL in bundle.wind_by_model
    wind = bundle.wind_by_model[DEFAULT_MODEL]
    assert wind.model == DEFAULT_MODEL
    assert len(wind.points) == 24
    # First point of fixture
    assert wind.points[0].time == datetime(2026, 4, 26, 0, 0, tzinfo=UTC)
    assert wind.points[0].speed_kn == 4.3
    assert wind.points[0].direction_deg == 87
    assert wind.points[0].gust_kn == 7.8

    assert len(bundle.sea.points) == 24
    sea0 = bundle.sea.points[0]
    assert sea0.time == datetime(2026, 4, 26, 0, 0, tzinfo=UTC)
    # Marine fixture has all sea fields populated
    assert sea0.wave_height_m is not None


@respx.mock
async def test_fetch_passes_arome_as_default_model_param(
    forecast_marseille_arome, marine_porquerolles
):
    forecast_route = respx.get(FORECAST_URL).mock(
        return_value=httpx.Response(200, json=forecast_marseille_arome)
    )
    respx.get(MARINE_URL).mock(return_value=httpx.Response(200, json=marine_porquerolles))

    adapter = OpenMeteoAdapter()
    start, end = _start_end()
    await adapter.fetch(lat=43.30, lon=5.35, start=start, end=end)

    sent = forecast_route.calls.last.request
    assert sent.url.params["models"] == DEFAULT_MODEL
    assert sent.url.params["wind_speed_unit"] == "kn"
    assert sent.url.params["timezone"] == "UTC"


@respx.mock
async def test_cache_hits_within_ttl(forecast_marseille_arome, marine_porquerolles):
    forecast_route = respx.get(FORECAST_URL).mock(
        return_value=httpx.Response(200, json=forecast_marseille_arome)
    )
    marine_route = respx.get(MARINE_URL).mock(
        return_value=httpx.Response(200, json=marine_porquerolles)
    )

    adapter = OpenMeteoAdapter()
    start, end = _start_end()
    await adapter.fetch(lat=43.30, lon=5.35, start=start, end=end)
    await adapter.fetch(lat=43.30, lon=5.35, start=start, end=end)

    assert forecast_route.call_count == 1
    assert marine_route.call_count == 1


@respx.mock
async def test_cache_serves_subwindow_without_refetch(
    forecast_marseille_arome, marine_porquerolles
):
    """A second fetch with a narrower [start, end] inside the cached window must hit cache."""
    forecast_route = respx.get(FORECAST_URL).mock(
        return_value=httpx.Response(200, json=forecast_marseille_arome)
    )
    marine_route = respx.get(MARINE_URL).mock(
        return_value=httpx.Response(200, json=marine_porquerolles)
    )

    adapter = OpenMeteoAdapter()
    start, end = _start_end()
    await adapter.fetch(lat=43.30, lon=5.35, start=start, end=end)
    # Sub-window inside the original day — must be served from cache.
    sub_start = datetime(2026, 4, 26, 6, 0, tzinfo=UTC)
    sub_end = datetime(2026, 4, 26, 12, 0, tzinfo=UTC)
    bundle = await adapter.fetch(lat=43.30, lon=5.35, start=sub_start, end=sub_end)

    assert forecast_route.call_count == 1
    assert marine_route.call_count == 1
    wind = bundle.wind_by_model[DEFAULT_MODEL]
    assert all(sub_start <= p.time <= sub_end for p in wind.points)
    assert len(wind.points) == 7  # 06:00..12:00 inclusive


@respx.mock
async def test_cache_dedupes_close_lat_lon_within_grid_cell(
    forecast_marseille_arome, marine_porquerolles
):
    """Two waypoints within the AROME grid cell (~1.1 km) share a cache entry."""
    forecast_route = respx.get(FORECAST_URL).mock(
        return_value=httpx.Response(200, json=forecast_marseille_arome)
    )
    respx.get(MARINE_URL).mock(return_value=httpx.Response(200, json=marine_porquerolles))

    adapter = OpenMeteoAdapter()
    start, end = _start_end()
    await adapter.fetch(lat=43.301, lon=5.351, start=start, end=end)
    await adapter.fetch(lat=43.304, lon=5.348, start=start, end=end)  # same 2dp cell

    assert forecast_route.call_count == 1


@respx.mock
async def test_multi_model_runs_parallel_requests(forecast_marseille_arome, marine_porquerolles):
    forecast_route = respx.get(FORECAST_URL).mock(
        return_value=httpx.Response(200, json=forecast_marseille_arome)
    )
    respx.get(MARINE_URL).mock(return_value=httpx.Response(200, json=marine_porquerolles))

    adapter = OpenMeteoAdapter()
    start, end = _start_end()
    bundle = await adapter.fetch(
        lat=43.30,
        lon=5.35,
        start=start,
        end=end,
        models=["meteofrance_arome_france", "ecmwf_ifs025", "icon_seamless"],
    )

    assert forecast_route.call_count == 3
    assert set(bundle.wind_by_model.keys()) == {
        "meteofrance_arome_france",
        "ecmwf_ifs025",
        "icon_seamless",
    }


async def test_naive_datetime_raises():
    adapter = OpenMeteoAdapter()
    with pytest.raises(ValueError, match="timezone-aware"):
        await adapter.fetch(
            lat=43.0,
            lon=5.0,
            start=datetime(2026, 4, 26, 0, 0),
            end=datetime(2026, 4, 26, 23, 0, tzinfo=UTC),
        )


async def test_end_before_start_raises():
    adapter = OpenMeteoAdapter()
    end = datetime(2026, 4, 26, 0, 0, tzinfo=UTC)
    start = datetime(2026, 4, 26, 23, 0, tzinfo=UTC)
    with pytest.raises(ValueError, match="after start"):
        await adapter.fetch(lat=43.0, lon=5.0, start=start, end=end)


@respx.mock
async def test_http_error_propagates(marine_porquerolles):
    respx.get(FORECAST_URL).mock(return_value=httpx.Response(500))
    respx.get(MARINE_URL).mock(return_value=httpx.Response(200, json=marine_porquerolles))

    adapter = OpenMeteoAdapter()
    start, end = _start_end()
    with pytest.raises(httpx.HTTPStatusError):
        await adapter.fetch(lat=43.0, lon=5.0, start=start, end=end)
