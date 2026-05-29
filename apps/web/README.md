# icaro Web (planned)

Future web interface for icaroRS. Not implemented yet.

It will consume the **icaro API** (see `apps/api/`) over HTTP — the web layer
talks to the API, the API calls the `icaro` domain. The browser never reaches
the simulation code directly.

**Rule:** presentation only. Any new behaviour starts as a use-case in
`packages/icaro/`, gets exposed by the API, and is finally rendered here.
