import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.document = { title: "", body: { style: {} }, getElementById: () => null };
const vite = await createServer({ root: process.cwd(), appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
test.after(async () => { await vite.close(); });
const { AlertRulesPage } = await vite.ssrLoadModule("/src/pages/AlertRulesPage.tsx");
const { AlertRuleForm, validateRuleForm } = await vite.ssrLoadModule("/src/components/AlertRuleForm.tsx");
const { RuleRequestError } = await vite.ssrLoadModule("/src/data/alertRuleDataSource.ts");
const { AppShell } = await vite.ssrLoadModule("/src/components/AppShell.tsx");
const { isAlertRulesPath, isInvestigationListPath, alertIdFromPath } = await vite.ssrLoadModule("/src/App.tsx");
const applicationId = "00000000-0000-4000-8000-000000000001";
const application = { id: applicationId, name: "Checkout application", status: "active", createdAt: "2026-09-13T00:00:00.000Z", updatedAt: "2026-09-13T00:00:00.000Z" };
const applications = [application];
const config = { service: "checkout-service", metricName: "queue.depth", operator: ">", threshold: 100, windowMinutes: 5, recoveryWindowMinutes: 3, stalenessMinutes: 1 };
const input = { applicationId, name: "Checkout queue", config };
const rule = (id = "old", overrides = {}) => ({ id, applicationId, name: input.name, type: "metric_threshold", enabled: true, config: { ...config }, createdAt: "2026-09-13T00:00:00.000Z", updatedAt: "2026-09-13T00:00:00.000Z", ...overrides });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const text = (renderer) => JSON.stringify(renderer.toJSON());
const button = (renderer, label) => renderer.root.findAllByType("button").find((node) => node.props["aria-label"] === label || node.children.join("") === label);
const sampleSource = { recent: async () => ({ data: [], hasMore: false }) };
const discoveryWindow = { from: "2026-09-12T00:00:00.000Z", to: "2026-09-13T00:00:00.000Z" };
const discoverySource = {
  services: async () => ({ data: [config.service, "new-service"], hasMore: false, window: discoveryWindow }),
  metrics: async (_applicationId, service) => ({ service, data: [{ name: config.metricName, types: ["gauge"], units: ["items"],
    lastSeen: discoveryWindow.to, metadataTruncated: false }], hasMore: false, window: discoveryWindow }),
};
const source = (overrides = {}) => ({ list: async () => [rule()], get: async (id) => rule(id), editContext: async () => ({ rule: rule(), revisionToken: "a".repeat(64) }), create: async () => rule("new", { enabled: false }), replace: async () => ({ previousRuleId: "old", replacement: rule("new", { enabled: false }) }), setEnabled: async (id, enabled) => rule(id, { enabled }), ...overrides });
const applicationSource = { list: async () => applications };
const mountPage = async (dataSource = source()) => { let renderer; await act(async () => { renderer = TestRenderer.create(React.createElement(AlertRulesPage, { dataSource, applicationDataSource: applicationSource, sampleDataSource: sampleSource, discoveryDataSource: discoverySource })); }); return renderer; };
const change = async (renderer, id, value) => { await act(async () => { renderer.root.findByProps({ id }).props.onChange({ target: { value } }); }); };
const submit = async (renderer) => { await act(async () => { renderer.root.findByType("form").props.onSubmit({ preventDefault() {} }); }); };
const unmount = async (renderer) => { await act(async () => renderer.unmount()); };

test("rule route is distinct and existing investigation path helpers remain unchanged", () => {
  assert.equal(isAlertRulesPath("/alert-rules"), true); assert.equal(isAlertRulesPath("/alert-rules/"), true);
  assert.equal(isAlertRulesPath("/alert-rules/x"), false); assert.equal(isInvestigationListPath("/alert-rules"), false);
  assert.equal(alertIdFromPath("/alert-rules"), null); assert.equal(alertIdFromPath("/investigations/a%20b"), "a b");
});

test("rule shell has active product navigation and no investigation or fixture controls", () => {
  const html = renderToStaticMarkup(React.createElement(AppShell, { activeProduct: "alert-rules", showInvestigationNavigation: false, pageTitle: "Alert rule management", investigationHref: "/investigations?q=test", currentAlertId: null, onSelectFixture() {}, children: "Rules" }));
  assert.match(html, /href="\/alert-rules"[^>]*aria-current="page"/);
  assert.match(html, /Skip to alert rules/); assert.match(html, /Alert rule management/);
  assert.doesNotMatch(html, /aria-label="Investigation sections"/); assert.doesNotMatch(html, /aria-label="Select investigation fixture"/);
  const legacy = renderToStaticMarkup(React.createElement(AppShell, { investigationHref: "/investigations", currentAlertId: null, onSelectFixture() {}, children: "Existing" }));
  assert.match(legacy, /Skip to investigation/); assert.match(legacy, /aria-label="Investigation sections"/);
});

test("form validation permits zero, negative and fractional minutes but rejects unsafe inputs", () => {
  const valid = { applicationId, name: "Rule", service: " checkout ", metricName: "queue", operator: ">=", threshold: "0", windowMinutes: "0.5", recoveryWindowMinutes: "3", stalenessMinutes: "1" };
  assert.deepEqual(validateRuleForm(valid), {}); assert.deepEqual(validateRuleForm({ ...valid, threshold: "-2.5" }), {});
  for (const value of ["", "NaN", "Infinity", "1e309"]) assert.ok(validateRuleForm({ ...valid, threshold: value }).threshold);
  for (const value of ["0", "-1", "Infinity", ""]) assert.ok(validateRuleForm({ ...valid, windowMinutes: value }).windowMinutes);
  assert.ok(validateRuleForm({ ...valid, service: "  " }).service); assert.ok(validateRuleForm({ ...valid, name: "x".repeat(256) }).name);
  assert.ok(validateRuleForm({ ...valid, operator: "==" }).operator);
});

test("form preserves exact identities and advanced fields and requires replacement confirmation", async () => {
  const saved = []; let renderer;
  const initial = { applicationId, name: " Existing ", config: { ...config, service: " checkout ", metricName: " queue.depth ", windowMinutes: 2.5, recoveryWindowMinutes: 7.25, stalenessMinutes: 0.75 } };
  await act(async () => { renderer = TestRenderer.create(React.createElement(AlertRuleForm, { applications, initial, editing: true, busy: false, sampleDataSource: sampleSource, discoveryDataSource: discoverySource, onSave: (value) => saved.push(value), onCancel() {} })); });
  await change(renderer, "rule-threshold", "0"); await submit(renderer); assert.equal(saved.length, 0); assert.match(text(renderer), /Save these changes/);
  await act(async () => button(renderer, "Confirm save").props.onClick());
  assert.equal(saved.length, 1); assert.deepEqual(saved[0], { applicationId, name: initial.name, config: { ...initial.config, threshold: 0 } });
  assert.match(text(renderer), /past alerts/); assert.equal(renderer.root.findAllByProps({ type: "checkbox" }).length, 0); await unmount(renderer);
});

test("recent sample check is explicit and warns about counters mixed units and limited data", async () => {
  let calls = 0, renderer;
  const samples = [{ timestamp: "2026-09-13T00:00:00.000Z", service: config.service, name: config.metricName, type: "counter", value: 200, unit: "ms" }, { timestamp: "2026-09-13T00:00:01.000Z", service: config.service, name: config.metricName, type: "gauge", value: 2 }, { timestamp: "2026-09-13T00:00:02.000Z", service: config.service, name: config.metricName, type: "gauge", value: 0.2, unit: "s" }];
  await act(async () => { renderer = TestRenderer.create(React.createElement(AlertRuleForm, { applications, initial: input, busy: false, discoveryDataSource: discoverySource, sampleDataSource: { recent: async (receivedApplicationId, service, name) => { calls++; assert.equal(receivedApplicationId, applicationId); assert.equal(service, config.service); assert.equal(name, config.metricName); return { data: samples, hasMore: true }; } }, onSave() {}, onCancel() {} })); });
  assert.equal(calls, 0); await act(async () => button(renderer, "Check recent readings").props.onClick());
  assert.equal(calls, 1); assert.match(text(renderer), /running totals, not rates per second/); assert.match(text(renderer), /Different units found/); assert.match(text(renderer), /have no unit/); assert.match(text(renderer), /shows only part of them/); assert.match(text(renderer), /some readings may be old/); await unmount(renderer);
});

test("empty and failed recent sample results do not invent a metric catalog", async () => {
  let renderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(AlertRuleForm, { applications, initial: input, busy: false, sampleDataSource: sampleSource, discoveryDataSource: discoverySource, onSave() {}, onCancel() {} })); });
  await act(async () => button(renderer, "Check recent readings").props.onClick()); assert.match(text(renderer), /does not prove the metric is missing/); await unmount(renderer);
  await act(async () => { renderer = TestRenderer.create(React.createElement(AlertRuleForm, { applications, initial: input, busy: false, discoveryDataSource: discoverySource, sampleDataSource: { recent: async () => { throw new Error("private error"); } }, onSave() {}, onCancel() {} })); });
  await act(async () => button(renderer, "Check recent readings").props.onClick()); assert.match(text(renderer), /can still save the rule disabled/); assert.doesNotMatch(text(renderer), /private error/); await unmount(renderer);
});

