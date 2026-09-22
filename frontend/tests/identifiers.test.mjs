import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import TestRenderer, { act } from "react-test-renderer";
import { createServer } from "vite";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const vite = await createServer({
  root: process.cwd(), appType: "custom", logLevel: "silent", server: { middlewareMode: true },
});
test.after(async () => vite.close());
const load = modulePath => vite.ssrLoadModule(modulePath);
const identifiers = await load("/src/components/ExactIdentifiers.tsx");
const references = await load("/src/components/FindingReferences.tsx");
const priority = await load("/src/components/EvidencePriority.tsx");
const story = await load("/src/components/EvidenceStory.tsx");
const trace = await load("/src/components/TraceTree.tsx");
const evidence = await load("/src/components/Evidence.tsx");
const groups = await load("/src/components/EvidenceGroups.tsx");
const review = await load("/src/components/FindingEvidenceReview.tsx");
const candidates = await load("/src/components/CauseCandidateRanking.tsx");
const related = await load("/src/components/RelatedEvidence.tsx");
const signals = await load("/src/components/StructuralSignals.tsx");
const integrity = await load("/src/components/IntegrityIssues.tsx");
const timeline = await load("/src/components/FindingsTimeline.tsx");
const overview = await load("/src/components/InvestigationOverview.tsx");
const targets = await load("/src/lib/investigationTargets.ts");
const correlations = await load("/src/lib/correlations.ts");
const data = await load("/src/data/investigationDataSource.ts");
const fixtureByLabel = Object.fromEntries(data.fixtureOptions.map(option => [option.label, option.alertId]));
const resolved = await data.fixtureInvestigationDataSource.getInvestigation(fixtureByLabel.Resolved);

const uuid = "Ac77F875-C18d-4C92-9ba4-4a5540744679";
const traceId = `  Trace/${uuid}?x=1&y=<reserved>#fragment  `;
const spanId = `Span:${uuid}:CaseSensitive`;
const missingId = `missing/${uuid}?a=1&b=<value>`;
const message = `Supplied prose keeps ${uuid} exactly, including its case.`;
const timestamp = "2026-09-14T12:34:56.789Z";

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

function codeValues(renderer) {
  return renderer.root.findAllByType("code").map(textOf);
}

function assertExactCodes(renderer, values) {
  for (const value of values) assert.ok(codeValues(renderer).includes(value), `Exact code missing: ${JSON.stringify(value)}`);
}

function assertHumanClosedDisclosures(renderer, values) {
  for (const disclosure of renderer.root.findAllByType("details")) {
    assert.notEqual(disclosure.props.open, true);
    const summary = disclosure.findByType("summary");
    for (const value of values.filter(value => value.length > 0)) assert.equal(textOf(summary).includes(value), false);
    assert.equal(summary.findAllByType("a").length, 0);
    assert.equal(summary.findAllByType("button").length, 0);
  }
}

function assertNavigationOutsideSummary(anchor) {
  for (let ancestor = anchor.parent; ancestor; ancestor = ancestor.parent) assert.notEqual(ancestor.type, "summary");
}

const finding = { ...resolved.findings[0], id: `finding/${uuid}?exact=1`, message, traceId, spanId, timestamp };
const rank = { ...resolved.evidenceRanks[0], findingId: finding.id, reasons: [message] };
const span = {
  ...resolved.traces[0], traceId, spanId, service: "checkout", operation: message, durationMs: 17,
  status: "error", children: [],
};
const exactLog = { service: "checkout", level: "error", message, timestamp, traceId, spanId };
const group = {
  ...resolved.evidenceGroups[0], id: `group/${uuid}`, message, findingIds: [finding.id], findingCount: 1,
  correlationIds: [missingId], correlationCount: 1, traceIds: [traceId], startedAt: timestamp, endedAt: timestamp,
};

test("exact identifiers use a human native disclosure and preserve full selectable labelled values", async () => {
  const longId = `${uuid}/`.repeat(100);
  const entries = [{ label: "Trace ID", value: traceId }, { label: "Span ID", value: spanId }, { label: "Long ID", value: longId }];
  const before = structuredClone(entries);
  await withRenderer(identifiers.ExactIdentifiers, { identifiers: entries, className: "mt-9" }, renderer => {
    const disclosure = renderer.root.findByType("details");
    assert.ok(disclosure.props.className.split(/\s+/).includes("mt-9"));
    assert.equal(textOf(disclosure.findByType("summary")), "Show IDs");
    assert.equal(disclosure.props.open, undefined);
    assert.equal(disclosure.findByType("summary").props.onClick, undefined);
    assert.deepEqual(disclosure.findAllByType("dt").map(textOf), entries.map(entry => entry.label));
    assert.deepEqual(codeValues(renderer), entries.map(entry => entry.value));
    for (const code of renderer.root.findAllByType("code")) {
      const classes = code.props.className.split(/\s+/);
      for (const name of ["select-text", "whitespace-pre-wrap", "break-all", "font-mono", "text-xs"]) assert.ok(classes.includes(name));
      assert.equal(classes.includes("truncate"), false);
    }
    assertHumanClosedDisclosures(renderer, entries.map(entry => entry.value));
    assert.deepEqual(entries, before);
  });
});

