import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import TestRenderer, { act } from "react-test-renderer";
import { createServer } from "vite";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const vite = await createServer({
  root: process.cwd(),
  appType: "custom",
  logLevel: "silent",
  server: { middlewareMode: true },
});

test.after(async () => {
  await vite.close();
});

const load = (path) => vite.ssrLoadModule(path);
const dataModule = await load("/src/data/investigationDataSource.ts");
const errorsModule = await load("/src/data/investigationErrors.ts");
const httpModule = await load("/src/data/httpInvestigationDataSource.ts");
const responseModule = await load("/src/data/investigationResponse.ts");
const narrativeResponseModule = await load(
  "/src/data/investigationNarrativeResponse.ts",
);
const narrativeDataSourceModule = await load(
  "/src/data/investigationNarrativeDataSource.ts",
);
const narrativeErrorsModule = await load(
  "/src/data/investigationNarrativeErrors.ts",
);
const narrativeTypesModule = await load(
  "/src/types/investigationNarrative.ts",
);
const correlationsModule = await load("/src/lib/correlations.ts");
const evidenceGroupUtilsModule = await load("/src/lib/evidenceGroups.ts");
const formattersModule = await load("/src/lib/formatters.ts");
const appModule = await load("/src/App.tsx");
const pageModule = await load("/src/pages/InvestigationPage.tsx");
const overviewModule = await load("/src/components/InvestigationOverview.tsx");
const alertStatusBadgeModule = await load("/src/components/AlertStatusBadge.tsx");
const findingsModule = await load("/src/components/FindingsTimeline.tsx");
const detailDrawerModule = await load(
  "/src/components/InvestigationDetailSection.tsx",
);

const traceModule = await load("/src/components/TraceTree.tsx");
const relatedModule = await load("/src/components/RelatedEvidence.tsx");
const evidenceGroupsModule = await load("/src/components/EvidenceGroups.tsx");
const evidenceModule = await load("/src/components/Evidence.tsx");
const priorityModule = await load("/src/components/EvidencePriority.tsx");
const evidenceStoryModule = await load("/src/components/EvidenceStory.tsx");
const signalsModule = await load("/src/components/StructuralSignals.tsx");
const integrityModule = await load("/src/components/IntegrityIssues.tsx");
const candidateModule = await load("/src/components/CauseCandidateRanking.tsx");
const supportTypesModule = await load("/src/components/SupportTypes.tsx");
const narrativePanelModule = await load(
  "/src/components/InvestigationNarrativePanel.tsx",
);
const appShellModule = await load("/src/components/AppShell.tsx");
const sidebarModule = await load("/src/components/AppSidebar.tsx");
const fixtureSelectorModule = await load("/src/components/FixtureSelector.tsx");
const topBarModule = await load("/src/components/TopBar.tsx");
const candidateUtilsModule = await load("/src/lib/causeCandidates.ts");
const decisionUtilsModule = await load("/src/lib/investigationDecision.ts");
const evidenceStoryUtilsModule = await load("/src/lib/evidenceStory.ts");
const findingEvidenceReviewModule = await load(
  "/src/lib/findingEvidenceReview.ts",
);
const reviewLocationModule = await load(
  "/src/lib/investigationReviewLocation.ts",
);
const exactSpanLogsModule = await load("/src/lib/exactSpanLogs.ts");
const narrativeUtilsModule = await load("/src/lib/investigationNarrative.ts");
const targetsModule = await load("/src/lib/investigationTargets.ts");
const alertListModule = await load("/src/data/alertListDataSource.ts");
const alertSelectionModule = await load("/src/lib/alertList.ts");
const workspaceModule = await load("/src/pages/InvestigationsPage.tsx");
const lifecycleModule = await load("/src/data/alertLifecycleDataSource.ts");
const lifecycleActionsModule = await load("/src/components/AlertLifecycleActions.tsx");

const fixtureByLabel = Object.fromEntries(
  dataModule.fixtureOptions.map((option) => [option.label, option.alertId]),
);
const resolved = await dataModule.fixtureInvestigationDataSource.getInvestigation(
  fixtureByLabel.Resolved,
);
const firing = await dataModule.fixtureInvestigationDataSource.getInvestigation(
  fixtureByLabel.Firing,
);
const empty = await dataModule.fixtureInvestigationDataSource.getInvestigation(
  fixtureByLabel.Empty,
);
const deepTrace = await dataModule.fixtureInvestigationDataSource.getInvestigation(
  fixtureByLabel["Deep trace"],
);
const multipleGroups =
  await dataModule.fixtureInvestigationDataSource.getInvestigation(
    fixtureByLabel.Groups,
  );
const integrityMismatch =
  await dataModule.fixtureInvestigationDataSource.getInvestigation(
    fixtureByLabel.Mismatch,
  );
const integrityMissing =
  await dataModule.fixtureInvestigationDataSource.getInvestigation(
    fixtureByLabel["Missing refs"],
  );
const candidateTie =
  await dataModule.fixtureInvestigationDataSource.getInvestigation(
    fixtureByLabel["Candidate tie"],
  );
const unifiedIncident = responseModule.parseInvestigationResponse(
  (await load("/fixtures/investigation-three-signal.json")).default,
);
const narrativeFixture = (
  await load("/fixtures/investigation-narrative.json")
).default;
const narrativeTieFixture = (
  await load("/fixtures/investigation-narrative-tie.json")
).default;

const markup = (Component, props) =>
  renderToStaticMarkup(React.createElement(Component, props));

const relatedProps = (investigation) => ({
  correlations: investigation.correlations,
  findings: investigation.findings,
  selectedCorrelationId: null,
  onSelectCorrelation() {},
});

const evidenceGroupProps = (investigation) => ({
  evidenceGroups: investigation.evidenceGroups,
  correlations: investigation.correlations,
  findings: investigation.findings,
  selectedGroupId: null,
  onSelectGroup() {},
});

const candidateProps = (investigation) => ({
  candidates: investigation.causeCandidates,
  facts: investigation.causeCandidateFacts,
  ranks: investigation.causeCandidateRanks,
  findings: investigation.findings,
  correlations: investigation.correlations,
  signals: investigation.signals,
  selectedCandidateId: null,
  onSelectCandidate() {},
});

const evidenceStoryProps = (investigation) => ({
  ranks: investigation.evidenceRanks,
  findings: investigation.findings,
  evidenceGroups: investigation.evidenceGroups,
  correlations: investigation.correlations,
  signals: investigation.signals,
  selectedFindingId: null,
  selectedGroupId: null,
  onReviewFinding() {},
  onReviewGroup() {},
});

const narrativePanelProps = (investigation, dataSource) => ({
  alertId: investigation.alert.id,
  dataSource,
  candidates: investigation.causeCandidates,
  facts: investigation.causeCandidateFacts,
  ranks: investigation.causeCandidateRanks,
  findings: investigation.findings,
  signals: investigation.signals,
  onNavigateFinding() {},
  onNavigateSignal() {},
});

const renderedText = (renderer) => JSON.stringify(renderer.toJSON());

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
};

test("finding filters combine search, service, severity and type without changing evidence order", async () => {
  const findings = [
    { id: "b", message: "Payment failed", service: "demo-checkout", severity: "high", type: "log_error", timestamp: "2026-09-07T07:09:34.000Z" },
    { id: "a", message: "Request failed", service: "demo-gateway", severity: "high", type: "trace_error", timestamp: "2026-09-07T07:09:35.000Z" },
    { id: "c", message: "Latency elevated", service: "demo-checkout", severity: "warning", type: "metric_threshold", timestamp: "2026-09-07T07:09:36.000Z" },
    { id: "d", message: "Unattributed failure", severity: "info", type: "log_error", timestamp: "2026-09-07T07:09:37.000Z" },
  ];
  const original = structuredClone(findings);
  let renderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(findingsModule.FindingsTimeline, { findings, timeline: [], openSection: "findings" })); });
  const ids = () => renderer.root.findAllByType("li").filter(row => row.props.id).map(row => row.props.id);
  const expected = values => values.map(correlationsModule.findingDomId);
  const change = async (control, value) => act(async () => control.props.onChange({ target: { value } }));
  const input = () => renderer.root.findByType("input");
  const selects = () => renderer.root.findAllByType("select");
  const clear = () => renderer.root.findAllByType("button").find(b => b.children.includes("Clear filters"));
  assert.deepEqual(ids(), expected(["b", "a", "c", "d"]));
  await change(input(), "  CHECKOUT  ");
  assert.deepEqual(ids(), expected(["b", "c"]));
  await change(selects()[0], "demo-checkout");
  await change(selects()[1], "high");
  await change(selects()[2], "log_error");
  assert.deepEqual(ids(), expected(["b"]));
  assert.equal(renderer.root.findAllByProps({ role: "status" })[0].children.join(""), "Showing 1 of 4 findings");
  await change(input(), "missing text");
  assert.deepEqual(ids(), []);
  assert.match(renderedText(renderer), /No findings match these filters/);
  await act(async () => clear().props.onClick());
  assert.deepEqual(ids(), expected(["b", "a", "c", "d"]));
  assert.deepEqual(findings, original);
  await act(async () => renderer.unmount());
});

test("finding links clear hiding filters and repeated selections reveal targets after drawer reopening", async () => {
  const findings = [
    { id: "linked", message: "Checkout failed", service: "demo-checkout", severity: "high", type: "log_error", timestamp: "2026-09-07T07:09:34.000Z" },
    { id: "other", message: "Gateway warning", service: "demo-gateway", severity: "warning", type: "trace_error", timestamp: "2026-09-07T07:09:35.000Z" },
  ];
  let renderer;
  const props = { findings, timeline: [], openSection: "findings" };
  const update = async next => act(async () => renderer.update(React.createElement(findingsModule.FindingsTimeline, next)));
  await act(async () => { renderer = TestRenderer.create(React.createElement(findingsModule.FindingsTimeline, props)); });
  await act(async () => renderer.root.findByType("input").props.onChange({ target: { value: "gateway" } }));
  const linked = { ...props, highlightedFindingIds: new Set(["linked"]) };
  await update(linked);
  assert.equal(renderer.root.findByType("input").props.value, "");
  assert.ok(renderer.root.findAllByType("li").some(row => row.props.id === correlationsModule.findingDomId("linked")));
  assert.match(renderedText(renderer), /Filters cleared to show linked findings/);
  await act(async () => renderer.root.findByType("input").props.onChange({ target: { value: "gateway" } }));
  // Equal selection content must not clear a newly edited filter on rerender.
  await update({ ...linked, highlightedFindingIds: new Set(["linked"]) });
  assert.equal(renderer.root.findByType("input").props.value, "gateway");
  await update({ ...linked, openSection: null });
  await update(linked);
  assert.equal(renderer.root.findByType("input").props.value, "");
  await act(async () => renderer.unmount());
});

test("focused evidence review resolves only explicit references and exact trace/span matches", () => {
  const targetId = "finding-trace-checkout";
  const unrelatedCorrelation = {
    ...unifiedIncident.correlations[0],
    id: "correlation-same-service-but-unlinked",
    findingIds: ["finding-metric-checkout-1"],
  };
  const unrelatedLog = {
    ...unifiedIncident.logs[0],
    message: "Same service and time, different span",
    spanId: "different-span",
  };
  const review = findingEvidenceReviewModule.buildFindingEvidenceReview(
    targetId,
    {
      findings: unifiedIncident.findings,
      evidenceRanks: unifiedIncident.evidenceRanks,
      evidenceGroups: unifiedIncident.evidenceGroups,
      correlations: [
        unrelatedCorrelation,
        ...unifiedIncident.correlations,
      ],
      signals: unifiedIncident.signals,
      logs: [unrelatedLog, ...unifiedIncident.logs],
      traces: unifiedIncident.traces,
    },
  );

  assert.ok(review);
  assert.equal(review.finding.id, targetId);
  assert.equal(review.priority, 1);
  assert.equal(review.rank.supportScore, 6);
  assert.deepEqual(
    review.evidenceGroups.map((group) => group.id),
    ["evidence-group-unified"],
  );
  assert.deepEqual(
    review.correlations.map((correlation) => correlation.id),
    [
      "correlation-checkout-same-span",
      "correlation-shared-trace",
      "correlation-checkout-temporal",
    ],
  );
  assert.deepEqual(
    review.signals.map((signal) => signal.id),
    ["signal-cross-service", "signal-multi-signal", "signal-trace-chain"],
  );
  assert.equal(review.exactSpan.operation, "GET /checkout");
  assert.deepEqual(
    review.exactSpanLogs.map(({ index, log }) => [index, log.message]),
    [[1, "Checkout inventory unavailable"]],
  );
});

test("focused evidence review never invents an exact-span link", () => {
  const input = {
    findings: unifiedIncident.findings,
    evidenceRanks: unifiedIncident.evidenceRanks,
    evidenceGroups: unifiedIncident.evidenceGroups,
    correlations: unifiedIncident.correlations,
    signals: unifiedIncident.signals,
    logs: unifiedIncident.logs,
    traces: unifiedIncident.traces,
  };
  const metricReview =
    findingEvidenceReviewModule.buildFindingEvidenceReview(
      "finding-metric-checkout-1",
      input,
    );
  const partialReferenceReview =
    findingEvidenceReviewModule.buildFindingEvidenceReview(
      "partial-reference",
      {
        ...input,
        findings: [
          ...input.findings,
          {
            ...input.findings[0],
            id: "partial-reference",
            traceId: unifiedIncident.logs[0].traceId,
          },
        ],
      },
    );

  assert.ok(metricReview);
  assert.equal(metricReview.exactSpanReference, undefined);
  assert.deepEqual(metricReview.exactSpanLogs, []);
  assert.ok(partialReferenceReview);
  assert.equal(partialReferenceReview.exactSpanReference, undefined);
  assert.equal(
    findingEvidenceReviewModule.buildFindingEvidenceReview("missing", input),
    null,
  );
});

test("focused evidence review has a factual empty-linked-context state", () => {
  const unlinkedFinding = {
    ...unifiedIncident.findings[0],
    id: "finding-without-explicit-links",
    message: "Finding without explicit linked context",
  };
  const html = markup(findingsModule.FindingsTimeline, {
    findings: [unlinkedFinding],
    timeline: [],
    openSection: "findings",
    reviewedFindingId: unlinkedFinding.id,
  });

  assert.match(
    html,
    /No linked evidence is available for this finding/,
  );
  assert.doesNotMatch(
    html,
    /root cause is|caused by|confirmed cause|likely cause|confidence|probability/i,
  );
});

test("finding review expands explicit context and opens exact-span telemetry", async () => {
  let reviewedFindingId = null;
  let exactSpanReference = null;
  let renderer;
  const props = {
    findings: unifiedIncident.findings,
    timeline: unifiedIncident.timeline,
    priorityFindingIds: unifiedIncident.evidenceRanks.map(
      (rank) => rank.findingId,
    ),
    evidenceRanks: unifiedIncident.evidenceRanks,
    evidenceGroups: unifiedIncident.evidenceGroups,
    correlations: unifiedIncident.correlations,
    signals: unifiedIncident.signals,
    logs: unifiedIncident.logs,
    traces: unifiedIncident.traces,
    openSection: "findings",
    reviewedFindingId,
    onReviewFinding(findingId) {
      reviewedFindingId = findingId;
    },
    onOpenExactSpanLogs(reference) {
      exactSpanReference = reference;
    },
  };

  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(findingsModule.FindingsTimeline, props),
    );
  });
  const targetRow = renderer.root.findByProps({
    id: correlationsModule.findingDomId("finding-trace-checkout"),
  });
  const reviewButton = targetRow
    .findAllByType("button")
    .find((button) => button.children.includes("Review linked evidence"));
  assert.ok(reviewButton);

  await act(async () => {
    reviewButton.props.onClick();
  });
  assert.equal(reviewedFindingId, "finding-trace-checkout");
  await act(async () => {
    renderer.update(
      React.createElement(findingsModule.FindingsTimeline, {
        ...props,
        reviewedFindingId,
      }),
    );
  });

  const text = renderedText(renderer);
  assert.match(text, /Focused evidence review/);
  assert.match(text, /Finding priority #1/);
  assert.match(text, /types of connections and patterns/);
  assert.ok(renderer.root.findAllByType(supportTypesModule.SupportTypeCount).some(count => count.props.count === 6));
  assert.match(text, /6 related findings across 2 services/);
  assert.match(text, /Same step \(span\)/);
  assert.match(text, /Failures along a call path/);
  assert.match(text, /GET \/checkout/);
  assert.match(text, /Checkout inventory unavailable/);
  assert.match(text, /Links use recorded IDs; matching a step requires both trace and span IDs/);
  assert.doesNotMatch(
    text,
    /root cause is|caused by|confirmed cause|likely cause|confidence|probability/i,
  );

  const telemetryLink = renderer.root
    .findAllByType("a")
    .find((link) => link.children.includes("Open logs for this step"));
  assert.ok(telemetryLink);
  await act(async () => {
    telemetryLink.props.onClick();
  });
  assert.deepEqual(exactSpanReference, {
    traceId: "f28f4af69971848b5469807f21f7cbd9",
    spanId: "799d3198920dfd89",
  });

  await act(async () => {
    renderer.unmount();
  });
});

test("alert list validates complete records and all lifecycle states", () => {
  const rows = [resolved.alert, { ...firing.alert, status: "acknowledged" }];
  assert.equal(alertListModule.parseAlertList(rows), rows);
  assert.deepEqual(alertListModule.parseAlertList([]), []);
  for (const payload of [{ alerts: rows }, [null], [{ ...resolved.alert, status: "unknown" }],
    [{ ...resolved.alert, updatedAt: "bad-date" }], [{ ...resolved.alert, service: 8 }],
    [resolved.alert, resolved.alert], [{ ...resolved.alert, message: undefined }]]) {
    assert.throws(() => alertListModule.parseAlertList(payload), alertListModule.AlertListError);
  }
});

test("alert search combines status and text while sorting by updated time without mutating input", () => {
  const old = { ...resolved.alert, id: "old", title: "CPU", service: "auth", updatedAt: "2026-01-01T00:00:00Z" };
  const recent = { ...firing.alert, id: "recent", title: "Checkout", message: "Inventory failed", service: "checkout", updatedAt: "2026-02-01T00:00:00Z" };
  const acknowledged = { ...recent, id: "ack", status: "acknowledged" };
  const rows = Object.freeze([old, recent, acknowledged]);
  assert.deepEqual(alertSelectionModule.selectAlerts(rows, "", "all").map((row) => row.id), ["ack", "recent", "old"]);
  assert.deepEqual(alertSelectionModule.selectAlerts(rows, " INVENTORY ", "firing"), [recent]);
  assert.deepEqual(alertSelectionModule.selectAlerts(rows, "auth", "resolved"), [old]);
  assert.deepEqual(alertSelectionModule.selectAlerts(rows, "checkout", "acknowledged"), [acknowledged]);
  assert.deepEqual(rows.map((row) => row.id), ["old", "recent", "ack"]);
});

test("workspace URL state round-trips search and valid lifecycle filters", () => {
  const view = { query: "checkout error", status: "firing" };
  assert.deepEqual(
    alertSelectionModule.alertListViewFromSearch(
      "?source=live&q=checkout+error&status=firing",
    ),
    view,
  );
  assert.deepEqual(
    alertSelectionModule.alertListViewFromSearch("?q=auth&status=unknown"),
    { query: "auth", status: "all" },
  );
  assert.equal(
    alertSelectionModule.alertListHref(view),
    "/investigations?q=checkout+error&status=firing",
  );
  assert.equal(
    alertSelectionModule.liveInvestigationHref("alert/id", view),
    "/investigations/alert%2Fid?source=live&q=checkout+error&status=firing",
  );
  assert.equal(
    alertSelectionModule.alertListHref(
      alertSelectionModule.defaultAlertListView,
    ),
    "/investigations",
  );
});

test("workspace initializes URL-backed controls and reports each view change", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = { title: "" };
  const changes = [];
  let renderer;

  try {
    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(workspaceModule.InvestigationsPage, {
          dataSource: { async getAlerts() { return [resolved.alert, firing.alert]; } },
          initialView: { query: "auth", status: "resolved" },
          onViewChange(view) { changes.push(view); },
        }),
      );
    });

    const input = renderer.root.findByType("input");
    const select = renderer.root.findByType("select");
    assert.equal(input.props.value, "auth");
    assert.equal(select.props.value, "resolved");
    assert.match(
      renderer.root.findByType("a").props.href,
      /source=live&q=auth&status=resolved$/,
    );

    await act(async () => {
      input.props.onChange({ target: { value: "checkout" } });
    });
    await act(async () => {
      select.props.onChange({ target: { value: "firing" } });
    });
    assert.deepEqual(changes, [
      { query: "checkout", status: "resolved" },
      { query: "checkout", status: "firing" },
    ]);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("detail states provide the exact filtered workspace return path", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = { title: "" };
  const returnHref = "/investigations?q=checkout&status=firing";
  let renderer;

  try {
    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(pageModule.InvestigationPage, {
          alertId: "missing-alert",
          returnHref,
          dataSource: {
            async getInvestigation() {
              throw new errorsModule.InvestigationNotFoundError("missing-alert");
            },
          },
          narrativeDataSource: { async generateNarrative() {} },
        }),
      );
    });

    const backLink = renderer.root
      .findAllByType("a")
      .find((link) => link.children.includes("Back to investigations"));
    assert.ok(backLink);
    assert.equal(backLink.props.href, returnHref);
    assert.match(renderedText(renderer), /Investigation not found/);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("alert HTTP source uses real endpoint, preserves cancellation, and distinguishes failures", async () => {
  const controller = new AbortController();
  const source = new alertListModule.HttpAlertListDataSource("http://example.test/", async (url, options) => {
    assert.equal(url, "http://example.test/v1/alerts");
    assert.equal(options.signal, controller.signal);
    return new Response(JSON.stringify([resolved.alert]));
  });
  assert.equal((await source.getAlerts({ signal: controller.signal }))[0].id, resolved.alert.id);
  for (const [fetchFn, kind] of [
    [async () => { throw new TypeError("offline"); }, "network"],
    [async () => new Response("", { status: 503 }), "http"],
    [async () => new Response("not json"), "invalid"],
  ]) {
    await assert.rejects(new alertListModule.HttpAlertListDataSource("", fetchFn).getAlerts(), (error) => error.kind === kind);
  }
  const aborted = new DOMException("Cancelled", "AbortError");
  await assert.rejects(new alertListModule.HttpAlertListDataSource("", async () => { throw aborted; }).getAlerts(), (error) => error === aborted);
});

test("workspace distinguishes list routes and hides detail-only navigation", () => {
  for (const path of ["/", "/investigations", "/investigations/"]) assert.equal(appModule.isInvestigationListPath(path), true);
  assert.equal(appModule.isInvestigationListPath("/investigations/alert-id"), false);
  assert.equal(appModule.isInvestigationListPath("/unknown"), false);
  const html = markup(appShellModule.AppShell, {
    investigationHref: "/investigations?q=checkout&status=firing", currentAlertId: null,
    showInvestigationNavigation: false, pageTitle: "Investigation workspace",
    onSelectFixture() {}, children: React.createElement("h1", null, "Browse alerts"),
  });
  assert.match(html, /href="\/investigations\?q=checkout&amp;status=firing"/);
  assert.match(html, /Investigation workspace/);
  assert.doesNotMatch(html, /href="#candidate-ranking"/);
});

