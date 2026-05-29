# icaro API (planned)

Future REST API over the `icaro` domain — likely **FastAPI**. Not implemented yet.

When built it is just another thin adapter, exactly like the CLI:

```
HTTP request → validate/parse → icaro.simulate_from_export(...) → serialize JSON response
```

**Rule (non-negotiable):** no simulation logic here. If a use-case doesn't exist
in `packages/icaro/` yet, add it there first, then expose it. The API depends on
`icaro`; `icaro` never depends on the API.
