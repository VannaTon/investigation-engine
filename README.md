# Observability Platform

## Local Investigation MVP v0.1

Investigate real telemetry using deterministic candidate ranking, linked
findings, and supporting traces, metrics, and logs. AI explanations are optional;
they do not determine ranking or replace evidence.

- [Local runbook and supported behavior](docs/LOCAL_MVP_RUNBOOK.md)
- [MVP roadmap and acceptance checklist](docs/LOCAL_INVESTIGATION_MVP.md)
- [Phase 12 workflow acceptance record](docs/PHASE_12_WORKFLOW_ACCEPTANCE.md)
- [Phase 13 release closeout and open gates](docs/PHASE_13_RELEASE_CLOSEOUT.md)
- [Frontend API integration](frontend/docs/API_INTEGRATION.md)

Phase 11A-11C implementation and automated coverage are present. Browser
acceptance remains open; Phase 12 has a historical real three-signal verification
but not a completed full-workflow signoff. Phase 13 documentation and final
automated checks are prepared. This is **not yet a completed release**.

For an already-initialized WSL workspace, use `npm run dev:stack` from `backend`,
then open `http://localhost:5173`. Follow the runbook prerequisites first:
fresh empty-database bootstrap is an explicit open release gate.

## Application onboarding and ingestion security

The self-hosted MVP has one local management workspace and separate application
identities. Open `http://localhost:5173/applications`, add an application, and
create an ingestion key. The full key is returned once; only its hash is stored,
and later key lists show metadata and the key prefix, never the secret. Disabling
an application blocks every key for that application, while revoking a key blocks
only that key.

Normal backend startup is secure by default: `INGESTION_AUTH_MODE` defaults to
`required`. Traces, metrics, and logs must send
`Authorization: Bearer <ingestion-key>`; the backend derives
`applicationId` from that key and does not trust an application identity in the
telemetry body. Missing, invalid, or revoked keys are rejected, and disabled
applications receive HTTP 403. There is no unauthenticated fallback in required
mode.

`npm run dev:stack` explicitly starts the local stack with
`INGESTION_AUTH_MODE=development`, which assigns unauthenticated local demo
telemetry to the fixed **Local development** application. Even in development
mode, a supplied malformed or invalid key is rejected. Do not use development
mode for a normal self-hosted deployment.

Before starting an existing installation with required mode, run these commands
from `backend`:

```bash
npm run migrate:up
npm run configure:application-identity-storage
```

The Applications screen supplies the exact OpenTelemetry `http/json` environment
settings for the new key. Existing OTLP paths stay unchanged:
`/v1/traces`, `/otlp/v1/metrics`, and `/otlp/v1/logs`. Protobuf
request/response compatibility remains intentionally deferred.

### Secure onboarding acceptance

Run the full local stack in required-authentication mode from `backend`:

```bash
INGESTION_AUTH_MODE=required npm run dev:stack
```

Then, from `backend/examples/otel-http-json-demo`, run:

```bash
npm run verify:onboarding:secure
```

The verifier rejects missing and unknown keys, creates a disposable application
and one-time ingestion key, confirms listings never expose the key or its hash,
and sends real trace, metric, and log data using OTLP/HTTP `http/json`. It also
proves that an application identity forged inside telemetry cannot override the
identity derived from the key, checks cross-application query isolation, and
preserves one real three-signal investigation for frontend review. Before exit it
disables the preserved rule, verifies disabled-application HTTP 403 and
revoked-key HTTP 401 behavior, revokes the key, and leaves the disposable
application disabled. Its output includes only IDs, the safe key prefix, and the
frontend URL—never the raw key. Failure cleanup attempts the same safe final
state and reports any cleanup operation that could not be completed.

### Continuous integration

The GitHub Actions workflow at `.github/workflows/ci.yml` runs on pushes to
`main`, pull requests, and manual dispatch. It contains:

- backend type-checking, the complete backend test suite, and demo tests;
- frontend type-checking, tests, and a production build; and
- the opt-in alert lifecycle integration test against PostgreSQL 17.

The secure onboarding verifier is intentionally a local/manual acceptance gate,
not a CI job, because it requires the API, Redis, ClickHouse, and all telemetry
workers and creates disposable application, key, alert, and telemetry records.
No repository or provider secret is required by the CI workflow.

Phase 14A application identity and Phase 14B secure onboarding verification are
now implemented. Further features require a separately chosen roadmap; see the
deferred scope in the MVP checklist.

## Product finishing pass

The user-approved product-engineer feedback is being fixed one item at a time,
without adding investigation features. See the [12-item finishing checklist](docs/PRODUCT_FINISHING_PASS.md).
The first fix removes unsupported `COLLECTING` claims and fabricated progress:
unresolved alerts show an evidence snapshot, and resolved alerts show a resolved
evidence window. Alert age does not automatically close it; displayed bounds come
from the fetched response. This UI cleanup does not change alert lifecycle policy
or close the existing release gates.

