# Copy as-is — no code merge risk

All of these can be copied verbatim from the main tree into the fresh checkout/worktree (`cp -r`). None depend on any other file in this diff. Do this step last, after skills and source customizations are in place.

## Custom container skills (`container/skills/`)

Migrated from the v1 install, not from any upstream `/add-*` skill. Each is a self-contained `SKILL.md`:

| Skill | What it does | External dependency (host-side, not code) |
|---|---|---|
| bookmark | Save URLs to `/workspace/agent/bookmarks.md` | none |
| capabilities | Read-only system capabilities report | none |
| cook-mode | Add/edit recipes in a web app | `/workspace/extra/apps/cook-mode.html` + `recipes.html` (runtime data, not in repo) |
| gcal-nango | Google Calendar via Nango OAuth proxy | `nango:host-gateway` alias on OneCLI gateway + Nango server running |
| ghostfolio | Investment portfolio queries | host alias on OneCLI gateway |
| groceries | Query receipt DB via `bun:sqlite` | `/workspace/agent/groceries/groceries.db` (migrated per-group data) |
| location-awareness | Read OwnTracks GPS files | sidecar location server running (`sidecar-location-home-api.md`) + Tailscale + OwnTracks phone setup |
| qmd | Semantic/keyword conversation search via MCP | `deploy/qmd/install.sh` run (below) |
| shield-adb | Control NVIDIA Shield via ADB | `$SHIELD_IP` env var + `/workspace/extra/android/adbkey` mount + adb in image |
| status | Read-only health check | none |
| task-scripts | Scheduling pre-check script guidance | none |
| tvoverlay | On-screen Shield notifications | `$SHIELD_IP` env var |
| web-publish | Static web pages via Caddy | writes to `/workspace/extra/apps/` (mounted RW) |
| wiki | Persistent structured knowledge base | none (owned by `add-karpathy-llm-wiki`, may already be reproduced by re-running that skill — diff against it first) |

Copy the whole `container/skills/<name>/` directory for each. For `wiki`, check whether `/add-karpathy-llm-wiki` (already in the skills list) reproduces this — if so, skip the manual copy and just re-run that skill.

## ⚠️ Post-copy fixups required by upstream breaking changes

The container skills above are copied verbatim, but three of them reference an MCP surface upstream has **removed**. Copying them unchanged hands every agent instructions for tools that no longer exist. Apply these edits after copying.

### 1. Scheduling moved from MCP tools to `ncl tasks`

Upstream deleted the six scheduling MCP tools (`schedule_task`, `list_tasks`, `pause_task`, `resume_task`, `cancel_task`, `update_task`). Tasks are now managed with `ncl tasks list/get/create/update/cancel/pause/resume/delete`. Upstream also **deleted its own `container/skills/task-scripts/`** — but the fork's copy is still worth keeping, because the underlying script contract survived unchanged (`{"wakeAgent": bool, "data": {...}}` on stdout, 30-second timeout, verified in `container/agent-runner/src/scheduling/task-script.ts`). Only the scheduling *syntax* changed: `ncl tasks create --script` replaces `schedule_task(script=...)`.

| File | Line | Change |
|---|---|---|
| `container/skills/task-scripts/SKILL.md` | 9 | Replace ``use `schedule_task` with a `script` `` with ``use `ncl tasks create --script` `` |
| `container/skills/capabilities/SKILL.md` | 41 | Replace the `schedule_task / list_tasks / pause_task / resume_task / cancel_task / update_task — scheduling` bullet with `` `ncl tasks list/get/create/update/cancel/pause/resume/delete` — scheduling (CLI, not MCP) `` |
| `container/skills/capabilities/SKILL.md` | 78 | In the MCP one-liner, drop `schedule/list/pause/resume/cancel/update_task` |
| `container/skills/status/SKILL.md` | 39 | In the `mcp__nanoclaw__*` list, drop `schedule_task, list_tasks, pause_task, resume_task, cancel_task, update_task` |
| `container/skills/status/SKILL.md` | 53 | Replace `Call mcp__nanoclaw__list_tasks to get scheduled tasks.` with `Run \`ncl tasks list\` to get scheduled tasks.` |

Also note for step 3 of `task-scripts` (the how-it-works list): the numbered contract is still correct as written — don't rewrite it.

### 2. `send_message` / `send_file` now require an explicit `to`

Every call needs a named destination; the reply-in-place and single-destination shortcuts are gone. Audit results for this fork:

