import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Writable } from 'node:stream';
import Fastify from 'fastify';
import { postgres } from '../config/postgres.ts';
import { buildNarrativeContext } from '../services/investigation-narrative-context.service.ts';
import { GenericLlmNarrativeGenerator } from '../services/generic-llm-narrative-generator.service.ts';
import { InvestigationNarrativeService } from '../services/investigation-narrative.service.ts';
import { alertRoutes } from '../routes/alert.routes.ts';

const id = 'ac77f875-c18d-4c92-9ba4-4a5540744679';
const api = 'http://127.0.0.1:3000';
const report = (event, fields = {}) => console.log(JSON.stringify({ event, ...fields }));
const investigationResponse = await fetch(`${api}/v1/alerts/${id}/investigation`, { signal: AbortSignal.timeout(20000) });
assert.equal(investigationResponse.status, 200);
const investigation = await investigationResponse.json();
const context = buildNarrativeContext(investigation);
report('live_evidence', { alertId: id, candidates: context.candidates.map(c => ({ service: c.service, rank: c.rank })), findings: context.findings.length });

// The isolated server never receives credentials or writes snapshots.
let mode = 'http';
let calls = 0;
const valid = {
  summary: { text: 'Investigation evidence is available for review.', findingIds: context.findings.slice(0, 1).map(f => f.findingId), signalIds: [] },
  candidates: context.candidates.map(c => ({ candidateId: c.candidateId, text: `Evidence for ${c.service} is available for review.`, findingIds: c.findingIds, signalIds: c.signalIds })),
};
const provider = createServer((req, res) => {
  calls++;
  req.resume();
  if (mode === 'timeout') return;
  if (mode === 'body_timeout') { res.writeHead(200, { 'content-type': 'application/json' }); res.write('{'); return; }
  if (mode === 'http') { res.writeHead(503); res.end('PRIVATE_PROVIDER_BODY'); return; }
  if (mode === 'invalid_response') { res.end('PRIVATE_INVALID_JSON'); return; }
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ choices: [{ message: { content: mode === 'invalid_output' ? 'PRIVATE_MODEL_OUTPUT' : JSON.stringify(valid) } }] }));
});
await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
const logs = [];
const app = Fastify({ logger: { level: 'warn', stream: new Writable({ write(chunk, _encoding, done) { logs.push(chunk.toString()); done(); } }) } });
const generator = new GenericLlmNarrativeGenerator({ baseUrl: `http://127.0.0.1:${provider.address().port}/v1`, model: 'isolated-test', requestTimeoutMs: 200 });
const service = new InvestigationNarrativeService(generator);
await app.register(alertRoutes, { alertService: {}, alertInvestigationService: {}, getNarrativeService: () => ({ async generate() { return { evidenceCutoff: investigation.window.to, generatedAt: new Date().toISOString(), contextHash: 'a'.repeat(64), narrative: await service.generate(context) }; } }) });
try {
  for (const [scenario, status, code, kind] of [
    ['http', 503, 'NARRATIVE_PROVIDER_UNAVAILABLE', 'http'],
    ['timeout', 503, 'NARRATIVE_PROVIDER_TIMEOUT', 'timeout'],
    ['body_timeout', 503, 'NARRATIVE_PROVIDER_TIMEOUT', 'timeout'],
    ['invalid_response', 502, 'NARRATIVE_PROVIDER_INVALID_RESPONSE', 'invalid_response'],
    ['invalid_output', 502, 'NARRATIVE_INVALID_OUTPUT', 'invalid_output'],
  ]) {
    mode = scenario;
    const before = calls;
    const response = await app.inject({ method: 'POST', url: `/v1/alerts/${id}/investigation/narrative` });
    assert.equal(response.statusCode, status);
    assert.equal(response.json().error.code, code);
    assert.doesNotMatch(response.body, /PRIVATE_/);
    assert.equal(calls, before + 1);
    assert.ok(logs.join('').split('\n').filter(Boolean).map(JSON.parse).some(l => l.providerFailureKind === kind));
    report('isolated_failure_pass', { scenario, status, code, requests: calls - before });
  }
  const beforeRetry = calls;
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(calls, beforeRetry);
  mode = 'success';
  const retry = await app.inject({ method: 'POST', url: `/v1/alerts/${id}/investigation/narrative` });
  assert.equal(retry.statusCode, 200, retry.body);
  assert.equal(calls, beforeRetry + 1);
  report('isolated_explicit_retry_pass', { requests: 1, automaticRetries: 0 });
} finally {
  await app.close();
  provider.closeAllConnections();
  await new Promise(resolve => provider.close(resolve));
}

// Read metadata only; call the live API once, without deleting/bypassing cache.
if (!process.argv.includes('--live')) {
  report('live_request_skipped', { reason: 'Use --live only with approval to send investigation evidence to the configured provider.' });
  await postgres.end();
} else {
const query = `SELECT n.context_hash, n.generation_config_hash, n.generated_at FROM investigation_narratives n JOIN alert_investigations i ON i.id = n.alert_investigation_id WHERE i.alert_id = $1`;
try {
  const before = (await postgres.query(query, [id])).rows;
  report('live_request_started', { alertId: id, existingSnapshots: before.length });
  const start = performance.now();
  const response = await fetch(`${api}/v1/alerts/${id}/investigation/narrative`, { method: 'POST', signal: AbortSignal.timeout(210000) });
  const elapsedMs = Math.round(performance.now() - start);
  const payload = await response.json();
  const after = (await postgres.query(query, [id])).rows;
  if (response.ok) {
    const previouslyStored = before.some(row => row.context_hash === payload.contextHash && new Date(row.generated_at).toISOString() === payload.generatedAt);
    const persisted = after.some(row => row.context_hash === payload.contextHash && new Date(row.generated_at).toISOString() === payload.generatedAt);
    report('live_request_result', { status: response.status, elapsedMs, source: previouslyStored ? 'existing_snapshot' : 'newly_generated_snapshot', persisted, generatedAt: payload.generatedAt, snapshotCountBefore: before.length, snapshotCountAfter: after.length });
    assert.ok(persisted);
  } else {
    report('live_request_result', { status: response.status, elapsedMs, code: payload.error?.code ?? 'UNCLASSIFIED', snapshotCountBefore: before.length, snapshotCountAfter: after.length });
  }
  const evidence = await fetch(`${api}/v1/alerts/${id}/investigation`, { signal: AbortSignal.timeout(20000) });
  assert.equal(evidence.status, 200);
  report('live_evidence_remains_available', { status: evidence.status });
} finally { await postgres.end(); }
}
