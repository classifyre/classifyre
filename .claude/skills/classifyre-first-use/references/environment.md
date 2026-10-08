# Environment: connecting to a live instance

## Contents

- [Finding the API](#finding-the-api)
- [MCP: connecting](#mcp-connecting)
- [What lives on MCP vs REST only](#what-lives-on-mcp-vs-rest-only)
- [Known blockers and their workarounds](#known-blockers-and-their-workarounds)
- [Reading the instance's own state](#reading-the-instances-own-state)

---

## Finding the API

Where the API lives depends on how the instance was started:

1. **All-in-one Docker image** (the usual case for a first-use run). Everything is behind one published port, and the API is under `/api`: with the default `-p 3000:3000`, the base URL is `http://127.0.0.1:3000/api`. Confirm with `curl -fsS http://127.0.0.1:3000/api/ping` (expects `pong`), and `docker ps` for a remapped host port.
2. **Local development.** `http://localhost:8000` directly, or `http://localhost:8811` when port-forwarded from k3d by Skaffold.
3. **Kubernetes.** Whatever the API ingress resolves to.

Every namespaced endpoint sits under the workspace: `<base>/<namespace-slug>/<endpoint>`. The all-in-one image creates a workspace called `default` on first boot, so `http://127.0.0.1:3000/api/default/sources` is the shape you want. `GET <base>/namespaces` lists them and is not namespaced.

Record the resolved base URL in the ledger. If a later action behaves oddly, the first question is whether you are still talking to the same namespace.

## MCP: connecting

- Endpoint: `POST /<namespace>/mcp` — it is namespaced, and a bare `POST /mcp` 404s. Through the all-in-one image that is `http://127.0.0.1:3000/api/default/mcp`.
- Auth: `Authorization: Bearer inmcp_<uuid>.<secret>` — the `inmcp` prefix is the token format.
- Tokens are managed through instance settings / MCP administration, which is a **REST-only surface** (see below). Create one there, or in the web UI's MCP settings.
- MCP must be enabled on the instance (`mcpEnabled`).

Sanity-check the connection by listing tools and reading a trivial state query before doing anything that mutates.

## What lives on MCP vs REST only

The first run found the MCP surface covers ~71 tools spanning: source discovery/config/validation/connection tests/runs; run logs and stopping; asset and finding search/detail/update; custom detector creation, validation, tests, training and extraction coverage; inquiries and live matcher previews; cases, evidence, findings, hypotheses/threads, support links, graphs, timelines; correlation config, exclusions, occurrences and recompute.

**Not on MCP — REST fallback required:**

| Surface | Notes |
|---|---|
| Autopilot: status, agents, runs, activity, memory, usage, tools, system brief | The whole agent layer. This is the largest gap (G-005). |
| Instance settings and MCP administration | Including the token you need to connect in the first place. |
| General graph pivot/expand/manual-edge operations | Correlation graph read is REST-only (G-017). |
| Sandbox detector runs, some exports/charts | See the sandbox caveat below. |

Every time you fall back, log it as an MCP coverage gap with the specific operation. That list is a deliverable in its own right — it is how the MCP surface gets prioritised.

**Sandbox caveat:** the sandbox is slated to be folded into a source type rather than remaining standalone. Confirm what exists on the build under test before reporting sandbox behaviour; it may be absent, changed, or unchanged.

## Known blockers and their workarounds

These cost the first run real time. Recognise them fast.

| Blocker | Symptom | Workaround |
|---|---|---|
| **MCP client timeout on long tools** (G-009) | `run_detector_tests` exceeds a ~300 s client limit and returns only a timeout — while the server keeps going and persists per-scenario results | Use the REST run endpoint for a bounded retest, then read persisted scenarios (`list_detector_test_scenarios`). The results are usually there; the transport gave up, not the work. |
| **Detector config validation rejects valid schemas** (G-001) | `validate_detector_config` fails a correct bare GLiNER2/REGEX pipeline schema with `data must match exactly one schema in oneOf` | Validate locally against `#/definitions/AnyPipelineSchema` in `packages/schemas`. Detector *creation* still works — the validator is wrong, not your config. |
| **No MCP delete for test scenarios** (G-010) | Cannot remove an obsolete scenario through MCP | REST `DELETE /custom-detectors/{detectorId}/test-scenarios/{scenarioId}` |
| **No MCP per-run asset progress** (G-013) | Cannot watch a run's per-asset progress live | REST `GET /runners/{runnerId}/assets/progress` |
| **Sandbox responses inline file bytes** (G-024) | Creating a sandbox run with a real file returns the bytes as a JSON integer-keyed object — a multi-million-token response that truncates | Filter with `jq 'del(.inputData)'`. Verify whether this still applies on your build. |

If you hit a blocker not on this list, that is a finding — record what you expected, what you tried, and what unblocked it.

## Reading the instance's own state

Useful truth sources, roughly in order of trustworthiness:

1. **Direct entity queries** — search sources/assets/findings/runs. These are the store.
2. **Run logs and per-asset progress** — what actually happened during a scan.
3. **Runner counters** — improved recently, but see the regression watch list before trusting them.
4. **The autopilot system brief** — a *claim*, written by an agent. Useful context, not evidence.
5. **Agent memory and run summaries** — least trustworthy. The first run found three separate false "no findings" memories written while the instance held thousands, and summaries claiming "11 applied" for runs with zero persisted decisions.

When two of these disagree, prefer the lower number on this list, and record the disagreement — it is usually a bug.