## Alert Rules (separately approved add-on)

Open `http://localhost:5173/alert-rules` or choose **Alert Rules** in product
navigation. This screen always uses the live API, not investigation fixtures.

1. Export the chosen metric from your application through `/otlp/v1/metrics`.
2. Choose a service observed in metric data from the past 24 hours, then choose
   one of that service's metrics. Names stay exact; trace-only services and
   fixtures are not added to these dropdowns. Set the operator, raw-unit
   threshold, and lookback window. Changing service clears the metric and
   threshold; changing metric clears the threshold and any previous sample check.
3. Use **Check recent samples** to inspect up to 100 samples from the past
   15 minutes. This preview is separate from the 24-hour discovery window.
   Review the observed unit/type warnings before setting a threshold.
4. Save the new rule disabled, review it, then explicitly enable it.

Discovery has distinct loading, empty, and unavailable states. **Refresh choices**
is an explicit action, not an automatic retry loop. Lists are capped at 200 choices
in the UI and show a warning when more exist. An existing rule's exact current
selection remains available even when it has no recent metric data; it is labeled
as a current selection, not invented as an observed value. Discovery never selects
a service, metric, unit conversion, or threshold on the user's behalf.

Rules retain the existing evaluator: any fetched sample breach can trigger, with
at most 500 samples fetched per evaluation. There is no averaging, sustained-breach
calculation, unit conversion, or counter-to-rate conversion. Gauge guidance is not
gauge-only enforcement. Automatic recovery needs the separate alert-recovery
worker, which `dev:stack` does not include. Disabling is not resolving and cannot
cancel an evaluation already in progress.

Editing uses **Save changes** followed by a short confirmation. Confirmation is
required before the single write; **Keep editing** or Escape retains the draft.
There are no invented version numbers or sustained-duration controls.
Saving creates a new disabled rule and disables the original atomically. The old
name/configuration and linked alerts/findings are preserved. A precise revision
token rejects stale or concurrent replacement saves with HTTP 409. Requests are
bounded to 15 seconds in the frontend; an uncertain save requires an explicit
list refresh and review, never automatic resubmission. Unsupported rule types and
malformed configurations remain visible but are not editable. An enabled malformed
metric rule can still be disabled. The UI has no delete action because the existing
delete API cascades linked alerts.

Existing CRUD success responses are retained, including the API's historical
enabled-by-default create behavior when `enabled` is omitted. The new UI explicitly
sends `enabled: false`. New editing endpoints are
`GET /v1/alert-rules/:id/edit-context` and
`POST /v1/alert-rules/:id/replacements` (name, complete config, revisionToken).

The new read-only discovery endpoints are
`GET /v1/metrics/discovery/services?applicationId=<application UUID>` and
`GET /v1/metrics/discovery/metrics?applicationId=<application UUID>&service=<exact service>`.
They return a server-selected UTC window covering the last 24 hours, ordered
choices, and `hasMore`; the metrics response also echoes the service and reports
bounded observed types/units, last-seen time, and metadata truncation. `limit`
defaults to 200 and is capped at 500. Queries use only the scalar `metrics` table,
with per-query time, memory, and scanned-row limits. A failed or over-budget query
returns unavailable, not a quietly incomplete successful result. Existing raw
metric, ingestion, evaluator, storage schema, and alert-history behavior is unchanged.

Dropdown verification checkpoint (2026-09-13): both type checks and the frontend
build pass; frontend tests are 214/214, and backend tests are 200 passed with one
existing optional real-PostgreSQL lifecycle test skipped. A read-only real-storage
check returned one observed service in about 2.9 seconds. The dependent metric
lookup exceeded its five-second query budget (ClickHouse TIMEOUT_EXCEEDED, code
159), so live metric discovery and browser acceptance are still open. Query
budgets were not raised and no telemetry, rules, or historical findings were
changed for this check. Read-only storage metadata reports 2,227 scalar metric
rows and 66,404 total bytes; a large metrics-table scan is not supported by that
evidence. The bounded query-log diagnostic also timed out, so query-specific cost
versus environmental latency is not yet isolated.
Close this add-on only after both real discovery lookups
succeed and the new/edit rule browser workflow is reviewed; do not automatically
start another feature phase.

With the initialized stack and metric worker already running, repeat the scoped
real-storage check from `backend`:

```bash
npx tsx src/scripts/verify-alert-rule-management.ts
```

It checks healthy/breaching OTLP gauges, preserved original findings, concurrent
replacement rejection, and real PostgreSQL rollback. It starts no public listener,
worker, or provider call. It removes only its uniquely owned disposable rules and
linked alerts after their stream messages are acknowledged; scoped telemetry stays
in ClickHouse. If safe cleanup cannot be confirmed, it reports exact test rule IDs
and leaves them disabled for inspection. This add-on does not close the earlier
MVP release gates.
