from __future__ import annotations

from datetime import UTC, datetime, timedelta

from mcp.server.fastmcp import FastMCP
from openwind_data.adapters.base import (
    ForecastBundle,
    SeaSeries,
    WindPoint,
    WindSeries,
)

from openwind_mcp_core import build_server


class StubAdapter:
    async def fetch(
        self,
        lat: float,
        lon: float,
        start: datetime,
        end: datetime,
        models: list[str] | None = None,
    ) -> ForecastBundle:
        models = models or ["meteofrance_arome_france"]
        points: list[WindPoint] = []
        t = start
        while t <= end:
            points.append(WindPoint(time=t, speed_kn=12.0, direction_deg=0.0, gust_kn=None))
            t = t + timedelta(hours=1)
        return ForecastBundle(
            lat=lat,
            lon=lon,
            start=start,
            end=end,
            wind_by_model={m: WindSeries(model=m, points=tuple(points)) for m in models},
            sea=SeaSeries(points=()),
            requested_at=start,
        )


async def _call(server: FastMCP, name: str, args: dict) -> object:
    result = await server.call_tool(name, args)
    # FastMCP.call_tool returns (content, structured_or_dict)
    if isinstance(result, tuple):
        return result[1]
    return result


class TestBuildServer:
    def test_returns_fastmcp(self) -> None:
        server = build_server(adapter=StubAdapter())
        assert isinstance(server, FastMCP)

    async def test_lists_four_tools(self) -> None:
        server = build_server(adapter=StubAdapter())
        tools = await server.list_tools()
        names = {t.name for t in tools}
        assert names == {
            "list_boat_archetypes",
            "get_marine_forecast",
            "estimate_passage_tool",
            "score_complexity_tool",
        }


class TestListArchetypes:
    async def test_returns_five_archetypes_with_metadata(self) -> None:
        server = build_server(adapter=StubAdapter())
        out = await _call(server, "list_boat_archetypes", {})
        items = out["result"] if isinstance(out, dict) and "result" in out else out
        assert len(items) == 5
        names = {a["name"] for a in items}
        assert "cruiser_40ft" in names
        for a in items:
            assert {"length_ft", "type", "category", "performance_class", "examples"} <= a.keys()


class TestEstimatePassageTool:
    async def test_returns_serializable_report(self) -> None:
        server = build_server(adapter=StubAdapter())
        out = await _call(
            server,
            "estimate_passage_tool",
            {
                "waypoints": [{"lat": 43.30, "lon": 5.35}, {"lat": 43.00, "lon": 6.20}],
                "departure": datetime(2026, 5, 1, 6, 0, tzinfo=UTC).isoformat(),
                "archetype": "cruiser_40ft",
                "segment_length_nm": 10.0,
            },
        )
        assert isinstance(out["departure_time"], str)
        assert isinstance(out["arrival_time"], str)
        assert out["archetype"] == "cruiser_40ft"
        assert len(out["segments"]) >= 1
        assert isinstance(out["segments"][0]["start_time"], str)


class TestScoreComplexityTool:
    async def test_wind_only(self) -> None:
        server = build_server(adapter=StubAdapter())
        out = await _call(
            server,
            "score_complexity_tool",
            {
                "waypoints": [{"lat": 43.30, "lon": 5.35}, {"lat": 43.00, "lon": 6.20}],
                "departure": datetime(2026, 5, 1, 6, 0, tzinfo=UTC).isoformat(),
                "archetype": "cruiser_40ft",
            },
        )
        assert 1 <= out["level"] <= 5
        assert out["sea_level"] is None

    async def test_with_sea(self) -> None:
        server = build_server(adapter=StubAdapter())
        out = await _call(
            server,
            "score_complexity_tool",
            {
                "waypoints": [{"lat": 43.30, "lon": 5.35}, {"lat": 43.00, "lon": 6.20}],
                "departure": datetime(2026, 5, 1, 6, 0, tzinfo=UTC).isoformat(),
                "archetype": "cruiser_40ft",
                "max_hs_m": 2.5,
            },
        )
        assert out["sea_level"] == 4
