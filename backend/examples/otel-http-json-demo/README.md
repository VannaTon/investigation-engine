# OTLP/HTTP JSON auto-instrumentation demo

This isolated demo proves that real Node.js OpenTelemetry
auto-instrumentation can send distributed traces and runtime metrics, and
that the official OpenTelemetry Logs API can send application logs, through
the platform's existing ingestion paths. The trace flow is:

~~~
demo gateway -> demo checkout
       |
       v
OTLP/HTTP http/json
       |
       v
backend /v1/traces -> Redis -> span worker -> ClickHouse
       |
       v
GET /v1/traces/:traceId
~~~

The applications use Node's built-in HTTP module. Their source code does not
create spans or propagate trace headers manually. OpenTelemetry is loaded with
the official zero-code registration module before either application starts.
Because the applications use ECMAScript modules, the verifier also loads
the official OpenTelemetry instrumentation hook required to patch ESM imports.
It uses Node's supported `--import` entry point and `node:module.register()`
to register `@opentelemetry/instrumentation/hook.mjs`; it does not use the
deprecated `--experimental-loader` flag.

## Prerequisites

Start the existing platform dependencies first. Configure Histogram storage
once, then run the API and the workers required by the selected verification:

~~~
docker compose up -d
npm run configure:histogram-metric-storage
npm run dev
npm run span-worker
npm run metric-worker
npm run histogram-metric-worker
npm run worker
~~~

Histogram metric verification also requires these backend `.env` values:

~~~
HISTOGRAM_METRIC_RECOVERY_ENABLED=true
OTLP_EXPLICIT_HISTOGRAMS_ENABLED=true
~~~

The backend is expected at http://127.0.0.1:3000. Redis is expected at
redis://127.0.0.1:6379. Override them with BACKEND_URL and REDIS_URL if needed.

## Install

From this directory:

~~~
npm install
~~~

## Trace verification

~~~
npm run verify
~~~

The verifier starts the two demo services, sends one successful request and
one request whose checkout call returns an error, waits for both traces to be
queryable, validates their structure, checks the span worker pending count,
and stops the demo services.

The child processes are explicitly configured with:

~~~
OTEL_TRACES_EXPORTER=otlp
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://127.0.0.1:3000/v1/traces
OTEL_EXPORTER_OTLP_TRACES_PROTOCOL=http/json
OTEL_EXPORTER_OTLP_TRACES_COMPRESSION=none
OTEL_NODE_ENABLED_INSTRUMENTATIONS=http
~~~

Using the signal-specific traces endpoint means /v1/traces is not appended
automatically. The protocol is deliberately set to http/json because the
platform receiver currently implements OTLP/HTTP JSON-only compatibility.

A successful verification ends with a JSON record whose event is
otel_http_json_demo_verified and includes both trace IDs, their persisted span
counts, and pendingMessages set to zero.

## Runtime metrics verification

~~~
npm run verify:metrics
~~~

This verifier starts a tiny Node process through the official OpenTelemetry
zero-code registration module twice: once without Content-Encoding and once
with gzip. Only runtime-node instrumentation is enabled; the application does
not create metrics manually. The verifier uses Node's `--expose-gc` switch
and triggers one collection so `v8js.gc.duration` is deterministic.

Each run uses a unique service name and a temporary local forwarding proxy.
The proxy observes and validates the real exporter request, then forwards the
exact encoded body and Content-Encoding to the backend. The verifier checks:

- the exporter is explicitly using OTLP/HTTP `http/json`;
- both absent Content-Encoding and gzip reach `/otlp/v1/metrics`;
- Gauge, cumulative monotonic Sum, and explicit-Histogram points are accepted;
- non-monotonic Sum points are counted as unsupported;
- the backend's OTLP partial-success count exactly matches those unsupported
  points;
- the official exporter recognizes and reports the partial-success response;
- accepted Gauges/counters and Histograms reach their separate Redis streams,
  workers, ClickHouse tables, and query APIs with exact OTel metadata;
- none of this verifier's events remain pending in either consumer group; and
- the unique diagnostic services do not create alerts.

The runtime process is explicitly configured with:

