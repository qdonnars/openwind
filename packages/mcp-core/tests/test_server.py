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

    async def test_lists_all_tools(self) -> None:
        server = build_server(adapter=StubAdapter())
        tools = await server.list_tools()
        names = {t.name for t in tools}
        assert names == {
            "list_boat_archetypes",
            "get_marine_forecast",
            "estimate_passage",
            "score_complexity",
            "read_me",
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
            "estimate_passage",
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

    async def test_estimate_passage_default_uses_auto(self) -> None:
        # No `model` argument → server default is AUTO_MODEL.
        # StubAdapter returns data for any model, so auto resolves on first try.
        server = build_server(adapter=StubAdapter())
        out = await _call(
            server,
            "estimate_passage",
            {
                "waypoints": [{"lat": 43.30, "lon": 5.35}, {"lat": 43.00, "lon": 6.20}],
                "departure": datetime(2026, 5, 1, 6, 0, tzinfo=UTC).isoformat(),
                "archetype": "cruiser_40ft",
                "segment_length_nm": 10.0,
            },
        )
        assert out["model"] == "meteofrance_arome_france"
        assert len(out["segments"]) >= 1


class TestScoreComplexityTool:
    async def test_wind_only(self) -> None:
        server = build_server(adapter=StubAdapter())
        out = await _call(
            server,
            "score_complexity",
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
            "score_complexity",
            {
                "waypoints": [{"lat": 43.30, "lon": 5.35}, {"lat": 43.00, "lon": 6.20}],
                "departure": datetime(2026, 5, 1, 6, 0, tzinfo=UTC).isoformat(),
                "archetype": "cruiser_40ft",
                "max_hs_m": 2.5,
            },
        )
        assert out["sea_level"] == 4


class TestReadMeTool:
    async def test_returns_template_with_required_placeholders(self) -> None:
        # The text returned by `read_me` is contractual: any LLM client that
        # implemented the widget against today's placeholders will keep
        # working only if these keep showing up. Guard against accidental
        # renames.
        server = build_server(adapter=StubAdapter())
        out = await _call(server, "read_me", {})
        body = out["result"] if isinstance(out, dict) and "result" in out else out
        assert isinstance(body, str)
        for placeholder in (
            "{{departure_time}}",
            "{{departure_date_display}}",
            "{{timezone}}",
            "{{num_waypoints}}",
            "{{total_distance}}",
            "{{archetype_display}}",
            "{{efficiency}}",
            "{{duration_hours}}",
            "{{duration_minutes}}",
            "{{eta_time}}",
            "{{complexity_score}}",
            "{{complexity_bars}}",
            "{{legs}}",
            "{{openwind_url}}",
        ):
            assert placeholder in body, f"missing placeholder: {placeholder}"

    async def test_template_is_client_agnostic(self) -> None:
        # The widget must render in any MCP client, not just Claude. Two
        # invariants enforce that:
        #   1. no Claude-specific CSS variables (--color-text-primary, etc.)
        #   2. a `prefers-color-scheme` block driving the dark palette.
        server = build_server(adapter=StubAdapter())
        out = await _call(server, "read_me", {})
        body = out["result"] if isinstance(out, dict) and "result" in out else out
        assert "var(--color-" not in body
        assert "prefers-color-scheme: dark" in body

    async def test_template_points_at_openwind_fr(self) -> None:
        # Deep-link target is the prod web app. If the route ever moves we
        # want this to fail loudly rather than silently shipping stale URLs.
        server = build_server(adapter=StubAdapter())
        out = await _call(server, "read_me", {})
        body = out["result"] if isinstance(out, dict) and "result" in out else out
        assert "https://openwind.fr/plan?" in body