test("workspace retries failures, filters results, clears no-match state and opens live detail links", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = { title: "" };
  let calls = 0;
  let signal;
  let renderer;
  try {
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(workspaceModule.InvestigationsPage, {
        dataSource: { async getAlerts(options) {
          signal = options.signal;
          if (++calls === 1) throw new alertListModule.AlertListError("network");
          return [resolved.alert, firing.alert];
        } },
      }));
    });
    assert.match(renderedText(renderer), /Unable to load alerts/);
    await act(async () => { renderer.root.findAllByType("button").find((button) => button.children.includes("Try again")).props.onClick(); });
    assert.equal(calls, 2);
    assert.equal(renderer.root.findAllByType("a").length, 2);
    assert.ok(renderer.root.findAllByType("a").every((link) => link.props.href.endsWith("?source=live")));
    await act(async () => { renderer.root.findByType("select").props.onChange({ target: { value: "resolved" } }); });
    assert.equal(renderer.root.findAllByType("a").length, 1);
    await act(async () => { renderer.root.findByType("input").props.onChange({ target: { value: "nothing matches this" } }); });
    assert.match(renderedText(renderer), /No matching alerts/);
    await act(async () => { renderer.root.findAllByType("button").find((button) => button.children.includes("Clear filters")).props.onClick(); });
    assert.equal(renderer.root.findAllByType("a").length, 2);
    await act(async () => { renderer.unmount(); });
    renderer = null;
    assert.equal(signal.aborted, true);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("workspace discards requests after unmount and renders true empty lists", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = { title: "" };
  const pending = deferred();
  let signal;
  let renderer;
  try {
    await act(async () => { renderer = TestRenderer.create(React.createElement(workspaceModule.InvestigationsPage, {
      dataSource: { getAlerts(options) { signal = options.signal; return pending.promise; } },
    })); });
    assert.match(renderedText(renderer), /Loading alerts/);
    await act(async () => renderer.unmount());
    assert.equal(signal.aborted, true);
    await act(async () => pending.resolve([resolved.alert]));
    await act(async () => { renderer = TestRenderer.create(React.createElement(workspaceModule.InvestigationsPage, {
      dataSource: { async getAlerts() { return []; } },
    })); });
    assert.match(renderedText(renderer), /No alerts yet/);
    assert.doesNotMatch(renderedText(renderer), /No matching alerts/);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("workspace refresh retains filtered results and timestamp on failure, retries and prevents overlap", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = { title: "" };
  const requests = [];
  const dataSource = { getAlerts() { const request = deferred(); requests.push(request); return request.promise; } };
  let renderer;
  try {
    await act(async () => { renderer = TestRenderer.create(React.createElement(workspaceModule.InvestigationsPage, {
      dataSource, initialView: { query: resolved.alert.title, status: "resolved" },
    })); });
    await act(async () => requests[0].resolve([resolved.alert, firing.alert]));
    const fetchedAt = () => renderer.root.findAllByType("time")[0].props.dateTime;
    const originalTimestamp = fetchedAt();
    const originalHref = renderer.root.findByType("a").props.href;
    const refresh = renderer.root.findAllByType("button")[0].props.onClick;
    await act(async () => { refresh(); refresh(); });
    assert.equal(requests.length, 2);
    assert.equal(renderer.root.findAllByType("button")[0].props.disabled, true);
    assert.equal(renderer.root.findByType("a").props.href, originalHref);
    assert.equal(fetchedAt(), originalTimestamp);
    assert.match(renderedText(renderer), /Refreshing alerts/);
    await act(async () => { refresh(); });
    assert.equal(requests.length, 2);
    await act(async () => requests[1].reject(new alertListModule.AlertListError("network")));
    assert.match(renderedText(renderer), /Unable to refresh alerts/);
    assert.match(renderedText(renderer), /Showing the last loaded results/);
    assert.equal(fetchedAt(), originalTimestamp);
    assert.equal(renderer.root.findByType("a").props.href, originalHref);
    assert.equal(renderer.root.findByType("input").props.value, resolved.alert.title);
    assert.equal(renderer.root.findByType("select").props.value, "resolved");
    await act(async () => renderer.root.findAllByType("button").find((b) => b.children.includes("Try again")).props.onClick());
    assert.equal(requests.length, 3);
    await act(async () => requests[2].resolve([]));
    assert.match(renderedText(renderer), /No alerts yet/);
    assert.doesNotMatch(renderedText(renderer), /Unable to refresh alerts/);
    assert.ok(Date.parse(fetchedAt()) >= Date.parse(originalTimestamp));
    assert.equal(renderer.root.findAllByType("a").length, 0);
    assert.equal(renderer.root.findByType("input").props.value, resolved.alert.title);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("workspace ignores obsolete responses when its data source changes", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = { title: "" };
  const oldRequest = deferred();
  const newRequest = deferred();
  let oldSignal;
  let renderer;
  try {
    await act(async () => { renderer = TestRenderer.create(React.createElement(workspaceModule.InvestigationsPage, {
      dataSource: { getAlerts({ signal }) { oldSignal = signal; return oldRequest.promise; } },
    })); });
    await act(async () => renderer.update(React.createElement(workspaceModule.InvestigationsPage, {
      dataSource: { getAlerts() { return newRequest.promise; } },
    })));
    assert.equal(oldSignal.aborted, true);
    await act(async () => newRequest.resolve([resolved.alert]));
    await act(async () => oldRequest.resolve([firing.alert]));
    assert.match(renderer.root.findByType("a").props.href, new RegExp(resolved.alert.id));
    assert.equal(renderer.root.findAllByType("a").length, 1);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("lifecycle HTTP source sends exact PATCH and rejects mismatched or invalid replies", async () => {
  let captured;
  const expected = { ...firing.alert, id: "alert/id", status: "acknowledged" };
  const signal = new AbortController().signal;
  const source = new lifecycleModule.HttpAlertLifecycleDataSource("http://api.test/", async (url, options) => {
    captured = { url, ...options };
    return new Response(JSON.stringify(expected));
  });
  assert.deepEqual(await source.updateStatus(expected.id, "acknowledged", signal), expected);
  assert.equal(captured.url, "http://api.test/v1/alerts/alert%2Fid/status");
  assert.equal(captured.method, "PATCH");
  assert.equal(captured.body, '{"status":"acknowledged"}');
  assert.equal(captured.signal, signal);
  for (const status of [400, 404, 409, 500]) {
    const failing = new lifecycleModule.HttpAlertLifecycleDataSource("", async () => new Response("private server details", { status }));
    await assert.rejects(failing.updateStatus(expected.id, "acknowledged"), (error) => error.status === status && !error.message.includes("private"));
  }
  for (const payload of [{ ...expected, id: "wrong" }, { ...expected, status: "firing" }, {}]) {
    const invalid = new lifecycleModule.HttpAlertLifecycleDataSource("", async () => new Response(JSON.stringify(payload)));
    await assert.rejects(invalid.updateStatus(expected.id, "acknowledged"), (error) => error.kind === "invalid");
  }
  const offline = new lifecycleModule.HttpAlertLifecycleDataSource("", async () => { throw new Error("offline"); });
  await assert.rejects(offline.updateStatus(expected.id, "acknowledged"), (error) => error.kind === "network");
});

function lifecycleHarness({ updateStatus, getInvestigation, initial = firing }) {
  let renderer;
  let latest = initial;
  function Harness() {
    const [investigation, setInvestigation] = React.useState(initial);
    return React.createElement(lifecycleActionsModule.AlertLifecycleActions, {
      alert: investigation.alert,
      dataSource: { updateStatus },
      investigationSource: { getInvestigation },
      onUpdated(next) { latest = next; setInvestigation(next); },
    });
  }
  return {
    async mount() { await act(async () => { renderer = TestRenderer.create(React.createElement(Harness)); }); },
    get renderer() { return renderer; },
    get latest() { return latest; },
    button(label) { return renderer.root.findAllByType("button").find((node) => node.children.includes(label)); },
    async click(label) { await act(async () => this.button(label).props.onClick()); },
    async close() { await act(async () => renderer.unmount()); },
  };
}

test("resolution requires confirmation; cancel is inert; pending action cannot be duplicated", async () => {
  const pending = deferred();
  let patches = 0;
  let reads = 0;
  const next = { ...firing, alert: { ...firing.alert, status: "resolved" } };
  const h = lifecycleHarness({
    updateStatus() { patches++; return pending.promise; },
    async getInvestigation() { reads++; return next; },
  });
  await h.mount();
  try {
    await h.click("Resolve");
    assert.match(renderedText(h.renderer), /does not confirm that the service has recovered/);
    assert.equal(patches, 0);
    await h.click("Cancel");
    assert.equal(patches, 0);
    await h.click("Resolve");
    const confirm = h.button("Resolve alert").props.onClick;
    await act(async () => { confirm(); confirm(); });
    assert.equal(patches, 1);
    assert.equal(reads, 0);
    assert.equal(h.latest.alert.status, "firing");
    assert.equal(h.button("Acknowledge").props.disabled, true);
    await act(async () => pending.resolve(next.alert));
    assert.equal(reads, 1);
    assert.equal(h.latest.alert.status, "resolved");
    assert.equal(h.button("Resolve"), undefined);
    assert.match(renderedText(h.renderer), /Change saved. Investigation refreshed/);
  } finally { await h.close(); }
});

test("saved action with failed refresh retains prior data and retries GET without another PATCH", async () => {
  let patches = 0;
  let reads = 0;
  const next = { ...firing, alert: { ...firing.alert, status: "acknowledged" } };
  const h = lifecycleHarness({
    async updateStatus() { patches++; return next.alert; },
    async getInvestigation() { if (++reads === 1) throw new Error("offline"); return next; },
  });
  await h.mount();
  try {
    await h.click("Acknowledge");
    assert.equal(patches, 1);
    assert.equal(h.latest.alert.status, "firing");
    assert.match(renderedText(h.renderer), /Change saved, but the investigation could not be refreshed/);
    assert.equal(h.button("Resolve").props.disabled, true);
    await h.click("Refresh investigation");
    assert.equal(patches, 1);
    assert.equal(reads, 2);
    assert.equal(h.latest.alert.status, "acknowledged");
    assert.equal(h.button("Acknowledge"), undefined);
    assert.equal(h.button("Resolve").props.disabled, false);
  } finally { await h.close(); }
});

test("conflict and uncertain mutation outcomes refetch state without replaying the mutation", async () => {
  for (const failure of [new lifecycleModule.AlertLifecycleError("http", 409), new lifecycleModule.AlertLifecycleError("network"), new lifecycleModule.AlertLifecycleError("http", 500)]) {
    let patches = 0;
    let reads = 0;
    const h = lifecycleHarness({
      async updateStatus() { patches++; throw failure; },
      async getInvestigation() { reads++; return { ...firing, alert: { ...firing.alert, status: "resolved" } }; },
    });
    await h.mount();
    try {
      await h.click("Acknowledge");
      assert.equal(patches, 1);
      assert.equal(reads, 1);
      assert.equal(h.latest.alert.status, "resolved");
      assert.equal(h.button("Acknowledge"), undefined);
      assert.doesNotMatch(renderedText(h.renderer), /Change saved/);
      assert.match(renderedText(h.renderer), failure.status === 409 ? /alert changed/ : /could not confirm whether the change was saved/);
    } finally { await h.close(); }
  }
});

test("missing alert or failed reconciliation blocks further mutation until a successful refresh", async () => {
  let patches = 0;
  let reads = 0;
  const h = lifecycleHarness({
    async updateStatus() { patches++; throw new lifecycleModule.AlertLifecycleError("http", 404); },
    async getInvestigation() { reads++; throw new errorsModule.InvestigationNotFoundError(firing.alert.id); },
  });
  await h.mount();
  try {
    await h.click("Acknowledge");
    assert.match(renderedText(h.renderer), /Refresh before trying another action/);
    await h.click("Acknowledge");
    assert.equal(patches, 1);
    await h.click("Refresh investigation");
    assert.equal(reads, 2);
    assert.equal(patches, 1);
  } finally { await h.close(); }
});

test("leaving an investigation aborts a pending mutation and ignores its late result", async () => {
  const pending = deferred();
  let signal;
  let reads = 0;
  const h = lifecycleHarness({
    updateStatus(id, status, requestSignal) { signal = requestSignal; return pending.promise; },
    async getInvestigation() { reads++; return firing; },
  });
  await h.mount();
  await h.click("Acknowledge");
  await h.close();
  assert.equal(signal.aborted, true);
  await act(async () => pending.resolve({ ...firing.alert, status: "acknowledged" }));
  assert.equal(reads, 0);
});

test("fixture investigation pages do not expose lifecycle controls", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = { title: "" };
  let renderer;
  try {
    await act(async () => { renderer = TestRenderer.create(React.createElement(pageModule.InvestigationPage, {
      alertId: firing.alert.id,
      dataSource: { async getInvestigation() { return firing; } },
      narrativeDataSource: { async generateNarrative() { throw new Error("not requested"); } },
    })); });
    assert.equal(renderer.root.findAllByType(lifecycleActionsModule.AlertLifecycleActions).length, 0);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("restoring a cached workspace refreshes lifecycle status while retaining filters", async () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  globalThis.document = { title: "" };
  const listeners = new Map();
  globalThis.window = {
    addEventListener(name, handler) { listeners.set(name, handler); },
    removeEventListener(name) { listeners.delete(name); },
  };
  let renderer;
  let calls = 0;
  try {
    await act(async () => { renderer = TestRenderer.create(React.createElement(workspaceModule.InvestigationsPage, {
      initialView: { query: firing.alert.title, status: "firing" },
      dataSource: { async getAlerts() { calls++; return [{ ...firing.alert, status: calls === 1 ? "firing" : "resolved" }]; } },
    })); });
    assert.equal(renderer.root.findAllByType("a").length, 1);
    await act(async () => listeners.get("pageshow")({ persisted: true }));
    assert.equal(calls, 2);
    assert.equal(renderer.root.findAllByType("a").length, 0);
    assert.equal(renderer.root.findByType("input").props.value, firing.alert.title);
    assert.equal(renderer.root.findByType("select").props.value, "firing");
    await act(async () => renderer.unmount());
    renderer = null;
    assert.equal(listeners.has("pageshow"), false);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
  }
});

test("lifecycle confirmation focuses Cancel and Escape returns focus to Resolve", async () => {
  const focused = [];
  let renderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(lifecycleActionsModule.AlertLifecycleActions, {
    alert: firing.alert,
    dataSource: { async updateStatus() { throw new Error("not requested"); } },
    investigationSource: { async getInvestigation() { return firing; } },
    onUpdated() {},
  }), { createNodeMock(element) { return { focus() { focused.push(element.props.children); } }; } }); });
  try {
    await act(async () => renderer.root.findAllByType("button").find((b) => b.children.includes("Resolve")).props.onClick());
    assert.equal(focused.at(-1), "Cancel");
    await act(async () => renderer.root.findByProps({ role: "group" }).props.onKeyDown({ key: "Escape" }));
    assert.equal(focused.at(-1), "Resolve");
    assert.equal(renderer.root.findAllByProps({ role: "group" }).length, 0);
  } finally { await act(async () => renderer.unmount()); }
});

test("live page replaces status and investigation window after confirmed resolution", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = { title: "" };
  let renderer;
  let reads = 0;
  let patches = 0;
  let narratives = 0;
  const next = { ...firing, alert: { ...firing.alert, status: "resolved", resolvedAt: resolved.alert.resolvedAt }, window: resolved.window };
  try {
    await act(async () => { renderer = TestRenderer.create(React.createElement(pageModule.InvestigationPage, {
      alertId: firing.alert.id,
      dataSource: { async getInvestigation() { return ++reads === 1 ? firing : next; } },
      narrativeDataSource: { async generateNarrative() { narratives++; } },
      lifecycleDataSource: { async updateStatus(id, status) { patches++; assert.equal(id, firing.alert.id); assert.equal(status, "resolved"); return next.alert; } },
    })); });
    await act(async () => renderer.root.findAllByType("button").find((b) => b.children.includes("Resolve")).props.onClick());
    await act(async () => renderer.root.findAllByType("button").find((b) => b.children.includes("Resolve alert")).props.onClick());
    assert.equal(reads, 2);
    assert.equal(patches, 1);
    assert.equal(narratives, 0);
    assert.match(renderedText(renderer), /Resolved evidence window/);
    assert.match(renderedText(renderer), /Change saved. Investigation refreshed/);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
  }
});

test("sidebar progressively reveals investigation navigation groups", async () => {
  let renderer;
  const navigatedSections = [];

  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(sidebarModule.AppSidebar, {
        collapsed: false,
        mobileOpen: false,
        investigationHref: "/investigations/alert-id",
        activeSectionId: "overview",
        onNavigateSection(sectionId) {
          navigatedSections.push(sectionId);
        },
        onToggleCollapsed() {},
        onCloseMobile() {},
      }),
    );
  });

  const initialText = renderedText(renderer);
  assert.match(initialText, /Investigations/);
  assert.match(initialText, /Overview/);
  assert.match(initialText, /Where to start/);
  assert.match(initialText, /AI explanation/);
  assert.doesNotMatch(initialText, /Finding priority/);
  assert.doesNotMatch(initialText, /Grouped evidence/);

  const investigationToggle = renderer.root
    .findAllByType("button")
    .find((button) => button.props["aria-controls"] === "sidebar-group-investigation");
  const evidenceToggle = renderer.root
    .findAllByType("button")
    .find((button) => button.props["aria-controls"] === "sidebar-group-evidence");

  assert.ok(investigationToggle);
  assert.ok(evidenceToggle);
  assert.equal(renderer.root.findAllByType("button").filter(button => button.props["aria-controls"]?.startsWith("sidebar-group-")).length, 2);
  assert.doesNotMatch(initialText, /Deep evidence/);
  assert.equal(investigationToggle.props["aria-expanded"], true);
  assert.equal(evidenceToggle.props["aria-expanded"], false);

  await act(async () => {
    evidenceToggle.props.onClick();
  });
  assert.equal(evidenceToggle.props["aria-expanded"], true);
  assert.match(renderedText(renderer), /Finding priority/);
  assert.match(renderedText(renderer), /Request path/);
  assert.match(renderedText(renderer), /Grouped evidence/);
  assert.match(renderedText(renderer), /Connections/);
  assert.match(renderedText(renderer), /Metrics and logs/);
  assert.match(renderedText(renderer), /Data checks/);
  const evidenceChildren = renderer.root.findByProps({ id: "sidebar-group-evidence" });
  assert.deepEqual(evidenceChildren.findAllByType("a").map(link => link.props.href), ["#evidence-priority", "#trace-path", "#findings", "#timeline", "#evidence-groups", "#relationships", "#telemetry", "#integrity"]);
  assert.ok(evidenceChildren.findAllByType("a").every(link => /ml-3/.test(link.props.className)));
  assert.deepEqual(navigatedSections, []);
  await act(async () => evidenceToggle.props.onClick());
  assert.equal(evidenceToggle.props["aria-expanded"], false);
  assert.equal(renderer.root.findAllByProps({ id: "sidebar-group-evidence" }).length, 0);
  await act(async () => evidenceToggle.props.onClick());
  assert.equal(renderer.root.findByProps({ id: "sidebar-group-evidence" }).findAllByType("a").length, 8);
  assert.deepEqual(navigatedSections, []);

  await act(async () => {
    renderer.unmount();
  });
});

const evidenceNavigationProps = (overrides = {}) => ({
  collapsed: false,
  mobileOpen: false,
  investigationHref: "/investigations/alert-id?source=live&q=checkout",
  activeSectionId: "overview",
  onNavigateSection() {},
  onToggleCollapsed() {},
  onCloseMobile() {},
  ...overrides,
});

test("evidence navigation consolidates groups while preserving the complete ordered anchor inventory", () => {
  const ids = ["overview", "candidate-ranking", "ai-explanation", "evidence-priority", "trace-path", "findings", "timeline", "evidence-groups", "relationships", "telemetry", "integrity"];
  assert.deepEqual(sidebarModule.investigationSectionIds, ids);
  assert.equal(new Set(sidebarModule.investigationSectionIds).size, ids.length);
  assert.deepEqual(sidebarModule.investigationSectionGroups.map(group => [group.id, group.label, group.defaultExpanded]), [["investigation", "Investigation", true], ["evidence", "Evidence", false]]);
  assert.deepEqual(sidebarModule.investigationSectionGroups[0].items.map(item => item.id), ["candidate-ranking", "ai-explanation"]);
  assert.deepEqual(sidebarModule.investigationSectionGroups[1].items.map(item => item.id), ids.slice(3));
  for (const id of ids) assert.equal(appShellModule.investigationSectionIdFromHash(`#${id}`), id);
  assert.equal(appShellModule.investigationSectionIdFromHash("#deep-evidence"), null);
});

test("evidence navigation automatically reveals every evidence destination after active-section changes", async () => {
  const navigations = [];
  const props = evidenceNavigationProps({ onNavigateSection(id) { navigations.push(id); } });
  let renderer;
  try {
    await act(async () => { renderer = TestRenderer.create(React.createElement(sidebarModule.AppSidebar, props)); });
    for (const item of sidebarModule.investigationSectionGroups[1].items) {
      let toggle = renderer.root.findAllByType("button").find(button => button.props["aria-controls"] === "sidebar-group-evidence");
      if (toggle.props["aria-expanded"]) await act(async () => toggle.props.onClick());
      assert.equal(renderer.root.findAllByProps({ id: "sidebar-group-evidence" }).length, 0);
      await act(async () => renderer.update(React.createElement(sidebarModule.AppSidebar, { ...props, activeSectionId: item.id })));
      toggle = renderer.root.findAllByType("button").find(button => button.props["aria-controls"] === "sidebar-group-evidence");
      assert.equal(toggle.props["aria-expanded"], true);
      const links = renderer.root.findByProps({ id: "sidebar-group-evidence" }).findAllByType("a");
      assert.equal(links.length, 8);
      assert.deepEqual(links.filter(link => link.props["aria-current"] === "location").map(link => link.props.href), [`#${item.id}`]);
      assert.equal(links.find(link => link.props.href === `#${item.id}`).props["aria-label"], item.label);
    }
    assert.deepEqual(navigations, []);
    assert.equal(renderer.root.findAllByType("button").filter(button => button.props["aria-controls"] === "sidebar-group-deep-evidence").length, 0);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
  }
});

test("evidence navigation opens all existing views from the collapsed sidebar without changing the active section", async () => {
  let renderer;
  try {
    await act(async () => { renderer = TestRenderer.create(React.createElement(appShellModule.AppShell, {
      investigationHref: "/investigations/alert-id", currentAlertId: "alert-id", onSelectFixture() {},
    }, React.createElement("div", null, "Unchanged investigation content"))); });
    const collapse = renderer.root.findAllByType("button").find(button => button.props["aria-label"] === "Collapse sidebar");
    await act(async () => collapse.props.onClick());
    const open = renderer.root.findAllByType("button").find(button => button.props["aria-label"] === "Open Evidence navigation");
    assert.ok(open);
    assert.equal(open.props.title, "Evidence");
    assert.equal(open.props["aria-expanded"], false);
    await act(async () => open.props.onClick());
    const sidebar = renderer.root.findByType(sidebarModule.AppSidebar);
    assert.equal(sidebar.props.collapsed, false);
    assert.equal(sidebar.props.activeSectionId, "overview");
    assert.equal(sidebar.findByProps({ id: "sidebar-group-evidence" }).findAllByType("a").length, 8);
    assert.match(renderedText(renderer), /Unchanged investigation content/);
    assert.doesNotMatch(renderedText(renderer), /Deep evidence/);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
  }
});

