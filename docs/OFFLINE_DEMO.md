# Running the demo with no backend

Every screen in the app renders with no service running. Two things make that true, and
neither of them invents a number the project has not already produced.

## 1. Diagnostic reports come from a shipped snapshot

`public/diagnostics/reports/` is a byte-for-byte copy of the policy runtime's own output
tree, `poweshift-backend/data/policy_phase8/runtime_inference_reports_v2/` — the same
index, summaries and per-profile reports the live backend serves over HTTP. The report
page reads the real stored decisions, not placeholders.

`src/lib/backend/runtime.ts` decides where to read from:

| `NEXT_PUBLIC_POWESHIFT_API_URL` | Behaviour |
| --- | --- |
| unset (the default) | Reads the snapshot directly. Nothing is attempted over the network. |
| set, backend up | Reads the live backend. |
| set, backend down | Falls through to the snapshot rather than failing. |

Which one answered is carried on the catalog as `origin`, and the race page's backend
panel prints it — `Policy backend · Live runtime` or `Policy backend · Stored snapshot`.
The app never implies a live run it did not have.

To refresh the snapshot after the backend regenerates its reports:

```bash
rsync -a --delete \
  ../poweshift-backend/data/policy_phase8/runtime_inference_reports_v2/ \
  public/diagnostics/reports/
```

The live WebSocket runtime (`/runs/{id}/stream` and `/runs/{id}/live`) has no snapshot
equivalent — a stream of live recommendations only means something with a policy running.
Those stay dark without a backend, which is the honest state.

## 2. The race map is the real circuit

`src/lib/race/circuits.ts` holds recorded centrelines for the nine circuits the setup
screens offer, in metres. They are extracted from the position telemetry the previous
backend curated in `track-shift/data/ml_datasets` — one flying lap per circuit, resampled
by arc length. Silverstone is Silverstone.

Regenerate them with:

```bash
python3 scripts/generate_circuits.py
```

The setup screen's chosen event flows through to `FixtureRaceSource`, so the circuit,
its lap distance and its base lap time all follow the selection. An event with no
recorded outline falls back to a generated loop, labelled as one in the session's
permitted evidence.

## What is still a fixture

The 23-car race itself — the field, its strategies, the neutralisations, the battles — is
the generated review fixture it has always been, and the page says so above the map. Only
the circuit it is run on and the stored diagnostic reports beside it are real.

`/race` (the older qualifying-lap dashboard) still expects the previous backend's
WebSocket at `ws://localhost:8000/api/stream/simulation` and is not reachable from the
app's navigation.