test("exact identifiers omit an empty collection but do not trim or filter supplied empty values", async () => {
  assert.equal(renderToStaticMarkup(React.createElement(identifiers.ExactIdentifiers, { identifiers: [] })), "");
  await withRenderer(identifiers.ExactIdentifiers, {
    identifiers: [{ label: "Empty supplied ID", value: "" }, { label: "Whitespace supplied ID", value: " \t " }],
    summary: "Reference identifiers",
  }, renderer => {
    assert.equal(textOf(renderer.root.findByType("summary")), "Reference identifiers");
    assert.deepEqual(codeValues(renderer), ["", " \t "]);
    assert.deepEqual(renderer.root.findAllByType("dt").map(textOf), ["Empty supplied ID", "Whitespace supplied ID"]);
  });
});

test("finding references show a readable missing warning with no fabricated link and preserve valid navigation", async () => {
  const navigated = [];
  await withRenderer(references.FindingReferenceList, {
    references: [{ id: missingId }, { id: finding.id, finding }], onNavigateFinding: id => navigated.push(id),
  }, async renderer => {
    const rows = renderer.root.findAllByType("li");
    assert.match(textOf(rows[0]), /Linked finding unavailable in this investigation/);
    assert.equal(rows[0].findAllByType("a").length, 0);
    assert.equal(rows[0].findAllByType("p")[0].children.includes(missingId), false);
    assertExactCodes(renderer, [missingId]);
    assertHumanClosedDisclosures(renderer, [missingId]);
    const link = renderer.root.findByType("a");
    assert.equal(link.props.href, `#${correlations.findingDomId(finding.id)}`);
    assertNavigationOutsideSummary(link);
    await act(async () => link.props.onClick());
    assert.deepEqual(navigated, [finding.id]);
  });
});

test("priority and evidence story missing branches retain readable warnings and exact identifiers without fake targets", async () => {
  const missingRank = { ...rank, findingId: missingId };
  const cases = [
    [priority.EvidencePriority, { ranks: [missingRank], findings: [], selectedFindingId: null, onSelectFinding() {} }],
    [story.EvidenceStory, {
      ranks: [missingRank], findings: [], evidenceGroups: [{ ...group, findingIds: [missingId] }], correlations: [], signals: [],
      selectedFindingId: null, selectedGroupId: null, onReviewFinding() {}, onReviewGroup() {},
    }],
  ];
  for (const [Component, props] of cases) {
    await withRenderer(Component, props, renderer => {
      assert.match(textOf(renderer.root), /Linked finding unavailable/);
      assertExactCodes(renderer, [missingId]);
      assertHumanClosedDisclosures(renderer, [missingId]);
      assert.equal(renderer.root.findAllByType("a").some(anchor => anchor.props.href === `#${correlations.findingDomId(missingId)}`), false);
      if (Component === priority.EvidencePriority) {
        assert.equal(renderer.root.findByType("article").props.title, `Ordering reasons: ${message}`);
      } else {
        assert.ok(textOf(renderer.root).includes(message));
      }
    });
  }
});

test("trace identifier disclosures preserve exact matching counts log anchors timestamps and callback references", async () => {
  const logs = [exactLog, { ...exactLog, message: "Second exact log" }, { ...exactLog, traceId: "not-the-trace", message: "Unrelated log" }];
  const selected = [];
  await withRenderer(trace.TraceTree, {
    traces: [span], logs, selectedExactSpan: { traceId, spanId }, onReviewExactSpanLogs: reference => selected.push(reference),
  }, async renderer => {
    assertExactCodes(renderer, [traceId, spanId]);
    assertHumanClosedDisclosures(renderer, [traceId, spanId]);
    assert.ok(textOf(renderer.root).includes(message));
    assert.equal(textOf(renderer.root).includes("Unrelated log"), false);
    const node = renderer.root.findByProps({ id: targets.traceSpanDomId(traceId, spanId) });
    assert.equal(node.props["data-exact-span-log-count"], 2);
    assert.ok(node.props.className.includes("ring-ink"));
    const link = renderer.root.findByType("a");
    assert.equal(link.props.href, `#${targets.logDomId(timestamp, "checkout", 0)}`);
    assertNavigationOutsideSummary(link);
    assert.deepEqual(renderer.root.findAllByType("time").map(time => time.props.dateTime), [timestamp, timestamp]);
    await act(async () => link.props.onClick());
    assert.deepEqual(selected, [{ traceId, spanId }]);
    assert.equal(renderer.root.findByProps({ role: "region" }).props.className.includes("overflow-x-auto"), true);
  });
});