test("evidence navigation closes the mobile overlay and focuses the exact selected evidence landmark", async () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const frames = [];
  const focused = [];
  const body = { style: { overflow: "auto" } };
  globalThis.window = {
    location: { hash: "" }, addEventListener() {}, removeEventListener() {},
    requestAnimationFrame(callback) { frames.push(callback); return frames.length; },
  };
  globalThis.document = { body, getElementById(id) { return { focus(options) { focused.push({ id, options }); } }; } };
  let renderer;
  try {
    await act(async () => { renderer = TestRenderer.create(React.createElement(appShellModule.AppShell, {
      investigationHref: "/investigations/alert-id", currentAlertId: "alert-id", onSelectFixture() {},
    }, React.createElement("section", { id: "telemetry", tabIndex: -1 }, "Exact telemetry landmark")), {
      createNodeMock: element => ({ focus() { focused.push({ control: element.props["aria-label"] }); } }),
    }); });
    const open = renderer.root.findAllByType("button").find(button => button.props["aria-label"] === "Open navigation");
    await act(async () => open.props.onClick());
    assert.equal(body.style.overflow, "hidden");
    assert.equal(renderer.root.findByType(sidebarModule.AppSidebar).props.mobileOpen, true);
    const toggle = renderer.root.findAllByType("button").find(button => button.props["aria-controls"] === "sidebar-group-evidence");
    await act(async () => toggle.props.onClick());
    const link = renderer.root.findAllByType("a").find(item => item.props.href === "#telemetry");
    await act(async () => link.props.onClick());
    const sidebar = renderer.root.findByType(sidebarModule.AppSidebar);
    assert.equal(sidebar.props.mobileOpen, false);
    assert.equal(sidebar.props.activeSectionId, "telemetry");
    assert.equal(body.style.overflow, "auto");
    assert.equal(renderer.root.findAllByType("div").filter(node => node.props.inert === true).length, 0);
    assert.equal(renderer.root.findAllByType("button").filter(button => button.props["aria-label"] === "Close navigation overlay").length, 0);
    assert.equal(frames.length, 1);
    frames[0]();
    assert.deepEqual(focused.find(item => item.id === "telemetry"), { id: "telemetry", options: { preventScroll: true } });
    assert.ok(focused.some(item => item.control === "Open navigation"));
    assert.equal(link.props["aria-current"], "location");
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
  }
});

test("evidence navigation honors existing exact finding log and advanced hashes without rewriting route state", async () => {
  const previousWindow = globalThis.window;
  const listeners = new Map();
  const location = { hash: "#finding-trace-checkout", pathname: "/investigations/alert-id", search: "?source=live&q=checkout" };
  globalThis.window = {
    location,
    addEventListener(type, callback) { listeners.set(type, callback); },
    removeEventListener(type, callback) { if (listeners.get(type) === callback) listeners.delete(type); },
  };
  let renderer;
  try {
    await act(async () => { renderer = TestRenderer.create(React.createElement(appShellModule.AppShell, {
      investigationHref: "/investigations/alert-id", currentAlertId: "alert-id", onSelectFixture() {},
    }, React.createElement("div", null, "Investigation context"))); });
    assert.equal(renderer.root.findByType(sidebarModule.AppSidebar).props.activeSectionId, "findings");
    for (const [hash, section] of [["#investigation-log-exact-demo-checkout-0", "telemetry"], ["#relationships", "relationships"], ["#evidence%2Dgroups", "evidence-groups"], ["#integrity", "integrity"]]) {
      const toggle = renderer.root.findAllByType("button").find(button => button.props["aria-controls"] === "sidebar-group-evidence");
      assert.equal(toggle.props["aria-expanded"], true);
      await act(async () => toggle.props.onClick());
      location.hash = hash;
      await act(async () => listeners.get("hashchange")());
      const sidebar = renderer.root.findByType(sidebarModule.AppSidebar);
      assert.equal(sidebar.props.activeSectionId, section);
      const links = sidebar.findByProps({ id: "sidebar-group-evidence" }).findAllByType("a");
      assert.equal(links.find(link => link.props.href === `#${section}`).props["aria-current"], "location");
      assert.equal(location.hash, hash);
      assert.equal(location.pathname, "/investigations/alert-id");
      assert.equal(location.search, "?source=live&q=checkout");
    }
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    assert.equal(listeners.size, 0);
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
  }
});

test("section hash parsing maps stable review targets to their parent navigation section", () => {
  assert.equal(
    appShellModule.investigationSectionIdFromHash("#candidate-ranking"),
    "candidate-ranking",
  );
  assert.equal(
    appShellModule.investigationSectionIdFromHash("#evidence%2Dpriority"),
    "evidence-priority",
  );
  assert.equal(
    appShellModule.investigationSectionIdFromHash("#finding-not-a-section"),
    "findings",
  );
  assert.equal(
    appShellModule.investigationSectionIdFromHash(
      "#investigation-log-2026-09-01-checkout-0",
    ),
    "telemetry",
  );
  assert.equal(appShellModule.investigationSectionIdFromHash("#%E0%A4%A"), null);
  assert.equal(appShellModule.investigationSectionIdFromHash("overview"), null);
});

test("mobile navigation is unfocusable while closed, reveals active groups, and closes with Escape", async () => {
  let closeCalls = 0;
  let renderer;
  const props = {
    collapsed: false,
    mobileOpen: false,
    investigationHref: "/investigations/alert-id",
    activeSectionId: "relationships",
    onNavigateSection() {},
    onToggleCollapsed() {},
    onCloseMobile() {
      closeCalls += 1;
    },
  };

  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(sidebarModule.AppSidebar, props),
    );
  });

  let sidebar = renderer.root.findByType("aside");
  assert.match(sidebar.props.className, /invisible -translate-x-full/);
  assert.match(sidebar.props.className, /lg:visible lg:translate-x-0/);

  const evidenceToggle = renderer.root
    .findAllByType("button")
    .find(
      (button) =>
        button.props["aria-controls"] === "sidebar-group-evidence",
    );
  assert.ok(evidenceToggle);
  assert.equal(evidenceToggle.props["aria-expanded"], true);
  const activeLink = renderer.root
    .findAllByType("a")
    .find((link) => link.props.href === "#relationships");
  assert.equal(activeLink?.props["aria-current"], "location");

  await act(async () => {
    renderer.update(
      React.createElement(sidebarModule.AppSidebar, {
        ...props,
        mobileOpen: true,
      }),
    );
  });

  sidebar = renderer.root.findByType("aside");
  assert.match(sidebar.props.className, /visible translate-x-0/);
  let prevented = false;
  await act(async () => {
    sidebar.props.onKeyDown({
      key: "Escape",
      preventDefault() {
        prevented = true;
      },
    });
  });
  assert.equal(prevented, true);
  assert.equal(closeCalls, 1);

  await act(async () => {
    renderer.unmount();
  });
});

test("sidebar section links transfer focus to the selected page landmark", async () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  let scheduledCallback;
  let focusedOptions;
  let focusedTargetId;
  globalThis.window = {
    requestAnimationFrame(callback) {
      scheduledCallback = callback;
      return 1;
    },
  };
  globalThis.document = {
    getElementById(targetId) {
      return {
        focus(options) {
          focusedTargetId = targetId;
          focusedOptions = options;
        },
      };
    },
  };
  let renderer;

  try {
    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(sidebarModule.AppSidebar, {
          collapsed: false,
          mobileOpen: false,
          investigationHref: "/investigations/alert-id",
          activeSectionId: "overview",
          onNavigateSection() {},
          onToggleCollapsed() {},
          onCloseMobile() {},
        }),
      );
    });

    const candidateLink = renderer.root
      .findAllByType("a")
      .find((link) => link.props.href === "#candidate-ranking");
    assert.ok(candidateLink);
    await act(async () => {
      candidateLink.props.onClick();
    });
    assert.equal(typeof scheduledCallback, "function");
    scheduledCallback();
    assert.equal(focusedTargetId, "candidate-ranking");
    assert.deepEqual(focusedOptions, { preventScroll: true });
  } finally {
    if (renderer) {
      await act(async () => {
        renderer.unmount();
      });
    }
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("fixture scenarios live in a grouped development control, not primary tabs", () => {
  const selectorHtml = markup(fixtureSelectorModule.FixtureSelector, {
    options: dataModule.fixtureOptions,
    selectedAlertId: fixtureByLabel.Groups,
    onSelect() {},
  });
  const topBarHtml = markup(topBarModule.TopBar, {
    sidebarCollapsed: false,
    fixtureOptions: dataModule.fixtureOptions,
    selectedAlertId: fixtureByLabel.Groups,
    onToggleSidebar() {},
    onOpenMobileNavigation() {},
    onSelectFixture() {},
  });

  assert.match(selectorHtml, /<details/);
  assert.match(selectorHtml, /Example investigations/);
  assert.match(selectorHtml, /Alert status/);
  assert.match(selectorHtml, /Evidence examples/);
  assert.match(selectorHtml, /Data checks/);
  assert.match(selectorHtml, /Ranking ties/);
  for (const label of [
    "Resolved",
    "Firing",
    "No evidence",
    "Long request path",
    "Grouped evidence",
    "Service mismatch",
    "Missing links",
    "Tied candidates",
  ]) {
    assert.match(selectorHtml, new RegExp(`>${label}<`));
  }
  assert.doesNotMatch(topBarHtml, /aria-label="Fixture investigations"/);
  assert.doesNotMatch(topBarHtml, /role="group"/);
});

test("fixture selector preserves existing fixture IDs and route behavior", async () => {
  let selectedAlertId;
  let renderer;

  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(fixtureSelectorModule.FixtureSelector, {
        options: dataModule.fixtureOptions,
        selectedAlertId: fixtureByLabel.Resolved,
        onSelect(alertId) {
          selectedAlertId = alertId;
        },
      }),
    );
  });

  const mismatchButton = renderer.root
    .findAllByType("button")
    .find((button) =>
      button
        .findAllByType("span")
        .some((span) => span.children.includes("Service mismatch")),
    );
  assert.ok(mismatchButton);
  await act(async () => {
    mismatchButton.props.onClick();
  });
  assert.equal(selectedAlertId, fixtureByLabel.Mismatch);

  for (const option of dataModule.fixtureOptions) {
    const path = dataModule.investigationPath(option.alertId);
    assert.equal(appModule.alertIdFromPath(path), option.alertId);
  }

  await act(async () => {
    renderer.unmount();
  });
});
test("app shell truly collapses and restores the sidebar without hiding content", async () => {
  let renderer;

  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(
        appShellModule.AppShell,
        {
          investigationHref: "/investigations/alert-id",
          currentAlertId: "alert-id",
          fixtureOptions: [],
          onSelectFixture() {},
        },
        React.createElement("div", null, "Main investigation content"),
      ),
    );
  });

  const expandedText = renderedText(renderer);
  assert.match(expandedText, /lg:w-64/);
  assert.match(expandedText, /Main investigation content/);
  assert.match(expandedText, /Where to start/);

  const collapse = renderer.root
    .findAllByType("button")
    .find((button) => button.props["aria-label"] === "Collapse sidebar");
  assert.ok(collapse);

  await act(async () => {
    collapse.props.onClick();
  });

  const collapsedText = renderedText(renderer);
  assert.match(collapsedText, /lg:w-\[4\.5rem\]/);
  assert.match(collapsedText, /Main investigation content/);
  assert.match(collapsedText, /Expand sidebar/);

  for (const label of [
    "Investigations",
    "Overview",
    "Investigation",
    "Evidence",
  ]) {
    const control = renderer.root
      .findAll((node) => node.type === "a" || node.type === "button")
      .find(
        (node) =>
          node.props["aria-label"] === label ||
          node.props.title === label,
      );
    assert.ok(control, `expected accessible collapsed control for ${label}`);
  }

  const candidateLink = renderer.root
    .findAllByType("a")
    .find((link) => link.props.href === "#candidate-ranking");
  const investigationChildren = renderer.root
    .findAllByType("div")
    .find((item) => item.props.id === "sidebar-group-investigation");
  assert.ok(candidateLink);
  assert.ok(investigationChildren);
  assert.match(investigationChildren.props.className, /lg:hidden/);

  const expand = renderer.root
    .findAllByType("button")
    .find((button) => button.props["aria-label"] === "Expand sidebar");
  assert.ok(expand);
  await act(async () => {
    expand.props.onClick();
  });

  const restoredText = renderedText(renderer);
  assert.match(restoredText, /lg:w-64/);
  assert.match(restoredText, /Where to start/);
  assert.match(restoredText, /Main investigation content/);

  await act(async () => {
    renderer.unmount();
  });
});

test("opening mobile navigation makes page content inert and keeps the backdrop out of tab order", async () => {
  let renderer;

  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(
        appShellModule.AppShell,
        {
          investigationHref: "/investigations/alert-id",
          currentAlertId: "alert-id",
          fixtureOptions: [],
          onSelectFixture() {},
        },
        React.createElement("div", null, "Main investigation content"),
      ),
    );
  });

  const openButton = renderer.root
    .findAllByType("button")
    .find((button) => button.props["aria-label"] === "Open navigation");
  assert.ok(openButton);
  assert.equal(openButton.props["aria-expanded"], false);

  await act(async () => {
    openButton.props.onClick();
  });

  assert.equal(openButton.props["aria-expanded"], true);
  const inertContent = renderer.root
    .findAllByType("div")
    .find((node) => node.props.inert === true);
  assert.ok(inertContent);
  const backdrop = renderer.root
    .findAllByType("button")
    .find(
      (button) => button.props["aria-label"] === "Close navigation overlay",
    );
  assert.ok(backdrop);
  assert.equal(backdrop.props.tabIndex, -1);

  await act(async () => {
    backdrop.props.onClick();
  });
  assert.equal(openButton.props["aria-expanded"], false);
  assert.equal(
    renderer.root.findAllByType("div").some((node) => node.props.inert === true),
    false,
  );

  await act(async () => {
    renderer.unmount();
  });
});

test("section navigation preserves stable targets through collapsed groups", async () => {
  let renderer;

  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(
        appShellModule.AppShell,
        {
          investigationHref: "/investigations/alert-id",
          currentAlertId: "alert-id",
          fixtureOptions: [],
          onSelectFixture() {},
        },
        React.createElement("div", null, "Investigation"),
      ),
    );
  });

  const candidateLink = renderer.root
    .findAllByType("a")
    .find((link) => link.props.href === "#candidate-ranking");
  const narrativeLink = renderer.root
    .findAllByType("a")
    .find((link) => link.props.href === "#ai-explanation");
  assert.ok(candidateLink);
  assert.ok(narrativeLink);

  await act(async () => {
    candidateLink.props.onClick();
  });
  assert.equal(candidateLink.props["aria-current"], "location");

  await act(async () => {
    narrativeLink.props.onClick();
  });
  assert.equal(narrativeLink.props["aria-current"], "location");

  const evidenceToggle = renderer.root
    .findAllByType("button")
    .find((button) => button.props["aria-controls"] === "sidebar-group-evidence");
  assert.ok(evidenceToggle);
  await act(async () => {
    evidenceToggle.props.onClick();
  });

  const traceLink = renderer.root
    .findAllByType("a")
    .find((link) => link.props.href === "#trace-path");
  assert.ok(traceLink);
  await act(async () => {
    traceLink.props.onClick();
  });
  assert.equal(traceLink.props["aria-current"], "location");

  assert.equal(evidenceToggle.props["aria-expanded"], true);
  assert.equal(renderer.root.findByProps({ id: "sidebar-group-evidence" }).findAllByType("a").length, 8);

  const relationshipsLink = renderer.root
    .findAllByType("a")
    .find((link) => link.props.href === "#relationships");
  assert.ok(relationshipsLink);
  await act(async () => {
    relationshipsLink.props.onClick();
  });
  assert.equal(relationshipsLink.props["aria-current"], "location");

  await act(async () => {
    renderer.unmount();
  });
});

test("ready investigation renders every sidebar target with ranking before AI", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = { title: "" };
  let narrativeCalls = 0;
  let renderer;
  const investigationSource = {
    async getInvestigation() {
      return resolved;
    },
  };
  const narrativeSource = {
    async generateNarrative() {
      narrativeCalls += 1;
      return narrativeFixture;
    },
  };

  try {
    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(pageModule.InvestigationPage, {
          alertId: resolved.alert.id,
          dataSource: investigationSource,
          narrativeDataSource: narrativeSource,
        }),
      );
      await new Promise((resolvePromise) => setImmediate(resolvePromise));
    });

    const text = renderedText(renderer);
    for (const id of [
      "overview",
      "candidate-ranking",
      "ai-explanation",
      "evidence-priority",
      "findings",
      "timeline",
      "trace-path",
      "evidence-groups",
      "relationships",
      "telemetry",
      "integrity",
    ]) {
      assert.match(text, new RegExp(`"id":"${id}"`));
    }
    assert.ok(text.indexOf('"id":"candidate-ranking"') < text.indexOf('"id":"ai-explanation"'));
    assert.ok(text.indexOf('"id":"ai-explanation"') < text.indexOf('"id":"evidence-priority"'));
    assert.ok(text.indexOf('"id":"telemetry"') < text.indexOf('"id":"integrity"'));
    assert.equal(narrativeCalls, 0);
  } finally {
    if (renderer) {
      await act(async () => {
        renderer.unmount();
      });
    }
    if (previousDocument === undefined) {
      delete globalThis.document;
    } else {
      globalThis.document = previousDocument;
    }
  }
});
function startingPointHostNodes(renderer) {
  const nodes = [];
  function visit(value) {
    if (Array.isArray(value)) return value.forEach(visit);
    if (value && typeof value === "object") {
      nodes.push(value);
      value.children?.forEach(visit);
    }
  }
  visit(renderer.toJSON());
  return nodes;
}

async function withStartingPointPage(investigation, verify) {
  const previousDocument = globalThis.document;
  const previousHTMLElement = globalThis.HTMLElement;
  const documentEnvironment = installReviewDocumentEnvironment();
  globalThis.document = documentEnvironment.document;
  globalThis.HTMLElement = documentEnvironment.HTMLElement;
  const before = structuredClone(investigation);
  let reads = 0;
  let narratives = 0;
  let lifecycleWrites = 0;
  let renderer;
  try {
    await act(async () => { renderer = TestRenderer.create(React.createElement(pageModule.InvestigationPage, {
      alertId: investigation.alert.id,
      dataSource: { async getInvestigation() { reads++; return investigation; } },
      narrativeDataSource: { async generateNarrative() { narratives++; throw new Error("Not requested"); } },
      lifecycleDataSource: { async updateStatus() { lifecycleWrites++; throw new Error("Not requested"); } },
    }), { createNodeMock: documentEnvironment.createNodeMock }); });
    await verify(renderer);
    assert.equal(reads, 1);
    assert.equal(narratives, 0);
    assert.equal(lifecycleWrites, 0);
    assert.deepEqual(investigation, before);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
    if (previousHTMLElement === undefined) delete globalThis.HTMLElement; else globalThis.HTMLElement = previousHTMLElement;
  }
}

test("starting point slot follows incident identity and precedes snapshot context without replacing it", () => {
  const html = markup(overviewModule.InvestigationOverview, {
    investigation: unifiedIncident,
    children: React.createElement("section", { id: "starting-point-slot" }, "Existing ranking"),
  });
  assert.ok(html.indexOf('id="alert-title"') < html.indexOf('id="starting-point-slot"'));
  assert.ok(html.indexOf('id="starting-point-slot"') < html.indexOf('id="window-heading"'));
  assert.ok(html.indexOf('id="window-heading"') < html.indexOf('aria-label="Investigation summary"'));
  const standalone = markup(overviewModule.InvestigationOverview, { investigation: unifiedIncident });
  assert.match(standalone, /Evidence snapshot/);
  assert.match(standalone, /Investigation summary/);
  assert.doesNotMatch(standalone, /starting-point-slot|candidate-ranking/);
});

test("starting point ready page renders the existing leader before the window and totals with one ranking", async () => {
  await withStartingPointPage(unifiedIncident, renderer => {
    const nodes = startingPointHostNodes(renderer);
    const title = nodes.findIndex(node => node.props.id === "alert-title");
    const ranking = nodes.findIndex(node => node.props.id === "candidate-ranking");
    const windowHeading = nodes.findIndex(node => node.props.id === "window-heading");
    const totals = nodes.findIndex(node => node.props["aria-label"] === "Investigation summary");
    const rows = nodes.filter(node => node.type === "article" && node.props["aria-label"]?.startsWith("Candidate rank #"));
    assert.ok(title >= 0 && title < ranking && ranking < windowHeading && windowHeading < totals);
    assert.deepEqual(rows.map(row => row.props["aria-label"]), unifiedIncident.causeCandidateRanks.map(rank => `Candidate rank #${rank.rank}, ${rank.service}${rank.tied ? ", tied candidate" : ""}`));
    assert.ok(nodes.indexOf(rows[0]) < windowHeading);
    assert.match(renderedText(renderer), /Best place to start/);
    assert.equal(nodes.filter(node => node.props.id === "candidate-ranking").length, 1);
    assert.equal(renderer.root.findAllByType(candidateModule.CauseCandidateRanking).length, 1);
    const candidate = renderer.root.findByType(overviewModule.InvestigationOverview).findByType(candidateModule.CauseCandidateRanking);
    assert.equal(candidate.props.ranks, unifiedIncident.causeCandidateRanks);
    assert.equal(candidate.props.facts, unifiedIncident.causeCandidateFacts);
    assert.equal(candidate.props.candidates, unifiedIncident.causeCandidates);
    assert.equal(renderer.root.findAllByType(detailDrawerModule.InvestigationDetailDrawer).filter(drawer => drawer.props.id === "candidate-detail-drawer").length, 1);
  });
});

test("starting point ties keep both equal-rank candidates ahead of the window without a chosen winner", async () => {
  await withStartingPointPage(candidateTie, renderer => {
    const nodes = startingPointHostNodes(renderer);
    const windowHeading = nodes.findIndex(node => node.props.id === "window-heading");
    const rows = nodes.filter(node => node.type === "article" && node.props["aria-label"]?.startsWith("Candidate rank #"));
    assert.equal(rows.length, 2);
    assert.ok(rows.every(row => row.props["aria-label"].startsWith("Candidate rank #1,") && nodes.indexOf(row) < windowHeading));
    const text = renderedText(renderer);
    assert.match(text, /Tied starting points/);
    assert.equal((text.match(/Why this starting point is tied/g) ?? []).length, 2);
    assert.doesNotMatch(text, /Best place to start/);
    assert.ok(!rows.some(row => row.props["aria-label"].startsWith("Candidate rank #2,")));
  });
});

test("starting point empty page explains absence before the window instead of inventing a candidate", async () => {
  await withStartingPointPage(empty, renderer => {
    const text = renderedText(renderer);
    assert.match(text, /No starting points were ranked for this investigation/);
    assert.ok(text.indexOf("No starting points were ranked") < text.indexOf('"id":"window-heading"'));
    assert.doesNotMatch(text, /Best place to start|Tied starting points/);
    assert.equal(startingPointHostNodes(renderer).filter(node => node.type === "article" && node.props["aria-label"]?.startsWith("Candidate rank #")).length, 0);
    assert.equal(renderer.root.findByType(candidateModule.CauseCandidateRanking).props.ranks.length, 0);
  });
});

