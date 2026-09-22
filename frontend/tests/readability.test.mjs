import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import TestRenderer, { act } from "react-test-renderer";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";
import { createServer } from "vite";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const stylesheetPath = path.resolve("src/index.css");
const stylesheet = await readFile(stylesheetPath, "utf8");
const compiled = await postcss([
  tailwindcss({ config: path.resolve("tailwind.config.ts") }),
  autoprefixer(),
]).process(stylesheet, { from: stylesheetPath });
const vite = await createServer({
  root: process.cwd(),
  appType: "custom",
  logLevel: "silent",
  server: { middlewareMode: true },
});
test.after(async () => vite.close());

const load = (modulePath) => vite.ssrLoadModule(modulePath);
const data = await load("/src/data/investigationDataSource.ts");
const overview = await load("/src/components/InvestigationOverview.tsx");
const candidates = await load("/src/components/CauseCandidateRanking.tsx");
const support = await load("/src/components/SupportTypes.tsx");
const trace = await load("/src/components/TraceTree.tsx");
const timeline = await load("/src/components/FindingsTimeline.tsx");
const targets = await load("/src/lib/investigationTargets.ts");
const fixtureByLabel = Object.fromEntries(data.fixtureOptions.map(option => [option.label, option.alertId]));
const resolved = await data.fixtureInvestigationDataSource.getInvestigation(fixtureByLabel.Resolved);
const deepTrace = await data.fixtureInvestigationDataSource.getInvestigation(fixtureByLabel["Deep trace"]);
const markup = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));

function declarations(selector) {
  const values = {};
  compiled.root.walkRules(rule => {
    if (rule.selector === selector) {
      rule.walkDecls(declaration => { values[declaration.prop] = declaration.value; });
    }
  });
  assert.notDeepEqual(values, {}, `Expected generated rule ${selector}`);
  return values;
}