- `container/skills/vercel-cli/SKILL.md:107` — **already compliant**, uses `to: "frontend-engineer"`. No change.
- `container/skills/capabilities/SKILL.md:35-36` and `container/skills/status/SKILL.md:39` — these only *name* the tools in a capability list, they don't show call syntax. Safe as-is, though line 35-36 reading "send a message to the user/group" is now slightly misleading; optionally reword to "send a message to a named destination".
- Group `CLAUDE.local.md` files — no `send_message` usages found, nothing to fix.

Cross-check against the `wiring-is-inbound-only-destinations-are-the-reply-path` note: a wired-but-destination-less channel now fails louder under this change, since there is no implicit reply target to fall back on. After upgrading, confirm each live group has its destinations set (`ncl destinations list`).

### 3. Channel formatting skills moved to the `channels` branch

`whatsapp-formatting` and `slack-formatting` no longer ship in trunk — they install with `/add-whatsapp` / `/add-slack`. The skills list already reapplies both, so this resolves itself. Do **not** hand-copy them.

## `deploy/qmd/` — full directory

Standalone host-side deployment for the qmd conversation-search service: per-group isolated MCP instances on private loopback ports, launchd supervisor (`com.nanoclaw.qmd.plist` + refresh plist), Caddy reverse-proxy snippet, `install.sh`/`refresh.sh`/`serve.sh`/`lib.sh`.

**How to apply:** `cp -r deploy/qmd <fresh-checkout>/deploy/qmd`, then run `bash deploy/qmd/install.sh` from the new checkout root. No path adjustments needed — it uses `$REPO` + `$HOME`, not repo-relative assumptions. Requires `ncl` CLI and `~/Library/LaunchAgents` writable (macOS). Also see `docs/qmd-conversation-search` memory note — per-group isolated + token-gated, runtime state in `~/.nanoclaw-qmd`.

## `container/cli-tools.json` — additions

Diff against a fresh checkout's `container/cli-tools.json` and add these three entries (Gmail MCP tool + opencode workaround dep):
- `@gongrzhe/server-gmail-autoauth-mcp@1.1.11`
- `zod-to-json-schema@3.22.5`
- `opencode-ai@1.4.17` (may already be added by re-running `/add-opencode`, check first)

`container/install-cli-tools.sh` needs no changes — it's the standard manifest-driven installer, unchanged from upstream.

## Docs (copy as reference, no code dependency)

- `docs/LOCATION.md` — OwnTracks + Tailscale setup guide for `sidecar-location-home-api.md`
- `docs/migration-2026-06-14.md` — archival snapshot of the v1→v2 migration, reference only
- `docs/v2-migration-followups.md` — roadmap of what's applied vs outstanding; useful cross-check once this migration is done
- `docs/permission-model.md` — fork-local write-up of the six-layer permission stack (reach → admin → access → cli_scope → approvals → destinations). Not present upstream.

## Root `CLAUDE.md` — one added line

The fork's only change to the root `CLAUDE.md` (vs the migration base) is a single row in the **Docs Index** table, pointing at the fork-local doc above. After checking out clean upstream, re-add it to that table, keeping it in the same position (right after the `docs/isolation-model.md` row):

```markdown
| [docs/permission-model.md](docs/permission-model.md) | Six-layer permission stack: reach → admin → access → cli_scope → approvals → destinations |
```

Nothing else in the root `CLAUDE.md` is fork-local — take upstream's version wholesale and add just this row.

## Group content

`groups/` is a **data directory** (per the migrate-nanoclaw skill's own principles — data dirs are never touched by the migration process). This section is informational only, not something to actively "reapply" — it carries over automatically since `groups/` isn't part of the code checkout being swapped.

Actual live groups: `groups/telegram_main/`, `groups/telegram_opencode/`, `groups/telegram_yanicius/`, `groups/telegram_yasmin/` — each has its own `CLAUDE.md` (composed at spawn, don't hand-edit) and `CLAUDE.local.md` (hand-written per-group memory/identity — real content, e.g. `telegram_main`'s covers Kivra/Gmail runbooks).

`groups/main/` exists but is empty (leftover from before the telegram_* groups were created) and `groups/global/` was deleted entirely during the v1→v2 migration (`groups/global/CLAUDE.md` and `groups/main/CLAUDE.md` both show as deletions in the local diff vs base) — don't try to reproduce those two paths.