test("starting point missing joined facts keeps the supplied ranking and honest unavailable details", async () => {
  const missing = { ...unifiedIncident, causeCandidateFacts: [], causeCandidates: [] };
  await withStartingPointPage(missing, async renderer => {
    const ranking = renderer.root.findByType(candidateModule.CauseCandidateRanking);
    assert.equal(ranking.props.ranks, unifiedIncident.causeCandidateRanks);
    const nodes = startingPointHostNodes(renderer);
    const windowHeading = nodes.findIndex(node => node.props.id === "window-heading");
    const first = nodes.find(node => node.type === "article" && node.props["aria-label"] === "Candidate rank #1, demo-checkout");
    assert.ok(first && nodes.indexOf(first) < windowHeading);
    assert.match(renderedText(renderer), /Severity unavailable/);
    const open = ranking.findAllByType("button").find(button => button.props["aria-controls"] === "candidate-detail-drawer");
    await act(async () => open.props.onClick());
    assert.match(renderedText(renderer), /Detailed facts are missing for this candidate/);
    assert.match(renderedText(renderer), /Linked evidence is missing for this candidate/);
    assert.equal(renderer.root.findAllByType("button").filter(button => button.children.includes("Show candidate findings")).length, 0);
  });
});

test("starting point moved drawer retains exact finding and trace links and opens existing findings", async () => {
  await withStartingPointPage(unifiedIncident, async renderer => {
    const candidate = unifiedIncident.causeCandidates.find(item => item.id === unifiedIncident.causeCandidateRanks[0].candidateId);
    const ranking = renderer.root.findByType(candidateModule.CauseCandidateRanking);
    const open = ranking.findAllByType("button").find(button => button.props["aria-controls"] === "candidate-detail-drawer");
    await act(async () => open.props.onClick());
    const findingHref = `#${correlationsModule.findingDomId(candidate.findingIds[0])}`;
    const traceHref = `#${targetsModule.traceDomId(candidate.traceIds[0])}`;
    const findingLink = ranking.findAllByType("a").find(link => link.props.href === findingHref);
    assert.ok(findingLink);
    assert.ok(ranking.findAllByType("a").some(link => link.props.href === traceHref));
    await act(async () => findingLink.props.onClick());
    const findings = renderer.root.findByType(findingsModule.FindingsTimeline);
    assert.equal(findings.props.openSection, "findings");
    assert.deepEqual([...findings.props.highlightedFindingIds], candidate.findingIds);
    assert.equal(findings.props.highlightedFindingLabel, "Candidate finding");
    assert.ok(startingPointHostNodes(renderer).some(node => node.props.id === findingHref.slice(1)));
    assert.equal(renderer.root.findAllByType(detailDrawerModule.InvestigationDetailDrawer).filter(drawer => drawer.props.id === "candidate-detail-drawer").length, 1);
    assert.equal(startingPointHostNodes(renderer).filter(node => node.props.id === "candidate-detail-drawer").length, 0);
  });
});

test("deeper investigation sections are compact by default and reveal complete drawer content", async () => {
  let renderer;

  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(findingsModule.FindingsTimeline, {
          findings: resolved.findings,
          timeline: resolved.timeline,
        }),
        React.createElement(signalsModule.StructuralSignals, {
          signals: resolved.signals,
          findings: resolved.findings,
          selectedSignalId: null,
          onSelectSignal() {},
        }),
        React.createElement(
          evidenceGroupsModule.EvidenceGroups,
          evidenceGroupProps(resolved),
        ),
        React.createElement(
          relatedModule.RelatedEvidence,
          relatedProps(resolved),
        ),
        React.createElement(evidenceModule.Evidence, {
          metrics: resolved.metrics,
          logs: resolved.logs,
        }),
        React.createElement(integrityModule.IntegrityIssues, {
          issues: resolved.integrityIssues,
          logs: resolved.logs,
          traces: resolved.traces,
        }),
      ),
    );
  });

  const sections = [
    ["findings", resolved.findings[0].message],
    ["timeline", "Alert fired"],
    ["structural-signals", resolved.signals[0].message],
    ["evidence-groups", resolved.evidenceGroups[0].message],
    ["relationships", resolved.correlations[0].message],
    ["telemetry", resolved.metrics[0].name],
    ["integrity", "No missing or inconsistent trace or span links were reported"],
  ];

  for (const [sectionId, expectedText] of sections) {
    const button = renderer.root
      .findAllByType("button")
      .find((item) => item.props["aria-controls"] === sectionId + "-drawer");
    assert.ok(button, "expected drawer trigger for " + sectionId);
    assert.equal(button.props["aria-expanded"], false);
    assert.equal(
      renderer.root
        .findAllByType("aside")
        .some((item) => item.props.id === sectionId + "-drawer"),
      false,
    );

    await act(async () => {
      button.props.onClick();
    });

    assert.equal(button.props["aria-expanded"], true);
    const drawer = renderer.root
      .findAllByType("aside")
      .find((item) => item.props.id === sectionId + "-drawer");
    assert.ok(drawer, "expected open drawer for " + sectionId);
    assert.equal(drawer.props.role, "dialog");
    assert.equal(drawer.props["aria-modal"], "true");
    assert.ok(renderedText(renderer).includes(expectedText));
  }

  await act(async () => {
    renderer.unmount();
  });
});
test("actual integrity issues stay prominent and open complete diagnostics on demand", async () => {
  let renderer;

  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(integrityModule.IntegrityIssues, {
        issues: integrityMismatch.integrityIssues,
        logs: integrityMismatch.logs,
        traces: integrityMismatch.traces,
      }),
    );
  });

  const initialText = renderedText(renderer);
  assert.match(initialText, /Service and step mismatch/);
  assert.ok(initialText.includes(integrityMismatch.integrityIssues[0].message));

  const button = renderer.root
    .findAllByType("button")
    .find((item) => item.props["aria-controls"] === "integrity-drawer");
  assert.ok(button);
  assert.equal(button.props["aria-expanded"], false);

  await act(async () => {
    button.props.onClick();
  });

  assert.equal(button.props["aria-expanded"], true);
  const drawer = renderer.root
    .findAllByType("aside")
    .find((item) => item.props.id === "integrity-drawer");
  assert.ok(drawer);
  assert.equal(drawer.props.role, "dialog");
  assert.match(renderedText(renderer), /do not mean the incident is invalid/);

  await act(async () => {
    renderer.unmount();
  });
});
test("fixture matrix covers intelligence, candidate ranks, integrity, empty, deep trace, groups, and unknown IDs", async () => {
  assert.equal(resolved.alert.status, "resolved");
  assert.equal(firing.alert.status, "firing");
  assert.equal(empty.findings.length, 0);
  assert.equal(empty.traces.length, 0);
  assert.equal(empty.logs.length, 0);
  assert.equal(deepTrace.traces[0].children[0].children.length, 1);
  assert.equal(multipleGroups.evidenceGroups.length, 2);
  assert.deepEqual(resolved.integrityIssues, []);
  assert.equal(resolved.signals.length, 3);
  assert.equal(resolved.evidenceRanks.length, resolved.findings.length);
  assert.deepEqual(
    resolved.causeCandidateRanks.map(({ service, rank }) => [service, rank]),
    [
      ["postgres", 1],
      ["auth-service", 2],
      ["user-service", 3],
    ],
  );
  assert.deepEqual(
    candidateTie.causeCandidateRanks.map(({ service, rank, tied }) => [
      service,
      rank,
      tied,
    ]),
    [
      ["postgres", 1, true],
      ["redis", 1, true],
    ],
  );
  assert.equal(integrityMismatch.integrityIssues[0].type, "service_span_mismatch");
  assert.deepEqual(
    integrityMissing.integrityIssues.map((issue) => issue.type),
    ["missing_trace_reference", "missing_span_reference"],
  );
  await assert.rejects(
    dataModule.fixtureInvestigationDataSource.getInvestigation("unknown-alert"),
    errorsModule.InvestigationNotFoundError,
  );
});

test("resolved and firing alert status presentations remain distinct", () => {
  const resolvedHtml = markup(overviewModule.InvestigationOverview, {
    investigation: resolved,
  });
  const firingHtml = markup(overviewModule.InvestigationOverview, {
    investigation: firing,
  });

  assert.match(resolvedHtml, />Resolved</);
  assert.match(resolvedHtml, /Resolved evidence window/);
  assert.match(firingHtml, />Firing</);
  assert.match(firingHtml, /Evidence snapshot/);
});

test("list and detail reuse one title-case alert status presentation without changing stored values", async () => {
  const cases = [
    ["firing", "Firing"],
    ["acknowledged", "Acknowledged"],
    ["resolved", "Resolved"],
  ];
  const alerts = cases.map(([status], index) => ({
    ...firing.alert,
    id: "status-presentation-" + index,
    status,
    resolvedAt: status === "resolved" ? firing.alert.updatedAt : undefined,
  }));
  const before = structuredClone(alerts);

  for (const [status, label] of cases) {
    const badgeHtml = markup(alertStatusBadgeModule.AlertStatusBadge, { status });
    assert.match(badgeHtml, new RegExp('data-alert-status="' + status + '"'));
    assert.match(badgeHtml, new RegExp(">" + label + "</span>"));
    assert.equal((badgeHtml.match(/<svg/g) ?? []).length, 1);

    const alert = alerts.find((item) => item.status === status);
    const investigation = { ...firing, alert };
    const detailHtml = markup(overviewModule.InvestigationOverview, { investigation });
    assert.ok(detailHtml.includes(badgeHtml));
  }

  const previousDocument = globalThis.document;
  globalThis.document = { title: "" };
  let renderer;
  try {
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(workspaceModule.InvestigationsPage, {
        dataSource: { async getAlerts() { return alerts; } },
      }));
    });
    const badges = renderer.root.findAllByType(alertStatusBadgeModule.AlertStatusBadge);
    assert.deepEqual(badges.map((badge) => badge.props.status), cases.map(([status]) => status));
    assert.deepEqual(
      badges.map((badge) => badge.findByProps({ "data-alert-status": badge.props.status }).children.at(-1)),
      cases.map(([, label]) => label),
    );
    assert.deepEqual(alerts, before);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("demo incident header makes the readable title primary and full identifiers secondary", () => {
  const before = structuredClone(unifiedIncident);
  const html = markup(overviewModule.InvestigationOverview, { investigation: unifiedIncident });
  const title = html.match(/<h1\b[^>]*>(.*?)<\/h1>/s)?.[1];
  assert.equal(title, "Checkout failures detected");
  assert.ok(!title.includes(unifiedIncident.alert.id));
  assert.ok(!title.includes(unifiedIncident.alert.ruleId));
  assert.match(html, /<details\b[^>]*>.*?<summary\b[^>]*>Alert IDs<\/summary>/s);
  assert.doesNotMatch(html, /<details\b[^>]*\bopen(?:=|\s|>)/);
  assert.match(html, />Alert ID</);
  assert.match(html, />Rule ID</);
  assert.ok(html.includes(`>${unifiedIncident.alert.id}</dd>`));
  assert.ok(html.includes(`>${unifiedIncident.alert.ruleId}</dd>`));
  assert.deepEqual(unifiedIncident, before);
});

test("incident display never silently rewrites user-supplied titles or trigger messages", () => {
  const custom = {
    ...firing,
    alert: { ...firing.alert, title: "Phase 7 customer migration 1fd77d4a-2e33-4a09-aae3-74eb81e743b4", message: "custom_count_abc >= 1, no rate derived" },
  };
  const html = markup(overviewModule.InvestigationOverview, { investigation: custom });
  assert.ok(html.includes(`>${custom.alert.title}</h1>`));
  assert.ok(html.includes(custom.alert.message.replace(">", "&gt;")));
});

test("demo fixture incident and lifecycle event use the same accurate human-readable title", () => {
  assert.equal(unifiedIncident.alert.title, "Checkout failures detected");
  const event = unifiedIncident.timeline.find(item => item.type === "alert_fired");
  assert.equal(event.data.title, unifiedIncident.alert.title);
  assert.equal(event.data.alertId, unifiedIncident.alert.id);
  assert.ok(unifiedIncident.metrics.every(metric => metric.type === "counter" && metric.value === 1 && metric.unit === "{failure}"));
  assert.doesNotMatch(unifiedIncident.alert.title, /Phase|OTLP|Unified|rate|%|[0-9a-f]{8}-[0-9a-f-]{27}/i);
});

test("demo incident list retains distinct full IDs and exact live links for matching readable titles", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = { title: "" };
  const alerts = [unifiedIncident.alert, { ...unifiedIncident.alert, id: "second-alert-exact-id", ruleId: "second-rule-exact-id" }];
  const before = structuredClone(alerts);
  const view = { query: "Checkout failures", status: "firing" };
  let reads = 0;
  let renderer;
  try {
    await act(async () => { renderer = TestRenderer.create(React.createElement(workspaceModule.InvestigationsPage, {
      dataSource: { async getAlerts() { reads++; return alerts; } }, initialView: view,
    })); });
    assert.equal(reads, 1);
    assert.deepEqual(renderer.root.findAllByType("h2").map(node => node.children.join("")), ["Checkout failures detected", "Checkout failures detected"]);
    assert.equal(renderer.root.findAllByType("details").length, 2);
    assert.ok(renderer.root.findAllByType("details").every(node => !node.props.open));
    const links = renderer.root.findAllByType("a");
    assert.deepEqual(new Set(links.map(link => link.props.href)), new Set(alerts.map(alert => alertSelectionModule.liveInvestigationHref(alert.id, view))));
    for (const alert of alerts) {
      const values = renderer.root.findAllByType("dd").map(node => node.children.join(""));
      assert.ok(values.includes(alert.id));
      assert.ok(values.includes(alert.ruleId));
      assert.ok(links.some(link => link.props["aria-label"].includes(`(${alert.id})`)));
    }
    assert.deepEqual(alerts, before);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
  }
});

test("evidence window does not infer active collection or resolution from an old alert", () => {
  const old = {
    ...firing,
    alert: { ...firing.alert, startedAt: "2026-09-10T09:00:00.000Z", updatedAt: "2026-09-10T09:01:00.000Z" },
    window: { from: "2026-09-10T08:45:00.000Z", to: "2026-09-10T09:05:00.000Z" },
  };
  const html = markup(overviewModule.InvestigationOverview, { investigation: old });
  assert.match(html, />Firing</);
  assert.match(html, />Unresolved</);
  assert.match(html, /Evidence snapshot/);
  assert.match(html, /does not close just because time has passed/);
  assert.match(html, /this view does not show whether new data is arriving/);
  assert.doesNotMatch(html, /COLLECTING|Live evidence window|FINALIZED|Frozen evidence window/);
  assert.match(html, /dateTime="2026-09-10T08:45:00.000Z"/);
  assert.match(html, /dateTime="2026-09-10T09:05:00.000Z"/);
  assert.equal(old.alert.status, "firing");
});

test("evidence window never invents live collection for firing or acknowledged snapshots", () => {
  for (const status of ["firing", "acknowledged"]) {
    const investigation = { ...firing, alert: { ...firing.alert, status } };
    const html = markup(overviewModule.InvestigationOverview, { investigation });
    assert.ok(html.includes(">" + (status === "firing" ? "Firing" : "Acknowledged") + "<"));
    assert.match(html, />Unresolved</);
    assert.match(html, /Evidence snapshot/);
    assert.doesNotMatch(html, /COLLECTING|Live evidence window|live-ping|live-window/);
  }
});

test("evidence window displays resolved state and the exact returned range without claiming frozen records", () => {
  const html = markup(overviewModule.InvestigationOverview, { investigation: resolved });
  assert.match(html, /Resolved evidence window/);
  assert.match(html, /This alert is resolved/);
  assert.ok(html.includes(`dateTime="${resolved.window.from}"`));
  assert.ok(html.includes(`dateTime="${resolved.window.to}"`));
  assert.doesNotMatch(html, /COLLECTING|Live evidence window|Frozen evidence window|Unresolved/);
});

test("evidence window separates the last alert update from evidence time bounds", () => {
  const investigation = {
    ...firing,
    alert: { ...firing.alert, status: "acknowledged", updatedAt: "2026-09-10T09:01:00.000Z" },
    window: { from: "2026-09-10T08:45:00.000Z", to: "2026-09-13T10:00:00.000Z" },
  };
  const html = markup(overviewModule.InvestigationOverview, { investigation });
  assert.match(html, /Last alert update/);
  assert.ok(html.includes(formattersModule.formatDateTime(investigation.alert.updatedAt)));
  assert.ok(html.includes(`dateTime="${investigation.window.to}"`));
  assert.match(html, /Evidence from/);
  assert.match(html, /Evidence through/);
});

test("evidence window has accessible snapshot context and no fabricated progress visualization", () => {
  for (const investigation of [firing, resolved]) {
    const html = markup(overviewModule.InvestigationOverview, { investigation });
    assert.match(html, /aria-labelledby="window-heading" aria-describedby="window-description"/);
    assert.match(html, /id="window-description"/);
    assert.match(html, /Evidence from/);
    assert.match(html, /Evidence through/);
    assert.doesNotMatch(html, /w-4\/5|live-window|live-ping|role="progressbar"/);
  }
});

test("evidence window refresh reloads authoritative status and bounds without lifecycle or AI writes", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = { title: "" };
  const next = { ...resolved, alert: { ...resolved.alert, id: firing.alert.id, ruleId: firing.alert.ruleId } };
  let reads = 0;
  let writes = 0;
  let narratives = 0;
  const source = new httpModule.HttpInvestigationDataSource("http://example.invalid", async (url, init) => {
    reads++;
    assert.ok(url.endsWith(`/v1/alerts/${firing.alert.id}/investigation`));
    assert.equal(init.method, "GET");
    return new Response(JSON.stringify(reads === 1 ? firing : next), { status: 200, headers: { "content-type": "application/json" } });
  });
  const props = {
    alertId: firing.alert.id,
    dataSource: source,
    narrativeDataSource: { async generateNarrative() { narratives++; throw new Error("Not requested"); } },
    lifecycleDataSource: { async updateStatus() { writes++; throw new Error("Not requested"); } },
  };
  let renderer;
  try {
    await act(async () => { renderer = TestRenderer.create(React.createElement(pageModule.InvestigationPage, { ...props, key: "before-refresh" })); });
    assert.match(renderedText(renderer), /Evidence snapshot/);
    assert.match(renderedText(renderer), /Unresolved/);
    await act(async () => { renderer.update(React.createElement(pageModule.InvestigationPage, { ...props, key: "after-refresh" })); });
    assert.equal(reads, 2);
    assert.equal(writes, 0);
    assert.equal(narratives, 0);
    assert.match(renderedText(renderer), /Resolved evidence window/);
    assert.doesNotMatch(renderedText(renderer), /Unresolved|COLLECTING/);
    assert.deepEqual(renderer.root.findByType(overviewModule.InvestigationOverview).findAllByType("time").map(node => node.props.dateTime), [next.window.from, next.window.to]);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
  }
});

test("overview and timeline preserve readable width on narrow screens", () => {
  const overviewHtml = markup(overviewModule.InvestigationOverview, {
    investigation: resolved,
  });
  const timelineHtml = markup(findingsModule.FindingsTimeline, {
    findings: resolved.findings,
    timeline: resolved.timeline,
    openSection: "timeline",
    onOpenSection() {},
  });

  assert.match(overviewHtml, /min-w-0 gap-3 text-xs sm:min-w-\[17rem\]/);
  assert.match(timelineHtml, /grid-cols-\[1\.75rem_minmax/);
});

test("empty findings and timeline states are factual", () => {
  const html = markup(findingsModule.FindingsTimeline, {
    findings: [],
    timeline: [],
  });

  assert.match(html, /No findings were generated for this investigation/);
  assert.match(html, /No timeline events were recorded/);
});

test("recursive trace rendering includes deep descendants and accessible controls", () => {
  const html = markup(traceModule.TraceTree, { traces: deepTrace.traces });

  assert.match(html, /gateway-service/);
  assert.match(html, /postgres-primary/);
  assert.match(html, /depth 7/);
  assert.match(html, /role="region"/);
  assert.match(html, /aria-label="Scrollable request call path"/);
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /Collapse gateway-service POST \/checkout step/);
});

test("exact-span log lookup requires both identifiers and preserves duplicates", () => {
  const exactLog = unifiedIncident.logs[0];
  const sameTraceDifferentSpan = {
    ...exactLog,
    spanId: "different-span",
  };
  const sameSpanDifferentTrace = {
    ...exactLog,
    traceId: "different-trace",
  };
  const missingSpan = { ...exactLog };
  delete missingSpan.spanId;
  const duplicateExactLog = {
    ...exactLog,
    message: "Second exact log record",
  };
  const logs = [
    exactLog,
    sameTraceDifferentSpan,
    sameSpanDifferentTrace,
    missingSpan,
    duplicateExactLog,
  ];
  const lookup = exactSpanLogsModule.buildExactSpanLogLookup(logs);
  const matches = exactSpanLogsModule.findExactSpanLogs(lookup, {
    traceId: exactLog.traceId,
    spanId: exactLog.spanId,
  });

  assert.deepEqual(matches.map(({ index }) => index), [0, 4]);
  assert.deepEqual(
    matches.map(({ log }) => log.message),
    [exactLog.message, duplicateExactLog.message],
  );
  assert.equal(
    exactSpanLogsModule.findExactSpanLogs(lookup, {
      traceId: exactLog.traceId,
      spanId: "different-span",
    }).length,
    1,
  );
  assert.equal(
    exactSpanLogsModule.findExactSpanLogs(lookup, {
      traceId: "different-trace",
      spanId: exactLog.spanId,
    }).length,
    1,
  );
});

test("trace tree shows exact log context only on the matching checkout leaf", () => {
  const exactLog = unifiedIncident.logs[0];
  const html = markup(traceModule.TraceTree, {
    traces: unifiedIncident.traces,
    logs: unifiedIncident.logs,
    selectedExactSpan: {
      traceId: exactLog.traceId,
      spanId: exactLog.spanId,
    },
    onReviewExactSpanLogs() {},
  });
  const expectedLogTarget = targetsModule.logDomId(
    exactLog.timestamp,
    exactLog.service,
    0,
  );

  assert.equal((html.match(/Logs for this step/g) ?? []).length, 1);
  assert.equal((html.match(/data-exact-span-log-count="1"/g) ?? []).length, 1);
  assert.equal((html.match(/data-exact-span-log-count="0"/g) ?? []).length, 2);
  assert.match(html, /Checkout inventory unavailable/);
  assert.match(html, /Review linked logs/);
  assert.match(html, new RegExp(`href="#${expectedLogTarget}"`));
  assert.doesNotMatch(
    html,
    /root cause|caused by|culprit|confirmed cause|likely cause|confidence|probability/i,
  );
});