function generatedColor(selector, property) {
  const value = declarations(selector)[property];
  const match = value?.match(/^rgb\((\d+) (\d+) (\d+) \/ /);
  assert.ok(match, `Expected an actual generated RGB color for ${selector}: ${value}`);
  return match.slice(1).map(Number);
}

function luminance(rgb) {
  const channels = rgb.map(channel => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(foreground, background) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

function composite(foreground, opacity, background) {
  return foreground.map((channel, index) => channel * opacity + background[index] * (1 - opacity));
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async entry => {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(filename);
    return /\.(tsx?|css)$/.test(entry.name) ? [filename] : [];
  }));
  return nested.flat();
}

function hasClass(node, name) {
  return String(node.props.className ?? "").split(/\s+/).includes(name);
}

function assertWrapping(node) {
  assert.ok(hasClass(node, "break-words"));
  assert.ok(hasClass(node, "[overflow-wrap:anywhere]"));
  assert.equal(hasClass(node, "truncate"), false);
}

test("readability compiles the shared 13px minimum without enlarging body or heading tokens", () => {
  assert.equal(declarations(".text-xs")["font-size"], "0.8125rem");
  assert.equal(declarations(".text-xs")["line-height"], "1.25rem");
  assert.equal(declarations(".text-sm")["font-size"], "0.875rem");
  assert.equal(declarations(".text-base")["font-size"], "1rem");
  assert.equal(declarations(".text-2xl")["font-size"], "1.5rem");
  assert.equal(declarations(".sm\\:text-3xl")["font-size"], "1.875rem");
  const fixedSizes = [];
  compiled.root.walkDecls("font-size", declaration => {
    const match = declaration.value.match(/^(\d*\.?\d+)(rem|px)$/);
    if (match) fixedSizes.push({ value: Number(match[1]) * (match[2] === "rem" ? 16 : 1), selector: declaration.parent.selector });
  });
  assert.ok(fixedSizes.length > 0);
  for (const size of fixedSizes) assert.ok(size.value >= 13, `Smaller compiled font in ${size.selector}: ${size.value}px`);
  postcss.parse(stylesheet).walkRules(rule => {
    if ([":root", "html", "body"].includes(rule.selector)) {
      rule.walkDecls("font-size", declaration => assert.fail(`Unexpected root/body scaling: ${declaration.value}`));
    }
  });
});

test("readability source does not reintroduce a smaller arbitrary font-size utility", async () => {
  for (const filename of await sourceFiles(path.resolve("src"))) {
    const source = await readFile(filename, "utf8");
    for (const match of source.matchAll(/text-\[(\d*\.?\d+)(rem|px)\]/g)) {
      const pixels = Number(match[1]) * (match[2] === "rem" ? 16 : 1);
      assert.ok(pixels >= 13, `${path.relative(process.cwd(), filename)} contains ${match[0]} (${pixels}px)`);
    }
  }
});

test("readability shared text palettes have contrast margin on their actual base and incident-tinted backgrounds", () => {
  const white = generatedColor(".bg-surface", "background-color");
  const canvas = generatedColor(".bg-canvas", "background-color");
  const slate = generatedColor(".text-slate", "color");
  const ink = generatedColor(".text-ink", "color");
  const incident = generatedColor(".text-incident", "color");
  assert.deepEqual(slate, [82, 97, 113]);
  assert.ok(contrast(slate, white) > 6.3);
  assert.ok(contrast(slate, canvas) > 5.8);
  for (const background of [white, canvas]) {
    for (const foreground of [slate, ink, incident]) assert.ok(contrast(foreground, background) >= 4.5);
  }
  const tintOpacities = new Set();
  compiled.root.walkDecls("background-color", declaration => {
    const match = declaration.value.match(/^rgb\(180 35 45 \/ (0\.\d+)\)$/);
    // Pseudo-element rails use darker incident opacity but do not carry text.
    if (match && declaration.parent.selector?.startsWith(".bg-incident")) tintOpacities.add(Number(match[1]));
  });
  assert.ok(tintOpacities.has(0.07), "The real alert badge incident tint should be compiled");
  for (const opacity of tintOpacities) {
    for (const base of [white, canvas]) {
      const tinted = composite(incident, opacity, base);
      for (const foreground of [slate, ink, incident]) {
        assert.ok(contrast(foreground, tinted) >= 4.5, `Text contrast on incident/${opacity} fell below 4.5`);
      }
    }
  }
  assert.ok(contrast(white, generatedColor(".bg-ink", "background-color")) >= 4.5);
  assert.ok(contrast(white, generatedColor(".bg-incident", "background-color")) >= 4.5);
  // These selected palette pairs do not certify every page, overlay, focus state, or viewport.
});

test("readability overview wraps long exact alert and service values instead of truncating them", async () => {
  const investigation = structuredClone(resolved);
  investigation.alert.title = "CheckoutFailure".repeat(24);
  investigation.alert.message = "threshold.metric.selector=" + "long-selector".repeat(28);
  investigation.alert.service = "checkout-service".repeat(20);
  investigation.summary.servicesInvolved = [investigation.alert.service, "database-primary".repeat(20)];
  const before = structuredClone(investigation);
  let renderer;
  try {
    await act(async () => { renderer = TestRenderer.create(React.createElement(overview.InvestigationOverview, { investigation })); });
    assert.equal(renderer.root.findByType("h1").children.join(""), investigation.alert.title);
    assertWrapping(renderer.root.findByType("h1"));
    const exactTextNodes = value => renderer.root.findAll(node => typeof node.type === "string" && node.children.includes(value));
    for (const value of [investigation.alert.message, ...investigation.summary.servicesInvolved]) {
      const nodes = exactTextNodes(value);
      assert.ok(nodes.length > 0, `Exact value missing: ${value}`);
      for (const node of nodes) assertWrapping(node);
    }
    const joinedServices = investigation.summary.servicesInvolved.join(" · ");
    const detail = renderer.root.findByProps({ title: joinedServices });
    assert.equal(detail.children.join(""), joinedServices);
    assertWrapping(detail);
    assert.deepEqual(investigation, before);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
  }
});

test("readability overview preserves exact summary counts evidence times and the candidate landmark slot", async () => {
  const investigation = structuredClone(resolved);
  investigation.summary = { ...investigation.summary, errorSpans: 9001, metricAnomalies: 12345, logErrors: 67890 };
  let renderer;
  try {
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(overview.InvestigationOverview, {
        investigation,
        children: React.createElement("section", { id: "candidate-ranking" }, "Existing candidate content"),
      }));
    });
    assert.deepEqual(renderer.root.findAllByType("time").map(node => node.props.dateTime), [investigation.window.from, investigation.window.to]);
    for (const count of [investigation.summary.servicesInvolved.length, 9001, 12345, 67890]) {
      assert.ok(renderer.root.findAllByType("p").some(node => node.children.join("") === String(count)));
    }
    const sections = renderer.root.findAllByType("section");
    assert.equal(sections[0].props.id, "overview");
    assert.equal(sections[1].props.id, "candidate-ranking");
    assert.equal(sections[2].props["aria-labelledby"], "window-heading");
  } finally {
    if (renderer) await act(async () => renderer.unmount());
  }
});

