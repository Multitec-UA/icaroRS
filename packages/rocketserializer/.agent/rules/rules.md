---
trigger: always_on
---

# RocketSerializer Project Context & AI Rules

## Project Overview

RocketSerializer is a Python library that provides serialization capabilities for OpenRocket (.ork) files. It acts as a bridge between OpenRocket designs and RocketPy simulations, allowing users to convert .ork files into JSON parameters or directly into executable RocketPy Jupyter notebooks.

## Goal

To seamlessly convert OpenRocket designs into usable data for RocketPy, enabling advanced flight simulations using the data extraction from OpenRocket's validated models.

## Technology Stack

- **Language**: Python (>= 3.8)
- **Core Libraries**:
  - `rocketpy`: For flight simulation physics.
  - `orhelper`: Helper library for interacting with OpenRocket JARs.
  - `beautifulsoup4` (`bs4`) & `lxml`: For parsing the XML structure of .ork files.
  - `numpy`: Numerical operations.
  - `click`: Command-line interface creation.
- **External Requirements**:
  - Java Runtime Environment (JRE) 17+ (required for OpenRocket 23.09).
  - OpenRocket JAR file.

## Project Structure

- **Root**: Contains configuration (`pyproject.toml`, `requirements.in`) and documentation.
- **`rocketserializer/`**: Main package directory.
  - **`cli.py`**: Defines the CLI entry points (`ork2json`, `ork2notebook`).
  - **`ork_extractor.py`**: The core logic engine. It parses the .ork file, orchestrates data extraction, and aggregates results.
  - **`nb_builder.py`**: Logic for generating Jupyter notebooks from the extracted data.
  - **`components/`**: Modular extractors for specific rocket parts (e.g., `motor.py`, `fins.py`, `nose_cone.py`).
- **`tests/`**: Unit and integration tests.
- **`examples/`**: Example .ork files and outputs.

## Development Standards

- **Formatting**: Code must be formatted with **Black**.
  - Line length: 88 characters.
- **Imports**: Sorted using **isort** (profile: black).
- **Linting**: **Pylint** is used. Check `pyproject.toml` for enabled/disabled rules.
- **Docstrings**: Use **NumPy style** docstrings for all functions and classes.
- **Type Hinting**: Encouraged but not strictly enforced in legacy code. New code should be typed.

## Key Workflows & implementation Details

1.  **Extraction Process (`ork_extractor.py`)**:
    - The `ork_extractor` function takes a BeautifulSoup object of the .ork file.
    - It initializes data vectors (time, datapoints) from simulation data present in the .ork file.
    - It iteratively calls specific component search functions (e.g., `search_motor`, `search_nosecone`) from the `components/` submodule.
    - It generates `drag_curve.csv` and `thrust_curve.csv` (or similar) as side effects in the output folder.

2.  **CLI Usage**:
    - `ork2json`:
      - `--filepath`: Link to the .ork file. (Mandatory)
      - `--output`: Path to the output folder. (Optional, defaults to input folder)
      - `--ork_jar`: Path to the OpenRocket JAR file. (Optional, tries to find in current dir)
      - `--encoding`: Encoding of the .ork file. (Optional, default: utf-8)
      - `--verbose`: Show progress of serialization. (Optional, default: False)
    - `ork2notebook`:
      - Similar options to `ork2json`.

## Limitations & Constraints

- **Simulation Data**: The input .ork file **MUST** contain at least one simulation run with data.
- **Language**: The .ork file must be saved in **English**.
- **Rocket Configuration**:
  - Single stage only.
  - Single motor only.
  - Single nose cone only.

## Instructions for Future Agents

- **Context Awareness**: Before making changes to extraction logic, verify where the data comes from in the OpenRocket XML structure.
- **Dependencies**: Remember this project relies on a headless OpenRocket JAR execution via `orhelper`. Changes affecting the JAR interaction must be tested carefully.
- **Testing**: Run tests using `pytest` or the provided `run-tests.sh` script. Ensure you have the OpenRocket JAR available in the environment if running integration tests.
- **Refactoring**: When modifying `ork_extractor.py`, ensure that the dictionary keys in the returned `settings` object remain consistent, as downstream tools (like `nb_builder.py`) rely on them.

## Data Approximations

- **Motor Properties**: Some properties are not directly available in standard `.ork` simulation exports and are approximated in `components/motor.py`:
  - `dry_inertia` is set to `(0, 0, 0)`.
  - `center_of_dry_mass` is set to `0`.
  - Nozzle and throat radii are estimated based on grain geometry.
  - **Do not attempt to 'fix' these by searching for non-existent tags unless you are certain the data source has changed.**

## Notebook Generation

- **`nb_builder.py`**:
  - Tightly coupled to the `parameters.json` structure output by `ork_extractor.py`. Changes to dictionary keys in the extractor must be reflected here.
  - Generates a `simulation.ipynb` file.
  - **Dependency**: Uses `os.system("black ...")` to format the notebook. Ensure `black` is available in the system PATH.