test("trace exact-log action reports the exact selected trace and span", async () => {
  const exactLog = unifiedIncident.logs[0];
  let reviewedReference = null;
  let renderer;

  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(traceModule.TraceTree, {
        traces: unifiedIncident.traces,
        logs: unifiedIncident.logs,
        onReviewExactSpanLogs(reference) {
          reviewedReference = reference;
        },
      }),
    );
  });

  const reviewLink = renderer.root
    .findAllByType("a")
    .find((link) =>
      link.children.some(
        (child) =>
          typeof child === "string" && child.includes("Review linked logs"),
      ),
    );
  assert.ok(reviewLink);

  await act(async () => {
    reviewLink.props.onClick();
  });

  assert.deepEqual(reviewedReference, {
    traceId: exactLog.traceId,
    spanId: exactLog.spanId,
  });

  await act(async () => {
    renderer.unmount();
  });
});

test("telemetry drawer emphasizes every log matching the selected exact span", () => {
  const exactLog = unifiedIncident.logs[0];
  const secondExactLog = {
    ...exactLog,
    timestamp: "2026-09-07T07:09:34.171Z",
    message: "Second exact checkout error",
  };
  const unrelatedLog = {
    ...exactLog,
    spanId: "another-span",
    message: "Unrelated checkout error",
  };
  const html = markup(evidenceModule.Evidence, {
    metrics: unifiedIncident.metrics,
    logs: [exactLog, secondExactLog, unrelatedLog],
    detailsOpen: true,
    focusedExactSpan: {
      traceId: exactLog.traceId,
      spanId: exactLog.spanId,
    },
  });

  assert.match(html, /2 logs match the selected request path and step/);
  assert.equal((html.match(/Log for selected step/g) ?? []).length, 2);
  assert.match(html, /Second exact checkout error/);
  assert.match(html, /Unrelated checkout error/);
});

test("logs without an exact trace and span match do not decorate trace nodes", () => {
  const exactLog = unifiedIncident.logs[0];
  const html = markup(traceModule.TraceTree, {
    traces: unifiedIncident.traces,
    logs: [
      { ...exactLog, spanId: "another-span" },
      { ...exactLog, traceId: "another-trace" },
      { ...exactLog, traceId: undefined },
      { ...exactLog, spanId: undefined },
    ],
    onReviewExactSpanLogs() {},
  });

  assert.doesNotMatch(html, /Logs for this step|Review linked logs/);
  assert.equal((html.match(/data-exact-span-log-count="0"/g) ?? []).length, 3);
});

test("Evidence Groups handles frozen empty arrays", () => {
  const absentHtml = markup(
    evidenceGroupsModule.EvidenceGroups,
    evidenceGroupProps(firing),
  );
  const emptyHtml = markup(
    evidenceGroupsModule.EvidenceGroups,
    evidenceGroupProps(empty),
  );

  assert.deepEqual(firing.evidenceGroups, []);
  assert.deepEqual(empty.evidenceGroups, []);
  assert.match(absentHtml, /No connected evidence groups were found/);
  assert.match(emptyHtml, /No connected evidence groups were found/);
});

test("Evidence Groups renders one real group and multiple separate groups", () => {
  const oneHtml = markup(
    evidenceGroupsModule.EvidenceGroups,
    { ...evidenceGroupProps(resolved), detailsOpen: true },
  );
  const multipleHtml = markup(
    evidenceGroupsModule.EvidenceGroups,
    { ...evidenceGroupProps(multipleGroups), detailsOpen: true },
  );

  assert.equal(resolved.evidenceGroups.length, 1);
  assert.match(oneHtml, /5 related findings across 3 services/);
  assert.match(oneHtml, /Same step \(span\)/);
  assert.match(oneHtml, /Same request path \(trace\)/);
  assert.match(oneHtml, /Same service and time window/);
  assert.equal(multipleGroups.evidenceGroups.length, 2);
  assert.deepEqual(resolved.integrityIssues, []);
  assert.equal(resolved.signals.length, 3);
  assert.equal(resolved.evidenceRanks.length, resolved.findings.length);
  assert.equal(integrityMismatch.integrityIssues[0].type, "service_span_mismatch");
  assert.deepEqual(
    integrityMissing.integrityIssues.map((issue) => issue.type),
    ["missing_trace_reference", "missing_span_reference"],
  );
  assert.match(multipleHtml, /3 related findings across 2 services/);
  assert.match(multipleHtml, /2 related findings across 2 services/);
  assert.match(multipleHtml, /No linked traces/);
  assert.doesNotMatch(
    `${oneHtml}${multipleHtml}`,
    /root cause|diagnosis|blamed service|causal chain|confidence score/i,
  );
});

test("Evidence Group finding and correlation references resolve through lookup maps", () => {
  const group = resolved.evidenceGroups[0];
  const findingLookup = correlationsModule.buildFindingLookup(resolved.findings);
  const correlationLookup = evidenceGroupUtilsModule.buildCorrelationLookup(
    resolved.correlations,
  );
  const findings = correlationsModule.resolveFindingIds(
    group.findingIds,
    findingLookup,
  );
  const relationships =
    evidenceGroupUtilsModule.resolveEvidenceGroupCorrelations(
      group,
      correlationLookup,
    );

  assert.equal(findings.length, 5);
  assert.ok(findings.every((reference) => reference.finding));
  assert.equal(relationships.length, 3);
  assert.ok(relationships.every((reference) => reference.correlation));
});

test("Evidence Groups fails gracefully for unknown finding and correlation references", () => {
  const unknownGroup = {
    id: "evidence_group:unknown-references",
    findingIds: ["missing-finding-id"],
    correlationIds: ["missing-correlation-id"],
    services: ["service-with-a-very-long-name-that-must-wrap-safely"],
    traceIds: [],
    findingCount: 1,
    correlationCount: 1,
    findingTypes: ["log_error"],
    correlationTypes: ["same_trace"],
    startedAt: "2026-08-25T00:00:00.000Z",
    endedAt: "2026-08-25T00:00:00.000Z",
    message: "1 referenced finding across 1 service",
  };
  const html = markup(evidenceGroupsModule.EvidenceGroups, {
    evidenceGroups: [unknownGroup],
    correlations: resolved.correlations,
    findings: resolved.findings,
    selectedGroupId: null,
    onSelectGroup() {},
    detailsOpen: true,
  });

  assert.match(html, /Linked finding unavailable in this investigation/);
  assert.match(html, /Linked connection unavailable/);
  assert.match(html, /No linked traces/);
});

test("Evidence Group selection is accessible and narrow layout stays single-column by default", () => {
  const group = resolved.evidenceGroups[0];
  const html = markup(evidenceGroupsModule.EvidenceGroups, {
    ...evidenceGroupProps(resolved),
    selectedGroupId: group.id,
    detailsOpen: true,
  });
  const findingsHtml = markup(findingsModule.FindingsTimeline, {
    findings: resolved.findings,
    timeline: resolved.timeline,
    highlightedFindingIds: new Set(group.findingIds),
    openSection: "findings",
  });

  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /Clear highlight/);
  assert.match(html, /space-y-4 p-4 sm:p-5/);
  assert.doesNotMatch(html, /xl:grid-cols-2/);
  assert.match(html, /break-all/);
  assert.match(findingsHtml, /Connected finding/);
});
test("correlation section handles frozen empty arrays", () => {
  const absentHtml = markup(relatedModule.RelatedEvidence, relatedProps(firing));
  const emptyHtml = markup(relatedModule.RelatedEvidence, relatedProps(empty));

  assert.match(absentHtml, /No recorded connections were found/);
  assert.match(emptyHtml, /No recorded connections were found/);
});

test("correlation section renders one and several factual relationship types", () => {
  const severalHtml = markup(
    relatedModule.RelatedEvidence,
    { ...relatedProps(resolved), detailsOpen: true },
  );
  const oneHtml = markup(
    relatedModule.RelatedEvidence,
    { ...relatedProps(deepTrace), detailsOpen: true },
  );

  assert.match(severalHtml, /Same step \(span\)/);
  assert.match(severalHtml, /Same request path \(trace\)/);
  assert.match(severalHtml, /Same service and time window/);
  assert.doesNotMatch(severalHtml, /root cause|culprit|caused by/i);
  assert.match(oneHtml, /6 connected findings/);
  assert.match(oneHtml, /trace-2026-08-24-production-checkout-request/);
});

test("correlation references use one lookup map and preserve unresolved IDs", () => {
  const lookup = correlationsModule.buildFindingLookup(resolved.findings);
  const references = correlationsModule.resolveCorrelationFindings(
    resolved.correlations[0],
    lookup,
  );

  assert.equal(references.length, 2);
  assert.ok(references.every((reference) => reference.finding));

  const missing = correlationsModule.resolveCorrelationFindings(
    { ...resolved.correlations[0], findingIds: ["missing-finding-id"] },
    lookup,
  );
  assert.equal(missing[0].id, "missing-finding-id");
  assert.equal(missing[0].finding, undefined);
});

test("selected correlation exposes keyboard state and visibly identifies linked findings", () => {
  const correlation = resolved.correlations[0];
  const relatedHtml = markup(relatedModule.RelatedEvidence, {
    ...relatedProps(resolved),
    selectedCorrelationId: correlation.id,
    detailsOpen: true,
  });
  const findingsHtml = markup(findingsModule.FindingsTimeline, {
    findings: resolved.findings,
    timeline: resolved.timeline,
    highlightedFindingIds: new Set(correlation.findingIds),
    openSection: "findings",
  });
  const firstFindingId = correlationsModule.findingDomId(
    correlation.findingIds[0],
  );

  assert.match(relatedHtml, /aria-pressed="true"/);
  assert.match(relatedHtml, /Clear highlight/);
  assert.match(relatedHtml, new RegExp(`href="#${firstFindingId}"`));
  assert.match(findingsHtml, /Connected finding/);
  assert.match(findingsHtml, new RegExp(`id="${firstFindingId}"`));
});
test("route parser decodes the URL ID and request passes it to the data source", async () => {
  const routeId = appModule.alertIdFromPath(
    "/investigations/alert%2Fwith%20spaces",
  );
  let receivedId;
  const source = {
    async getInvestigation(alertId) {
      receivedId = alertId;
      return resolved;
    },
  };

  assert.equal(routeId, "alert/with spaces");
  await pageModule.requestInvestigation(source, routeId);
  assert.equal(receivedId, "alert/with spaces");
});

for (const scenario of [
  {
    name: "investigation",
    create: () => new httpModule.HttpInvestigationDataSource("http://localhost:3000/"),
    request: (source, signal) => source.getInvestigation("alert/with spaces", { signal }),
    payload: resolved,
    method: "GET",
    suffix: "",
  },
  {
    name: "narrative",
    create: () => new narrativeDataSourceModule.HttpInvestigationNarrativeDataSource("http://localhost:3000/"),
    request: (source, signal) => source.generateNarrative("alert/with spaces", { signal }),
    payload: narrativeFixture,
    method: "POST",
    suffix: "/narrative",
  },
]) {
  test(`default ${scenario.name} fetch preserves the browser receiver`, async (t) => {
    const calls = [];
    t.mock.method(globalThis, "fetch", async function (url, init) {
      // Model the native browser API's receiver check, absent from Node fetch.
      if (this !== undefined && this !== globalThis) {
        throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
      }
      calls.push({ url, init });
      return new Response(JSON.stringify(scenario.payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const controller = new AbortController();

    const result = await scenario.request(scenario.create(), controller.signal);

    assert.deepEqual(result, scenario.payload);
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      "http://localhost:3000/v1/alerts/alert%2Fwith%20spaces/investigation" + scenario.suffix,
    );
    assert.equal(calls[0].init.method, scenario.method);
    assert.equal(calls[0].init.headers.Accept, "application/json");
    assert.equal(calls[0].init.signal, controller.signal);
  });
}

test("investigation retry starts a new request and recovers from network failure", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = { title: "" };
  const retryResponse = deferred();
  const calls = [];
  let renderer;
  const source = new httpModule.HttpInvestigationDataSource(
    "http://localhost:3000",
    async (url, init) => {
      calls.push({ url, init });
      if (calls.length === 1) {
        throw new TypeError("Failed to fetch");
      }
      return retryResponse.promise;
    },
  );

  try {
    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(pageModule.InvestigationPage, {
          alertId: resolved.alert.id,
          dataSource: source,
          narrativeDataSource: {
            async generateNarrative() {
              assert.fail("Retrying an investigation must not generate an AI explanation");
            },
          },
        }),
      );
    });
    assert.equal(calls.length, 1);
    assert.match(renderedText(renderer), /We could not connect to the server/);
    const retryButton = renderer.root.findAllByType("button").find(
      (button) => button.children.includes("Try again"),
    );
    assert.ok(retryButton);

    await act(async () => {
      retryButton.props.onClick();
    });
    assert.equal(calls.length, 2);
    assert.equal(calls[1].url, calls[0].url);
    assert.equal(calls[0].init.signal.aborted, true);
    assert.notEqual(calls[1].init.signal, calls[0].init.signal);
    assert.equal(calls[1].init.signal.aborted, false);
    assert.match(renderedText(renderer), /Loading investigation/);
    assert.doesNotMatch(renderedText(renderer), /We could not connect to the server/);

    await act(async () => {
      retryResponse.resolve(new Response(JSON.stringify(resolved), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    });
    assert.equal(calls.length, 2);
    assert.match(renderedText(renderer), /Where to start/);
    assert.doesNotMatch(renderedText(renderer), /Could not load this investigation/);
  } finally {
    if (renderer) {
      await act(async () => renderer.unmount());
    }
    if (previousDocument === undefined) {
      delete globalThis.document;
    } else {
      globalThis.document = previousDocument;
    }
  }
});

test("HTTP data source URL-encodes IDs and accepts a valid response", async () => {
  let requestedUrl;
  const source = new httpModule.HttpInvestigationDataSource(
    "http://localhost:3000/",
    async (url) => {
      requestedUrl = String(url);
      return new Response(JSON.stringify(resolved), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  );

  const response = await source.getInvestigation("alert/with spaces");
  assert.equal(response.alert.id, resolved.alert.id);
  assert.equal(
    requestedUrl,
    "http://localhost:3000/v1/alerts/alert%2Fwith%20spaces/investigation",
  );
});

test("HTTP 404, network failure, and malformed responses stay distinct", async () => {
  const notFound = new httpModule.HttpInvestigationDataSource(
    "http://localhost:3000",
    async () => new Response(null, { status: 404 }),
  );
  const network = new httpModule.HttpInvestigationDataSource(
    "http://localhost:3000",
    async () => {
      throw new TypeError("connection refused");
    },
  );
  const malformed = new httpModule.HttpInvestigationDataSource(
    "http://localhost:3000",
    async () => new Response("not-json", { status: 200 }),
  );

  await assert.rejects(
    notFound.getInvestigation("missing"),
    errorsModule.InvestigationNotFoundError,
  );
  await assert.rejects(
    network.getInvestigation("offline"),
    errorsModule.InvestigationNetworkError,
  );
  await assert.rejects(
    malformed.getInvestigation("invalid"),
    errorsModule.InvalidInvestigationResponseError,
  );
});

test("narrative runtime parser accepts the frozen snapshot contract", () => {
  const parsed =
    narrativeResponseModule.parseInvestigationNarrativeSnapshot(narrativeFixture);

  assert.equal(parsed.evidenceCutoff, "2026-08-15T06:30:00.000Z");
  assert.equal(parsed.generatedAt, "2026-08-15T06:30:02.000Z");
  assert.equal(parsed.contextHash.length, 64);
  assert.equal(parsed.narrative.summary.findingIds.length, 3);
  assert.equal(parsed.narrative.candidates.length, 3);
});

test("narrative runtime parser rejects malformed snapshot and reference fields", () => {
  for (const mutate of [
    (value) => delete value.evidenceCutoff,
    (value) => delete value.generatedAt,
    (value) => delete value.contextHash,
    (value) => delete value.narrative.summary.text,
    (value) => { value.narrative.summary.findingIds = [42]; },
    (value) => { value.narrative.summary.signalIds = "signal"; },
    (value) => delete value.narrative.candidates[0].candidateId,
    (value) => delete value.narrative.candidates[0].text,
    (value) => { value.narrative.candidates[0].findingIds = [null]; },
    (value) => { value.narrative.candidates[0].signalIds = {}; },
  ]) {
    const malformed = structuredClone(narrativeFixture);
    mutate(malformed);
    assert.throws(
      () =>
        narrativeResponseModule.parseInvestigationNarrativeSnapshot(malformed),
      narrativeResponseModule.InvalidInvestigationNarrativeResponseError,
    );
  }
});

test("narrative HTTP data source POSTs once, URL-encodes IDs, and validates success", async () => {
  const calls = [];
  const source = new narrativeDataSourceModule.HttpInvestigationNarrativeDataSource(
    "http://localhost:3000/",
    async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify(narrativeFixture), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  );

  const snapshot = await source.generateNarrative("alert/with spaces");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(
    calls[0].url,
    "http://localhost:3000/v1/alerts/alert%2Fwith%20spaces/investigation/narrative",
  );
  assert.equal(snapshot.narrative.candidates.length, 3);
});

test("narrative backend error codes map to safe product copy", async () => {
  const cases = [
    [
      "NARRATIVE_PROVIDER_TIMEOUT",
      "AI explanation is temporarily unavailable because the request timed out. Your evidence and ranking are still available.",
    ],
    [
      "NARRATIVE_PROVIDER_UNAVAILABLE",
      "AI explanation is temporarily unavailable. Your evidence and ranking are still available.",
    ],
    [
      "NARRATIVE_PROVIDER_ERROR",
      "AI explanation is temporarily unavailable. The AI service did not accept the request. Your evidence and ranking are still available.",
    ],
    [
      "NARRATIVE_PROVIDER_INVALID_RESPONSE",
      "AI explanation is temporarily unavailable. The AI service sent a response we could not use. Your evidence and ranking are still available.",
    ],
    [
      "NARRATIVE_INVALID_OUTPUT",
      "AI explanation is temporarily unavailable. The explanation was not in a usable format. Your evidence and ranking are still available.",
    ],
    [
      "NARRATIVE_GROUNDING_FAILED",
      "The AI explanation was not shown because it could not be checked against this investigation's evidence. Your evidence and ranking are still available.",
    ],
    [
      "NARRATIVE_SEMANTIC_VALIDATION_FAILED",
      "The AI explanation was not shown because it disagreed with the evidence-based ranking. Your evidence and ranking are still available.",
    ],
  ];

  for (const [code, expectedMessage] of cases) {
    const source = new narrativeDataSourceModule.HttpInvestigationNarrativeDataSource(
      "http://localhost:3000",
      async () =>
        new Response(
          JSON.stringify({ error: { code, message: "backend detail" } }),
          {
            status:
              code === "NARRATIVE_PROVIDER_UNAVAILABLE" ||
              code === "NARRATIVE_PROVIDER_TIMEOUT"
                ? 503
                : 502,
          },
        ),
    );

    await assert.rejects(source.generateNarrative("alert-id"), (error) => {
      assert.ok(error instanceof narrativeTypesModule.NarrativeApiError);
      assert.equal(error.code, code);
      assert.equal(error.message, expectedMessage);
      assert.equal(error.backendMessage, "backend detail");
      return true;
    });
  }
});

test("narrative cooldown uses Retry-After seconds and supports HTTP dates", async () => {
  const source = new narrativeDataSourceModule.HttpInvestigationNarrativeDataSource(
    "http://localhost:3000",
    async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "NARRATIVE_GENERATION_COOLDOWN",
            message: "cooldown",
          },
        }),
        { status: 429, headers: { "Retry-After": "5" } },
      ),
  );

  await assert.rejects(source.generateNarrative("alert-id"), (error) => {
    assert.equal(error.code, "NARRATIVE_GENERATION_COOLDOWN");
    assert.equal(error.retryAfterSeconds, 5);
    assert.equal(
      error.message,
      "An explanation was just created. Try again in 5 seconds.",
    );
    return true;
  });

  assert.equal(
    narrativeDataSourceModule.parseRetryAfter(
      "Wed, 15 Aug 2026 06:30:05 GMT",
      Date.parse("2026-08-15T06:30:00.000Z"),
    ),
    5,
  );
});

test("narrative malformed success and unknown failures reject safely", async () => {
  const malformed = new narrativeDataSourceModule.HttpInvestigationNarrativeDataSource(
    "http://localhost:3000",
    async () => new Response(JSON.stringify({ generatedAt: "missing fields" })),
  );
  const unknown = new narrativeDataSourceModule.HttpInvestigationNarrativeDataSource(
    "http://localhost:3000",
    async () =>
      new Response(
        JSON.stringify({ error: { code: "FUTURE_ERROR", message: "detail" } }),
        { status: 500 },
      ),
  );

  await assert.rejects(malformed.generateNarrative("alert-id"), (error) => {
    assert.equal(error.code, "NARRATIVE_INVALID_RESPONSE");
    assert.equal(
      error.message,
      "AI explanation is temporarily unavailable. We could not read the explanation response. Your evidence and ranking are still available.",
    );
    return true;
  });
  await assert.rejects(unknown.generateNarrative("alert-id"), (error) => {
    assert.equal(error.code, "NARRATIVE_HTTP_ERROR");
    assert.equal(
      error.message,
      "AI explanation is temporarily unavailable. Your evidence and ranking are still available.",
    );
    return true;
  });
});

test("actual backend not-configured code keeps deterministic availability explicit", () => {
  assert.equal(
    narrativeErrorsModule.narrativeErrorMessage("NARRATIVE_NOT_CONFIGURED"),
    "AI explanation is not set up. Your evidence and ranking are still available.",
  );
});
test("narrative stays idle until explicitly generated and refreshes on demand", async () => {
  let calls = 0;
  const source = {
    async generateNarrative() {
      calls += 1;
      return narrativeFixture;
    },
  };
  let renderer;

  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(
        narrativePanelModule.InvestigationNarrativePanel,
        narrativePanelProps(resolved, source),
      ),
    );
  });

  assert.equal(calls, 0);
  let action = renderer.root.findByType("button");
  assert.equal(action.children.join(""), "Generate explanation");

  await act(async () => {
    await action.props.onClick();
  });

  assert.equal(calls, 1);
  action = renderer.root.findByType("button");
  assert.equal(action.children.join(""), "Refresh explanation");
  assert.match(renderedText(renderer), /Investigation summary/);

  await act(async () => {
    await action.props.onClick();
  });

  assert.equal(calls, 2);
  assert.match(renderedText(renderer), /Refresh explanation/);

  await act(async () => {
    renderer.unmount();
  });
});

test("narrative loading disables only its action and keeps deterministic ranking visible", async () => {
  const pending = deferred();
  let calls = 0;
  const source = {
    generateNarrative() {
      calls += 1;
      return pending.promise;
    },
  };
  let renderer;

  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(
          candidateModule.CauseCandidateRanking,
          candidateProps(resolved),
        ),
        React.createElement(
          narrativePanelModule.InvestigationNarrativePanel,
          narrativePanelProps(resolved, source),
        ),
      ),
    );
  });

  const action = renderer.root
    .findAllByType("button")
    .find((button) => button.children.join("") === "Generate explanation");
  assert.ok(action);

  await act(async () => {
    void action.props.onClick();
    void action.props.onClick();
    await Promise.resolve();
  });

  const loadingText = renderedText(renderer);
  assert.equal(calls, 1);
  assert.match(loadingText, /Where to start/);
  assert.match(loadingText, /Generating explanation…/);
  assert.match(
    loadingText,
    /Preparing an explanation of this investigation's evidence./,
  );
  assert.equal(
    renderer.root
      .findAllByType("button")
      .filter((button) => button.props.disabled === true).length,
    1,
  );

  await act(async () => {
    pending.resolve(narrativeFixture);
    await pending.promise;
  });

  assert.match(renderedText(renderer), /Refresh explanation/);

  await act(async () => {
    renderer.unmount();
  });
});