~~~
OTEL_TRACES_EXPORTER=none
OTEL_METRICS_EXPORTER=otlp
OTEL_LOGS_EXPORTER=none
OTEL_EXPORTER_OTLP_METRICS_ENDPOINT=http://127.0.0.1:<dynamic-port>/otlp/v1/metrics
OTEL_EXPORTER_OTLP_METRICS_PROTOCOL=http/json
OTEL_EXPORTER_OTLP_METRICS_COMPRESSION=none|gzip
OTEL_NODE_ENABLED_INSTRUMENTATIONS=runtime-node
OTEL_NODE_RESOURCE_DETECTORS=env,process
~~~

The dynamic port belongs to the transparent verification proxy; it forwards
to the backend URL without changing the body or compression. A successful run
ends with a JSON record whose event is
`otel_http_json_metrics_demo_verified`.

Partial success remains expected in Phase 5F2 because non-monotonic Sum is
still unsupported. The receiver accepts Gauge and cumulative monotonic Sum on
the scalar path, mapping the latter's raw cumulative value to the existing
`counter` type. Explicit Histograms such as `v8js.gc.duration` use the
separate distribution path. The verifier proves both paths while confirming
that `v8js.memory.heap.space.size` remains rejected. Diagnostic rows remain
stored under unique service names for inspection.

## Log verification

~~~
npm run verify:logs
~~~

This verifier starts a tiny Node process through the official OpenTelemetry
zero-code registration module and emits one INFO record and one ERROR record
through the official OpenTelemetry Logs API. It runs once without
Content-Encoding and once with gzip, using unique service names and messages
for every execution.

A temporary local forwarding proxy observes and validates the real exporter
request, then forwards the exact encoded body and Content-Encoding to the
backend. Each child process is explicitly configured with:

~~~
OTEL_TRACES_EXPORTER=none
OTEL_METRICS_EXPORTER=none
OTEL_LOGS_EXPORTER=otlp
OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=http://127.0.0.1:<dynamic-port>/otlp/v1/logs
OTEL_EXPORTER_OTLP_LOGS_PROTOCOL=http/json
OTEL_EXPORTER_OTLP_LOGS_COMPRESSION=none|gzip
OTEL_NODE_RESOURCE_DETECTORS=env,process
~~~

The verifier checks:

- the exporter sends OTLP/HTTP JSON to `/otlp/v1/logs`;
- ordinary requests omit Content-Encoding and gzip requests preserve it;
- the backend returns the successful OTLP JSON response;
- both records reach the existing Redis stream, worker, and ClickHouse table;
- severity, resource attributes, instrumentation scope, application
  attributes, and stack trace survive normalization;
- the ERROR record creates exactly one error group;
- the generated investigation contains the error group and error log; and
- all Redis messages created by the verifier are acknowledged.

The log worker must already be running. The verifier never acknowledges,
deletes, or otherwise changes unrelated pending messages. Diagnostic rows and
error groups remain stored under unique names for later inspection.

A successful run ends with a JSON record whose event is
`otel_http_json_logs_demo_verified`, with two stored logs per compression
mode, two error groups, and zero pending verifier messages.

The Logs API is used deliberately because Node auto-instrumentation does not
convert ordinary `console.log` calls into OTLP log records. The application
does not construct an OTLP envelope or call the backend directly.

## Unified investigation verification

~~~
npm run verify:unified:preserve
~~~

This Phase 7 verifier sends one controlled checkout failure while traces,
metrics, and logs are enabled together through the official OpenTelemetry
Node SDK. All exporters are explicitly configured for OTLP/HTTP `http/json`
without Content-Encoding. The checkout process emits its application ERROR
record through the official Logs API while the auto-instrumented checkout
server span is active, and records a cumulative monotonic failure counter
through the official Metrics API.

The verifier proves that the stored log has the exact trace and span IDs of
the checkout leaf error span, the metric is present in the same investigation
window, all three consumer groups drain with zero pending messages and zero
lag, no new DLQ item is created, and the investigation contains same-span and
multi-signal evidence. It reads the real candidate facts and passes the real
candidate ranks through the backend's existing lexicographic comparator before
asserting that checkout ranks first because severity ties and trace position
is decisive.

