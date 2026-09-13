# System Architecture Documentation

This project uses a **layered modular monolith** with **event-driven background workers**.

> **Summary:** It is a modular layered backend with a repository-service-route structure, plus an event-driven worker architecture using Redis, ClickHouse, and Postgres.

---

## Architectural Summary

| Component                | Technology / Strategy  | Responsibility                                                        |
| :----------------------- | :--------------------- | :-------------------------------------------------------------------- |
| **API Layer**            | Fastify                | Fast HTTP routing, schema validation, request handling                |
| **Service Layer**        | TypeScript Use-Cases   | Core business logic and workflow orchestration                        |
| **Data Access Layer**    | Custom Repositories    | Direct abstraction over ClickHouse and PostgreSQL persistence         |
| **Dependency Injection** | Manual Composition     | Explicit wiring of repositories, services, and event publishers       |
| **Message Broker**       | Redis Streams / Queues | Asynchronous event transport and buffering                            |
| **Observability Store**  | ClickHouse             | High-throughput time-series logs, metrics, and trace spans            |
| **Relational Metadata**  | PostgreSQL             | Relational entities (alerts, investigations, incidents, error groups) |

---

## Project Structure & Layers

### 1. Fastify HTTP API Layer

- **Entry Point:** `src/server.ts`
- **App Setup & Plugins:** `src/app.ts`
- **Route Definitions:** `src/routes/*`
  - Examples: `log.routes.ts`, `metric.routes.ts`, `alert.routes.ts`

### 2. Service Layer

- **Business Logic:** `src/services/*`
- Encapsulates core business rules, application flows, and transaction boundaries.
- Examples:
  - `log-ingestion.service.ts`
  - `metric.service.ts`
  - `alert.service.ts`
  - `trace-query.service.ts`

### 3. Repository / Data-Access Layer

- **Persistence Logic:** `src/repository/*`
- Direct data abstraction over ClickHouse (analytical) and Postgres (relational).
- Example: `LogRepository` writes high-volume telemetry logs to ClickHouse.

### 4. Composition Layer (Manual Dependency Injection)

- **Wiring:** `src/composition/*`
- Wires up repositories, services, workers/processors, and publishers manually.
- _Note:_ Uses clean manual DI rather than a heavy reflection framework container (like NestJS).

### 5. Event-Driven Ingestion Pipeline

- Telemetry data is received via Fastify HTTP API endpoints.
- Event publishers push raw ingestion events to **Redis** streams/queues.
- Background workers consume, parse, and process events asynchronously. The
  current ingestion publication and telemetry processing paths are sequential;
  do not assume a worker batching optimization has been implemented.
- **Worker Implementations:** `src/worker/*`

---

## Polyglot Persistence Strategy

```
                          ┌───────────────────────────┐
                          │   Fastify HTTP API Layer  │
                          │      (src/routes/*)       │
                          └─────────────┬─────────────┘
                                        │
                                        ▼
                          ┌───────────────────────────┐
                          │       Service Layer       │
                          │     (src/services/*)      │
                          └─────────────┬─────────────┘
                                        │
           ┌────────────────────────────┼────────────────────────────┐
           │                            │                            │
           ▼                            ▼                            ▼
  ┌─────────────────┐          ┌─────────────────┐          ┌─────────────────┐
  │      Redis      │          │   ClickHouse    │          │    PostgreSQL   │
  │ Stream / Queue  │          │ Analytical Store│          │ Relational Data │
  └────────┬────────┘          └─────────────────┘          └─────────────────┘
           │
           ▼
  ┌─────────────────┐
  │ Background      │
  │ Workers         │
  │ (src/worker/*)  │
  └─────────────────┘
```

- **Redis:** Used for high-throughput message streaming and event queues.
- **ClickHouse:** Optimized for time-series telemetry (logs, metrics, trace spans).
- **PostgreSQL:** Handles relational metadata (alerts, investigations, incidents, error groups).

---

## Narrative Ranking Authority

LLMs do not derive cause-candidate ranking rationale. Candidate order and the
first decisive ranking dimension are computed deterministically and supplied to
the narrative layer as authoritative facts.

Semantic narrative validation checks only a narrow set of explicit ranking
contradictions, including false severity winners, reversed ordering, misuse of
later ranking dimensions, and tie violations. It is not a general
natural-language fact checker.

### Narrative provider resilience

An explicit narrative action first checks the backend's revalidated cache.
A cache miss that passes cooldown makes one provider request; an explicit
refresh can therefore return a cached snapshot. There is no automatic retry.
`LLM_REQUEST_TIMEOUT_MS` sets the finite
provider deadline and defaults to `180000` (three minutes), which accommodates
the slower provider responses observed in local development.

Provider timeouts, network failures, HTTP errors, invalid provider envelopes,
and invalid model output are classified separately in structured server logs.
Client responses remain generic and never include provider bodies, prompts, or
raw model output. A failed generation is not persisted, so deterministic
investigation evidence remains authoritative and available for an explicit
retry.

---

## OTLP/HTTP JSON-only compatibility

The trace ingestion compatibility endpoint is:

```text
POST /v1/traces
Content-Type: application/json
```

It accepts OTLP `ExportTraceServiceRequest` JSON with no `Content-Encoding`
header or with `Content-Encoding: gzip`. The decoded request body is limited to
64 MiB.

Auto-instrumentation and collector compatibility tests must explicitly select
the OTLP HTTP/JSON protocol:

```text
OTEL_EXPORTER_OTLP_PROTOCOL=http/json
OTEL_EXPORTER_OTLP_TRACES_PROTOCOL=http/json
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:3000
```

Binary protobuf requests (`Content-Type: application/x-protobuf`) and protobuf
responses are intentionally deferred. This endpoint must not be described as
full OTLP/HTTP binary compatibility until that transport is implemented and
tested.
