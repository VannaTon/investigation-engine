import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { createServer } from "vite";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.document = { title: "", body: { style: {} }, getElementById: () => null };
const vite = await createServer({ root: process.cwd(), appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
test.after(async () => { await vite.close(); });
const { MetricRuleSelectors } = await vite.ssrLoadModule("/src/components/MetricRuleSelectors.tsx");
const { AlertRuleForm } = await vite.ssrLoadModule("/src/components/AlertRuleForm.tsx");

const applicationId = "00000000-0000-4000-8000-000000000001";
const application = { id: applicationId, name: "Checkout application", status: "active", createdAt: "2026-09-13T00:00:00.000Z", updatedAt: "2026-09-13T00:00:00.000Z" };
const applications = [application];
const window = { from: "2026-09-12T00:00:00.000Z", to: "2026-09-13T00:00:00.000Z" };
const descriptor = (name = "queue.depth", overrides = {}) => ({ name, types: ["gauge"], units: ["items"], lastSeen: window.to, metadataTruncated: false, ...overrides });
const servicesResult = (data = ["checkout", "payment"], overrides = {}) => ({ data, hasMore: false, window, ...overrides });
const metricsResult = (service, data = [descriptor()], overrides = {}) => ({ service, data, hasMore: false, window, ...overrides });
const discovery = (overrides = {}) => {
  const services = overrides.services ?? (async () => servicesResult());
  const metrics = overrides.metrics ?? (async (service) => metricsResult(service));
  return {
    services: (receivedApplicationId, signal) => { assert.equal(receivedApplicationId, applicationId); return services(signal); },
    metrics: (receivedApplicationId, service, signal) => { assert.equal(receivedApplicationId, applicationId); return metrics(service, signal); },
  };
};
const sampleSource = { recent: async () => ({ data: [], hasMore: false }) };
const input = { applicationId, name: "Checkout queue", config: { service: "checkout", metricName: "queue.depth", operator: ">", threshold: 100, windowMinutes: 5, recoveryWindowMinutes: 3, stalenessMinutes: 1 } };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const content = (renderer) => JSON.stringify(renderer.toJSON());
const control = (renderer, id) => renderer.root.findByProps({ id });
const button = (renderer, label) => renderer.root.findAllByType("button").find((node) => node.props["aria-label"] === label || node.children.join("") === label);
const options = (renderer, id) => control(renderer, id).findAllByType("option").map((node) => ({ value: node.props.value, label: node.children.join(""), disabled: !!node.props.disabled }));
const change = async (renderer, id, value) => { await act(async () => control(renderer, id).props.onChange({ target: { value } })); };
const click = async (renderer, label) => { const node = button(renderer, label); assert.ok(node, `Missing button: ${label}`); await act(async () => { node.props.onClick(); }); };
const submit = async (renderer) => { await act(async () => renderer.root.findByType("form").props.onSubmit({ preventDefault() {} })); };
const unmount = async (renderer) => { await act(async () => renderer.unmount()); };
const mountSelectors = async (dataSource = discovery(), initial = {}, onChange = {}) => {
  function Harness() {
    const [service, setService] = React.useState(initial.service ?? "");
    const [metricName, setMetricName] = React.useState(initial.metricName ?? "");
    return React.createElement(MetricRuleSelectors, {
      applicationId, service, metricName, initialService: initial.initialService, initialMetricName: initial.initialMetricName,
      busy: initial.busy ?? false, errors: initial.errors ?? {}, dataSource,
      onServiceChange(value) { setService(value); setMetricName(""); onChange.service?.(value); },
      onMetricChange(value, expectedService) { if (expectedService !== service) return; setMetricName(value); onChange.metric?.(value, expectedService); },
      serviceRef() {}, metricRef() {},
    });
  }
  let renderer; await act(async () => { renderer = TestRenderer.create(React.createElement(Harness)); }); return renderer;
};
const mountForm = async (props = {}, createNodeMock) => {
  let renderer; await act(async () => { renderer = TestRenderer.create(React.createElement(AlertRuleForm, {
    applications, initial: input, editing: true, busy: false, sampleDataSource: sampleSource, discoveryDataSource: discovery(), onSave() {}, onCancel() {}, ...props,
  }), createNodeMock ? { createNodeMock } : undefined); }); return renderer;
};

test("native selectors list only services and metrics observed by discovery", async () => {
  const renderer = await mountSelectors(discovery(), { service: "checkout", metricName: "queue.depth" });
  assert.equal(control(renderer, "rule-service").type, "select"); assert.equal(control(renderer, "rule-metricName").type, "select");
  assert.deepEqual(options(renderer, "rule-service").map((option) => option.value), ["", "checkout", "payment"]);
  assert.deepEqual(options(renderer, "rule-metricName").map((option) => option.value), ["", "queue.depth"]);
  assert.equal(renderer.root.findAllByType("input").length, 0); assert.equal(renderer.root.findAllByType("datalist").length, 0);
  assert.match(content(renderer), /last 24 hours/); assert.doesNotMatch(content(renderer), /fixture-one|Example service|Enter a service|Enter a metric/); await unmount(renderer);
});

test("metric discovery is scoped to the exact selected service", async () => {
  const requested = []; const dataSource = discovery({ metrics: async (service) => { requested.push(service); return metricsResult(service, [descriptor(`${service}.metric`)]); } });
  const renderer = await mountSelectors(dataSource);
  assert.deepEqual(requested, []); assert.equal(control(renderer, "rule-metricName").props.disabled, true);
  await change(renderer, "rule-service", "payment"); assert.deepEqual(requested, ["payment"]);
  assert.deepEqual(options(renderer, "rule-metricName").map((option) => option.value), ["", "payment.metric"]);
  await change(renderer, "rule-service", "checkout"); assert.deepEqual(requested, ["payment", "checkout"]);
  assert.deepEqual(options(renderer, "rule-metricName").map((option) => option.value), ["", "checkout.metric"]); await unmount(renderer);
});

test("selector option values retain exact spaces and case without normalizing identities", async () => {
  const selected = []; const service = " Checkout ", metric = " Queue.Depth ";
  const dataSource = discovery({ services: async () => servicesResult([service, "checkout"]), metrics: async (value) => { assert.equal(value, service); return metricsResult(value, [descriptor(metric), descriptor("queue.depth")]); } });
  const renderer = await mountSelectors(dataSource, {}, { service: (value) => selected.push(value), metric: (value, expected) => selected.push([value, expected]) });
  await change(renderer, "rule-service", service); await change(renderer, "rule-metricName", metric);
  assert.deepEqual(selected, [service, [metric, service]]); assert.equal(control(renderer, "rule-service").props.value, service); assert.equal(control(renderer, "rule-metricName").props.value, metric);
  assert.ok(options(renderer, "rule-service").some((option) => option.value === service && option.label.includes('" Checkout "'))); await unmount(renderer);
});

test("existing unobserved identities remain pinned with current-selection and no-recent-data explanations", async () => {
  const service = " Legacy ", metric = " Old.Depth ";
  const renderer = await mountSelectors(discovery({ services: async () => servicesResult([]), metrics: async (value) => metricsResult(value, []) }), { service, metricName: metric, initialService: service, initialMetricName: metric });
  assert.equal(control(renderer, "rule-service").props.value, service); assert.equal(control(renderer, "rule-metricName").props.value, metric);
  assert.match(options(renderer, "rule-service").find((option) => option.value === service).label, /current selection/i);
  assert.match(options(renderer, "rule-metricName").find((option) => option.value === metric).label, /current selection/i);
  assert.match(content(renderer), /current choice is not in the recent list shown/i); assert.match(content(renderer), /does not mean the service or metric is unavailable/);
  assert.doesNotMatch(content(renderer), /Version 1|Version 2|v1 rule|v2 rule/); await unmount(renderer);
});

test("loading discovery disables choices and refresh without inventing fallback entries", async () => {
  const serviceRequest = deferred(), metricRequest = deferred();
  const renderer = await mountSelectors(discovery({ services: () => serviceRequest.promise, metrics: () => metricRequest.promise }), { service: "checkout" });
  assert.equal(control(renderer, "rule-service").props.disabled, true); assert.equal(control(renderer, "rule-metricName").props.disabled, true); assert.equal(button(renderer, "Refresh choices").props.disabled, true);
  assert.match(content(renderer), /Loading services/); assert.match(content(renderer), /Loading metrics for the selected service/);
  await act(async () => serviceRequest.resolve(servicesResult())); assert.equal(control(renderer, "rule-service").props.disabled, false); assert.equal(control(renderer, "rule-metricName").props.disabled, true);
  await act(async () => metricRequest.resolve(metricsResult("checkout"))); assert.equal(control(renderer, "rule-metricName").props.disabled, false); assert.equal(button(renderer, "Refresh choices").props.disabled, false); await unmount(renderer);
});

test("empty service and metric discovery shows honest empty states and performs no automatic retry", async () => {
  let serviceCalls = 0, metricCalls = 0;
  const renderer = await mountSelectors(discovery({ services: async () => { serviceCalls++; return servicesResult([]); }, metrics: async (service) => { metricCalls++; return metricsResult(service, []); } }), { service: "checkout", initialService: "checkout" });
  assert.match(content(renderer), /No metric readings were found for services/); assert.match(content(renderer), /No metric readings were found for this service/);
  assert.equal(serviceCalls, 1); assert.equal(metricCalls, 1); assert.equal(renderer.root.findAllByType("input").length, 0);
  await click(renderer, "Refresh choices"); assert.equal(serviceCalls, 2); assert.equal(metricCalls, 2); await unmount(renderer);
});

test("service discovery failure preserves selections and retries only through explicit refresh", async () => {
  let calls = 0; const renderer = await mountSelectors(discovery({ services: async () => { if (++calls === 1) throw new Error("private database error"); return servicesResult(); } }), { service: "checkout", metricName: "queue.depth", initialService: "checkout", initialMetricName: "queue.depth" });
  assert.equal(calls, 1); assert.match(content(renderer), /Services could not be loaded/); assert.doesNotMatch(content(renderer), /private database error/);
  assert.equal(control(renderer, "rule-service").props.value, "checkout"); assert.equal(control(renderer, "rule-service").props.disabled, true);
  await click(renderer, "Refresh choices"); assert.equal(calls, 2); assert.equal(control(renderer, "rule-service").props.disabled, false); await unmount(renderer);
});

test("metric discovery failure preserves current identity and has no silent retries", async () => {
  let calls = 0; const renderer = await mountSelectors(discovery({ metrics: async (service) => { if (++calls === 1) throw new Error("secret"); return metricsResult(service); } }), { service: "checkout", metricName: "queue.depth", initialService: "checkout", initialMetricName: "queue.depth" });
  assert.equal(calls, 1); assert.match(content(renderer), /Metrics could not be loaded/); assert.doesNotMatch(content(renderer), /secret/);
  assert.equal(control(renderer, "rule-metricName").props.value, "queue.depth"); assert.equal(control(renderer, "rule-metricName").props.disabled, true);
  await click(renderer, "Refresh choices"); assert.equal(calls, 2); assert.equal(control(renderer, "rule-metricName").props.disabled, false); await unmount(renderer);
});

test("forged unobserved choice events never change selected identities", async () => {
  const changed = []; const renderer = await mountSelectors(discovery(), { service: "checkout", metricName: "queue.depth" }, { service: (value) => changed.push(value), metric: (value) => changed.push(value) });
  await change(renderer, "rule-service", "fixture-service"); await change(renderer, "rule-metricName", "made.up.metric");
  assert.deepEqual(changed, []); assert.equal(control(renderer, "rule-service").props.value, "checkout"); assert.equal(control(renderer, "rule-metricName").props.value, "queue.depth"); await unmount(renderer);
});

test("service changes abort and ignore late old-service metric results", async () => {
  const oldRequest = deferred(); let oldSignal; const renderer = await mountSelectors(discovery({ metrics: (service, signal) => { if (service === "checkout") { oldSignal = signal; return oldRequest.promise; } return Promise.resolve(metricsResult(service, [descriptor("payment.depth")])); } }), { service: "checkout" });
  await change(renderer, "rule-service", "payment"); assert.equal(oldSignal.aborted, true);
  await act(async () => oldRequest.resolve(metricsResult("checkout", [descriptor("old-service.metric")])));
  assert.deepEqual(options(renderer, "rule-metricName").map((option) => option.value), ["", "payment.depth"]); assert.doesNotMatch(content(renderer), /old-service.metric/); await unmount(renderer);
});

test("wrong service echo becomes a safe metric-choice error rather than cross-service options", async () => {
  const renderer = await mountSelectors(discovery({ metrics: async () => metricsResult("payment", [descriptor("payment.private")]) }), { service: "checkout" });
  assert.match(content(renderer), /Metrics could not be loaded/); assert.equal(control(renderer, "rule-metricName").props.disabled, true); assert.doesNotMatch(content(renderer), /payment.private/); await unmount(renderer);
});

test("selected metric metadata explains mixed units counters missing units and truncated results", async () => {
  const renderer = await mountSelectors(discovery({ services: async () => servicesResult(undefined, { hasMore: true }), metrics: async (service) => metricsResult(service, [descriptor("queue.depth", { types: ["counter", "gauge"], units: ["ms", "s", ""], metadataTruncated: true })], { hasMore: true }) }), { service: "checkout", metricName: "queue.depth" });
  assert.match(content(renderer), /Different units were found/); assert.match(content(renderer), /Values are not converted/); assert.match(content(renderer), /running totals, not rates per second/); assert.match(content(renderer), /Some readings have no unit/);
  assert.match(content(renderer), /More metric types or units are available but are not shown/); assert.match(content(renderer), /This list does not show all services with metric readings/); assert.match(content(renderer), /This list does not show all metrics found/);
  assert.equal(control(renderer, "rule-metricName").props.value, "queue.depth"); await unmount(renderer);
});

test("changing service clears metric threshold and samples and ignores an aborted late sample response", async () => {
  const request = deferred(); let signal;
  const renderer = await mountForm({ sampleDataSource: { recent: (_applicationId, _service, _name, nextSignal) => { signal = nextSignal; return request.promise; } } });
  await click(renderer, "Check recent readings"); await change(renderer, "rule-service", "payment");
  assert.equal(signal.aborted, true); assert.equal(control(renderer, "rule-service").props.value, "payment"); assert.equal(control(renderer, "rule-metricName").props.value, ""); assert.equal(control(renderer, "rule-threshold").props.value, "");
  await act(async () => request.resolve({ data: [{ timestamp: window.to, service: "checkout", name: "queue.depth", type: "gauge", value: 987654, unit: "items" }], hasMore: false }));
  assert.doesNotMatch(content(renderer), /987654|readings loaded for checkout/); assert.equal(control(renderer, "rule-name").props.value, input.name); await unmount(renderer);
});

test("changing metric clears the threshold and previously displayed samples", async () => {
  const renderer = await mountForm({ discoveryDataSource: discovery({ metrics: async (service) => metricsResult(service, [descriptor(), descriptor("latency", { units: ["ms"] })]) }), sampleDataSource: { recent: async () => ({ data: [{ timestamp: window.to, service: "checkout", name: "queue.depth", type: "gauge", value: 987654, unit: "items" }], hasMore: false }) } });
  await click(renderer, "Check recent readings"); assert.match(content(renderer), /987654/);
  await change(renderer, "rule-metricName", "latency"); assert.equal(control(renderer, "rule-metricName").props.value, "latency"); assert.equal(control(renderer, "rule-threshold").props.value, "");
  assert.doesNotMatch(content(renderer), /987654|readings loaded for checkout/); await unmount(renderer);
});

test("a captured old-service metric handler cannot repopulate the metric after service changes", async () => {
  const renderer = await mountForm(); const staleMetricChange = control(renderer, "rule-metricName").props.onChange;
  await act(async () => { control(renderer, "rule-service").props.onChange({ target: { value: "payment" } }); staleMetricChange({ target: { value: "queue.depth" } }); });
  assert.equal(control(renderer, "rule-service").props.value, "payment"); assert.equal(control(renderer, "rule-metricName").props.value, ""); assert.equal(control(renderer, "rule-threshold").props.value, ""); await unmount(renderer);
});

test("Save changes opens inline confirmation and repeated form submits never confirm or duplicate a save", async () => {
  const saved = []; const renderer = await mountForm({ onSave: (value) => saved.push(value) });
  assert.ok(button(renderer, "Save changes")); assert.equal(button(renderer, "Confirm save"), undefined); assert.equal(renderer.root.findAllByProps({ type: "checkbox" }).length, 0);
  await submit(renderer); assert.equal(saved.length, 0);
  const confirmation = renderer.root.findByProps({ role: "group", "aria-label": "Confirm rule changes" });
  assert.equal(confirmation.props["aria-modal"], undefined); assert.match(content(renderer), /its alerts stay unchanged/); assert.ok(button(renderer, "Keep editing"));
  assert.equal(button(renderer, "Confirm save").props.type, "button");
  await submit(renderer); await submit(renderer); assert.equal(saved.length, 0);
  const confirmSave = button(renderer, "Confirm save").props.onClick; await act(async () => { confirmSave(); confirmSave(); });
  assert.equal(saved.length, 1); assert.deepEqual(saved[0], input); await unmount(renderer);
});

test("Escape and Keep editing close only confirmation preserve the draft and restore Save changes focus", async () => {
  const focused = []; let cancelled = 0;
  const createNodeMock = (element) => element.props.id ? { focus() { focused.push(element.props.id); } } : element.type === "button" && element.props.children === "Save changes" ? { focus() { focused.push("Save changes"); } } : null;
  const renderer = await mountForm({ onCancel() { cancelled++; }, onSave() { assert.fail("Cancelled confirmation must not save"); } }, createNodeMock);
  await change(renderer, "rule-name", "Kept draft"); focused.length = 0; await submit(renderer); assert.ok(focused.includes("rule-save-confirmation-title"));
  focused.length = 0; await act(async () => renderer.root.findByType("form").props.onKeyDown({ key: "Escape", preventDefault() {}, stopPropagation() {} }));
  assert.equal(button(renderer, "Confirm save"), undefined); assert.equal(control(renderer, "rule-name").props.value, "Kept draft"); assert.equal(cancelled, 0); assert.deepEqual(focused, ["Save changes"]);
  await submit(renderer); focused.length = 0; await click(renderer, "Keep editing");
  assert.equal(button(renderer, "Confirm save"), undefined); assert.equal(control(renderer, "rule-name").props.value, "Kept draft"); assert.equal(cancelled, 0); assert.deepEqual(focused, ["Save changes"]); await unmount(renderer);
});

test("changing a draft invalidates staged confirmation and primary controls avoid waiver and fake-version language", async () => {
  const saved = []; const renderer = await mountForm({ onSave: (value) => saved.push(value) });
  const staleThresholdChange = control(renderer, "rule-threshold").props.onChange;
  await submit(renderer); const staleConfirm = button(renderer, "Confirm save").props.onClick;
  await act(async () => staleThresholdChange({ target: { value: "0" } }));
  assert.equal(button(renderer, "Confirm save"), undefined); await act(async () => staleConfirm()); assert.equal(saved.length, 0);
  assert.equal(control(renderer, "rule-threshold").props.value, "0"); await submit(renderer); await click(renderer, "Confirm save"); assert.equal(saved.length, 1); assert.equal(saved[0].config.threshold, 0);
  assert.equal(renderer.root.findAllByProps({ type: "checkbox" }).length, 0); assert.doesNotMatch(content(renderer), /I understand and want|Version 1|Version 2|v1 rule|v2 rule/);
  const primaryLabels = renderer.root.findAllByType("button").map((node) => node.children.join("")).join(" "); assert.doesNotMatch(primaryLabels, /dev:stack|npm|worker|replacement/i);
  await unmount(renderer);
});

test("sample preview preserves raw unit spaces and warns rather than normalizing mixed units", async () => {
  const units = ["items", " items ", " "];
  const data = units.map((unit, index) => ({ timestamp: window.to, service: "checkout", name: "queue.depth", type: "gauge", value: index, unit }));
  const renderer = await mountForm({ sampleDataSource: { recent: async () => ({ data, hasMore: false }) } });
  await click(renderer, "Check recent readings");
  const paragraphs = renderer.root.findByProps({ "aria-label": "Recent metric readings" }).findAllByType("p").map((node) => node.children.join(""));
  const warning = paragraphs.find((paragraph) => paragraph.includes("Different units found")); assert.ok(warning, "Distinct raw units must retain the mixed-unit warning");
  assert.ok(warning.includes(JSON.stringify(" items ")), "Padded units must remain visibly quoted, not trimmed");
  assert.ok(warning.includes(JSON.stringify(" ")), "Whitespace-only units are present units, not missing data");
  assert.doesNotMatch(paragraphs.join(" "), /have no unit/); await unmount(renderer);
});

test("sample preview distinguishes literal unspecified unit from missing and empty units", async () => {
  const renderUnits = async (units) => {
    const data = units.map((unit, index) => ({ timestamp: window.to, service: "checkout", name: "queue.depth", type: "gauge", value: index, ...(unit === undefined ? {} : { unit }) }));
    const renderer = await mountForm({ sampleDataSource: { recent: async () => ({ data, hasMore: false }) } });
    await click(renderer, "Check recent readings");
    const paragraphs = renderer.root.findByProps({ "aria-label": "Recent metric readings" }).findAllByType("p").map((node) => node.children.join(""));
    return { renderer, paragraphs, text: paragraphs.join(" ") };
  };
  const literal = await renderUnits(["(unspecified)"]);
  assert.doesNotMatch(literal.text, /have no unit|Different units found/); await unmount(literal.renderer);
  const missing = await renderUnits([undefined, ""]);
  assert.match(missing.text, /have no unit/); assert.doesNotMatch(missing.text, /Different units found/); await unmount(missing.renderer);
  const distinct = await renderUnits(["(unspecified)", undefined, ""]);
  assert.match(distinct.text, /have no unit/);
  const warning = distinct.paragraphs.find((paragraph) => paragraph.includes("Different units found")); assert.ok(warning, "Literal unspecified and missing data are distinct units");
  assert.ok(warning.includes(JSON.stringify("(unspecified)"))); await unmount(distinct.renderer);
});

test("limited discovery preserves pinned identities without claiming absent samples and quotes exact unit labels", async () => {
  const service = " Legacy ", metricName = " Old.Depth ";
  const dataSource = discovery({
    services: async () => servicesResult(["checkout"], { hasMore: true }),
    metrics: async (value) => metricsResult(value, [descriptor("visible.metric", { units: [" items ", " ", ""] })], { hasMore: true }),
  });
  const renderer = await mountSelectors(dataSource, { service, metricName, initialService: service, initialMetricName: metricName });
  assert.equal(control(renderer, "rule-service").props.value, service); assert.equal(control(renderer, "rule-metricName").props.value, metricName);
  assert.match(options(renderer, "rule-service").find((option) => option.value === service).label, /current selection/i);
  assert.match(options(renderer, "rule-metricName").find((option) => option.value === metricName).label, /current selection/i);
  assert.match(content(renderer), /current choice is not in the recent list shown/i); assert.match(content(renderer), /list may show only part of the data/);
  assert.doesNotMatch(content(renderer), /No metric readings were found/); assert.match(content(renderer), /This list does not show all services with metric readings/); assert.match(content(renderer), /This list does not show all metrics found/);
  await change(renderer, "rule-metricName", "visible.metric");
  const displayedUnits = renderer.root.findAllByType("strong").map((node) => node.children.join(""));
  assert.ok(displayedUnits.includes(`${JSON.stringify(" items ")}, ${JSON.stringify(" ")}, (not provided)`), "Whitespace unit labels remain quoted; only the empty unit uses the not-provided label");
  assert.doesNotMatch(content(renderer), /No metric readings were found/); await unmount(renderer);
});