The `:preserve` command leaves the generated alert and its telemetry available
for the frontend at the printed port-5173 URL. Use `npm run verify:unified` for
a run that deletes its alert rule after verification.

## Secure application onboarding verification

Start the complete local stack in required-authentication mode from the backend
directory:

~~~
INGESTION_AUTH_MODE=required npm run dev:stack
~~~

Then run this command from the demo directory:

~~~
npm run verify:onboarding:secure
~~~

This wrapper owns the disposable application and key lifecycle. It verifies:

- missing keys are rejected for traces, metrics, and logs;
- an unknown well-formed key is rejected;
- application creation returns a one-time key while later listings expose only
  safe metadata and its prefix, never the key or its hash;
- valid trace, metric, and log OTLP/HTTP `http/json` requests are accepted;
- a forged application identity in a trace body cannot override the
  key-derived application identity;
- the real three-signal demo stores every signal, alert, and investigation
  under that same application and cannot be queried through the local
  development application;
- the generated investigation is preserved while its alert rule is disabled;
- a disabled application rejects its otherwise valid key with HTTP 403; and
- after re-enabling the application, revoking the key makes it return HTTP 401.

The final JSON record prints the disposable application ID/name, key ID and
prefix, alert/rule IDs, and a frontend URL. It never prints the raw key. The
application finishes disabled, the key finishes revoked, and the preserved rule
finishes disabled. If verification fails after creation, cleanup still attempts
those safe final states and emits a structured cleanup error if any step fails.

The runner configures signal-specific exporter credentials and bounded
OpenTelemetry deadlines itself. It also limits metric exports to one controlled
30-second interval so a slow development machine does not create an unnecessary
queue backlog. The full key is removed from the unified verifier's inherited
environment before it launches the demo applications, and forwarded child output
is defensively redacted.

Advanced direct use of `verify:unified` against required mode is possible with
`DEMO_APPLICATION_ID` and `DEMO_INGESTION_KEY`, but the secure onboarding
wrapper is preferred because it creates, tests, revokes, and disables its own
resources.

The live secure runner is intentionally not part of GitHub Actions. It requires
the API, Redis, ClickHouse, and all telemetry workers, and it writes disposable
local state. The demo's source-level regression tests remain available through
`npm test`.

## Incident names and local copy tests

New unified demo runs use the incident title **Checkout failures detected** and
the application log message **Checkout failed because inventory is unavailable.**
The measured signal remains a raw cumulative monotonic counter with unit
`{failure}` and an unchanged `>= 1` threshold; neither the title nor the UI
should present it as a percentage or failure rate.

The raw metric selector remains unique per run (`checkout_failures_<run-token>`).
The exact `demo.run_token`, environment, event name, trace IDs, and span IDs
remain in telemetry metadata and verification checks. The log body no longer
contains the run token, so repeated examples of the same failure can share an
error fingerprint; the verifier still identifies its exact log by trace/span
and checks the matching run-token metadata. Historical logs are not rewritten.

Run `npm test` in this example directory for the incident-copy, threshold,
run-isolation, and producer/verifier wiring regression checks. These tests do
not publish telemetry or replace `verify:unified` end-to-end verification.
Changing the generator does not rename existing preserved investigations.

## Scope

This demo does not implement authentication; the secure onboarding wrapper
tests the platform's existing required-mode authentication and trusted
application scoping. It does not add or test OTLP protobuf compatibility or
Histogram aggregation/alerts. The standalone Phase 6C log verifier does not
test trace-to-log correlation; the Phase 7 unified verifier does. Metrics
compatibility covers Gauge, cumulative monotonic Sum, and explicit Histogram.
Log compatibility covers string-body INFO and ERROR records, resource and
log attributes, instrumentation scope, stack trace mapping, error grouping,
and the existing basic investigation query. Delta, unspecified,
unknown-temporality, and non-monotonic Sum metrics remain unsupported, as do
ExponentialHistogram and Summary. The stored counter is a raw cumulative
sample; this demo does not derive deltas or rates and does not add reset
tracking. Protobuf request and response compatibility remains intentionally
deferred.
