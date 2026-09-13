import { randomUUID } from "node:crypto";
import { postgres } from "../config/postgres.js";

const baseUrl = "http://127.0.0.1:3000";
const marker = "Phase 10C lifecycle demo";
function demoConfig(id: string) {
  return {
    fingerprint: "phase10c:" + id, metricName: "phase10c_" + id, service: "phase10c-demo",
    operator: ">=", threshold: 1, windowMinutes: 5, recoveryWindowMinutes: 5, stalenessMinutes: 5,
  };
}
async function get(path: string) {
  const response = await fetch(baseUrl + path, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`GET ${path}: HTTP ${response.status}`);
  return response.json();
}

async function check(id: string) {
  const owned = await postgres.query(
    "SELECT a.id, a.status, a.acknowledged_at, a.resolved_at, i.finalized_at, i.window_to FROM alerts a JOIN alert_rules r ON r.id=a.rule_id JOIN alert_investigations i ON i.alert_id=a.id WHERE a.id=$1 AND r.name=$2 AND r.config->>'fingerprint'=$3",
    [id, marker, "phase10c:" + id],
  );
  if (owned.rows.length !== 1) throw new Error("Expected exactly one owned demo investigation.");
  const alert = await get("/v1/alerts/" + id);
  const investigation = await get("/v1/alerts/" + id + "/investigation");
  console.log(JSON.stringify({
    event: "phase10c_demo_checked", alertId: id, status: alert.status,
    acknowledgedAt: alert.acknowledgedAt ?? null, resolvedAt: alert.resolvedAt ?? null,
    persisted: owned.rows[0], window: investigation.window,
    candidateCount: investigation.causeCandidates.length,
    detailUrl: "http://localhost:5173/investigations/" + id + "?source=live&q=Phase+10C&status=firing",
  }));
}

try {
  const mode = process.argv[2];
  if (mode === "list") {
    const demos = await postgres.query(
      "SELECT a.id, a.status, a.created_at FROM alerts a JOIN alert_rules r ON r.id=a.rule_id WHERE r.name=$1 AND r.config->>'fingerprint'='phase10c:' || a.id::text ORDER BY a.created_at DESC",
      [marker],
    );
    console.log(JSON.stringify({ event: "phase10c_existing_demos", alerts: demos.rows }));
  } else if (mode === "prepare") {
    await get("/health");
    const id = randomUUID();
    const ruleId = randomUUID();
    const client = await postgres.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO alert_rules (id,name,type,enabled,config) VALUES ($1,$2,'metric_threshold',false,$3)",
        [ruleId, marker, JSON.stringify(demoConfig(id))],
      );
      await client.query(
        "INSERT INTO alerts (id,rule_id,status,title,message,service,started_at) VALUES ($1,$2,'firing',$3,$4,$5,CURRENT_TIMESTAMP)",
        [id, ruleId, marker + " (disposable)", "Disposable alert for acknowledge, cancel, resolve, and workspace acceptance checks. No telemetry was generated.", "phase10c-demo"],
      );
      await client.query(
        "INSERT INTO alert_investigations (alert_id,default_window_from) VALUES ($1,CURRENT_TIMESTAMP - interval '15 minutes')", [id],
      );
      await client.query("COMMIT");
      console.log(JSON.stringify({ event: "phase10c_demo_created", alertId: id, ruleId }));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
    await check(id);
  } else if (mode === "repair-rule" && /^[0-9a-f-]{36}$/i.test(process.argv[3] ?? "")) {
    const id = process.argv[3]!;
    const result = await postgres.query(
      "UPDATE alert_rules r SET type='metric_threshold', config=$4 WHERE r.id IN (SELECT rule_id FROM alerts WHERE id=$1) AND r.name=$2 AND r.config->>'fingerprint'=$3 AND r.enabled=false RETURNING r.id",
      [id, marker, "phase10c:" + id, JSON.stringify(demoConfig(id))],
    );
    if (result.rowCount !== 1) throw new Error("Expected exactly one owned disabled demo rule.");
    await check(id);
  } else if (mode === "check" && /^[0-9a-f-]{36}$/i.test(process.argv[3] ?? "")) {
    await check(process.argv[3]!);
  } else {
    throw new Error("Usage: verify-alert-lifecycle-demo.ts list | prepare | check <demo-alert-id> | repair-rule <demo-alert-id>");
  }
} finally { await postgres.end(); }
