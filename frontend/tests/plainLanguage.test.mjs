import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { createServer } from "vite";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const vite = await createServer({ root: process.cwd(), appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
test.after(async () => vite.close());
const load = modulePath => vite.ssrLoadModule(modulePath);
const data = await load("/src/data/investigationDataSource.ts");
const candidate = await load("/src/components/CauseCandidateRanking.tsx");
const support = await load("/src/components/SupportTypes.tsx");
const trace = await load("/src/components/TraceTree.tsx");
const evidenceStory = await load("/src/components/EvidenceStory.tsx");
const relatedEvidence = await load("/src/components/RelatedEvidence.tsx");
const structuralSignals = await load("/src/components/StructuralSignals.tsx");
const overview = await load("/src/components/InvestigationOverview.tsx");
const narrative = await load("/src/components/InvestigationNarrativePanel.tsx");
const narrativeErrors = await load("/src/data/investigationNarrativeErrors.ts");
const page = await load("/src/pages/InvestigationPage.tsx");
const investigationErrors = await load("/src/data/investigationErrors.ts");
const lifecycle = await load("/src/components/AlertLifecycleActions.tsx");
const lifecycleData = await load("/src/data/alertLifecycleDataSource.ts");
const candidatePresentation = await load("/src/lib/causeCandidates.ts");
const targets = await load("/src/lib/investigationTargets.ts");
const correlations = await load("/src/lib/correlations.ts");
const fixtureByLabel = Object.fromEntries(data.fixtureOptions.map(option => [option.label, option.alertId]));
const resolved = await data.fixtureInvestigationDataSource.getInvestigation(fixtureByLabel.Resolved);
const firing = await data.fixtureInvestigationDataSource.getInvestigation(fixtureByLabel.Firing);
const tied = await data.fixtureInvestigationDataSource.getInvestigation(fixtureByLabel["Candidate tie"]);
const snapshot = (await load("/fixtures/investigation-narrative.json")).default;
const rawProse = "User-supplied deterministic structural telemetry for Ac77F875-C18d-4C92-9ba4-4a5540744679 must stay verbatim.";

function textOf(node) {
  if (typeof node === "string" || typeof node === "number") return String(node);
  return (node.children ?? []).map(textOf).join("");
}

async function withRenderer(Component, props, inspect) {
  let renderer;
  try {
    await act(async () => { renderer = TestRenderer.create(React.createElement(Component, props)); });
    await inspect(renderer);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
  }
}

const button = (renderer, label) => renderer.root.findAllByType("button").find(node => textOf(node) === label);
const candidateProps = investigation => ({
  candidates: investigation.causeCandidates, facts: investigation.causeCandidateFacts, ranks: investigation.causeCandidateRanks,
  findings: investigation.findings, correlations: investigation.correlations, signals: investigation.signals,
  selectedCandidateId: null, onSelectCandidate() {},
});
const narrativeProps = investigation => ({
  alertId: investigation.alert.id, candidates: investigation.causeCandidates, facts: investigation.causeCandidateFacts,
  ranks: investigation.causeCandidateRanks, findings: investigation.findings, signals: investigation.signals,
  onNavigateFinding() {}, onNavigateSignal() {},
});

test("plain language explains evidence-based ranking once and retains its actual priority order and qualifiers", async () => {
  const backendRanks = [resolved.causeCandidateRanks[2], resolved.causeCandidateRanks[0], resolved.causeCandidateRanks[1]];
  const input = { ...candidateProps(resolved), ranks: backendRanks };
  const before = structuredClone(backendRanks);
  await withRenderer(candidate.CauseCandidateRanking, input, renderer => {
    assert.ok(textOf(renderer.root).includes("Evidence-based ranking"));
    assert.equal(textOf(renderer.root.findByProps({ id: "cause-candidates-heading" })), "Where to start");
    const description = textOf(renderer.root.findByProps({ id: "cause-candidates-description" }));
    assert.match(description, /failure severity, then request-path position,\s*then types of connections and patterns, then failure count/);
    assert.match(description, /same evidence gives the same order \(deterministic ranking\)/);
    assert.equal((description.match(/deterministic/g) ?? []).length, 1);
    assert.match(description, /Candidate rank tells you where to start; finding priority tells you which finding to\s*review first/);
    assert.match(description, /evidence-backed investigation starting points, not\s*confirmed root causes/);
    assert.equal((textOf(renderer.root).match(/confirmed root causes/g) ?? []).length, 1);
    assert.doesNotMatch(textOf(renderer.root), /places\s*to look, not confirmed causes/);
    const articles = renderer.root.findAllByType("article");
    assert.deepEqual(articles.map(article => textOf(article.findByType("h3"))), backendRanks.map(rank => rank.service));
    for (const rank of backendRanks) assert.ok(textOf(renderer.root).includes(`Candidate rank #${rank.rank}`));
    assert.deepEqual(backendRanks, before);
    const section = renderer.root.findByProps({ id: "candidate-ranking" });
    assert.equal(section.props["aria-labelledby"], "cause-candidates-heading");
    assert.equal(section.props["aria-describedby"], "cause-candidates-description");
  });
});

test("one primary root-cause warning replaces nearby repeats while standalone evidence views keep specific context", async () => {
  await withRenderer(evidenceStory.EvidenceStory, {
    ranks: resolved.evidenceRanks,
    findings: resolved.findings,
    evidenceGroups: resolved.evidenceGroups,
    correlations: resolved.correlations,
    signals: resolved.signals,
    selectedFindingId: null,
    selectedGroupId: null,
    onReviewFinding() {},
    onReviewGroup() {},
  }, renderer => {
    const description = textOf(renderer.root.findByProps({ id: "evidence-story-description" }));
    assert.match(description, /Support counts distinct types, not records/);
    assert.doesNotMatch(description, /confirm cause|proof of the cause|root cause/i);
  });

  await withRenderer(relatedEvidence.RelatedEvidence, {
    correlations: resolved.correlations,
    findings: resolved.findings,
    selectedCorrelationId: null,
    onSelectCorrelation() {},
    detailsOpen: true,
  }, renderer => {
    assert.match(textOf(renderer.root), /Connections do not confirm cause/);
  });

  await withRenderer(structuralSignals.StructuralSignals, {
    signals: resolved.signals,
    findings: resolved.findings,
    selectedSignalId: null,
    onSelectSignal() {},
    detailsOpen: true,
  }, renderer => {
    assert.match(textOf(renderer.root), /Patterns do not confirm cause/);
  });
});

test("plain tied-rank language does not invent a winner or replace missing candidate facts", async () => {
  await withRenderer(candidate.CauseCandidateRanking, candidateProps(tied), renderer => {
    assert.match(textOf(renderer.root), /Tied starting points/);
    assert.match(textOf(renderer.root), /Tied ranks are equally placed\. Row order does not pick a winner/);
    const displayed = renderer.root.findAllByType("article").map(textOf).join("|");
    assert.equal((displayed.match(/Candidate rank #1/g) ?? []).length, 2);
    assert.equal(displayed.includes("Candidate rank #2"), false);
    assert.match(displayed, /Tied candidate/);
  });
  await withRenderer(candidate.CauseCandidateRanking, { ...candidateProps(resolved), facts: [] }, async renderer => {
    await act(async () => button(renderer, "View details").props.onClick());
    assert.match(textOf(renderer.root), /Detailed facts are missing for this candidate/);
    assert.match(textOf(renderer.root), /type count comes from its rank, but the list of types is not available/);
    assert.deepEqual(renderer.root.findAllByType(support.SupportTypeCount).map(node => node.props.count), resolved.causeCandidateRanks.map(rank => rank.supportDiversity));
    assert.equal(renderer.root.findAllByType(support.SupportTypeBreakdown).length, 0);
  });
});

test("plain support units still count supplied types once and never represent volume or independent evidence", async () => {
  for (const [count, expected] of [[0, "0 types of connections and patterns"], [1, "1 type of connection or pattern"], [9001, "9001 types of connections and patterns"]]) {
    await withRenderer(support.SupportTypeCount, { count }, renderer => {
      const span = renderer.root.findByType("span");
      assert.equal(textOf(span), expected);
      assert.match(span.props.title, /different connection types and pattern types/);
      assert.match(span.props.title, /Each type counts once, even if it appears many times/);
      assert.match(span.props.title, /not the number of findings or proof that the evidence is independent/);
    });
  }
  const input = { correlationTypes: ["same_span", "same_trace"], signalTypes: ["multi_signal_evidence"] };
  const before = structuredClone(input);
  await withRenderer(support.SupportTypeBreakdown, input, renderer => {
    assert.match(textOf(renderer.root), /2 connection types \+ 1 pattern type/);
    assert.deepEqual(renderer.root.findAllByType("code").map(textOf), [...input.correlationTypes, ...input.signalTypes]);
    assert.deepEqual(input, before);
  });
});

test("request-path language explains trace and span without changing exact step targets or causality limits", async () => {
  const span = { ...resolved.traces[0], operation: rawProse, service: "literal_service.telemetry", children: [], status: "error" };
  const log = { timestamp: "2026-09-14T12:34:56.789Z", service: span.service, level: "error", message: rawProse, traceId: span.traceId, spanId: span.spanId };
  const selected = [];
  await withRenderer(trace.TraceTree, { traces: [span], logs: [log], onReviewExactSpanLogs: reference => selected.push(reference) }, async renderer => {
    assert.equal(textOf(renderer.root.findByProps({ id: "trace-heading" })), "Request path");
    const description = textOf(renderer.root.findByProps({ id: "trace-description" }));
    assert.match(description, /A trace follows a request or operation; a span records one step/);
    assert.match(description, /does not confirm cause/);
    assert.ok(textOf(renderer.root).includes(rawProse));
    assert.ok(textOf(renderer.root).includes(span.service));
    const step = renderer.root.findByProps({ id: targets.traceSpanDomId(span.traceId, span.spanId) });
    assert.equal(step.props["data-exact-span-log-count"], 1);
    const link = renderer.root.findByType("a");
    assert.equal(link.props.href, `#${targets.logDomId(log.timestamp, log.service, 0)}`);
    await act(async () => link.props.onClick());
    assert.deepEqual(selected, [{ traceId: span.traceId, spanId: span.spanId }]);
    assert.equal(renderer.root.findByType("time").props.dateTime, log.timestamp);
    assert.equal(renderer.root.findByProps({ id: "trace-path" }).props["aria-describedby"], "trace-description");
  });
  assert.deepEqual(Object.keys(candidatePresentation.tracePositionPresentations), ["observed_leaf_failure", "error_ancestor", "other_failure"]);
  assert.match(candidatePresentation.tracePositionPresentations.observed_leaf_failure.explanation, /does not confirm where the failure started/);
  assert.match(candidatePresentation.tracePositionPresentations.error_ancestor.explanation, /another recorded failing step below it/);
});

test("plain UI labels leave supplied titles messages services and ranking reasons verbatim", async () => {
  const investigation = { ...resolved, alert: { ...resolved.alert, title: rawProse, message: rawProse, service: "raw.deterministic_service" } };
  await withRenderer(overview.InvestigationOverview, { investigation }, renderer => {
    assert.equal(textOf(renderer.root.findByType("h1")), rawProse);
    assert.ok(renderer.root.findAllByType("p").some(node => textOf(node) === rawProse));
    assert.ok(textOf(renderer.root).includes(investigation.alert.service));
    assert.ok(textOf(renderer.root).includes(investigation.alert.status));
    assert.deepEqual(renderer.root.findAllByType("time").map(node => node.props.dateTime), [investigation.window.from, investigation.window.to]);
  });
  const ranks = resolved.causeCandidateRanks.map(rank => ({ ...rank, reasons: [rawProse] }));
  await withRenderer(candidate.CauseCandidateRanking, { ...candidateProps(resolved), ranks }, async renderer => {
    await act(async () => button(renderer, "View details").props.onClick());
    assert.ok(textOf(renderer.root).includes(rawProse));
    assert.ok(renderer.root.findAllByType("span").some(node => textOf(node) === rawProse));
    assert.deepEqual(ranks.map(rank => rank.reasons), resolved.causeCandidateRanks.map(() => [rawProse]));
  });
});

test("AI snapshot wording leaves raw narrative untouched and preserves backend order and evidence callbacks", async () => {
  const input = structuredClone(snapshot);
  input.narrative.summary.text = rawProse;
  input.narrative.candidates = input.narrative.candidates.map(block => ({ ...block, text: `${rawProse} ${block.candidateId}` }));
  const before = structuredClone(input);
  const navigated = [];
  await withRenderer(narrative.InvestigationNarrativeSnapshotContent, {
    ...narrativeProps(resolved), snapshot: input, onNavigateFinding: id => navigated.push(id),
  }, async renderer => {
    for (const block of [input.narrative.summary, ...input.narrative.candidates]) assert.ok(renderer.root.findAllByType("p").some(node => textOf(node) === block.text));
    const candidateRows = renderer.root.findAllByType("li").filter(node => node.findAllByType("p").some(paragraph => resolved.causeCandidateRanks.some(rank => textOf(paragraph) === rank.service)));
    assert.deepEqual(candidateRows.map(row => row.findAllByType("p").map(textOf).find(value => resolved.causeCandidateRanks.some(rank => rank.service === value))), resolved.causeCandidateRanks.map(rank => rank.service));
    const id = input.narrative.summary.findingIds[0];
    const link = renderer.root.findAllByType("a").find(node => node.props.href === `#${correlations.findingDomId(id)}`);
    assert.ok(link);
    await act(async () => link.props.onClick());
    assert.deepEqual(navigated, [id]);
    assert.deepEqual(input, before);
  });
});

test("AI is optional uses explicit retry and cannot hide the evidence or silently request a new explanation", async () => {
  let calls = 0;
  const dataSource = { async generateNarrative(id, options) {
    calls++;
    assert.equal(id, resolved.alert.id);
    assert.ok(options.signal instanceof AbortSignal);
    if (calls === 1) throw narrativeErrors.createNarrativeApiError("NARRATIVE_PROVIDER_TIMEOUT", 504);
    return snapshot;
  } };
  function Harness() {
    return React.createElement(React.Fragment, null,
      React.createElement(candidate.CauseCandidateRanking, candidateProps(resolved)),
      React.createElement(narrative.InvestigationNarrativePanel, { ...narrativeProps(resolved), dataSource }),
    );
  }
  await withRenderer(Harness, {}, async renderer => {
    assert.equal(calls, 0);
    assert.match(textOf(renderer.root), /Optional help/);
    assert.match(textOf(renderer.root), /AI explains the evidence on this page\. It does not change the ranking/);
    await act(async () => button(renderer, "Generate explanation").props.onClick());
    assert.equal(calls, 1);
    assert.match(textOf(renderer.root.findByProps({ role: "alert" })), /request timed out/);
    assert.match(textOf(renderer.root), /Your evidence and ranking are still available/);
    assert.ok(renderer.root.findByProps({ id: "candidate-ranking" }));
    assert.ok(button(renderer, "Retry explanation"));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    assert.equal(calls, 1);
    await act(async () => button(renderer, "Retry explanation").props.onClick());
    assert.equal(calls, 2);
    assert.ok(textOf(renderer.root).includes(snapshot.narrative.summary.text));
    assert.ok(button(renderer, "Refresh explanation"));
    assert.ok(renderer.root.findByProps({ id: "candidate-ranking" }));
    await act(async () => { await Promise.resolve(); });
    assert.equal(calls, 2);
  });
});

test("plain AI errors preserve classification status cooldown and backend diagnostics without exposing them in the message", () => {
  const cases = [
    ["NARRATIVE_PROVIDER_TIMEOUT", /request timed out/], ["NARRATIVE_PROVIDER_UNAVAILABLE", /temporarily unavailable/],
    ["NARRATIVE_PROVIDER_ERROR", /AI service did not accept the request/], ["NARRATIVE_PROVIDER_INVALID_RESPONSE", /response we could not use/],
    ["NARRATIVE_INVALID_OUTPUT", /not in a usable format/], ["NARRATIVE_GROUNDING_FAILED", /could not be checked against/],
    ["NARRATIVE_SEMANTIC_VALIDATION_FAILED", /disagreed with the evidence-based ranking/], ["NARRATIVE_NOT_CONFIGURED", /not set up/],
    ["NARRATIVE_NETWORK_ERROR", /temporarily unavailable/], ["NARRATIVE_INVALID_RESPONSE", /could not read/],
    ["NARRATIVE_HTTP_ERROR", /temporarily unavailable/], ["UNKNOWN", /temporarily unavailable/],
  ];
  for (const [code, meaning] of cases) {
    const error = narrativeErrors.createNarrativeApiError(code, 502, undefined, rawProse);
    assert.equal(error.code, code); assert.equal(error.status, 502); assert.equal(error.backendMessage, rawProse);
    assert.match(error.message, meaning);
    assert.match(error.message, /Your evidence and ranking are still available/);
    assert.equal(error.message.includes(rawProse), false);
    assert.equal(error.message.includes("deterministic"), false);
    assert.equal(narrativeErrors.normalizeNarrativeApiError(error), error);
  }
  const cooldown = narrativeErrors.createNarrativeApiError("NARRATIVE_GENERATION_COOLDOWN", 429, 0, rawProse);
  assert.equal(cooldown.code, "NARRATIVE_GENERATION_COOLDOWN"); assert.equal(cooldown.status, 429); assert.equal(cooldown.retryAfterSeconds, 0);
  assert.equal(cooldown.message, "An explanation was just created. Try again in 0 seconds.");
  assert.equal(narrativeErrors.normalizeNarrativeApiError(new Error(rawProse)).code, "UNKNOWN");
});

test("plain investigation errors keep distinct categories exact HTTP status and explicit retry without AI calls", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = { title: "" };
  const cases = [
    [new investigationErrors.InvestigationNetworkError("raw-url"), "Could not load this investigation.", /could not connect to the server/],
    [new investigationErrors.InvalidInvestigationResponseError(rawProse), "Could not read this investigation.", /data we could not use/],
    [new investigationErrors.InvestigationHttpError(502, "raw-url"), "Could not load this investigation.", /error 502/],
    [new Error(rawProse), "Investigation unavailable.", /could not be loaded/],
  ];
  try {
    for (const [failure, heading, detail] of cases) {
      let reads = 0; let aiCalls = 0;
      await withRenderer(page.InvestigationPage, {
        alertId: resolved.alert.id, returnHref: "/investigations?source=live&q=keep%20query",
        dataSource: { async getInvestigation(id) { reads++; assert.equal(id, resolved.alert.id); throw failure; } },
        narrativeDataSource: { async generateNarrative() { aiCalls++; return snapshot; } },
      }, async renderer => {
        assert.equal(reads, 1); assert.equal(aiCalls, 0);
        assert.ok(textOf(renderer.root).includes(heading)); assert.match(textOf(renderer.root), detail);
        assert.equal(textOf(renderer.root).includes(rawProse), false);
        assert.equal(renderer.root.findByType("a").props.href, "/investigations?source=live&q=keep%20query");
        await act(async () => button(renderer, "Try again").props.onClick());
        assert.equal(reads, 2); assert.equal(aiCalls, 0);
      });
    }
  } finally {
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
  }
});

test("plain alert actions still require explicit resolution and never imply verified recovery", async () => {
  const writes = []; let reads = 0;
  const next = { ...firing, alert: { ...firing.alert, status: "resolved", resolvedAt: firing.alert.updatedAt } };
  function Harness() {
    const [latest, setLatest] = React.useState(firing);
    return React.createElement(lifecycle.AlertLifecycleActions, {
      alert: latest.alert, onUpdated: setLatest,
      dataSource: { async updateStatus(id, action) { writes.push([id, action]); return next.alert; } },
      investigationSource: { async getInvestigation() { reads++; return next; } },
    });
  }
  await withRenderer(Harness, {}, async renderer => {
    assert.match(textOf(renderer.root), /Acknowledge marks the alert as seen\. Resolve closes the alert/);
    await act(async () => button(renderer, "Resolve").props.onClick());
    assert.equal(writes.length, 0); assert.equal(reads, 0);
    const confirmation = renderer.root.findByProps({ role: "group" });
    assert.equal(confirmation.props["aria-labelledby"], "resolve-confirmation");
    assert.match(textOf(confirmation), /sets an end time for its evidence window/);
    assert.match(textOf(confirmation), /does not confirm that the service has recovered/);
    await act(async () => button(renderer, "Cancel").props.onClick());
    assert.equal(writes.length, 0);
    await act(async () => button(renderer, "Resolve").props.onClick());
    await act(async () => renderer.root.findByProps({ role: "group" }).props.onKeyDown({ key: "Escape" }));
    assert.equal(writes.length, 0);
    await act(async () => button(renderer, "Resolve").props.onClick());
    const confirm = button(renderer, "Resolve alert").props.onClick;
    await act(async () => { confirm(); confirm(); });
    assert.deepEqual(writes, [[firing.alert.id, "resolved"]]); assert.equal(reads, 1);
    assert.match(textOf(renderer.root.findByProps({ role: "status" })), /Change saved\. Investigation refreshed/);
    assert.equal(button(renderer, "Resolve"), undefined);
  });
});

test("plain uncertain and conflict outcomes refresh once without replay or false saved and failed claims", async () => {
  for (const failure of [new lifecycleData.AlertLifecycleError("network"), new lifecycleData.AlertLifecycleError("http", 500), new lifecycleData.AlertLifecycleError("http", 409)]) {
    let writes = 0; let reads = 0;
    const next = { ...firing, alert: { ...firing.alert, status: "acknowledged" } };
    function Harness() {
      const [latest, setLatest] = React.useState(firing);
      return React.createElement(lifecycle.AlertLifecycleActions, {
        alert: latest.alert, onUpdated: setLatest,
        dataSource: { async updateStatus() { writes++; throw failure; } },
        investigationSource: { async getInvestigation() { reads++; return next; } },
      });
    }
    await withRenderer(Harness, {}, async renderer => {
      await act(async () => button(renderer, "Acknowledge").props.onClick());
      const notice = textOf(renderer.root.findByProps({ role: "alert" }));
      if (failure.status === 409) assert.match(notice, /alert changed before your update finished/);
      else assert.match(notice, /could not confirm whether the change was saved/);
      assert.match(notice, /latest (?:alert status is shown|status is shown)/);
      assert.doesNotMatch(notice, /Change saved\.|update failed|service has recovered/i);
      assert.equal(button(renderer, "Acknowledge"), undefined);
      await act(async () => { await Promise.resolve(); });
      assert.equal(writes, 1); assert.equal(reads, 1);
    });
  }
});

test("a saved change with a failed refresh is described honestly and refresh retries only the read", async () => {
  let writes = 0; let reads = 0;
  const next = { ...firing, alert: { ...firing.alert, status: "acknowledged" } };
  function Harness() {
    const [latest, setLatest] = React.useState(firing);
    return React.createElement(lifecycle.AlertLifecycleActions, {
      alert: latest.alert, onUpdated: setLatest,
      dataSource: { async updateStatus() { writes++; return next.alert; } },
      investigationSource: { async getInvestigation() { reads++; if (reads === 1) throw new Error(rawProse); return next; } },
    });
  }
  await withRenderer(Harness, {}, async renderer => {
    await act(async () => button(renderer, "Acknowledge").props.onClick());
    assert.match(textOf(renderer.root.findByProps({ role: "alert" })), /Change saved, but the investigation could not be refreshed/);
    assert.match(textOf(renderer.root), /may be out of date/);
    assert.equal(button(renderer, "Acknowledge").props.disabled, true);
    assert.equal(writes, 1); assert.equal(reads, 1);
    await act(async () => button(renderer, "Refresh investigation").props.onClick());
    assert.equal(writes, 1); assert.equal(reads, 2);
    assert.match(textOf(renderer.root.findByProps({ role: "status" })), /Change saved\. Investigation refreshed/);
  });
});
