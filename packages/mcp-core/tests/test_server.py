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
    """Test adapter that records every fetch call.

    The fetch counter is the load-bearing assertion for the V1 surface: the
    point of merging estimate_passage + score_complexity into ``plan_passage``
    is to fetch Open-Meteo ONCE per A→B question, not twice.
    """

    def __init__(self) -> None:
        self.fetch_calls: int = 0

    async def fetch(
        self,
        lat: float,
        lon: float,
        start: datetime,
        end: datetime,
        models: list[str] | None = None,
    ) -> ForecastBundle:
        self.fetch_calls += 1
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


_BASE_PLAN_ARGS: dict = {
    "waypoints": [{"lat": 43.30, "lon": 5.35}, {"lat": 43.00, "lon": 6.20}],
    "departure": datetime(2026, 5, 1, 6, 0, tzinfo=UTC).isoformat(),
    "archetype": "cruiser_40ft",
}


class TestBuildServer:
    def test_returns_fastmcp(self) -> None:
        server = build_server(adapter=StubAdapter())
        assert isinstance(server, FastMCP)

    async def test_lists_three_tools(self) -> None:
        # The collapsed surface — anything that drifts here is a regression.
        server = build_server(adapter=StubAdapter())
        tools = await server.list_tools()
        names = {t.name for t in tools}
        assert names == {
            "list_boat_archetypes",
            "get_marine_forecast",
            "plan_passage",
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


class TestPlanPassage:
    """The single workhorse tool. Replaces estimate_passage + score_complexity
    + render_passage_widget. The contract is: ONE call returns timing,
    complexity, html, and openwind_url — and fetches Open-Meteo ONCE."""

    async def test_returns_full_payload(self) -> None:
        adapter = StubAdapter()
        server = build_server(adapter=adapter)
        out = await _call(server, "plan_passage", _BASE_PLAN_ARGS)

        assert {"passage", "complexity", "html", "openwind_url"} <= out.keys()
        # Passage shape
        assert isinstance(out["passage"]["departure_time"], str)
        assert out["passage"]["archetype"] == "cruiser_40ft"
        assert len(out["passage"]["segments"]) >= 1
        # Complexity shape
        assert 1 <= out["complexity"]["level"] <= 5
        # HTML rendered by default — no placeholders left
        assert isinstance(out["html"], str)
        assert "{{" not in out["html"]
        # URL always present
        assert out["openwind_url"].startswith("https://openwind.fr/plan?")

    async def test_no_double_fetch(self) -> None:
        # The whole point of the merge: estimate_passage fetches once per
        # sub-segment. The OLD two-tool flow (estimate_passage +
        # score_complexity) ran the whole pipeline twice → 2N fetches.
        # plan_passage scores from the same report → exactly N fetches.
        adapter = StubAdapter()
        server = build_server(adapter=adapter)
        out = await _call(server, "plan_passage", _BASE_PLAN_ARGS)
        n_segments = len(out["passage"]["segments"])
        assert adapter.fetch_calls == n_segments, (
            f"expected one fetch per segment ({n_segments}), got {adapter.fetch_calls} — "
            "score_complexity may be re-fetching"
        )

    async def test_render_false_skips_html(self) -> None:
        # Opt-out path for text-only clients that don't need the ~5 KB markup.
        adapter = StubAdapter()
        server = build_server(adapter=adapter)
        out = await _call(server, "plan_passage", {**_BASE_PLAN_ARGS, "render": False})
        assert out["html"] is None
        # URL still present — it's the always-on fallback CTA.
        assert out["openwind_url"].startswith("https://openwind.fr/plan?")
        # Passage and complexity still computed.
        assert out["passage"]["archetype"] == "cruiser_40ft"
        assert 1 <= out["complexity"]["level"] <= 5

    async def test_openwind_url_uses_explicit_waypoints(self) -> None:
        # The URL encodes the user's original waypoints, not the (potentially
        # subdivided) segments — so partage SMS reproduit fidèlement la nav.
        server = build_server(adapter=StubAdapter())
        out = await _call(server, "plan_passage", _BASE_PLAN_ARGS)
        url = out["openwind_url"]
        assert "wpts=43.300,5.350;43.000,6.200" in url
        assert "archetype=cruiser_40ft" in url

    async def test_locale_fr_swaps_widget_labels(self) -> None:
        server = build_server(adapter=StubAdapter())
        out = await _call(server, "plan_passage", {**_BASE_PLAN_ARGS, "locale": "fr"})
        body = out["html"]
        assert ">DÉPART<" in body
        assert ">Durée<" in body
        assert ">Complexité<" in body

    async def test_locale_en_keeps_english(self) -> None:
        server = build_server(adapter=StubAdapter())
        out = await _call(server, "plan_passage", {**_BASE_PLAN_ARGS, "locale": "en"})
        assert ">DEPARTURE<" in out["html"]
        assert ">DÉPART<" not in out["html"]

    async def test_boat_name_and_leg_titles_threaded_to_html(self) -> None:
        server = build_server(adapter=StubAdapter())
        out = await _call(
            server,
            "plan_passage",
            {
                **_BASE_PLAN_ARGS,
                "boat_name": "OTAGO III",
                "leg_titles": ["Custom title only"],
            },
        )
        assert "OTAGO III" in out["html"]
        assert "Custom title only" in out["html"]

    async def test_max_hs_factors_into_complexity(self) -> None:
        # max_hs_m used to be on its own tool (score_complexity); now it's
        # a kwarg on plan_passage. Confirm it still drives the score.
        server = build_server(adapter=StubAdapter())
        out_no_hs = await _call(server, "plan_passage", _BASE_PLAN_ARGS)
        out_with_hs = await _call(server, "plan_passage", {**_BASE_PLAN_ARGS, "max_hs_m": 2.5})
        assert out_no_hs["complexity"]["sea_level"] is None
        assert out_with_hs["complexity"]["sea_level"] == 4

    async def test_default_uses_auto_model(self) -> None:
        # No `model` arg → AUTO_MODEL → StubAdapter resolves on first try.
        server = build_server(adapter=StubAdapter())
        out = await _call(server, "plan_passage", _BASE_PLAN_ARGS)
        assert out["passage"]["model"] == "meteofrance_arome_france"


class TestGetMarineForecast:
    async def test_returns_serializable_bundle(self) -> None:
        server = build_server(adapter=StubAdapter())
        out = await _call(
            server,
            "get_marine_forecast",
            {
                "lat": 43.30,
                "lon": 5.35,
                "start": datetime(2026, 5, 1, 6, 0, tzinfo=UTC).isoformat(),
                "end": datetime(2026, 5, 1, 18, 0, tzinfo=UTC).isoformat(),
            },
        )
        assert "wind" in out
        assert "meteofrance_arome_france" in out["wind"]
        assert isinstance(out["wind"]["meteofrance_arome_france"][0]["time"], str)
