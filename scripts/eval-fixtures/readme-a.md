# Tracebox

Tracebox is a small observability service for single-process Python workers. It
accepts OpenTelemetry spans over HTTP, stores them in SQLite, and renders a
waterfall for one request at a time.

## How it works

1. A worker posts batches of spans to `/v1/spans`. The payload is protobuf.
2. Each batch is validated against a fixed schema and written to a WAL, so a
   crash never loses an acknowledged batch.
3. A reader merges the WAL into a per-trace index once a minute.
4. The web UI fetches one trace by id and lays out its spans by start time.

The index is a single SQLite file. That is deliberate: the target user runs one
box and wants one file to copy when something goes wrong.

## Limitations

- No sampling. Every span is stored.
- The merge is a full scan of the WAL; it is fine up to roughly 10k traces.
- There is no authentication. Run it behind a private network.

## Installation

```sh
pip install tracebox
tracebox serve --db ./traces.db
```