test("narrative candidates join strictly by candidateId in deterministic rank order", () => {
  const joined = narrativeUtilsModule.joinNarrativeCandidates(
    resolved.causeCandidateRanks,
    resolved.causeCandidates,
    resolved.causeCandidateFacts,
    narrativeFixture.narrative.candidates,
  );

  assert.deepEqual(
    joined.map(({ rank }) => rank.service),
    ["postgres", "auth-service", "user-service"],
  );
  assert.ok(
    joined.every(
      ({ rank, candidate, facts, explanation }) =>
        candidate?.id === rank.candidateId &&
        facts?.candidateId === rank.candidateId &&
        explanation?.candidateId === rank.candidateId,
    ),
  );
});

test("narrative success renders snapshot metadata, deterministic facts, and hides contextHash", () => {
  const html = markup(
    narrativePanelModule.InvestigationNarrativeSnapshotContent,
    {
      snapshot: narrativeFixture,
      candidates: resolved.causeCandidates,
      facts: resolved.causeCandidateFacts,
      ranks: resolved.causeCandidateRanks,
      findings: resolved.findings,
      signals: resolved.signals,
      onNavigateFinding() {},
      onNavigateSignal() {},
    },
  );

  const postgresExplanation =
    "Postgres has a high-severity observed failing leaf with four structural support types in the deterministic evidence.";
  const authExplanation =
    "Auth-service has high-severity log and trace failures at an error-ancestor position with six structural support types.";
  const userExplanation =
    "User-service has a high-severity trace failure at an error-ancestor position with four structural support types.";

  assert.match(html, /Evidence through/);
  assert.match(html, /Generated/);
  assert.match(html, /Investigation summary/);
  assert.match(html, /Candidate explanations/);
  assert.ok(html.indexOf(postgresExplanation) < html.indexOf(authExplanation));
  assert.ok(html.indexOf(authExplanation) < html.indexOf(userExplanation));
  assert.match(html, /Failing step at branch end/);
  assert.match(html, /4 types of connections and patterns/);
  assert.match(html, /6 types of connections and patterns/);
  assert.match(html, /1 failure/);
  assert.match(html, /2 failures/);
  assert.doesNotMatch(html, new RegExp(narrativeFixture.contextHash));
  assert.doesNotMatch(html, /context hash/i);
});

test("narrative evidence resolver preserves explicit order without deriving references", () => {
  const block = narrativeFixture.narrative.summary;
  const extraFinding = {
    ...resolved.findings[0],
    id: "finding-not-attached-to-narrative",
    message: "Unattached finding must not become a reference",
  };
  const extraSignal = {
    ...resolved.signals[0],
    id: "signal-not-attached-to-narrative",
    message: "Unattached signal must not become a reference",
  };
  const references = narrativeUtilsModule.resolveNarrativeEvidenceReferences(
    block,
    [...resolved.findings, extraFinding],
    [...resolved.signals, extraSignal],
  );

  assert.deepEqual(
    references.findings.map(({ id }) => id),
    block.findingIds,
  );
  assert.deepEqual(
    references.signals.map(({ id }) => id),
    block.signalIds,
  );
  assert.ok(references.findings.every(({ finding }) => finding));
  assert.ok(references.signals.every(({ signal }) => signal));
  assert.doesNotMatch(
    JSON.stringify(references),
    /finding-not-attached-to-narrative|signal-not-attached-to-narrative/,
  );
});

test("narrative summary and candidates render block-level deterministic references", () => {
  const html = markup(
    narrativePanelModule.InvestigationNarrativeSnapshotContent,
    {
      snapshot: narrativeFixture,
      candidates: resolved.causeCandidates,
      facts: resolved.causeCandidateFacts,
      ranks: resolved.causeCandidateRanks,
      findings: resolved.findings,
      signals: resolved.signals,
      onNavigateFinding() {},
      onNavigateSignal() {},
    },
  );
  const summaryFindingId = narrativeFixture.narrative.summary.findingIds[0];
  const summarySignalId = narrativeFixture.narrative.summary.signalIds[0];

  assert.equal((html.match(/Linked evidence/g) ?? []).length, 4);
  assert.match(
    html,
    /Linked to this explanation as a whole, not to individual sentences/,
  );
  assert.match(
    html,
    new RegExp(`href="#${correlationsModule.findingDomId(summaryFindingId)}"`),
  );
  assert.match(
    html,
    new RegExp(`href="#${correlationsModule.signalDomId(summarySignalId)}"`),
  );
  assert.match(html, /Failures along a call path/);
  assert.doesNotMatch(
    html,
    /root cause|caused by|culprit|confirmed cause|likely cause|confidence|probability/i,
  );
});

test("narrative evidence references preserve missing IDs and explain empty blocks", () => {
  const missingSnapshot = structuredClone(narrativeFixture);
  missingSnapshot.narrative.summary.findingIds = ["finding-reference-missing"];
  missingSnapshot.narrative.summary.signalIds = ["signal-reference-missing"];
  const emptySnapshot = structuredClone(narrativeFixture);
  emptySnapshot.narrative.summary.findingIds = [];
  emptySnapshot.narrative.summary.signalIds = [];
  const commonProps = {
    candidates: resolved.causeCandidates,
    facts: resolved.causeCandidateFacts,
    ranks: resolved.causeCandidateRanks,
    findings: resolved.findings,
    signals: resolved.signals,
    onNavigateFinding() {},
    onNavigateSignal() {},
  };
  const missingHtml = markup(
    narrativePanelModule.InvestigationNarrativeSnapshotContent,
    { ...commonProps, snapshot: missingSnapshot },
  );
  const emptyHtml = markup(
    narrativePanelModule.InvestigationNarrativeSnapshotContent,
    { ...commonProps, snapshot: emptySnapshot },
  );

  assert.match(missingHtml, /Linked finding not available/);
  assert.match(missingHtml, /finding-reference-missing/);
  assert.match(missingHtml, /Linked pattern not available/);
  assert.match(missingHtml, /signal-reference-missing/);
  assert.match(
    emptyHtml,
    /No evidence links were provided for this explanation/,
  );
});

test("narrative evidence links select the exact finding and signal targets", async () => {
  const summaryFindingId = narrativeFixture.narrative.summary.findingIds[0];
  const summarySignalId = narrativeFixture.narrative.summary.signalIds[0];
  const findingHref = `#${correlationsModule.findingDomId(summaryFindingId)}`;
  const signalHref = `#${correlationsModule.signalDomId(summarySignalId)}`;
  let selectedFindingId = null;
  let selectedSignalId = null;
  let renderer;

  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(
        narrativePanelModule.InvestigationNarrativeSnapshotContent,
        {
          snapshot: narrativeFixture,
          candidates: resolved.causeCandidates,
          facts: resolved.causeCandidateFacts,
          ranks: resolved.causeCandidateRanks,
          findings: resolved.findings,
          signals: resolved.signals,
          onNavigateFinding(findingId) {
            selectedFindingId = findingId;
          },
          onNavigateSignal(signalId) {
            selectedSignalId = signalId;
          },
        },
      ),
    );
  });

  const findingLink = renderer.root
    .findAllByType("a")
    .find((link) => link.props.href === findingHref);
  const signalLink = renderer.root
    .findAllByType("a")
    .find((link) => link.props.href === signalHref);
  assert.ok(findingLink);
  assert.ok(signalLink);

  await act(async () => {
    findingLink.props.onClick();
    signalLink.props.onClick();
  });

  assert.equal(selectedFindingId, summaryFindingId);
  assert.equal(selectedSignalId, summarySignalId);

  await act(async () => {
    renderer.unmount();
  });
});

test("selected structural signal exposes the stable narrative target", () => {
  const signal = resolved.signals[0];
  const html = markup(signalsModule.StructuralSignals, {
    signals: resolved.signals,
    findings: resolved.findings,
    selectedSignalId: signal.id,
    onSelectSignal() {},
    detailsOpen: true,
  });

  assert.match(
    html,
    new RegExp(`id="${correlationsModule.signalDomId(signal.id)}"`),
  );
  assert.match(html, /aria-pressed="true"/);
});

test("narrative tie snapshot preserves co-equal deterministic rank order", () => {
  const html = markup(
    narrativePanelModule.InvestigationNarrativeSnapshotContent,
    {
      snapshot: narrativeTieFixture,
      candidates: candidateTie.causeCandidates,
      facts: candidateTie.causeCandidateFacts,
      ranks: candidateTie.causeCandidateRanks,
      findings: candidateTie.findings,
      signals: candidateTie.signals,
      onNavigateFinding() {},
      onNavigateSignal() {},
    },
  );
  const postgresExplanation =
    "Postgres has equivalent deterministic failure facts in this snapshot.";
  const redisExplanation =
    "Redis has equivalent deterministic failure facts in this snapshot.";

  assert.equal((html.match(/>Candidate rank #1</g) ?? []).length, 2);
  assert.equal((html.match(/Tied candidate/g) ?? []).length, 2);
  assert.doesNotMatch(html, />Candidate rank #2</);
  assert.ok(html.indexOf(postgresExplanation) < html.indexOf(redisExplanation));
  assert.doesNotMatch(html, new RegExp(narrativeTieFixture.contextHash));
});

test("narrative failure stays local and retries exactly once only when requested", async () => {
  let calls = 0;
  const source = {
    async generateNarrative() {
      calls += 1;

      if (calls === 1) {
        throw narrativeErrorsModule.createNarrativeApiError(
          "NARRATIVE_PROVIDER_UNAVAILABLE",
          503,
        );
      }

      return narrativeFixture;
    },
  };
  let renderer;

  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(
          candidateModule.CauseCandidateRanking,
          candidateProps(resolved),
        ),
        React.createElement(
          narrativePanelModule.InvestigationNarrativePanel,
          narrativePanelProps(resolved, source),
        ),
      ),
    );
  });

  const action = renderer.root
    .findAllByType("button")
    .find((button) => button.children.join("") === "Generate explanation");
  assert.ok(action);

  await act(async () => {
    await action.props.onClick();
  });

  assert.equal(calls, 1);
  const failureText = renderedText(renderer);
  assert.match(failureText, /Where to start/);
  assert.match(
    failureText,
    /AI explanation is temporarily unavailable. Your evidence and ranking are still available./,
  );
  assert.match(failureText, /Retry explanation/);

  await act(async () => {
    await Promise.resolve();
  });

  assert.equal(calls, 1);

  const retryAction = renderer.root
    .findAllByType("button")
    .find((button) => button.children.join("") === "Retry explanation");
  assert.ok(retryAction);

  await act(async () => {
    await retryAction.props.onClick();
  });

  assert.equal(calls, 2);
  assert.match(renderedText(renderer), /Investigation summary/);
  assert.match(renderedText(renderer), /Where to start/);

  await act(async () => {
    renderer.unmount();
  });
});
test("timestamp parser accepts ISO T and backend space-separated UTC forms", () => {
  assert.equal(
    formattersModule.parseTimestamp("2026-08-15T06:10:00.200Z").getTime(),
    formattersModule.parseTimestamp("2026-08-15 06:10:00.200Z").getTime(),
  );
});
test("cause candidate records join by candidateId without changing backend rank order", () => {
  const backendOrder = [
    resolved.causeCandidateRanks[2],
    resolved.causeCandidateRanks[0],
    resolved.causeCandidateRanks[1],
  ];
  const joined = candidateUtilsModule.joinCauseCandidateRanking(
    backendOrder,
    resolved.causeCandidates,
    resolved.causeCandidateFacts,
  );

  assert.deepEqual(
    joined.map(({ rank }) => rank.service),
    ["user-service", "postgres", "auth-service"],
  );
  assert.ok(joined.every(({ rank, candidate, facts }) =>
    candidate?.id === rank.candidateId && facts?.candidateId === rank.candidateId,
  ));
});

test("decision presentation uses backend ranks and explicit evidence references", () => {
  const decision = decisionUtilsModule.buildInvestigationDecision(
    unifiedIncident.causeCandidateRanks,
    unifiedIncident.causeCandidates,
    unifiedIncident.findings,
    unifiedIncident.correlations,
    unifiedIncident.signals,
  );
  const checkout = unifiedIncident.causeCandidates.find(
    (candidate) => candidate.service === "demo-checkout",
  );
  assert.ok(checkout);
  assert.equal(decision.leadingRank, 1);
  assert.equal(decision.coLeading, false);
  assert.deepEqual([...decision.leadingCandidateIds], [checkout.id]);
  assert.deepEqual(
    decision.evidenceByCandidateId
      .get(checkout.id)
      .map((evidence) => evidence.kind),
    [
      "exact_span_error_log",
      "metric_threshold",
      "cross_service_failure",
      "trace_failure_chain",
    ],
  );

  const withoutSameSpan = decisionUtilsModule.buildInvestigationDecision(
    unifiedIncident.causeCandidateRanks,
    unifiedIncident.causeCandidates,
    unifiedIncident.findings,
    unifiedIncident.correlations.filter(
      (correlation) => correlation.type !== "same_span",
    ),
    unifiedIncident.signals,
  );
  assert.doesNotMatch(
    withoutSameSpan.evidenceByCandidateId
      .get(checkout.id)
      .map((evidence) => evidence.kind)
      .join(" "),
    /exact_span_error_log/,
  );
});

test("evidence story preserves backend priority and uses only explicit group references", () => {
  const foreignCorrelation = {
    ...unifiedIncident.correlations[0],
    id: "correlation-not-referenced-by-group",
    message: "This relationship is deliberately outside the evidence group",
  };
  const foreignSignal = {
    ...unifiedIncident.signals[0],
    id: "signal-for-another-group",
    evidenceGroupId: "evidence-group-elsewhere",
    message: "This signal belongs to another evidence group",
  };
  const story = evidenceStoryUtilsModule.buildInvestigationEvidenceStory(
    unifiedIncident.evidenceRanks,
    unifiedIncident.findings,
    unifiedIncident.evidenceGroups,
    [...unifiedIncident.correlations, foreignCorrelation],
    [...unifiedIncident.signals, foreignSignal],
  );
  const thread = story.threads[0];

  assert.equal(story.threads.length, 1);
  assert.deepEqual(
    thread.findings.map(({ id }) => id),
    unifiedIncident.evidenceRanks.map(({ findingId }) => findingId),
  );
  assert.deepEqual(
    thread.correlations.map(({ id }) => id),
    unifiedIncident.evidenceGroups[0].correlationIds,
  );
  assert.deepEqual(
    thread.signals.map(({ id }) => id),
    unifiedIncident.signals.map(({ id }) => id),
  );
  assert.doesNotMatch(
    JSON.stringify(thread),
    /correlation-not-referenced-by-group|signal-for-another-group/,
  );
});

test("evidence story keeps multiple backend evidence groups isolated", () => {
  const story = evidenceStoryUtilsModule.buildInvestigationEvidenceStory(
    multipleGroups.evidenceRanks,
    multipleGroups.findings,
    multipleGroups.evidenceGroups,
    multipleGroups.correlations,
    multipleGroups.signals,
  );

  assert.equal(story.threads.length, multipleGroups.evidenceGroups.length);
  for (const thread of story.threads) {
    assert.deepEqual(
      new Set(thread.findings.map(({ id }) => id)),
      new Set(thread.group.findingIds),
    );
    assert.deepEqual(
      thread.correlations.map(({ id }) => id),
      thread.group.correlationIds,
    );
    assert.ok(
      thread.signals.every((signal) => signal.evidenceGroupId === thread.id),
    );
  }
});

test("evidence story retains ungrouped findings and reports unresolved references", () => {
  const outsideFinding = {
    ...unifiedIncident.findings[0],
    id: "finding-outside-explicit-groups",
    message: "Finding outside explicit evidence groups",
  };
  const outsideRank = {
    ...unifiedIncident.evidenceRanks[0],
    findingId: outsideFinding.id,
  };
  const groupWithMissingReferences = {
    ...unifiedIncident.evidenceGroups[0],
    findingIds: [
      ...unifiedIncident.evidenceGroups[0].findingIds,
      "finding-reference-missing",
    ],
    correlationIds: [
      ...unifiedIncident.evidenceGroups[0].correlationIds,
      "correlation-reference-missing",
    ],
  };
  const props = {
    ...evidenceStoryProps(unifiedIncident),
    ranks: [outsideRank, ...unifiedIncident.evidenceRanks],
    findings: [...unifiedIncident.findings, outsideFinding],
    evidenceGroups: [groupWithMissingReferences],
  };
  const story = evidenceStoryUtilsModule.buildInvestigationEvidenceStory(
    props.ranks,
    props.findings,
    props.evidenceGroups,
    props.correlations,
    props.signals,
  );
  const html = markup(evidenceStoryModule.EvidenceStory, props);

  assert.deepEqual(
    story.ungroupedFindings.map(({ id }) => id),
    [outsideFinding.id],
  );
  assert.match(html, /Unconnected findings/);
  assert.match(html, /Finding outside explicit evidence groups/);
  assert.match(html, /Linked finding unavailable/);
  assert.match(html, /finding-reference-missing/);
  assert.match(html, /Linked connection unavailable/);
  assert.match(html, /correlation-reference-missing/);
});

test("three-signal evidence story connects factual observations without causal claims", () => {
  const html = markup(
    evidenceStoryModule.EvidenceStory,
    evidenceStoryProps(unifiedIncident),
  );

  assert.match(html, /How the observations connect/);
  assert.match(html, /6 related findings across 2 services/);
  assert.match(html, /Observed findings/);
  assert.match(html, /Connections/);
  assert.match(html, /Evidence patterns/);
  assert.match(html, /The checkout ERROR log and trace failure reference the same span/);
  assert.match(html, /This group contains log, metric and trace findings/);
  assert.ok(
    html.indexOf("Trace error in demo-checkout: GET /checkout") <
      html.indexOf("Checkout inventory unavailable"),
  );
  assert.doesNotMatch(
    html,
    /root cause|caused by|culprit|confirmed cause|likely cause|confidence|probability|decisive dimension/i,
  );
});

test("evidence story review actions identify the exact finding or evidence group", async () => {
  let reviewedFinding = null;
  let reviewedGroup = null;
  let renderer;

  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(evidenceStoryModule.EvidenceStory, {
        ...evidenceStoryProps(unifiedIncident),
        onReviewFinding(findingId) {
          reviewedFinding = findingId;
        },
        onReviewGroup(groupId) {
          reviewedGroup = groupId;
        },
      }),
    );
  });

  const firstFindingLink = renderer.root.findAllByType("a")[0];
  const reviewGroupButton = renderer.root
    .findAllByType("button")
    .find((button) => button.children.join("").includes("Review 6 connected"));
  assert.ok(reviewGroupButton);

  await act(async () => {
    firstFindingLink.props.onClick();
    reviewGroupButton.props.onClick();
  });

  assert.equal(reviewedFinding, unifiedIncident.evidenceRanks[0].findingId);
  assert.equal(reviewedGroup, unifiedIncident.evidenceGroups[0].id);

  await act(async () => {
    renderer.unmount();
  });
});

test("evidence story has a compact empty state", () => {
  const html = markup(evidenceStoryModule.EvidenceStory, {
    ...evidenceStoryProps(empty),
    ranks: [],
    findings: [],
    evidenceGroups: [],
    correlations: [],
    signals: [],
  });

  assert.match(html, /No findings or evidence groups were available/);
});

test("three-signal leader exposes factual reasons without inventing causality", () => {
  const html = markup(
    candidateModule.CauseCandidateRanking,
    candidateProps(unifiedIncident),
  );

  assert.match(html, /Best place to start/);
  assert.match(html, /Start here/);
  assert.match(html, /Failing step at branch end/);
  assert.match(html, /Error log linked to the same step/);
  assert.match(html, /Metric reading met an alert rule/);
  assert.match(html, /Failures across services/);
  assert.match(html, /Failures along a call path/);
  assert.match(html, /evidence-backed investigation starting points, not confirmed root causes/);
  assert.ok(html.indexOf("demo-checkout") < html.indexOf("demo-gateway"));
  assert.doesNotMatch(
    html,
    /decisive dimension|root cause is|caused by|confirmed as the cause|probability|confidence/i,
  );
});

test("Cause Candidate Ranking keeps backend order in compact factual cards", () => {
  const html = markup(candidateModule.CauseCandidateRanking, candidateProps(resolved));

  assert.deepEqual(
    resolved.causeCandidateRanks.map(
      ({ service, rank, tracePosition, supportDiversity, failureFindingCount }) => ({
        service,
        rank,
        tracePosition,
        supportDiversity,
        failureFindingCount,
      }),
    ),
    [
      {
        service: "postgres",
        rank: 1,
        tracePosition: "observed_leaf_failure",
        supportDiversity: 4,
        failureFindingCount: 1,
      },
      {
        service: "auth-service",
        rank: 2,
        tracePosition: "error_ancestor",
        supportDiversity: 6,
        failureFindingCount: 2,
      },
      {
        service: "user-service",
        rank: 3,
        tracePosition: "error_ancestor",
        supportDiversity: 4,
        failureFindingCount: 1,
      },
    ],
  );
  assert.ok(html.indexOf("postgres") < html.indexOf("auth-service"));
  assert.ok(html.indexOf("auth-service") < html.indexOf("user-service"));
  assert.match(html, /Failing step at branch end/);
  assert.equal((html.match(/>Failure with nested failing steps</g) ?? []).length, 2);
  assert.match(html, /4 types of connections and patterns/);
  assert.match(html, /6 types of connections and patterns/);
  assert.match(html, />1 failure</);
  assert.match(html, />2 failures</);
  assert.equal((html.match(/View details/g) ?? []).length, 3);
  assert.doesNotMatch(html, /Why this candidate ranks here/);
  assert.doesNotMatch(html, /Candidate evidence/);
  for (const rank of resolved.causeCandidateRanks) {
    assert.doesNotMatch(html, new RegExp(rank.candidateId));
  }
  assert.match(
    html,
    /They are ranked by failure severity, then request-path position/,
  );
  assert.match(html, /evidence-backed investigation starting points, not confirmed root causes/);
  assert.doesNotMatch(
    html,
    /root cause is|is (?:a|the) root cause|root cause:|culprit|caused by|confirmed as the cause|probability|confidence score|AI confidence|root cause score/i,
  );
});