test("telemetry keeps optional IDs absent and exact supplied values messages counts and log targets unchanged", async () => {
  const base = { service: "checkout", level: "error", message, timestamp };
  const logs = [base, { ...base, traceId }, { ...base, spanId }, exactLog];
  await withRenderer(evidence.Evidence, {
    metrics: [], logs, detailsOpen: true, focusedExactSpan: { traceId, spanId },
  }, renderer => {
    for (const [index, expected] of [[], [traceId], [spanId], [traceId, spanId]].entries()) {
      const row = renderer.root.findByProps({ id: targets.logDomId(timestamp, "checkout", index) });
      assert.deepEqual(row.findAllByType("code").map(textOf), expected);
      assert.ok(textOf(row).includes(message));
      assert.equal(row.findByType("time").props.dateTime, timestamp);
      assert.equal(row.findAllByType("dt").some(dt => textOf(dt) === "Trace ID"), expected.includes(traceId));
      assert.equal(row.findAllByType("dt").some(dt => textOf(dt) === "Span ID"), expected.includes(spanId));
    }
    assert.match(textOf(renderer.root), /1 log matches the selected request path and step/);
    assertExactCodes(renderer, [traceId, spanId]);
    assertHumanClosedDisclosures(renderer, [traceId, spanId]);
  });
});

test("evidence groups put raw references in disclosures while retaining human messages windows and selection callbacks", async () => {
  const selected = [];
  await withRenderer(groups.EvidenceGroups, {
    evidenceGroups: [group], correlations: [], findings: [finding], selectedGroupId: null,
    onSelectGroup: id => selected.push(id), detailsOpen: true,
  }, async renderer => {
    assert.equal(textOf(renderer.root.findByType("h3")), message);
    assertExactCodes(renderer, [group.id, traceId, missingId]);
    assertHumanClosedDisclosures(renderer, [group.id, traceId, missingId]);
    assert.match(textOf(renderer.root), /Linked connection unavailable/);
    assert.deepEqual(renderer.root.findAllByType("time").map(time => time.props.dateTime), [timestamp, timestamp]);
    const emphasize = renderer.root.findAllByType("button").find(button => textOf(button) === "Highlight findings");
    await act(async () => emphasize.props.onClick());
    assert.deepEqual(selected, [group.id]);
    const findingLink = renderer.root.findAllByType("a").find(anchor => anchor.props.href === `#${correlations.findingDomId(finding.id)}`);
    assert.ok(findingLink);
    assertNavigationOutsideSummary(findingLink);
  });
});

test("finding review and candidate trace actions keep raw callback values and direct targets outside disclosure summaries", async () => {
  const selected = [];
  const model = {
    finding, rank, priority: 1, evidenceGroups: [], correlations: [], signals: [],
    exactSpanReference: { traceId, spanId }, exactSpan: span, exactSpanLogs: [{ index: 4, log: exactLog }],
  };
  await withRenderer(review.FindingEvidenceReview, {
    id: "existing-review-landmark", review: model, onOpenExactSpanLogs: reference => selected.push(reference),
  }, async renderer => {
    assertExactCodes(renderer, [traceId, spanId]);
    assertHumanClosedDisclosures(renderer, [traceId, spanId]);
    assert.ok(textOf(renderer.root).includes(message));
    const link = renderer.root.findByType("a");
    assert.equal(link.props.href, `#${targets.logDomId(timestamp, "checkout", 4)}`);
    assertNavigationOutsideSummary(link);
    await act(async () => link.props.onClick());
    assert.deepEqual(selected, [{ traceId, spanId }]);
  });
  const candidate = { ...resolved.causeCandidates[0], traceIds: [traceId], reasons: [message] };
  const candidateRank = { ...resolved.causeCandidateRanks[0], candidateId: candidate.id, reasons: [message] };
  await withRenderer(candidates.CauseCandidateRanking, {
    candidates: [candidate], ranks: [candidateRank], facts: resolved.causeCandidateFacts,
    findings: resolved.findings, correlations: resolved.correlations, signals: resolved.signals,
    selectedCandidateId: null, onSelectCandidate() {},
  }, async renderer => {
    const open = renderer.root.findAllByType("button").find(button => textOf(button) === "View details");
    await act(async () => open.props.onClick());
    assertExactCodes(renderer, [traceId]);
    assertHumanClosedDisclosures(renderer, [traceId]);
    assert.ok(textOf(renderer.root).includes(message));
    const link = renderer.root.findAllByType("a").find(anchor => anchor.props.href === `#${targets.traceDomId(traceId)}`);
    assert.ok(link);
    assert.equal(textOf(link).includes(traceId), false);
    assertNavigationOutsideSummary(link);
    await act(async () => link.props.onClick());
    assert.equal(renderer.root.findAllByProps({ role: "dialog" }).length, 0);
  });
});

