"""Unit tests for the convert subprocess worker's mapping logic.

These do NOT spawn a subprocess or start a JVM — they exercise
``run_conversion`` directly with ``convert_ork`` monkeypatched, plus
``main`` writing the outcome JSON.  The real subprocess round-trip is covered
by the integration smoke (a real .ork conversion run twice).
"""

from __future__ import annotations

import json
import sys

from icaro_api.services import convert_worker as worker


def test_run_conversion_ok(monkeypatch, tmp_path):
    export = tmp_path / "export"
    export.mkdir()
    monkeypatch.setattr("icaro.convert_ork", lambda **kw: export)

    outcome = worker.run_conversion("rocket.ork", tmp_path, None)

    assert outcome == {"status": "ok", "export_dir": str(export)}


def test_run_conversion_unavailable(monkeypatch, tmp_path):
    from icaro.convert import ConvertUnavailableError

    def _raise(**kw):
        raise ConvertUnavailableError("install Java 21 and icaro-cli[convert]")

    monkeypatch.setattr("icaro.convert_ork", _raise)

    outcome = worker.run_conversion("rocket.ork", tmp_path, None)

    assert outcome["status"] == "unavailable"
    assert "Java 21" in outcome["hint"]


def test_run_conversion_generic_error(monkeypatch, tmp_path):
    def _boom(**kw):
        raise OSError("JVM cannot be restarted")

    monkeypatch.setattr("icaro.convert_ork", _boom)

    outcome = worker.run_conversion("rocket.ork", tmp_path, None)

    assert outcome["status"] == "error"
    assert "JVM cannot be restarted" in outcome["message"]


def test_main_writes_outcome_json_and_exit_code(monkeypatch, tmp_path):
    export = tmp_path / "export"
    export.mkdir()
    monkeypatch.setattr("icaro.convert_ork", lambda **kw: export)

    result_path = tmp_path / "outcome.json"
    rc = worker.main(
        ["convert_worker", "rocket.ork", str(tmp_path), str(result_path), ""]
    )

    assert rc == worker.EXIT_OK
    written = json.loads(result_path.read_text())
    assert written == {"status": "ok", "export_dir": str(export)}


def test_main_unavailable_exit_code(monkeypatch, tmp_path):
    from icaro.convert import ConvertUnavailableError

    def _raise(**kw):
        raise ConvertUnavailableError("no jar")

    monkeypatch.setattr("icaro.convert_ork", _raise)

    result_path = tmp_path / "outcome.json"
    rc = worker.main(
        ["convert_worker", "rocket.ork", str(tmp_path), str(result_path), ""]
    )

    assert rc == worker.EXIT_UNAVAILABLE
    assert json.loads(result_path.read_text())["status"] == "unavailable"