test("changing sample identity aborts and ignores a late sample response", async () => {
  const request = deferred(); let signal, renderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(AlertRuleForm, { applications, initial: input, busy: false, discoveryDataSource: discoverySource, sampleDataSource: { recent: (_applicationId, _service, _name, nextSignal) => { signal = nextSignal; return request.promise; } }, onSave() {}, onCancel() {} })); });
  await act(async () => { button(renderer, "Check recent readings").props.onClick(); }); await change(renderer, "rule-service", "new-service"); assert.equal(signal.aborted, true);
  await act(async () => request.resolve({ data: [{ timestamp: "2026-09-13T00:00:00.000Z", type: "counter", value: 999 }], hasMore: false })); assert.doesNotMatch(text(renderer), /999/); await unmount(renderer);
});

test("empty rule list offers disabled creation and successful save is not enabled automatically", async () => {
  const calls = []; const renderer = await mountPage(source({ list: async () => [], create: async (value) => { calls.push(value); return rule("new", { enabled: false }); } }));
  assert.match(text(renderer), /No alert rules yet/); await act(async () => button(renderer, "New rule").props.onClick());
  assert.match(text(renderer), /Create rule/); await act(async () => renderer.root.findByType(AlertRuleForm).props.onSave(input));
  assert.deepEqual(calls, [input]); assert.match(text(renderer), /Rule saved\. It is disabled\./); assert.match(text(renderer), /Enable/); assert.equal(renderer.root.findAllByType(AlertRuleForm).length, 0); await unmount(renderer);
});