test("readability primary candidate trace and support explanations use the existing 14px body token", async () => {
  const elements = [
    [candidates.CauseCandidateRanking, {
      candidates: resolved.causeCandidates, facts: resolved.causeCandidateFacts, ranks: resolved.causeCandidateRanks,
      findings: resolved.findings, correlations: resolved.correlations, signals: resolved.signals,
      selectedCandidateId: null, onSelectCandidate() {},
    }, "cause-candidates-description"],
    [trace.TraceTree, { traces: deepTrace.traces }, "trace-description"],
  ];
  for (const [Component, props, id] of elements) {
    let renderer;
    try {
      await act(async () => { renderer = TestRenderer.create(React.createElement(Component, props)); });
      assert.ok(hasClass(renderer.root.findByProps({ id }), "text-sm"));
    } finally {
      if (renderer) await act(async () => renderer.unmount());
    }
  }
  const html = markup(support.SupportTypeBreakdown, { correlationTypes: ["same_trace"], signalTypes: [] });
  assert.match(html, /<p class="text-sm leading-5 text-slate">Adds the number of different connection types and pattern types/);
  assert.match(html, /same_trace/);
  assert.match(html, /1 connection type/);
  assert.match(html, /0 pattern types/);
});

test("readability keeps the deep trace contained and preserves exact-span log counts links and timestamps", async () => {
  const traces = structuredClone(deepTrace.traces);
  let leaf = traces[0];
  while (leaf.children.length) leaf = leaf.children[0];
  leaf.service = "postgres-primary".repeat(20);
  leaf.operation = "SELECT-with-long-query".repeat(20);
  const logs = [0, 1, 2].map(index => ({
    service: leaf.service, level: "error", message: `exact message ${index}`,
    timestamp: `2026-09-14T12:34:0${index}.000Z`, traceId: leaf.traceId, spanId: leaf.spanId,
  }));
  logs.push({ ...logs[0], traceId: "different-trace", message: "not an exact match" });
  const html = markup(trace.TraceTree, { traces, logs, onReviewExactSpanLogs() {} });
  assert.match(html, /trace-scroll overflow-x-auto/);
  assert.match(html, /role="region" aria-label="Scrollable request call path"/);
  assert.ok(html.includes(leaf.service));
  assert.ok(html.includes(leaf.operation));
  assert.match(html, /depth 7/);
  assert.match(html, /data-exact-span-log-count="3"/);
  assert.ok(html.includes(`href="#${targets.logDomId(logs[0].timestamp, logs[0].service, 0)}"`));
  assert.ok(html.includes(`dateTime="${logs[0].timestamp}"`));
  assert.ok(html.includes(`dateTime="${logs[1].timestamp}"`));
  assert.match(html, /\+1 more log for this step/);
  assert.doesNotMatch(html, /not an exact match/);
  let renderer;
  try {
    await act(async () => { renderer = TestRenderer.create(React.createElement(trace.TraceTree, { traces, logs })); });
    const collapse = renderer.root.findAllByType("button")[0];
    assert.equal(collapse.props["aria-expanded"], true);
    await act(async () => collapse.props.onClick());
    assert.equal(renderer.root.findAllByType("button")[0].props["aria-expanded"], false);
    assert.equal(renderer.root.findAll(node => node.props.id === targets.traceSpanDomId(leaf.traceId, leaf.spanId)).length, 0);
    await act(async () => renderer.root.findAllByType("button")[0].props.onClick());
    assert.equal(renderer.root.findAll(node => node.props.id === targets.traceSpanDomId(leaf.traceId, leaf.spanId)).length, 1);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
  }
});

test("readability timeline retains the existing fixed time column connector alignment and exact timestamps", () => {
  const html = markup(timeline.FindingsTimeline, {
    findings: resolved.findings, timeline: resolved.timeline, openSection: "timeline", onOpenSection() {},
  });
  assert.match(html, /sm:grid-cols-\[5\.9rem_1\.75rem_minmax\(0,1fr\)\]/);
  assert.match(html, /sm:left-\[7\.08rem\]/);
  for (const item of resolved.timeline) assert.ok(html.includes(`dateTime="${item.timestamp}"`));
  const gridValues = [];
  const leftValues = [];
  compiled.root.walkDecls("grid-template-columns", declaration => gridValues.push(declaration.value));
  compiled.root.walkDecls("left", declaration => leftValues.push(declaration.value));
  assert.ok(gridValues.includes("5.9rem 1.75rem minmax(0,1fr)"));
  assert.ok(leftValues.includes("7.08rem"));
});
