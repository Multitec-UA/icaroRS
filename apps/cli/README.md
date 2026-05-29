# icaro-cli — command-line interface

A thin delivery layer over the `icaro` domain. Installs the `icaro` command.

## Usage

```bash
icaro --help
icaro simulate <export-dir>     # e.g. Serializer-export-rockets/v1.5.0
```

`simulate` calls `icaro.simulate_from_export(...)` and prints the flight
summary. The CLI parses input and presents output — nothing more. New
behaviour belongs in `packages/icaro/` first, then gets a command here.