test("replacement uses current revision token and leaves old config and alerts unchanged", async () => {
  const old = rule(); const original = structuredClone(old); const calls = [];
  const renderer = await mountPage(source({ list: async () => [old], editContext: async () => ({ rule: old, revisionToken: "b".repeat(64) }), replace: async (...args) => { calls.push(args); return { previousRuleId: "old", replacement: rule("new", { enabled: false, config: { ...config, threshold: 0 } }) }; } }));
  await act(async () => button(renderer, `Edit rule: ${old.name} (old)`).props.onClick()); assert.equal(renderer.root.findByType(AlertRuleForm).props.editing, true);
  await act(async () => renderer.root.findByType(AlertRuleForm).props.onSave({ ...input, config: { ...config, threshold: 0 } }));
  assert.equal(calls.length, 1); assert.equal(calls[0][0], "old"); assert.equal(calls[0][2], "b".repeat(64)); assert.deepEqual(old, original);
  assert.match(text(renderer), /Changes saved\. The updated rule is disabled\./); assert.equal(button(renderer, `Enable rule: ${old.name} (old)`).props.disabled, false); assert.equal(button(renderer, `Enable rule: ${old.name} (new)`).props.disabled, false); await unmount(renderer);
});

test("cancelling edit-context loading aborts and ignores late edit data", async () => {
  const request = deferred(); let signal; const renderer = await mountPage(source({ editContext: (_id, nextSignal) => { signal = nextSignal; return request.promise; } }));
  await act(async () => { button(renderer, `Edit rule: ${input.name} (old)`).props.onClick(); }); assert.match(text(renderer), /Loading current rule settings/);
  await act(async () => button(renderer, "Cancel").props.onClick()); assert.equal(signal.aborted, true);
  await act(async () => request.resolve({ rule: rule(), revisionToken: "a".repeat(64) })); assert.equal(renderer.root.findAllByType(AlertRuleForm).length, 0); await unmount(renderer);
});

