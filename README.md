# Observability Platform

An OpenTelemetry-based observability and incident-investigation platform that helps engineers understand failures across distributed services.

## Overview

Modern systems generate large amounts of telemetry: **traces, metrics, and logs**. The difficult part is often not collecting that data, but connecting it into a clear incident story.

This project brings those signals together and organizes them into an investigation that helps engineers answer:

- What happened?
- Which services were involved?
- Where did the failure appear in the request path?
- Which logs, metrics, and spans support the investigation?
- Which service is the strongest place to investigate first?

Instead of presenting telemetry only as separate dashboards, the platform focuses on **evidence-backed incident investigation**.

```text
Applications
     ↓
OpenTelemetry
     ↓
Traces + Metrics + Logs
     ↓
Ingestion and processing
     ↓
Evidence correlation
     ↓
Investigation
     ↓
Ranked places to investigate
```

---

## What the Platform Helps With

The platform is designed to reduce the amount of manual work required to investigate incidents in distributed systems.

It helps engineers:

- Collect telemetry through OpenTelemetry.
- Follow requests across multiple services.
- Connect logs to the exact trace or span that produced them.
- Identify metric anomalies around an incident.
- Group related evidence.
- Understand how failures propagate through a request path.
- Prioritize which service to investigate first.
- Inspect the evidence behind that priority.
- Acknowledge and resolve alerts from the investigation workflow.

The ranking is **deterministic and evidence-based**. A highly ranked service is a recommended investigation starting point, not a guaranteed root cause.

---

## Main Workflow

A typical incident moves through the platform like this:

```text
Service failure
     ↓
Trace, metric, and log telemetry
     ↓
Alert
     ↓
Investigation
     ↓
Connected evidence
     ↓
Candidate services
     ↓
Evidence-based ranking
     ↓
Engineer reviews the evidence
     ↓
Acknowledge / Resolve
```

---

# Core Capabilities

## OpenTelemetry Ingestion

The platform accepts OpenTelemetry telemetry over **OTLP/HTTP JSON**.

Current signal support includes:

- Traces
- Logs
- Gauge metrics
- Cumulative counters
- Explicit histograms

`gzip` transport is supported for the OTLP receivers.

---

## Distributed Tracing

The platform reconstructs request paths using real trace and span relationships.

Example:

```text
gateway
  └── checkout
        └── payment
```

This makes it possible to see:

- Where failures appeared.
- Which service was the observed failing leaf.
- Whether a service was an upstream error ancestor.
- How a failure propagated through the request path.

---

## Log and Trace Correlation

Logs can carry trace and span context.

When both identifiers match, the platform can connect a log to the exact operation that produced it.

Example:

```text
checkout span
     └── ERROR log emitted inside this span
```

This provides stronger evidence than matching only by service name or timestamp.

---

## Metric Evidence

Metrics can contribute evidence around an incident window.

The current implementation supports scalar metrics such as:

- Gauges
- Cumulative counters

It also supports lossless storage of explicit histograms.

---

## Evidence-Backed Investigations

Investigations combine telemetry into structured evidence such as:

- Trace failures
- Log errors
- Metric anomalies
- Same-trace relationships
- Same-span relationships
- Cross-service failure patterns
- Request-path position

Related evidence is grouped so engineers can inspect the incident as a connected story instead of searching each telemetry source independently.

---

# Candidate Ranking

Services with relevant failure evidence can become investigation candidates.

Candidates are ranked using deterministic facts such as:

- Failure severity
- Position in the request path
- Diversity of supporting evidence
- Number of failure findings

The frontend shows **why** a candidate appears where it does.

The ranking is intended to answer:

> Where should I investigate first?

It does **not** claim:

> This is definitely the root cause.

---

# Alert Lifecycle

Alerts can move through the following lifecycle:

```text
Firing
   ↓
Acknowledged
   ↓
Resolved
```

The investigation workflow allows engineers to:

- Acknowledge incidents.
- Manually resolve incidents.
- Preserve the relevant investigation window.

---

# Optional AI Explanation

AI can generate a readable explanation of an existing investigation.

It is intentionally separate from the core analysis:

```text
Deterministic investigation
          ↓
Optional AI explanation
```

The AI does **not**:

- Create the evidence.
- Determine candidate ranking.
- Replace the deterministic investigation engine.

If the external AI provider is unavailable, the investigation remains usable.

---

# Investigation Experience

The frontend is organized around **understanding an incident** rather than browsing raw telemetry.

Main areas include:

- Alert overview
- Investigation window
- Ranked investigation candidates
- Evidence story
- Request path
- Findings
- Grouped evidence
- Connections
- Metrics and logs
- Data-quality checks
- Optional AI explanation

