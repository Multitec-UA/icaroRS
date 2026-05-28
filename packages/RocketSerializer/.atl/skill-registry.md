# Skill Registry — RocketSerializer

## Project Context
- **Name**: rocketserializer
- **Type**: Python library + CLI tool
- **Purpose**: Convert OpenRocket `.ork` files into RocketPy-compatible `parameters.json` and Jupyter notebooks
- **Python**: >=3.8, use `python3` on this machine
- **Entry points**: `ork2json`, `ork2notebook` CLI commands (via Click)

## Stack
| Layer | Tool/Library |
|-------|-------------|
| Language | Python 3.8–3.12 |
| CLI | click >= 8.0.0 |
| ORK parsing | orhelper == 0.1.3 + OpenRocket .jar (jpype-based) |
| XML parsing | BeautifulSoup4 (bs4) + lxml |
| Output format | RocketPy parameters.json (dict → JSON) |
| Notebook gen | nbformat >= 5.2.0 |
| Math | numpy |
| Config | pyyaml |

## Architecture
```
cli.py (ork2json / ork2notebook)
  └── ork_extractor.py          ← main pipeline
        └── components/
              ├── drag_curve.py
              ├── environment.py
              ├── fins.py
              ├── flight.py
              ├── id.py
              ├── motor.py
              ├── nose_cone.py
              ├── open_rocket_wrangler.py
              ├── parachute.py
              ├── rail_buttons.py
              ├── rocket.py
              ├── stored_results.py
              └── transition.py
  └── nb_builder.py             ← NotebookBuilder (parameters.json → .ipynb)
  └── _helpers.py               ← shared utilities
```

## Conventions
- **Formatter**: black (line-length=88) + isort (profile=black)
- **Linter**: pylint (max-line-length=88) + flake8
- **Type checker**: mypy (declared in dev deps)
- **Commit style**: conventional commits
- **CODEOWNERS**: @Gui-FernandesBR @juliomachad0

## Testing
- **Runner**: pytest 7.4.0
- **Coverage**: pytest-coverage
- **Test location**: `tests/`
- **Test layers**: acceptance only (no unit tests found)
  - `tests/acceptance/test_ork_extractor.py` — parametrized over 3 real rockets
  - `tests/conftest.py` — fixtures load actual `.ork` files via orhelper + OpenRocket JAR
- **Run command**: `python3 -m pytest tests/`
- **NOTE**: pytest step is commented out in CI (`test-pytest.yaml`) — tests require OpenRocket JAR and Java runtime; run locally only
- **CI**: GitHub Actions — linter on push, pytest on PR (pytest step disabled in CI)

## Compact Rules
1. Use `python3`, never `python`
2. Format with black (88 chars) before committing; run isort with black profile
3. Component extractors live in `rocketserializer/components/` — one file per rocket component
4. Each extractor function takes a BeautifulSoup object (`bs`) and/or `ork` (orhelper doc) as primary args
5. Tests require the OpenRocket JAR file (`tests/OpenRocket-15.03.jar`) — do not run in environments without Java
6. Output schema is `parameters.json` with top-level keys: `id`, `environment`, `rocket`, `nosecones`, `trapezoidal_fins`, `tails`, `parachutes`, `rail_buttons`, `motors`, `flight`, `stored_results`
7. Never build after changes (per project conventions)

## User Skills (trigger table)
| Context | Skill |
|---------|-------|
| Go tests, Bubbletea TUI | go-testing |
| Creating new AI skills | skill-creator |
| Python tests for rocketserializer | Use pytest patterns; fixture approach via conftest.py |