test("write lock prevents double-submit and does not report success before confirmation", async () => {
  const request = deferred(); let calls = 0; const renderer = await mountPage(source({ create: () => { calls++; return request.promise; } }));
  await act(async () => button(renderer, "New rule").props.onClick()); const save = renderer.root.findByType(AlertRuleForm).props.onSave;
  await act(async () => { save(input); save(input); }); assert.equal(calls, 1); assert.match(text(renderer), /Saving\. Please wait/); assert.doesNotMatch(text(renderer), /Rule saved\. It is disabled\./); assert.equal(button(renderer, "Cancel").props.disabled, true);
  await act(async () => request.resolve(rule("new", { enabled: false }))); assert.match(text(renderer), /Rule saved\. It is disabled\./); await unmount(renderer);
});

test("uncertain create is never retried and requires manual refresh plus explicit review", async () => {
  let saves = 0, lists = 0; const renderer = await mountPage(source({ list: async () => { lists++; return lists === 1 ? [] : [rule("possibly-saved", { enabled: false })]; }, create: async () => { saves++; throw new RuleRequestError("uncertain"); } }));
  await act(async () => button(renderer, "New rule").props.onClick()); await act(async () => renderer.root.findByType(AlertRuleForm).props.onSave(input));
  assert.equal(saves, 1); assert.equal(lists, 1); assert.equal(button(renderer, "New rule").props.disabled, true); assert.match(text(renderer), /may already be saved/);
  await act(async () => button(renderer, "Refresh rules").props.onClick()); assert.equal(lists, 2); assert.equal(saves, 1); assert.equal(button(renderer, "New rule").props.disabled, true);
  await act(async () => button(renderer, "I reviewed the latest rule list").props.onClick()); assert.equal(button(renderer, "New rule").props.disabled, false); assert.equal(saves, 1); await unmount(renderer);
});

test("stale replacement conflicts close editor without retrying stale token", async () => {
  let saves = 0; const renderer = await mountPage(source({ replace: async () => { saves++; throw new RuleRequestError("conflict"); } }));
  await act(async () => button(renderer, `Edit rule: ${input.name} (old)`).props.onClick()); await act(async () => renderer.root.findByType(AlertRuleForm).props.onSave(input));
  assert.equal(saves, 1); assert.equal(renderer.root.findAllByType(AlertRuleForm).length, 0); assert.match(text(renderer), /Refresh and choose Edit again/); await unmount(renderer);
});

test("uncertain toggle fetches latest actual state once without retrying update", async () => {
  let writes = 0, gets = 0; const renderer = await mountPage(source({ setEnabled: async () => { writes++; throw new RuleRequestError("uncertain"); }, get: async () => { gets++; return rule("old", { enabled: false }); } }));
  await act(async () => button(renderer, `Disable rule: ${input.name} (old)`).props.onClick());
  assert.equal(writes, 1); assert.equal(gets, 1); assert.match(text(renderer), /latest rule is disabled/); assert.ok(button(renderer, `Enable rule: ${input.name} (old)`)); await unmount(renderer);
});