Users can search and filter findings by:

- Service
- Severity
- Finding type
- Message text

Raw identifiers such as trace IDs and span IDs remain available when needed, but are kept visually secondary to human-readable evidence.

---

# Investigations Workspace

The `/investigations` workspace provides a place to find and manage alerts.

It supports:

- Search
- Status filters
- Sorting
- Refresh
- Loading states
- Error states
- Returning to the same search/filter context after viewing an investigation

---

# Architecture

The platform uses a **streaming architecture** so telemetry ingestion is separated from storage and investigation processing.

```text
Applications
     ↓
OpenTelemetry / OTLP
     ↓
Fastify ingestion API
     ↓
Redis Streams
     ↓
Telemetry workers
     ↓
┌──────────────────────┬──────────────────────┐
│      ClickHouse      │     PostgreSQL       │
│  Telemetry Storage   │    Alerts / State    │
└──────────────────────┴──────────────────────┘
              ↓
       Investigation Engine
              ↓
          React UI
```

## Architecture Responsibilities

| Component            | Responsibility                         |
| -------------------- | -------------------------------------- |
| Applications         | Generate telemetry                     |
| OpenTelemetry        | Standardize and transport telemetry    |
| Fastify API          | Receive OTLP telemetry                 |
| Redis Streams        | Decouple ingestion from processing     |
| Telemetry Workers    | Process telemetry asynchronously       |
| ClickHouse           | Store telemetry data                   |
| PostgreSQL           | Store alerts and application state     |
| Investigation Engine | Correlate evidence and rank candidates |
| React UI             | Present investigations and workflows   |

---

# Main Technologies

- **Node.js**
- **TypeScript**
- **Fastify**
- **Redis Streams**
- **ClickHouse**
- **PostgreSQL**
- **React**
- **OpenTelemetry**

---

# Reliability

Telemetry processing uses **Redis consumer groups** and recovery-aware workers.

The system is designed around **at-least-once delivery**, with retry-safe downstream processing where replay could otherwise create duplicates.

Workers include:

- Bounded processing attempts
- Abandoned-message recovery
- Dead-letter handling
- Graceful shutdown
- Retry-safe storage for important side effects

The project does **not** claim globally transactional exactly-once processing across Redis, ClickHouse, and PostgreSQL.

---

# Local Development

The local development stack can be started with:

```bash
cd backend
npm run dev:stack
```

The launcher starts the application services and workers needed for the normal local workflow.

## Local Addresses

| Service  | Address                 |
| -------- | ----------------------- |
| Frontend | `http://localhost:5173` |
| Backend  | `http://localhost:3000` |

## OTLP Endpoints

### Traces

```http
POST /v1/traces
```

### Metrics

```http
POST /otlp/v1/metrics
```

### Logs

```http
POST /otlp/v1/logs
```

---

# Project Status

The current release target is a **local investigation MVP**.

The core workflow is:

```text
Find an alert
     ↓
Open the investigation
     ↓
Review ranked candidates
     ↓
Inspect supporting evidence
     ↓
Acknowledge the alert
     ↓
Resolve the alert
     ↓
Return to the investigations workspace
```

The current finishing work is focused on:

- Usability
- Evidence review
- Final workflow acceptance
- Release documentation

rather than adding new telemetry features.

---

# Current Limitations

This project is currently designed as a **local MVP**, rather than a production multi-tenant observability service.

Important limitations include:

- No production authentication or multi-tenant project isolation.
- No production deployment model yet.
- OTLP support currently focuses on HTTP/JSON rather than protobuf.
- OpenTelemetry Collector onboarding is not yet part of the main setup.
- Server-side pagination for large alert workspaces is not implemented.
- Advanced metric types such as Delta Sum, non-monotonic Sum, ExponentialHistogram, and Summary are not yet supported.
- Histogram alerting and investigation semantics are not yet implemented.
- General error-group investigation support is less complete than the main metric-threshold investigation flow.
- AI explanations depend on an external provider and may be temporarily unavailable.
- Some browser acceptance has been performed manually because automated browser tooling was not always available.
- Throughput optimization such as Redis pipelining and larger ClickHouse batching remains future work.

These limitations are intentionally outside the current local MVP finish line.

---

# Product Direction

The project is exploring a focused product idea:

> **Evidence-backed incident investigation for engineering using OpenTelemetry.**

The goal is **not** to replace every observability dashboard.

The goal is to help an engineer move from:

> "There is an incident."

to:

> "These services are involved.
> This is the strongest place to start.
> Here is the trace, log, and metric evidence supporting that conclusion."
