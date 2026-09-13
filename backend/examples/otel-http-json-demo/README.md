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

Node 22 currently prints an ExperimentalWarning for OpenTelemetry's ESM
instrumentation loader hook. This is expected: OpenTelemetry requires the hook
to patch ESM imports, and the underlying Node loader mechanism is still marked
experimental.

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

## Scope

This demo does not add or test OTLP protobuf compatibility, authentication,
or Histogram aggregation/alerts. The standalone Phase 6C log verifier does
not test trace-to-log correlation; the Phase 7 unified verifier does. Metrics
compatibility covers Gauge, cumulative monotonic Sum, and explicit Histogram.
Log compatibility covers string-body INFO and ERROR records, resource and
log attributes, instrumentation scope, stack trace mapping, error grouping,
and the existing basic investigation query. Delta, unspecified,
unknown-temporality, and non-monotonic Sum metrics remain unsupported, as do
ExponentialHistogram and Summary. The stored counter is a raw cumulative
sample; this demo does not derive deltas or rates and does not add reset
tracking. Protobuf request and response compatibility remains intentionally
deferred.