test("refresh failure keeps previously fetched rules visible and disables stale row writes", async () => {
  let lists = 0; const renderer = await mountPage(source({ list: async () => { lists++; if (lists > 1) throw new RuleRequestError("unavailable"); return [rule()]; } }));
  await act(async () => button(renderer, "Refresh rules").props.onClick()); assert.match(text(renderer), /earlier rule list is still visible/); assert.match(text(renderer), /Checkout queue/); assert.equal(button(renderer, `Edit rule: ${input.name} (old)`).props.disabled, true); assert.equal(button(renderer, "New rule").props.disabled, true); await unmount(renderer);
});

test("invalid form submit focuses the first invalid field and edit confirmation heading", async () => {
  const focused = []; let renderer;
  const advancedDetails = { open: false };
  const createNodeMock = (element) => element.type === "details" ? advancedDetails : element.props.id ? { focus: () => { if (element.props.id === "rule-recoveryWindowMinutes") assert.equal(advancedDetails.open, true); focused.push(element.props.id); } } : null;
  await act(async () => { renderer = TestRenderer.create(React.createElement(AlertRuleForm, { applications, initial: input, busy: false, sampleDataSource: sampleSource, discoveryDataSource: discoverySource, onSave() { assert.fail("Invalid form must not save"); }, onCancel() {} }), { createNodeMock }); });
  focused.length = 0; await change(renderer, "rule-name", " "); await change(renderer, "rule-service", ""); await submit(renderer); assert.deepEqual(focused, ["rule-name"]);
  focused.length = 0; await change(renderer, "rule-name", "Valid"); await submit(renderer); assert.deepEqual(focused, ["rule-service"]);
  focused.length = 0; await change(renderer, "rule-service", config.service); await change(renderer, "rule-metricName", config.metricName); await change(renderer, "rule-threshold", "Infinity"); await submit(renderer); assert.deepEqual(focused, ["rule-threshold"]);
  focused.length = 0; await change(renderer, "rule-threshold", "100"); await change(renderer, "rule-recoveryWindowMinutes", "0"); await submit(renderer); assert.deepEqual(focused, ["rule-recoveryWindowMinutes"]); assert.equal(advancedDetails.open, true); await unmount(renderer);
  await act(async () => { renderer = TestRenderer.create(React.createElement(AlertRuleForm, { applications, initial: input, editing: true, busy: false, sampleDataSource: sampleSource, discoveryDataSource: discoverySource, onSave() { assert.fail("Unconfirmed replacement must not save"); }, onCancel() {} }), { createNodeMock }); });
  focused.length = 0; await submit(renderer); assert.deepEqual(focused, ["rule-save-confirmation-title"]); assert.equal(renderer.root.findAllByProps({ type: "checkbox" }).length, 0); await unmount(renderer);
});

test("cancel and confirmed save restore New opener focus after controls become enabled", async () => {
  const focusEvents = []; const request = deferred(); let renderer;
  const openingControl = { isConnected: true, get disabled() { return button(renderer, "New rule").props.disabled; }, focus() { focusEvents.push({ target: "new", disabled: this.disabled }); } };
  const createNodeMock = (element) => element.type === "h1" ? { focus() { focusEvents.push({ target: "heading" }); } } : element.type === "button" && element.props.children === "New rule" ? openingControl : null;
  await act(async () => { renderer = TestRenderer.create(React.createElement(AlertRulesPage, { dataSource: source({ create: () => request.promise }), applicationDataSource: applicationSource, sampleDataSource: sampleSource, discoveryDataSource: discoverySource }), { createNodeMock }); });
  await act(async () => button(renderer, "New rule").props.onClick({ currentTarget: openingControl })); await act(async () => button(renderer, "Cancel").props.onClick()); assert.deepEqual(focusEvents, [{ target: "new", disabled: false }]);
  focusEvents.length = 0; await act(async () => button(renderer, "New rule").props.onClick({ currentTarget: openingControl })); await act(async () => { renderer.root.findByType(AlertRuleForm).props.onSave(input); }); assert.deepEqual(focusEvents, []);
  await act(async () => request.resolve(rule("new", { enabled: false }))); assert.deepEqual(focusEvents, [{ target: "new", disabled: false }]); await unmount(renderer);
});

