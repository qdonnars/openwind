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
            "render_passage_widget",
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


class TestRenderPassageWidgetTool:
    """The fast path — server-side rendering of final HTML.

    Anchors the contract: *no placeholders* in the output, the deep-link URL
    points at openwind.fr, FR/EN labels swap, and the segment data drives the
    leg blocks.
    """

    @staticmethod
    async def _build_passage(server: FastMCP) -> dict:
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
        return out

    @staticmethod
    async def _build_complexity(server: FastMCP) -> dict:
        return await _call(
            server,
            "score_complexity",
            {
                "waypoints": [{"lat": 43.30, "lon": 5.35}, {"lat": 43.00, "lon": 6.20}],
                "departure": datetime(2026, 5, 1, 6, 0, tzinfo=UTC).isoformat(),
                "archetype": "cruiser_40ft",
            },
        )

    @staticmethod
    async def _render(server: FastMCP, args: dict) -> str:
        out = await _call(server, "render_passage_widget", args)
        body = out["result"] if isinstance(out, dict) and "result" in out else out
        assert isinstance(body, str)
        return body

    async def test_returns_final_html_with_no_placeholders(self) -> None:
        server = build_server(adapter=StubAdapter())
        passage = await self._build_passage(server)
        complexity = await self._build_complexity(server)

        body = await self._render(server, {"passage": passage, "complexity": complexity})
        # The whole point: substitution happened server-side. Any leftover
        # mustache-style placeholder is a bug — the LLM would render it raw.
        assert "{{" not in body
        assert "}}" not in body

    async def test_renders_one_leg_block_per_segment(self) -> None:
        server = build_server(adapter=StubAdapter())
        passage = await self._build_passage(server)
        complexity = await self._build_complexity(server)

        body = await self._render(server, {"passage": passage, "complexity": complexity})
        assert body.count('class="ow-leg"') == len(passage["segments"])

    async def test_includes_openwind_deeplink(self) -> None:
        server = build_server(adapter=StubAdapter())
        passage = await self._build_passage(server)
        body = await self._render(
            server,
            {
                "passage": passage,
                "waypoints": [{"lat": 43.30, "lon": 5.35}, {"lat": 43.00, "lon": 6.20}],
            },
        )
        # Deep-link uses the explicit waypoints arg — fail loudly if the URL
        # ever moves or the encoder drops args.
        assert "https://openwind.fr/plan?" in body
        assert "wpts=43.300,5.350;43.000,6.200" in body
        assert "archetype=cruiser_40ft" in body

    async def test_locale_fr_swaps_labels(self) -> None:
        server = build_server(adapter=StubAdapter())
        passage = await self._build_passage(server)
        body = await self._render(server, {"passage": passage, "locale": "fr"})
        # FR swap targets the label text between tags, not arbitrary occurrences.
        assert ">DÉPART<" in body
        assert ">Durée<" in body
        assert ">Complexité<" in body
        assert ">Ouvrir dans OpenWind &rarr;<" in body
        assert ">DEPARTURE<" not in body

    async def test_locale_en_keeps_english(self) -> None:
        server = build_server(adapter=StubAdapter())
        passage = await self._build_passage(server)
        body = await self._render(server, {"passage": passage, "locale": "en"})
        assert ">DEPARTURE<" in body
        assert ">DÉPART<" not in body

    async def test_complexity_optional(self) -> None:
        # Without complexity, score shows "-" and no bars are filled.
        server = build_server(adapter=StubAdapter())
        passage = await self._build_passage(server)
        body = await self._render(server, {"passage": passage})
        # 5 bar elements present, none with a background colour set.
        assert body.count('<span class="ow-cx-bar"') == 5
        assert 'class="ow-cx-bar" style="background:#' not in body

    async def test_boat_name_and_leg_titles(self) -> None:
        server = build_server(adapter=StubAdapter())
        passage = await self._build_passage(server)
        custom_titles = [f"Custom leg {i}" for i in range(len(passage["segments"]))]
        body = await self._render(
            server,
            {
                "passage": passage,
                "boat_name": "OTAGO III",
                "leg_titles": custom_titles,
            },
        )
        assert "OTAGO III" in body
        for title in custom_titles:
            assert title in body


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