test("semantic ties render as co-equal rank 1 cards without visual rank 2", () => {
  const html = markup(
    candidateModule.CauseCandidateRanking,
    candidateProps(candidateTie),
  );

  assert.deepEqual(
    candidateTie.causeCandidateRanks.map(({ service, rank, tied }) => ({
      service,
      rank,
      tied,
    })),
    [
      { service: "postgres", rank: 1, tied: true },
      { service: "redis", rank: 1, tied: true },
    ],
  );
  assert.equal((html.match(/>Candidate rank #1<\/span>/g) ?? []).length, 2);
  assert.doesNotMatch(html, />Candidate rank #2<\/span>/);
  assert.ok((html.match(/Tied candidate/g) ?? []).length >= 2);
  assert.match(html, /Row order does not pick a winner/);
  assert.match(html, /Tied starting points/);
  assert.equal((html.match(/Why this starting point is tied/g) ?? []).length, 2);
  assert.doesNotMatch(html, /Best place to start/);
  assert.match(html, /evidence-backed investigation starting points, not confirmed root causes/);
  assert.doesNotMatch(
    html,
    /root cause is|is (?:a|the) root cause|root cause:|culprit|caused by|confirmed as the cause|probability|confidence/i,
  );
});

test("candidate View details reveals reasons, evidence navigation, and emphasis", async () => {
  const candidate = resolved.causeCandidates.find(
    (item) => item.service === "postgres",
  );
  assert.ok(candidate);
  let selectedCandidateId = null;
  let renderer;

  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(candidateModule.CauseCandidateRanking, {
        ...candidateProps(resolved),
        selectedCandidateId: candidate.id,
        onSelectCandidate(candidateId) {
          selectedCandidateId = candidateId;
        },
      }),
    );
  });

  const initialText = renderedText(renderer);
  assert.doesNotMatch(initialText, /Why this candidate ranks here/);
  assert.doesNotMatch(initialText, /Candidate evidence/);

  const viewDetails = renderer.root
    .findAllByType("button")
    .find((button) => button.props["aria-controls"] === "candidate-detail-drawer");
  assert.ok(viewDetails);
  assert.equal(viewDetails.props["aria-expanded"], false);

  await act(async () => {
    viewDetails.props.onClick();
  });

  assert.equal(viewDetails.props["aria-expanded"], true);
  const expandedText = renderedText(renderer);
  assert.match(expandedText, /Why this candidate ranks here/);
  assert.match(expandedText, /Candidate evidence/);
  assert.match(expandedText, /Highest failure severity: high/);

  const findingId = correlationsModule.findingDomId(candidate.findingIds[0]);
  const traceId = targetsModule.traceDomId(candidate.traceIds[0]);
  const links = renderer.root.findAllByType("a");
  assert.ok(links.some((link) => link.props.href === `#${findingId}`));
  assert.ok(links.some((link) => link.props.href === `#${traceId}`));

  const emphasize = renderer.root
    .findAllByType("button")
    .find((button) => button.props["aria-pressed"] === true);
  assert.ok(emphasize);
  await act(async () => {
    emphasize.props.onClick();
  });
  assert.equal(selectedCandidateId, null);

  const findingsHtml = markup(findingsModule.FindingsTimeline, {
    findings: resolved.findings,
    timeline: resolved.timeline,
    highlightedFindingIds: new Set(candidate.findingIds),
    highlightedFindingLabel: "Candidate finding",
    openSection: "findings",
  });
  assert.match(findingsHtml, /Candidate finding/);
  assert.match(findingsHtml, new RegExp(`id="${findingId}"`));

  await act(async () => {
    renderer.unmount();
  });
});

test("Cause Candidate Ranking has a compact factual empty state", () => {
  const html = markup(candidateModule.CauseCandidateRanking, candidateProps(empty));

  assert.match(html, /No starting points were ranked for this investigation/);
});

test("runtime validation enforces every required candidate structure", () => {
  for (const field of [
    "correlations",
    "evidenceGroups",
    "causeCandidates",
    "causeCandidateFacts",
    "causeCandidateRanks",
  ]) {
    const missing = structuredClone(resolved);
    delete missing[field];
    assert.throws(
      () => responseModule.parseInvestigationResponse(missing),
      errorsModule.InvalidInvestigationResponseError,
      `${field} must be required`,
    );
  }

  const invalidCandidate = structuredClone(resolved);
  delete invalidCandidate.causeCandidates[0].startedAt;
  assert.throws(
    () => responseModule.parseInvestigationResponse(invalidCandidate),
    errorsModule.InvalidInvestigationResponseError,
  );

  const invalidFacts = structuredClone(resolved);
  invalidFacts.causeCandidateFacts[0].supportDiversity = -1;
  assert.throws(
    () => responseModule.parseInvestigationResponse(invalidFacts),
    errorsModule.InvalidInvestigationResponseError,
  );

  const invalidRank = structuredClone(resolved);
  invalidRank.causeCandidateRanks[0].tracePosition = "probable_origin";
  assert.throws(
    () => responseModule.parseInvestigationResponse(invalidRank),
    errorsModule.InvalidInvestigationResponseError,
  );
});
test("runtime validation enforces stable intelligence fields and severity values", () => {
  assert.equal(responseModule.parseInvestigationResponse(resolved), resolved);

  const invalidSeverity = structuredClone(resolved);
  invalidSeverity.findings[0].severity = "medium";
  assert.throws(
    () => responseModule.parseInvestigationResponse(invalidSeverity),
    errorsModule.InvalidInvestigationResponseError,
  );

  const invalidSignal = structuredClone(resolved);
  invalidSignal.signals[0].type = "probable_cause";
  assert.throws(
    () => responseModule.parseInvestigationResponse(invalidSignal),
    errorsModule.InvalidInvestigationResponseError,
  );

  const invalidGroupFacts = structuredClone(resolved);
  delete invalidGroupFacts.evidenceGroups[0].findingCount;
  assert.throws(
    () => responseModule.parseInvestigationResponse(invalidGroupFacts),
    errorsModule.InvalidInvestigationResponseError,
  );

  const missingRequiredArray = structuredClone(resolved);
  delete missingRequiredArray.integrityIssues;
  assert.throws(
    () => responseModule.parseInvestigationResponse(missingRequiredArray),
    errorsModule.InvalidInvestigationResponseError,
  );
});

test("Evidence priority preserves backend order and renders severity before structural support", () => {
  const html = markup(priorityModule.EvidencePriority, {
    ranks: resolved.evidenceRanks,
    findings: resolved.findings,
    selectedFindingId: null,
    onSelectFinding() {},
  });

  assert.deepEqual(
    resolved.evidenceRanks.map((rank) => rank.supportScore),
    [6, 5, 4, 4, 2],
  );
  assert.ok(
    html.indexOf("Trace error in auth-service: login") <
      html.indexOf("database timeout"),
  );
  assert.match(
    html,
    /Findings are ordered by severity first, then by the types of connections and patterns that support them/,
  );
  assert.match(html, /6 types of connections and patterns/);
  assert.match(html, /Same step \(span\)/);
  assert.match(html, /Failures along a call path/);
  assert.doesNotMatch(
    html,
    /root cause|confidence|probability|cause score|likely cause|culprit/i,
  );
});

test("Evidence priority links and selected state navigate to the ranked finding", () => {
  const selected = resolved.evidenceRanks[0];
  const html = markup(priorityModule.EvidencePriority, {
    ranks: resolved.evidenceRanks,
    findings: resolved.findings,
    selectedFindingId: selected.findingId,
    onSelectFinding() {},
  });
  const findingId = correlationsModule.findingDomId(selected.findingId);
  const findingsHtml = markup(findingsModule.FindingsTimeline, {
    findings: resolved.findings,
    timeline: resolved.timeline,
    highlightedFindingIds: new Set([selected.findingId]),
    highlightedFindingLabel: "Selected finding priority",
    openSection: "findings",
  });

  assert.match(html, new RegExp(`href="#${findingId}"`));
  assert.match(html, /aria-current="location"/);
  assert.match(findingsHtml, /Selected finding priority/);
  assert.match(findingsHtml, new RegExp(`id="${findingId}"`));
});

test("Evidence priority has a compact factual empty state", () => {
  const html = markup(priorityModule.EvidencePriority, {
    ranks: [],
    findings: [],
    selectedFindingId: null,
    onSelectFinding() {},
  });

  assert.match(html, /No findings were ranked for this investigation/);
});

test("rank and priority copy keeps candidate rank 1 distinct from linked finding priority 2", async () => {
  const firstRank = unifiedIncident.causeCandidateRanks[0];
  const candidate = unifiedIncident.causeCandidates.find(item => item.id === firstRank.candidateId);
  const findingId = unifiedIncident.evidenceRanks[1].findingId;
  assert.equal(firstRank.rank, 1);
  assert.equal(firstRank.service, "demo-checkout");
  assert.ok(candidate.findingIds.includes(findingId));

  await withStartingPointPage(unifiedIncident, async renderer => {
    const ranking = renderer.root.findByType(candidateModule.CauseCandidateRanking);
    const rows = ranking.findAllByType("article");
    assert.deepEqual(rows.map(row => row.props["aria-label"]), unifiedIncident.causeCandidateRanks.map(rank => `Candidate rank #${rank.rank}, ${rank.service}`));
    assert.ok(rows[0].findAllByType("span").some(span => span.children.join("") === "Candidate rank #1"));
    const open = rows[0].findAllByType("button").find(button => button.props["aria-controls"] === "candidate-detail-drawer");
    await act(async () => open.props.onClick());
    const drawer = ranking.findByType(detailDrawerModule.InvestigationDetailDrawer);
    assert.equal(drawer.props.title, "Candidate rank #1 · demo-checkout");
    assert.ok(ranking.findAllByType("a").some(link => link.props.href === `#${targetsModule.traceDomId(candidate.traceIds[0])}`));

    const story = renderer.root.findByType(evidenceStoryModule.EvidenceStory);
    const link = story.findAllByType("a").find(item => item.props.href === `#${correlationsModule.findingDomId(findingId)}`);
    assert.ok(link.findAllByType("span").some(span => span.children.join("") === "Finding priority #2"));
    await act(async () => link.props.onClick());
    const findings = renderer.root.findByType(findingsModule.FindingsTimeline);
    assert.equal(findings.props.openSection, "findings");
    assert.equal(findings.props.reviewedFindingId, findingId);
    assert.deepEqual([...findings.props.highlightedFindingIds], [findingId]);
    assert.equal(findings.props.highlightedFindingLabel, "Selected finding");
    const row = findings.findByProps({ id: correlationsModule.findingDomId(findingId) });
    assert.ok(row.findAllByType("span").some(span => span.children.join("") === "Finding priority #2"));
    assert.match(renderedText(renderer), /Finding priority reasons/);
    assert.equal(ranking.props.ranks, unifiedIncident.causeCandidateRanks);
    assert.equal(story.props.ranks, unifiedIncident.evidenceRanks);
  });
});

test("rank and priority copy preserves global finding priorities across evidence threads", async () => {
  const ranks = unifiedIncident.evidenceRanks;
  const groups = [
    { ...unifiedIncident.evidenceGroups[0], id: "thread-later-priorities", findingIds: [ranks[1].findingId, ranks[3].findingId] },
    { ...unifiedIncident.evidenceGroups[0], id: "thread-first-priority", findingIds: [ranks[0].findingId] },
  ];
  const before = structuredClone({ ranks, groups });
  let renderer;
  try {
    await act(async () => { renderer = TestRenderer.create(React.createElement(evidenceStoryModule.EvidenceStory, {
      ...evidenceStoryProps(unifiedIncident), evidenceGroups: groups,
    })); });
    const priorities = thread => thread.findAllByType("a").map(link => link.findAllByType("span").find(span => span.children.join("").startsWith("Finding priority #")).children.join(""));
    assert.deepEqual(priorities(renderer.root.findByProps({ "data-evidence-thread": groups[0].id })), ["Finding priority #2", "Finding priority #4"]);
    assert.deepEqual(priorities(renderer.root.findByProps({ "data-evidence-thread": groups[1].id })), ["Finding priority #1"]);
    for (const link of renderer.root.findAllByType("a")) {
      const index = ranks.findIndex(rank => link.props.href === `#${correlationsModule.findingDomId(rank.findingId)}`);
      assert.ok(index >= 0);
      assert.ok(link.findAllByType("span").some(span => span.children.join("") === `Finding priority #${index + 1}`));
    }
    assert.deepEqual({ ranks, groups }, before);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
  }
});

test("rank and priority copy qualifies legacy finding priorities without inventing missing ranks", () => {
  const ranks = resolved.evidenceRanks;
  const html = markup(priorityModule.EvidencePriority, {
    ranks, findings: [], selectedFindingId: ranks[1].findingId, onSelectFinding() {},
  });
  assert.match(html, /id="evidence-priority"/);
  assert.match(html, />Finding priority<\/h2>/);
  assert.deepEqual([...html.matchAll(/>Finding priority #(\d+)<\/span>/g)].map(match => Number(match[1])), ranks.map((_, index) => index + 1));
  assert.match(html, /Linked finding unavailable in this investigation/);
  assert.doesNotMatch(html, />\s*(?:#\d+|Rank \d+|Priority #\d+)\s*</);

  const unranked = markup(findingsModule.FindingsTimeline, {
    findings: [unifiedIncident.findings[0]], timeline: [], evidenceRanks: [],
    openSection: "findings", reviewedFindingId: unifiedIncident.findings[0].id,
  });
  assert.doesNotMatch(unranked, /Finding priority #\d/);
  assert.match(unranked, /No linked evidence is available for this finding/);
  const emptyHtml = markup(priorityModule.EvidencePriority, {
    ranks: [], findings: [], selectedFindingId: null, onSelectFinding() {},
  });
  assert.doesNotMatch(emptyHtml, /Finding priority #\d/);
});

test("rank and priority copy qualifies AI candidate badges while preserving ranks ties and raw text", () => {
  for (const [investigation, snapshot] of [[resolved, narrativeFixture], [candidateTie, narrativeTieFixture]]) {
    const before = structuredClone(snapshot);
    const html = markup(narrativePanelModule.InvestigationNarrativeSnapshotContent, {
      snapshot, ...candidateProps(investigation), onNavigateFinding() {}, onNavigateSignal() {},
    });
    assert.deepEqual([...html.matchAll(/>Candidate rank #(\d+)<\/span>/g)].map(match => Number(match[1])), investigation.causeCandidateRanks.map(rank => rank.rank));
    assert.doesNotMatch(html, />\s*(?:#\d+|Rank \d+|Priority #\d+)\s*</);
    for (const block of snapshot.narrative.candidates) assert.ok(html.includes(block.text));
    if (investigation === candidateTie) {
      assert.equal((html.match(/>Candidate rank #1<\/span>/g) ?? []).length, 2);
      assert.ok((html.match(/Tied candidate/g) ?? []).length >= 2);
      assert.doesNotMatch(html, />Candidate rank #2<\/span>/);
    }
    assert.deepEqual(snapshot, before);
  }
});

test("rank and priority copy qualifies navigation while retaining durable section anchors", () => {
  const items = sidebarModule.investigationSectionGroups.flatMap(group => group.items);
  const findingItem = items.find(item => item.id === "evidence-priority");
  const candidateItem = items.find(item => item.id === "candidate-ranking");
  assert.equal(findingItem.label, "Finding priority");
  assert.equal(candidateItem.label, "Where to start");
  const html = markup(sidebarModule.SidebarNavItem, {
    ...findingItem, href: "#evidence-priority", active: true, collapsed: false, currentType: "location", nested: true,
  });
  assert.match(html, /href="#evidence-priority"/);
  assert.match(html, /Finding priority/);
  assert.match(html, /aria-current="location"/);
  assert.doesNotMatch(html, /Evidence priority|Selected priority/);
});

test("support units use explicit type labels for zero one and supplied totals without scaling", () => {
  for (const count of [0, 1, 6, 9001]) {
    const html = markup(supportTypesModule.SupportTypeCount, { count, className: "support-count-style" });
    assert.ok(html.includes(`>${count} ${count === 1 ? "type of connection or pattern" : "types of connections and patterns"}</span>`));
    assert.match(html, /class="support-count-style"/);
    assert.match(html, /Each type counts once, even if it appears many times/);
    assert.match(html, /not the number of findings or proof that the evidence is independent/);
    assert.doesNotMatch(html, />Support \d+<|>Support score|confidence|%/i);
  }
});

test("support units expose the supplied category breakdown with readable labels and exact codes", () => {
  const correlationTypes = ["same_span", "same_trace"];
  const signalTypes = ["trace_failure_chain"];
  const before = structuredClone({ correlationTypes, signalTypes });
  const html = markup(supportTypesModule.SupportTypeBreakdown, { correlationTypes, signalTypes });
  assert.match(html, /2 connection types \+ 1 pattern type/);
  assert.match(html, /Same step \(span\)/);
  assert.match(html, /Same request path \(trace\)/);
  assert.match(html, /Failures along a call path/);
  for (const code of [...correlationTypes, ...signalTypes]) assert.ok(html.includes(`>${code}</code>`));
  assert.match(html, /Adds the number of different connection types and pattern types/);
  assert.deepEqual({ correlationTypes, signalTypes }, before);
  const zero = markup(supportTypesModule.SupportTypeBreakdown, { correlationTypes: [], signalTypes: [] });
  assert.match(zero, /0 connection types \+ 0 pattern types/);
  assert.equal((zero.match(/None listed\./g) ?? []).length, 2);
});

test("support units clarify candidate totals and breakdown without changing reasons or exact links", async () => {
  await withStartingPointPage(unifiedIncident, async renderer => {
    const rank = unifiedIncident.causeCandidateRanks[0];
    const facts = unifiedIncident.causeCandidateFacts.find(item => item.candidateId === rank.candidateId);
    const candidate = unifiedIncident.causeCandidates.find(item => item.id === rank.candidateId);
    const ranking = renderer.root.findByType(candidateModule.CauseCandidateRanking);
    assert.deepEqual(ranking.findAllByType(supportTypesModule.SupportTypeCount).map(count => count.props.count), unifiedIncident.causeCandidateRanks.map(item => unifiedIncident.causeCandidateFacts.find(fact => fact.candidateId === item.candidateId).supportDiversity));
    assert.match(renderedText(renderer), /then types of connections and patterns/);
    const open = ranking.findAllByType("button").find(button => button.props["aria-controls"] === "candidate-detail-drawer");
    await act(async () => open.props.onClick());
    const breakdown = ranking.findByType(supportTypesModule.SupportTypeBreakdown);
    assert.equal(breakdown.props.correlationTypes, facts.correlationTypes);
    assert.equal(breakdown.props.signalTypes, facts.signalTypes);
    assert.equal(facts.supportDiversity, facts.correlationTypes.length + facts.signalTypes.length);
    for (const reason of rank.reasons) assert.ok(ranking.findAllByType("span").some(span => span.children.join("") === reason));
    assert.ok(ranking.findAllByType("a").some(link => link.props.href === `#${correlationsModule.findingDomId(candidate.findingIds[0])}`));
    assert.ok(ranking.findAllByType("a").some(link => link.props.href === `#${targetsModule.traceDomId(candidate.traceIds[0])}`));
    assert.equal(ranking.props.ranks, unifiedIncident.causeCandidateRanks);
  });
});

test("support units keep missing candidate facts total while marking its breakdown unavailable", async () => {
  await withStartingPointPage({ ...unifiedIncident, causeCandidateFacts: [] }, async renderer => {
    const ranking = renderer.root.findByType(candidateModule.CauseCandidateRanking);
    assert.deepEqual(ranking.findAllByType(supportTypesModule.SupportTypeCount).map(count => count.props.count), unifiedIncident.causeCandidateRanks.map(rank => rank.supportDiversity));
    const open = ranking.findAllByType("button").find(button => button.props["aria-controls"] === "candidate-detail-drawer");
    await act(async () => open.props.onClick());
    assert.equal(ranking.findAllByType(supportTypesModule.SupportTypeBreakdown).length, 0);
    assert.match(renderedText(renderer), /type count comes from its rank, but the list of types is not available/);
    assert.doesNotMatch(renderedText(renderer), /None listed/);
  });
});

test("support units qualify finding story legacy panel and focused review using unchanged rank totals", async () => {
  let renderer;
  try {
    await act(async () => { renderer = TestRenderer.create(React.createElement(evidenceStoryModule.EvidenceStory, evidenceStoryProps(unifiedIncident))); });
    for (const link of renderer.root.findAllByType("a")) {
      const rank = unifiedIncident.evidenceRanks.find(item => link.props.href === `#${correlationsModule.findingDomId(item.findingId)}`);
      assert.ok(rank);
      assert.equal(link.findByType(supportTypesModule.SupportTypeCount).props.count, rank.supportScore);
    }
    const legacy = markup(priorityModule.EvidencePriority, {
      ranks: unifiedIncident.evidenceRanks, findings: unifiedIncident.findings, selectedFindingId: null, onSelectFinding() {},
    });
    assert.deepEqual([...legacy.matchAll(/>(\d+) (?:types of connections and patterns|type of connection or pattern)<\/span>/g)].map(match => Number(match[1])), unifiedIncident.evidenceRanks.map(rank => rank.supportScore));
    const rank = unifiedIncident.evidenceRanks[1];
    const review = markup(findingsModule.FindingsTimeline, {
      ...unifiedIncident, evidenceRanks: unifiedIncident.evidenceRanks,
      openSection: "findings", reviewedFindingId: rank.findingId,
    });
    assert.ok(review.includes(`>${rank.supportScore} types of connections and patterns</span>`));
    assert.ok(review.includes(`${rank.correlationTypes.length} connection types + ${rank.signalTypes.length} pattern types`));
    for (const code of [...rank.correlationTypes, ...rank.signalTypes]) assert.ok(review.includes(`>${code}</code>`));
    for (const html of [legacy, review]) assert.doesNotMatch(html, />Support \d+<|>Support score/);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
  }
});

test("support units preserve AI text ranks ties and facts or rank fallback counts", () => {
  for (const [investigation, snapshot] of [[resolved, narrativeFixture], [candidateTie, narrativeTieFixture]]) {
    for (const facts of [investigation.causeCandidateFacts, []]) {
      const before = structuredClone({ facts, snapshot });
      const html = markup(narrativePanelModule.InvestigationNarrativeSnapshotContent, {
        snapshot, ...candidateProps(investigation), facts, onNavigateFinding() {}, onNavigateSignal() {},
      });
      assert.deepEqual([...html.matchAll(/>(\d+) (?:types of connections and patterns|type of connection or pattern)<\/span>/g)].map(match => Number(match[1])), investigation.causeCandidateRanks.map(rank => facts.find(fact => fact.candidateId === rank.candidateId)?.supportDiversity ?? rank.supportDiversity));
      for (const block of snapshot.narrative.candidates) assert.ok(html.includes(block.text));
      assert.deepEqual({ facts, snapshot }, before);
      assert.doesNotMatch(html, />Support \d+<|>Support score/);
    }
  }
});

test("support units never reconcile an inconsistent supplied total with its listed types", async () => {
  const facts = unifiedIncident.causeCandidateFacts.map((fact, index) => index === 0 ? { ...fact, supportDiversity: 99 } : fact);
  const firstRank = unifiedIncident.causeCandidateRanks.find(rank => rank.candidateId === facts[0].candidateId);
  await withStartingPointPage({ ...unifiedIncident, causeCandidateFacts: facts }, async renderer => {
    const ranking = renderer.root.findByType(candidateModule.CauseCandidateRanking);
    const row = ranking.findAllByType("article").find(item => item.props["aria-label"] === `Candidate rank #${firstRank.rank}, ${firstRank.service}`);
    assert.equal(row.findByType(supportTypesModule.SupportTypeCount).props.count, 99);
    const open = row.findAllByType("button").find(button => button.props["aria-controls"] === "candidate-detail-drawer");
    await act(async () => open.props.onClick());
    const breakdown = ranking.findByType(supportTypesModule.SupportTypeBreakdown);
    assert.equal(breakdown.props.correlationTypes, facts[0].correlationTypes);
    assert.equal(breakdown.props.signalTypes, facts[0].signalTypes);
    assert.equal(firstRank.supportDiversity, unifiedIncident.causeCandidateRanks.find(rank => rank.candidateId === firstRank.candidateId).supportDiversity);
  });
});

test("Structural signals render all stable factual labels and finding references", () => {
  const html = markup(signalsModule.StructuralSignals, {
    signals: resolved.signals,
    findings: resolved.findings,
    selectedSignalId: resolved.signals[0].id,
    onSelectSignal() {},
    detailsOpen: true,
  });

  assert.match(html, /Failures across services/);
  assert.match(html, /More than one evidence type/);
  assert.match(html, /Failures along a call path/);
  assert.match(html, /Error evidence was observed across 3 services/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(
    html,
    new RegExp(
      `href="#${correlationsModule.findingDomId(
        resolved.signals[0].findingIds[0],
      )}"`,
    ),
  );
  assert.doesNotMatch(
    html,
    /caused by|culprit|root cause|likely cause|confidence/i,
  );
});

test("Structural signals use a compact empty state when no signals exist", () => {
  const html = markup(signalsModule.StructuralSignals, {
    signals: empty.signals,
    findings: empty.findings,
    selectedSignalId: null,
    onSelectSignal() {},
  });

  assert.deepEqual(empty.signals, []);
  assert.match(html, /No evidence patterns were found/);
});

test("Integrity UI stays subtle for clean investigations", () => {
  const html = markup(integrityModule.IntegrityIssues, {
    issues: resolved.integrityIssues,
    logs: resolved.logs,
    traces: resolved.traces,
  });

  assert.match(html, /Data checks/);
  assert.doesNotMatch(html, /Data check issues/);
});

test("Integrity UI explains a service and span mismatch and links existing evidence", () => {
  const issue = integrityMismatch.integrityIssues[0];
  const html = markup(integrityModule.IntegrityIssues, {
    issues: integrityMismatch.integrityIssues,
    logs: integrityMismatch.logs,
    traces: integrityMismatch.traces,
    detailsOpen: true,
  });
  const logId = targetsModule.logDomId(
    issue.logTimestamp,
    issue.service,
    0,
  );
  const spanId = targetsModule.traceSpanDomId(
    issue.traceId,
    issue.spanId,
  );

  assert.match(html, /Service and step mismatch/);
  assert.match(
    html,
    /Log service billing-service does not match referenced span service auth-service/,
  );
  assert.match(html, new RegExp(`href="#${logId}"`));
  assert.match(html, new RegExp(`href="#${spanId}"`));
  assert.match(html, /View related log/);
  assert.match(html, /View linked step/);
  assert.match(html, /do not mean the incident is invalid/);
});

test("Integrity UI handles missing trace and span references without inventing targets", () => {
  const html = markup(integrityModule.IntegrityIssues, {
    issues: integrityMissing.integrityIssues,
    logs: integrityMissing.logs,
    traces: integrityMissing.traces,
    detailsOpen: true,
  });
  const traceId = targetsModule.traceDomId("trace-integrity-existing");

  assert.match(html, /Linked trace unavailable/);
  assert.match(html, /Linked step unavailable/);
  assert.match(html, /trace-not-collected/);
  assert.match(html, /span-not-collected/);
  assert.match(html, /View related log/);
  assert.match(html, new RegExp(`href="#${traceId}"`));
  assert.match(html, /View available trace/);
});

test("Finding presentation supports info, warning, high, and critical severity", () => {
  const html = markup(findingsModule.FindingsTimeline, {
    findings: integrityMismatch.findings,
    timeline: integrityMismatch.timeline,
    openSection: "findings",
  });

  assert.match(html, /critical severity/);
  assert.match(html, /high severity/);
  assert.match(html, /warning severity/);
  assert.match(html, /info severity/);
  assert.doesNotMatch(html, /low severity|medium severity/);
});

test("Evidence Group Facts render backend counts, types, and observed window", () => {
  const group = resolved.evidenceGroups[0];
  const html = markup(
    evidenceGroupsModule.EvidenceGroups,
    { ...evidenceGroupProps(resolved), detailsOpen: true },
  );

  assert.equal(group.findingCount, 5);
  assert.equal(group.correlationCount, 3);
  assert.deepEqual(group.findingTypes, [
    "log_error",
    "metric_threshold",
    "trace_error",
  ]);
  assert.deepEqual(group.correlationTypes, [
    "same_span",
    "same_trace",
    "temporal_service",
  ]);
  assert.match(html, /Finding types/);
  assert.match(html, /metric threshold/);
  assert.match(html, /Observed window/);
});

function installReviewLocationBrowser(initialHref) {
  const listeners = new Map();
  const historyCalls = [];
  const location = { pathname: "", search: "", hash: "" };

  function setHref(href) {
    const url = new URL(href, "http://frontend.test");
    location.pathname = url.pathname;
    location.search = url.search;
    location.hash = url.hash;
  }

  function addListener(name, handler) {
    const handlers = listeners.get(name) ?? new Set();
    handlers.add(handler);
    listeners.set(name, handlers);
  }

  function removeListener(name, handler) {
    listeners.get(name)?.delete(handler);
  }

  setHref(initialHref);
  return {
    location,
    listeners,
    historyCalls,
    setHref,
    dispatch(name) {
      for (const handler of [...(listeners.get(name) ?? [])]) {
        handler({ type: name });
      }
    },
    window: {
      location,
      history: {
        state: null,
        pushState(state, _title, href) {
          this.state = state;
          historyCalls.push({ mode: "push", href });
          setHref(href);
        },
        replaceState(state, _title, href) {
          this.state = state;
          historyCalls.push({ mode: "replace", href });
          setHref(href);
        },
      },
      addEventListener: addListener,
      removeEventListener: removeListener,
      requestAnimationFrame(callback) {
        callback();
        return 1;
      },
      cancelAnimationFrame() {},
    },
  };
}

function installReviewDocumentEnvironment() {
  const listeners = new Map();
  class MockHTMLElement {
    focus() {}
    scrollIntoView() {}
    querySelectorAll() {
      return [];
    }
  }

  return {
    HTMLElement: MockHTMLElement,
    createNodeMock() {
      return new MockHTMLElement();
    },
    document: {
      title: "",
      body: { style: { overflow: "" } },
      activeElement: null,
      getElementById() {
        return new MockHTMLElement();
      },
      addEventListener(name, handler) {
        const handlers = listeners.get(name) ?? new Set();
        handlers.add(handler);
        listeners.set(name, handlers);
      },
      removeEventListener(name, handler) {
        listeners.get(name)?.delete(handler);
      },
    },
  };
}

test("evidence acceptance: drawer focuses Close, traps keyboard navigation and restores focus and body scrolling", async () => {
  const previousDocument = globalThis.document;
  const previousHTMLElement = globalThis.HTMLElement;
  const listeners = new Map();
  const focusHistory = [];
  let renderer;
  let closeCalls = 0;
  let documentMock;

  class TrackingHTMLElement {
    constructor(name) {
      this.name = name;
    }
    focus() {
      documentMock.activeElement = this;
      focusHistory.push(this.name);
    }
  }

  const trigger = new TrackingHTMLElement("trigger");
  const close = new TrackingHTMLElement("close");
  const search = new TrackingHTMLElement("search");
  const last = new TrackingHTMLElement("last");
  const drawer = new TrackingHTMLElement("drawer");
  drawer.querySelectorAll = (selector) => {
    assert.match(selector, /button:not/);
    assert.match(selector, /input:not/);
    return [close, search, last];
  };
  documentMock = {
    activeElement: trigger,
    body: { style: { overflow: "clip" } },
    addEventListener(name, handler) {
      const handlers = listeners.get(name) ?? new Set();
      handlers.add(handler);
      listeners.set(name, handlers);
    },
    removeEventListener(name, handler) {
      listeners.get(name)?.delete(handler);
    },
  };
  globalThis.document = documentMock;
  globalThis.HTMLElement = TrackingHTMLElement;

  const renderDrawer = (open) => React.createElement(
    detailDrawerModule.InvestigationDetailDrawer,
    {
      id: "evidence-acceptance-drawer",
      open,
      eyebrow: "Observed facts",
      title: "Evidence acceptance",
      onClose() { closeCalls += 1; },
    },
    React.createElement("input", { "aria-label": "Search findings" }),
    React.createElement("button", { type: "button" }, "Last evidence action"),
  );
  const dispatchKey = async (key, shiftKey = false) => {
    let prevented = false;
    await act(async () => {
      for (const handler of [...(listeners.get("keydown") ?? [])]) {
        handler({ key, shiftKey, preventDefault() { prevented = true; } });
      }
    });
    return prevented;
  };

  try {
    await act(async () => {
      renderer = TestRenderer.create(renderDrawer(false), {
        createNodeMock(element) {
          return element.type === "aside" ? drawer : close;
        },
      });
    });
    assert.equal(listeners.get("keydown")?.size ?? 0, 0);
    assert.equal(documentMock.body.style.overflow, "clip");
    await act(async () => { renderer.update(renderDrawer(true)); });
    assert.equal(documentMock.activeElement, close);
    assert.equal(documentMock.body.style.overflow, "hidden");
    assert.equal(listeners.get("keydown").size, 1);

    assert.equal(await dispatchKey("Tab", true), true);
    assert.equal(documentMock.activeElement, last);
    assert.equal(await dispatchKey("Tab"), true);
    assert.equal(documentMock.activeElement, close);
    search.focus();
    assert.equal(await dispatchKey("Tab"), false);
    assert.equal(documentMock.activeElement, search);
    assert.equal(await dispatchKey("ArrowDown"), false);
    assert.equal(await dispatchKey("Escape"), true);
    assert.equal(closeCalls, 1);

    await act(async () => { renderer.update(renderDrawer(false)); });
    assert.equal(documentMock.activeElement, trigger);
    assert.equal(documentMock.body.style.overflow, "clip");
    assert.equal(listeners.get("keydown").size, 0);
    assert.deepEqual(focusHistory, ["close", "last", "close", "search", "trigger"]);

    await act(async () => { renderer.update(renderDrawer(true)); });
    assert.equal(documentMock.activeElement, close);
    await act(async () => { renderer.unmount(); });
    renderer = null;
    assert.equal(documentMock.activeElement, trigger);
    assert.equal(documentMock.body.style.overflow, "clip");
    assert.equal(listeners.get("keydown").size, 0);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousHTMLElement === undefined) delete globalThis.HTMLElement;
    else globalThis.HTMLElement = previousHTMLElement;
  }
});

test("evidence acceptance: switching investigations resets active finding review and all finding filters", async () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousHTMLElement = globalThis.HTMLElement;
  const browser = installReviewLocationBrowser(
    "/investigations/" + resolved.alert.id + "?source=live",
  );
  const documentEnvironment = installReviewDocumentEnvironment();
  const nextRequest = deferred();
  const requests = [];
  let renderer;
  let narrativeCalls = 0;
  const dataSource = {
    getInvestigation(alertId, options) {
      requests.push({ alertId, signal: options.signal });
      return alertId === resolved.alert.id ? Promise.resolve(resolved) : nextRequest.promise;
    },
  };
  const narrativeDataSource = {
    async generateNarrative() { narrativeCalls += 1; throw new Error("not requested"); },
  };
  const page = (alertId) => React.createElement(pageModule.InvestigationPage, {
    alertId, dataSource, narrativeDataSource,
  });
  const openFindings = async () => {
    const trigger = renderer.root.findAllByType("button").find(
      (button) => button.props["aria-controls"] === "findings-drawer",
    );
    assert.ok(trigger);
    await act(async () => { trigger.props.onClick(); });
  };
  globalThis.window = browser.window;
  globalThis.document = documentEnvironment.document;
  globalThis.HTMLElement = documentEnvironment.HTMLElement;

  try {
    await act(async () => {
      renderer = TestRenderer.create(page(resolved.alert.id), {
        createNodeMock: documentEnvironment.createNodeMock,
      });
    });
    await openFindings();
    const finding = resolved.findings.find((item) => item.service);
    assert.ok(finding);
    const row = renderer.root.findByProps({ id: correlationsModule.findingDomId(finding.id) });
    const reviewButton = row.findAllByType("button").find(
      (button) => button.children.includes("Review linked evidence"),
    );
    assert.ok(reviewButton);
    await act(async () => { reviewButton.props.onClick(); });
    assert.match(renderedText(renderer), /Focused evidence review/);

    const input = renderer.root.findByType("input");
    const selects = renderer.root.findAllByType("select");
    assert.equal(selects.length, 3);
    await act(async () => { input.props.onChange({ target: { value: finding.message } }); });
    await act(async () => { selects[0].props.onChange({ target: { value: finding.service } }); });
    await act(async () => { selects[1].props.onChange({ target: { value: finding.severity } }); });
    await act(async () => { selects[2].props.onChange({ target: { value: finding.type } }); });
    assert.equal(input.props.value, finding.message);
    assert.deepEqual(selects.map((select) => select.props.value), [finding.service, finding.severity, finding.type]);
    assert.match(renderedText(renderer), /Focused evidence review/);

    browser.setHref("/investigations/" + firing.alert.id + "?source=live");
    await act(async () => { renderer.update(page(firing.alert.id)); });
    assert.match(renderedText(renderer), /Loading investigation/);
    assert.equal(requests[0].signal.aborted, true);
    assert.equal(renderer.root.findAllByProps({ "data-investigation-drawer": "findings-drawer" }).length, 0);
    await act(async () => { nextRequest.resolve(firing); });
    assert.deepEqual(requests.map((request) => request.alertId), [resolved.alert.id, firing.alert.id]);
    assert.equal(renderer.root.findByType(findingsModule.FindingsTimeline).props.reviewedFindingId, null);
    assert.doesNotMatch(renderedText(renderer), /Focused evidence review/);
    assert.equal(renderer.root.findAllByProps({ "data-investigation-drawer": "findings-drawer" }).length, 0);

    await openFindings();
    assert.equal(renderer.root.findByType("input").props.value, "");
    assert.deepEqual(renderer.root.findAllByType("select").map((select) => select.props.value), ["", "", ""]);
    assert.equal(renderer.root.findAllByType("button").find((button) => button.children.includes("Clear filters")).props.disabled, true);
    assert.deepEqual(
      renderer.root.findAllByType("li").filter((item) => item.props.id).map((item) => item.props.id),
      firing.findings.map((item) => correlationsModule.findingDomId(item.id)),
    );
    assert.doesNotMatch(renderedText(renderer), /Focused evidence review/);
    assert.equal(narrativeCalls, 0);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousHTMLElement === undefined) delete globalThis.HTMLElement;
    else globalThis.HTMLElement = previousHTMLElement;
  }
});

test("durable evidence targets resolve only exact IDs from the loaded snapshot", () => {
  const finding = resolved.findings[0];
  const findingTargetId = correlationsModule.findingDomId(finding.id);
  assert.deepEqual(
    reviewLocationModule.resolveInvestigationReviewLocation(
      `#${findingTargetId}`,
      { findings: resolved.findings, logs: resolved.logs },
    ),
    {
      kind: "finding",
      targetId: findingTargetId,
      findingId: finding.id,
    },
  );

  const logIndex = resolved.logs.findIndex((log) => log.traceId && log.spanId);
  assert.ok(logIndex >= 0);
  const log = resolved.logs[logIndex];
  const logTargetId = targetsModule.logDomId(log.timestamp, log.service, logIndex);
  const similarButUnlinkedLog = {
    ...log,
    message: "Similar service and time, different exact record",
    traceId: "unrelated-trace",
    spanId: "unrelated-span",
  };
  assert.deepEqual(
    reviewLocationModule.resolveInvestigationReviewLocation(
      `#${logTargetId}`,
      {
        findings: resolved.findings,
        logs: [...resolved.logs, similarButUnlinkedLog],
      },
    ),
    {
      kind: "log",
      targetId: logTargetId,
      logIndex,
      exactSpanReference: {
        traceId: log.traceId,
        spanId: log.spanId,
      },
    },
  );

  const partialLog = { ...log, traceId: "trace-only", spanId: undefined };
  const partialTargetId = targetsModule.logDomId(
    partialLog.timestamp,
    partialLog.service,
    0,
  );
  assert.deepEqual(
    reviewLocationModule.resolveInvestigationReviewLocation(
      `#${partialTargetId}`,
      { findings: [], logs: [partialLog] },
    ),
    {
      kind: "log",
      targetId: partialTargetId,
      logIndex: 0,
    },
  );

  for (const hash of ["#missing", "#%E0%A4%A"]) {
    assert.equal(
      reviewLocationModule.resolveInvestigationReviewLocation(hash, {
        findings: resolved.findings,
        logs: resolved.logs,
      }),
      null,
    );
  }
  assert.equal(
    reviewLocationModule.resolveInvestigationReviewLocation(
      `#${findingTargetId}`,
      { findings: [finding, finding], logs: [] },
    ),
    null,
  );
  assert.equal(
    reviewLocationModule.investigationReviewHref(
      "/investigations/alert-1",
      "?source=live&q=checkout",
      findingTargetId,
    ),
    `/investigations/alert-1?source=live&q=checkout#${findingTargetId}`,
  );
});

test("review hashes restore finding and exact-log state across history navigation", async () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousHTMLElement = globalThis.HTMLElement;
  const finding = resolved.findings[0];
  const findingTargetId = correlationsModule.findingDomId(finding.id);
  const logIndex = resolved.logs.findIndex((log) => log.traceId && log.spanId);
  assert.ok(logIndex >= 0);
  const log = resolved.logs[logIndex];
  const logTargetId = targetsModule.logDomId(log.timestamp, log.service, logIndex);
  const baseHref = `/investigations/${resolved.alert.id}?source=live&q=checkout`;
  const findingHref = `${baseHref}#${findingTargetId}`;
  const logHref = `${baseHref}#${logTargetId}`;
  const browser = installReviewLocationBrowser(findingHref);
  const documentEnvironment = installReviewDocumentEnvironment();
  let renderer;

  globalThis.window = browser.window;
  globalThis.document = documentEnvironment.document;
  globalThis.HTMLElement = documentEnvironment.HTMLElement;

  try {
    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(pageModule.InvestigationPage, {
          alertId: resolved.alert.id,
          dataSource: {
            async getInvestigation() {
              return resolved;
            },
          },
          narrativeDataSource: {
            async generateNarrative() {
              throw new Error("not requested");
            },
          },
        }),
        { createNodeMock: documentEnvironment.createNodeMock },
      );
    });

    assert.equal(
      renderer.root.findAllByProps({
        "data-investigation-drawer": "findings-drawer",
      }).length,
      1,
    );
    assert.match(renderedText(renderer), /Focused evidence review/);
    assert.match(renderedText(renderer), new RegExp(finding.message.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(browser.historyCalls.length, 0);

    browser.setHref(logHref);
    await act(async () => {
      browser.dispatch("hashchange");
    });
    assert.equal(
      renderer.root.findAllByProps({
        "data-investigation-drawer": "telemetry-drawer",
      }).length,
      1,
    );
    assert.match(renderedText(renderer), /Selected request step/);
    assert.match(renderedText(renderer), new RegExp(log.traceId));
    assert.doesNotMatch(renderedText(renderer), /Focused evidence review/);

    browser.setHref(findingHref);
    await act(async () => {
      browser.dispatch("popstate");
    });
    assert.equal(
      renderer.root.findAllByProps({
        "data-investigation-drawer": "findings-drawer",
      }).length,
      1,
    );
    assert.match(renderedText(renderer), /Focused evidence review/);

    browser.setHref(baseHref);
    await act(async () => {
      browser.dispatch("popstate");
    });
    assert.equal(
      renderer.root.findAll(
        (node) => node.props["data-investigation-drawer"] !== undefined,
      ).length,
      0,
    );
    assert.ok((browser.listeners.get("hashchange")?.size ?? 0) > 0);
    assert.ok((browser.listeners.get("popstate")?.size ?? 0) > 0);
  } finally {
    if (renderer) {
      await act(async () => {
        renderer.unmount();
      });
    }
    assert.equal(browser.listeners.get("hashchange")?.size ?? 0, 0);
    assert.equal(browser.listeners.get("popstate")?.size ?? 0, 0);
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousHTMLElement === undefined) delete globalThis.HTMLElement;
    else globalThis.HTMLElement = previousHTMLElement;
  }
});

test("opening and closing a finding review writes one durable URL and preserves query state", async () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousHTMLElement = globalThis.HTMLElement;
  const baseHref = `/investigations/${resolved.alert.id}?source=live&q=checkout&status=firing`;
  const browser = installReviewLocationBrowser(baseHref);
  const documentEnvironment = installReviewDocumentEnvironment();
  let renderer;

  globalThis.window = browser.window;
  globalThis.document = documentEnvironment.document;
  globalThis.HTMLElement = documentEnvironment.HTMLElement;

  const page = () =>
    React.createElement(pageModule.InvestigationPage, {
      alertId: resolved.alert.id,
      dataSource: {
        async getInvestigation() {
          return resolved;
        },
      },
      narrativeDataSource: {
        async generateNarrative() {
          throw new Error("not requested");
        },
      },
    });

  try {
    await act(async () => {
      renderer = TestRenderer.create(page(), {
        createNodeMock: documentEnvironment.createNodeMock,
      });
    });
    const openFindings = renderer.root
      .findAllByType("button")
      .find((button) => button.props["aria-controls"] === "findings-drawer");
    assert.ok(openFindings);
    await act(async () => {
      openFindings.props.onClick();
    });

    const reviewButton = renderer.root
      .findAllByType("button")
      .find((button) => button.children.includes("Review linked evidence"));
    assert.ok(reviewButton);
    await act(async () => {
      reviewButton.props.onClick();
    });

    const reviewedFinding = resolved.findings[0];
    const findingTargetId = correlationsModule.findingDomId(reviewedFinding.id);
    assert.deepEqual(browser.historyCalls, [
      {
        mode: "push",
        href: `${baseHref}#${findingTargetId}`,
      },
    ]);
    assert.equal(browser.location.pathname, `/investigations/${resolved.alert.id}`);
    assert.equal(browser.location.search, "?source=live&q=checkout&status=firing");
    assert.equal(browser.location.hash, `#${findingTargetId}`);
    assert.match(renderedText(renderer), /Focused evidence review/);

    const closeReview = renderer.root
      .findAllByType("button")
      .find((button) => button.children.includes("Close evidence review"));
    assert.ok(closeReview);
    await act(async () => {
      closeReview.props.onClick();
    });
    assert.deepEqual(browser.historyCalls, [
      {
        mode: "push",
        href: `${baseHref}#${findingTargetId}`,
      },
      { mode: "replace", href: baseHref },
    ]);
    assert.equal(browser.location.hash, "");
    assert.doesNotMatch(renderedText(renderer), /Focused evidence review/);
    assert.equal(
      renderer.root.findAllByProps({
        "data-investigation-drawer": "findings-drawer",
      }).length,
      1,
    );

    await act(async () => {
      renderer.unmount();
    });
    renderer = null;
    await act(async () => {
      renderer = TestRenderer.create(page(), {
        createNodeMock: documentEnvironment.createNodeMock,
      });
    });
    assert.doesNotMatch(renderedText(renderer), /Focused evidence review/);
    assert.equal(
      renderer.root.findAll(
        (node) => node.props["data-investigation-drawer"] !== undefined,
      ).length,
      0,
    );
  } finally {
    if (renderer) {
      await act(async () => {
        renderer.unmount();
      });
    }
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousHTMLElement === undefined) delete globalThis.HTMLElement;
    else globalThis.HTMLElement = previousHTMLElement;
  }
});




