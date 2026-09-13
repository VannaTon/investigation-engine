# Observability Platform

## Local Investigation MVP v0.1

Investigate real telemetry using deterministic candidate ranking, linked
findings, and supporting traces, metrics, and logs. AI explanations are optional;
they do not determine ranking or replace evidence.

- [Local runbook and supported behavior](docs/LOCAL_MVP_RUNBOOK.md)
- [MVP roadmap and acceptance checklist](docs/LOCAL_INVESTIGATION_MVP.md)
- [Phase 12 workflow acceptance record](docs/PHASE_12_WORKFLOW_ACCEPTANCE.md)
- [Phase 13 release closeout and open gates](docs/PHASE_13_RELEASE_CLOSEOUT.md)
- [Frontend API integration](frontend/docs/API_INTEGRATION.md)

Phase 11A-11C implementation and automated coverage are present. Browser
acceptance remains open; Phase 12 has a historical real three-signal verification
but not a completed full-workflow signoff. Phase 13 documentation and final
automated checks are prepared. This is **not yet a completed release**.

For an already-initialized WSL workspace, use `npm run dev:stack` from `backend`,
then open `http://localhost:5173`. Follow the runbook prerequisites first:
fresh empty-database bootstrap is an explicit open release gate.

No automatic Phase 14 follows closure. New features require a separately chosen
roadmap; see the deferred scope in the MVP checklist.
