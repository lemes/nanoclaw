# v1 → v2 Migration Record — 2026-06-14

Final state of `logs/setup-migration/handoff.json` at completion of `/migrate-from-v1`.
See also: docs/v2-migration-followups.md (remaining integration work) and
docs/v1-fork-reference/dropped-swarm-groups/ (archived swarm groups).

```json
{
  "version": 1,
  "started_at": "2026-06-14T13:23:32Z",
  "v1_path": "/Users/vin/code/nanoclaw",
  "v1_version": "1.2.42",
  "overall_status": "complete",
  "completed_at": "2026-06-14T15:57:00Z",
  "skill_phases": "Phase 0 (telegram install fix + onecli upgrade + smoke test), Phase 1 (owner + strict policy + Yasmin member), Phase 2 (CLAUDE.local.md cleanup + Greg identity), Phase 3 (container.json gcloud mount validated), Phase 4 (per v2-migration-plan: dropped swarm groups, kept-Nango/Gmail-tool-only FIXMEs, follow-ups doc). Verify: success, 3 groups.",
  "swarm_dropped": "telegram_swarm + telegram_yasmin-swarm removed (agent+messaging groups, wirings) per plan 7B.2; folders archived to docs/v1-fork-reference/dropped-swarm-groups/.",
  "followups_doc": "docs/v2-migration-followups.md (Nango host-alias, Gmail tool install, TREK MCP, skill/voice, Kivra ipc trigger)",
  "aborted_at": "",
  "source": "migrate-v2.sh",
  "channels_installed": ["telegram"],
  "onecli_healthy": true,
  "service_switched": true,
  "smoke_test": "passed 2026-06-14: telegram message routed -> container spawned -> reply delivered",
  "onecli_upgraded": "gateway+CLI were stale v1.2.1 (served /api/agents); upgraded to pinned gateway 1.36.0 / cli 2.2.5 (serves /v1/agents) via setup --step onecli. Was the real cause of no-reply; onecli_healthy=true only checked CLI, not SDK API path.",
  "steps": {"1a-env": {"status": "success", "log": "logs/migrate-steps/1a-env.log"},"1b-db": {"status": "success", "log": "logs/migrate-steps/1b-db.log"},"1c-groups": {"status": "success", "log": "logs/migrate-steps/1c-groups.log"},"1d-sessions": {"status": "success", "log": "logs/migrate-steps/1d-sessions.log"},"1e-tasks": {"status": "success", "log": "logs/migrate-steps/1e-tasks.log"},"2b-channel-auth": {"status": "success", "log": "logs/migrate-steps/2b-channel-auth.log"},"2c-install-telegram": {"status": "fixed_in_skill", "log": "logs/migrate-steps/2c-install-telegram.log", "note": "migrate-v2.sh used origin (fork lemes/nanoclaw, no channels branch); reinstalled from upstream/channels. Bumped root chat dep ^4.24.0 -> ^4.27.0 to match adapter 4.27.0. Build + registration test green."},"3c-auth": {"status": "success", "log": "logs/migrate-steps/3c-auth.log"},"3e-build": {"status": "success", "log": "logs/migrate-steps/3e-build.log"}},
  "step_logs_dir": "logs/migrate-steps",
  "followups": [
    "Seed owner user and access policy",
    "Review CLAUDE.local.md files for v1-specific patterns",
    "Verify container.json mount paths are valid"
  ]
}

```