test("relationship signal and integrity displays do not fabricate optional identifiers or alter factual prose", async () => {
  const correlation = { ...resolved.correlations[0], id: `correlation/${uuid}`, message, findingIds: [], service: "checkout" };
  delete correlation.traceId; delete correlation.spanId;
  const signal = { ...resolved.signals[0], id: `signal/${uuid}`, message, findingIds: [], services: ["checkout"] };
  delete signal.traceId; delete signal.spanId;
  const issue = { id: `issue/${uuid}`, type: "missing_span_reference", message, service: "checkout" };
  const cases = [
    [related.RelatedEvidence, { correlations: [correlation], findings: [], selectedCorrelationId: null, onSelectCorrelation() {}, detailsOpen: true }],
    [signals.StructuralSignals, { signals: [signal], findings: [], selectedSignalId: null, onSelectSignal() {}, detailsOpen: true }],
    [integrity.IntegrityIssues, { issues: [issue], logs: [], traces: [], detailsOpen: true }],
  ];
  for (const [Component, props] of cases) {
    await withRenderer(Component, props, renderer => {
      assert.ok(textOf(renderer.root).includes(message));
      assert.equal(renderer.root.findAllByType("dt").some(dt => ["Trace ID", "Span ID"].includes(textOf(dt))), false);
      assert.equal(renderer.root.findAllByType("code").some(code => [traceId, spanId, "undefined", "null"].includes(textOf(code))), false);
    });
  }
  await withRenderer(integrity.IntegrityIssues, {
    issues: [{ ...issue, traceId, spanId, logTimestamp: timestamp }], logs: [exactLog], traces: [span], detailsOpen: true,
  }, renderer => {
    assertExactCodes(renderer, [traceId, spanId]);
    assertHumanClosedDisclosures(renderer, [traceId, spanId]);
    const hrefs = renderer.root.findAllByType("a").map(anchor => anchor.props.href);
    assert.ok(hrefs.includes(`#${targets.traceSpanDomId(traceId, spanId)}`));
    assert.ok(hrefs.includes(`#${targets.logDomId(timestamp, "checkout", 0)}`));
    for (const link of renderer.root.findAllByType("a")) assertNavigationOutsideSummary(link);
  });
});

test("supplied UUID prose stays verbatim in alert and finding views while exact navigation and timestamps remain", async () => {
  const investigation = { ...resolved, alert: { ...resolved.alert, title: message, message } };
  await withRenderer(overview.InvestigationOverview, { investigation }, renderer => {
    assert.equal(textOf(renderer.root.findByType("h1")), message);
    assert.ok(renderer.root.findAllByType("p").some(paragraph => textOf(paragraph) === message));
  });
  const reviewed = [];
  await withRenderer(timeline.FindingsTimeline, {
    findings: [finding], timeline: [], openSection: "findings", onOpenSection() {}, reviewedFindingId: null,
    onReviewFinding: id => reviewed.push(id),
  }, async renderer => {
    assert.ok(renderer.root.findAllByType("p").some(paragraph => textOf(paragraph) === message));
    assertExactCodes(renderer, [traceId, spanId]);
    assertHumanClosedDisclosures(renderer, [traceId, spanId]);
    assert.equal(renderer.root.findByType("time").props.dateTime, timestamp);
    assert.ok(renderer.root.findAllByType("li").some(row => row.props.id === correlations.findingDomId(finding.id)));
    const action = renderer.root.findAllByType("button").find(button => textOf(button) === "Review linked evidence");
    await act(async () => action.props.onClick());
    assert.deepEqual(reviewed, [finding.id]);
  });
});