test("edit cancellation restores Edit opener and uncertain save uses heading fallback", async () => {
  const focused = []; let renderer;
  const editOpener = { isConnected: true, get disabled() { return button(renderer, `Edit rule: ${input.name} (old)`).props.disabled; }, focus() { focused.push({ target: "edit", disabled: this.disabled }); } };
  const createNodeMock = (element) => element.type === "h1" ? { focus() { focused.push({ target: "heading" }); } } : null;
  await act(async () => { renderer = TestRenderer.create(React.createElement(AlertRulesPage, { dataSource: source({ replace: async () => { throw new RuleRequestError("uncertain"); } }), applicationDataSource: applicationSource, sampleDataSource: sampleSource, discoveryDataSource: discoverySource }), { createNodeMock }); });
  await act(async () => button(renderer, `Edit rule: ${input.name} (old)`).props.onClick({ currentTarget: editOpener })); await act(async () => button(renderer, "Cancel").props.onClick()); assert.deepEqual(focused, [{ target: "edit", disabled: false }]);
  focused.length = 0; await act(async () => button(renderer, `Edit rule: ${input.name} (old)`).props.onClick({ currentTarget: editOpener })); await act(async () => renderer.root.findByType(AlertRuleForm).props.onSave(input)); assert.deepEqual(focused, [{ target: "heading" }]); assert.equal(button(renderer, `Edit rule: ${input.name} (old)`).props.disabled, true); await unmount(renderer);
});

test("a stale submit captured before explicit refresh cannot dispatch a save", async () => {
  const refreshRequest = deferred(); let lists = 0, saves = 0;
  const renderer = await mountPage(source({ list: () => ++lists === 1 ? Promise.resolve([]) : refreshRequest.promise, create: async () => { saves++; return rule("new", { enabled: false }); } }));
  await act(async () => button(renderer, "New rule").props.onClick()); const staleSave = renderer.root.findByType(AlertRuleForm).props.onSave;
  await act(async () => { button(renderer, "Refresh rules").props.onClick(); staleSave(input); }); assert.equal(saves, 0); assert.match(text(renderer), /Refreshing/); assert.equal(button(renderer, "New rule").props.disabled, true);
  await act(async () => refreshRequest.resolve([])); assert.equal(saves, 0); assert.equal(renderer.root.findAllByType(AlertRuleForm).length, 0); await unmount(renderer);
});

test("unsupported legacy types are read-only and malformed metric rules can only be disabled", async () => {
  const renderer = await mountPage(source({ list: async () => [rule("other", { type: "log_pattern" }), rule("bad-on", { config: {} }), rule("bad-off", { config: {}, enabled: false })] }));
  assert.match(text(renderer), /rule can only be viewed here/); assert.equal(button(renderer, `Disable rule: ${input.name} (other)`), undefined);
  assert.equal(button(renderer, `Disable rule: ${input.name} (bad-on)`).props.disabled, false); assert.equal(button(renderer, `Enable rule: ${input.name} (bad-off)`).props.disabled, true); assert.equal(renderer.root.findAllByType("button").filter((node) => node.children.join("") === "Edit").length, 0); await unmount(renderer);
});

test("unmount aborts active list request and no late result is rendered", async () => {
  const request = deferred(); let signal;
  const renderer = await mountPage(source({ list: (nextSignal) => { signal = nextSignal; return request.promise; } }));
  assert.match(text(renderer), /Loading alert rules/); await unmount(renderer); assert.equal(signal.aborted, true); await act(async () => request.resolve([rule()]));
});
