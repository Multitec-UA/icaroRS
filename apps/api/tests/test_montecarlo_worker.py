"""Unit tests for the Monte Carlo subprocess worker (S9).

``icaro.run_monte_carlo`` is patched: no rocketpy flight runs and no
subprocess is spawned. The real subprocess round-trip is an integration
concern.
"""

from __future__ import annotations

import json

from icaro_api.services import montecarlo_worker as worker
from tests.fakes import fake_montecarlo_result


class _FakeResult:
    def to_dict(self):
        return fake_montecarlo_result()


def _argv(tmp_path, scenario_json):
    return [
        "--export-dir", str(tmp_path / "export"),
        "--scenario-json", str(scenario_json),
        "--n", "12",
        "--output-prefix", str(tmp_path / "run" / "montecarlo"),
        "--result-json", str(tmp_path / "result.json"),
    ]


def test_main_writes_result_json_and_exits_0(monkeypatch, tmp_path, capsys):
    calls = []

    def _fake(export_dir, scenario, n, output_prefix, **kw):
        calls.append((export_dir, scenario, n, output_prefix, kw))
        return _FakeResult()

    monkeypatch.setattr("icaro.run_monte_carlo", _fake)
    scenario_json = tmp_path / "scenario.json"
    scenario_json.write_text(json.dumps({"site": {"latitude": 38.0, "longitude": -0.5}}))

    rc = worker.main(_argv(tmp_path, scenario_json))

    assert rc == 0
    assert json.loads((tmp_path / "result.json").read_text()) == fake_montecarlo_result()
    export_dir, scenario, n, prefix, kw = calls[0]
    assert export_dir == str(tmp_path / "export")
    assert scenario.site.latitude == 38.0
    assert n == 12
    assert prefix == str(tmp_path / "run" / "montecarlo")
    assert kw.get("parallel") is False
    out = capsys.readouterr()
    assert out.out == "" and out.err == ""


def test_null_scenario_passes_none(monkeypatch, tmp_path):
    seen = {}

    def _fake(export_dir, scenario, n, output_prefix, **kw):
        seen["scenario"] = scenario
        return _FakeResult()

    monkeypatch.setattr("icaro.run_monte_carlo", _fake)
    scenario_json = tmp_path / "scenario.json"
    scenario_json.write_text("null")

    assert worker.main(_argv(tmp_path, scenario_json)) == 0
    assert seen["scenario"] is None


def test_exception_prints_message_to_stderr_and_exits_1(monkeypatch, tmp_path, capsys):
    def _boom(*a, **kw):
        raise RuntimeError("motor file missing")

    monkeypatch.setattr("icaro.run_monte_carlo", _boom)
    scenario_json = tmp_path / "scenario.json"
    scenario_json.write_text("null")

    rc = worker.main(_argv(tmp_path, scenario_json))

    assert rc == 1
    assert "motor file missing" in capsys.readouterr().err
    assert not (tmp_path / "result.json").exists()
