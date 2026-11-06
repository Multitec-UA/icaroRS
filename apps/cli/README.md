# icaro-cli — command-line interface

A thin delivery layer over the `icaro` domain. Installs the `icaro` command.

## Usage

```bash
icaro --help
icaro simulate <export-dir>     # e.g. Serializer-export-rockets/v1.5.0
icaro convert <rocket.ork>      # .ork -> export directory
icaro mc <export-dir> --scenario s.yaml -n 100 [--output PREFIX] [--parallel [--workers K]]
```

`simulate` calls `icaro.simulate_from_export(...)` and prints the flight
summary.

`mc` calls `icaro.run_monte_carlo(...)`: N stochastic flights within the
scenario's `uncertainty` budget. A run takes minutes; live progress goes to
stderr. It prints the attempted/succeeded/failed counts and the apogee AGL
distribution (mean ± std, p5/p50/p95), and writes `PREFIX.inputs.txt`,
`PREFIX.outputs.txt`, `PREFIX.errors.txt` (NDJSON) and `PREFIX.kml` (landing
ellipses, only when at least 3 flights succeed). `PREFIX` defaults to
`./<scenario name>`. Failed flights do not abort the run; the command exits 1
only when no flight succeeds. `--workers` requires `--parallel`. The CLI parses input and presents output — nothing more. New
behaviour belongs in `packages/icaro/` first, then gets a command here.
