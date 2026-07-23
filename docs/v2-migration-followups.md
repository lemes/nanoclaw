# v2 Migration — Follow-ups

Generated 2026-06-14 at the end of `/migrate-from-v1`. The core migration is done and
v2 is live on Telegram (v1 stopped). These are the deliberate roadmap items from
`~/code/nanoclaw/docs/v2-migration-plan.md` that were **not** part of finishing the
migration — fork integrations that need re-implementation in v2 patterns. None block
normal chat; each is an opt-in capability to restore.

Status legend: 🔴 broken until wired · 🟡 not yet installed · ⚪ net-new work

## 1. ✅ Nango Google Calendar — FIXED 2026-06-14 (plan §7B.1)

**Decision:** KEEP Nango (calendar is genuinely multi-account here; OneCLI's
`google-calendar` app is single-account and can't replace it).

**What was wrong:** v2 routes outbound calls through the OneCLI **gateway container**
(`onecli`, launched from `~/.onecli/docker-compose.yml`), not direct from the agent.
The agent curls `http://nango:3003`; the gateway matched the `nango` secret and injected
the Bearer, but then **couldn't resolve `nango`** on its own Docker network → forwarded
to nothing (HTTP 000). v1 sidestepped this by adding `--add-host=nango:host-gateway` to
the *agent* container (`v1 container-runtime.ts:18`), but that doesn't help in v2 because
the request is proxied and the *gateway* does the DNS. (`nango-server/connections` returns
401 without the Bearer, so going direct/unproxied isn't an option.)

**The fix (applied):** add `extra_hosts: ["nango:host-gateway"]` to the `onecli` service
in `~/.onecli/docker-compose.yml` (backup: `docker-compose.yml.bak-pre-nango`), so the
gateway resolves `nango` → host → the published `nango-server` on `127.0.0.1:3003`. Same
`nango:host-gateway` trick as v1, just on the container that forwards in v2. No nanoclaw
core change, no skill/secret change — `nango:3003` stays the contract everywhere.
Verified: a proxied `GET http://nango:3003/connections` returns 200 with real connection data.

**Recreating the gateway — important:** the compose image is `${ONECLI_VERSION:-latest}`.
Always bring it up pinned, or it silently jumps to `:latest` and breaks `agents list`:
```bash
ONECLI_VERSION=1.36.0 docker compose -f ~/.onecli/docker-compose.yml up -d onecli
```

**Caveats:** (1) a future OneCLI gateway upgrade may regenerate this compose and drop the
`extra_hosts` lines — re-add them if calendar/ghostfolio break. (2) The Nango proxy
(`nango-server`, `nango-db`, `nango-redis`) must stay running.

> **`ghostfolio` fixed the same way (2026-06-14):** added `"ghostfolio:host-gateway"` to the
> same `extra_hosts` list. Verified: proxied `GET http://ghostfolio:3333/api/v1/account` →
> 200 with real account data (stored Bearer still valid). See §6.

## 2. ✅ Gmail — tool-only, INSTALLED 2026-06-16 (plan §4)

**Decision:** TOOL-ONLY. The v1 inbound-email channel (auto-deliver unread mail as
notifications + auto-reply threading) is **dropped**.

**Done (2026-06-16):** installed Gmail as an MCP tool in **telegram_main** via the
`/add-gmail-tool` flow with OneCLI-managed OAuth. The agent now has `mcp__gmail__*`
tools there; it only touches mail when explicitly asked. Verified end-to-end over
Telegram (label/inbox queries return real data). Single-account
(`assistantgreg3@gmail.com`), same as v1.

**Deviations from the skill (worth knowing for the next `add-*-tool` run):**
- **Install path:** the skill edits `container/Dockerfile` (`ARG GMAIL_MCP_VERSION` +
  a `pnpm install -g` RUN block), but this install moved global CLIs to
  `container/cli-tools.json`. Wired the two packages there instead —
  `@gongrzhe/server-gmail-autoauth-mcp@1.1.11` + the workaround pin
  `zod-to-json-schema@3.22.5` (one global install dedupes gmail-mcp's `^3.22.1`
  below the broken `zod/v3` subpath). Adapted the skill's `gmail-dockerfile.test.ts`
  guard → `gmail-cli-tools.test.ts` (asserts the manifest); `gmail-allow-pattern.test.ts`
  unchanged.
- **Stale real creds:** `~/.gmail-mcp/` held *real* v1 OAuth creds (live refresh token +
  GCP `client_secret`, world-readable), not `onecli-managed` stubs. Backed up to
  `~/.gmail-mcp-backup-2026-06-16/` (0600) and replaced with stubs. The backed-up GCP
  OAuth client (`client_id`/`client_secret`) was reused to connect Gmail in OneCLI.
  Revocation/rotation of that exposed secret was **deferred** (noted, not done) — rotate
  in Google Cloud Console when convenient and reconnect OneCLI if you do.
- **Mount allowlist** gained `~/.gmail-mcp` (read-write, token cache); host was restarted
  to clear the per-process allowlist cache.

## 3. ✅ TREK MCP — wired 2026-06-16 (native HTTP-MCP)

Wired to the Main group via a **native HTTP-MCP** patch (not the mcp-remote bridge): v2's
`McpServerConfig` was widened to a `stdio | http` union (`src/container-config.ts`,
`container/agent-runner/src/providers/types.ts`), and `ncl groups config add-mcp-server`
gained `--url`/`--headers`. Main's `mcp_servers` entry:
`{"type":"http","url":"http://trek:3000/mcp","headers":{"X-Forwarded-Proto":"https"}}`.
Reachability/auth: `trek:host-gateway` on the gateway compose + the "TREK MCP" secret
hostPattern repointed to `trek`; the `X-Forwarded-Proto` header defeats TREK's `FORCE_HTTPS`
301. Proven with a live MCP `initialize`. **Note:** this is the fork's first *trunk* core
patch (must survive `/update-nanoclaw`); TREK's static API token is deprecated (→ OAuth 2.1
eventually). See `[[trek-mcp-native-http]]` memory.

## 4. ✅ Voice transcription — implemented 2026-06-18 (Path A, local whisper)

Inbound audio is transcribed host-side in the Chat SDK bridge. New `src/transcription.ts`
(+ test), ported from v1; `src/channels/chat-sdk-bridge.ts` `messageToInbound` transcribes
any `type:'audio'` attachment inline (ffmpeg → 16kHz WAV → whisper.cpp via
`/opt/homebrew/bin`), drops the base64 blob, and sets the body to `[Voice: <transcript>]`.
Best-effort: a no-op when no model is present, falls back to the raw attachment on failure.
Works for any Chat SDK channel. Model `data/models/ggml-base.bin` (gitignored, install-local).
Path B (OpenAI API) was unneeded — whisper/ffmpeg were already on the host.

## 5. ✅ FIXED (2026-06-18) Kivra receipt sync — import moved into kivra-sync

The v1 final step wrote a task file to `/workspace/ipc/tasks/` to trigger a host-side
import — that IPC mount **does not exist in v2**. Rather than rebuild a host-RPC path,
the import was **decoupled from NanoClaw entirely** and moved into the kivra-sync repo:
`kivra/groceries_import.py` (a Python port of v1's `scripts/import-groceries.ts`) runs
automatically at the end of each successful sync (hooked in `kivra_sync.py` after
`fetch_receipts`, gated on `receipts_stored > 0`; failures never break the sync). It
imports new receipts and classifies new products via Claude Haiku (key read from
`/run/secrets/anthropic-api-key`, mounted from `~/.config/nanoclaw/anthropic-api-key`).

The groceries DB moved to `groups/telegram_main/groceries/groceries.db` (a subfolder, in
`DELETE` journal mode) and is bind-mounted into **both** the kivra-sync container (writer,
at `/groceries`) and the agent container (read-only reader, at
`/workspace/agent/groceries/groceries.db`). The `CLAUDE.local.md` runbook step 4 now says
the import is automatic — nothing to trigger. The sync server itself
(`host.docker.internal:4001`) is unchanged. See `docs/followup-plans/kivra-import.md`.

## 6. Custom container skills — v2 readiness (8 of 9 need fixes)

The 9 custom container skills (`container/skills/`) were copied verbatim from v1 and
mostly reference v1 infra the rewrite dropped. Audited 2026-06-14 against the live v2
container environment. **Only `task-scripts` works as-is.** None of this is upstream-core
drift — every fix is editing the skill's own `SKILL.md` (plus a few env/image wiring
decisions). The 8 upstream container skills are unmodified and fine.

> **⚠️ Migration gotcha — skill shadowing (fixed 2026-06-14):** `migrate-v2.sh` pre-copied the
> container skills into each group's `data/v2-sessions/<id>/.claude-shared/skills/` as **real
> directories**, and `syncSkillSymlinks` only creates a symlink when the entry is *missing* — so
> those stale copies shadowed the live `/app/skills/<name>` and **every edit to a migrated skill
> silently never reached the agent** (new skills like `gcal-nango` were fine — they're symlinks).
> Fixed by replacing the 33 stale real dirs (11 skills × 3 groups) with symlinks. If you edit a
> migrated skill and the agent ignores the change, check that
> `data/v2-sessions/<id>/.claude-shared/skills/<name>` is a **symlink**, not a real dir. A durable
> fix belongs in `migrate-v2.sh` (symlink instead of copy) or `syncSkillSymlinks` (replace
> non-symlink entries).

> A 10th custom skill, `gcal-nango`, was later added by consolidating the duplicated
> Google Calendar instructions out of the 3 group `CLAUDE.local.md` files. Its readiness
> is tracked under §1 (needs the `nango` host alias) — fixing it there fixes calendar for
> every group at once.

The recurring v2 deltas behind the breakage:
- `/workspace/group/` → **`/workspace/agent/`** (RW group folder)
- `/workspace/project/`, `/workspace/ipc/`, `/workspace/extra/` — **gone**
- `/workspace/global/` — now **read-only** (was RW in v1)
- env vars **not injected** into containers (`$SHIELD_IP`, `$NANOCLAW_GROUP_FOLDER` are empty)
- missing CLIs in the image: **`adb`**, **`sqlite3`** (image ships chromium + curl + bun/pnpm)
- no host aliases wired (`ghostfolio`, `nango` bare hostnames don't resolve)
- `register_group` MCP tool replaced by `create_agent`

### Group A — status (2026-06-14)

Two were genuinely `SKILL.md`-only and are **done**. The other three turned out NOT to be
pure-markdown: the original audit assumed `/workspace/global` was mounted and Caddy pointed
at v2 — but the migration **deleted `groups/global/`** (so `/workspace/global` isn't mounted)
and the v1 web/data (`groceries.db`, recipes, `cook-mode.html`) was **never copied to v2**.
Caddy's `com.nanoclaw.caddy` service still serves from the **v1 install**
(`NANOCLAW_GROUPS_DIR=/Users/vin/code/nanoclaw/groups`). So `groceries`/`cook-mode`/
`web-publish` need the v1 web/data layer restored on v2, not just text edits.

| Skill | Verdict | Status / what it needs |
|---|---|---|
| `capabilities` | ✅ FIXED | dropped the dead `/workspace/project` main-gate; `/workspace/group/`→`/workspace/agent/`; real v2 MCP-tool list (`register_group`→`create_agent`, added send_file/edit_message/etc.). Pure markdown. |
| `status` | ✅ FIXED | dropped main-gate + dead `/workspace/ipc`+`/group` listings; `node`/`claude`→`bun --version`; real MCP list. Pure markdown. |
| `groceries` | ✅ FIXED (2026-06-14; DB relocated 2026-06-18) | copied `groceries.db` from v1 → now at `groups/telegram_main/groceries/groceries.db` (gitignored; durable — per-group folders aren't wiped like `groups/global/`; auto-mounts RW under `/workspace/agent/groceries/`). SKILL.md rewritten to `bun:sqlite` (no `sqlite3` in image) reading `/workspace/agent/groceries/groceries.db` read-only, with a presence check. Verified: query returns real data. Available in `telegram_main` (the owner chat); other groups get a graceful "not available here". DB is now refreshed automatically by the kivra-sync post-sync importer — see §5. |
| `web-publish` | ✅ FIXED (2026-06-14) | Caddy repointed to v2 (see note); SKILL.md `/workspace/group/public`→`/workspace/agent/public`; folder name now derived via `ncl groups get` (auto-fills own group) instead of the unset `$NANOCLAW_GROUP_FOLDER`. Verified: page written to `telegram_main/public` served at `…:8443/telegram_main/…` → 200. |
| `cook-mode` | ✅ FIXED (2026-06-14) | per-group in `telegram_main` (chosen): copied `cook-mode.html`/`recipes.html`/`recipes/`/`pickuplimes-browser-state.json` from v1 → `groups/telegram_main/public/` (+ workspace); SKILL.md paths `/workspace/global`→`/workspace/agent`, URL `/global/`→`/telegram_main/`. Verified: engine + recipes served via Caddy → 200. Stays skill-only (writes go to RW `/workspace/agent`, not the RO global). |
| `ghostfolio` | ✅ FIXED (2026-06-14) | reachability fixed via `extra_hosts: ghostfolio:host-gateway` on the OneCLI gateway (§1) — proxied `/api/v1/account` → 200. Remaining nit: the `SKILL.md` still mentions a host-side `scripts/ghostfolio-auth.ts refresh` that isn't in the container; only matters if the stored Bearer later expires |

> **Caddy repoint (2026-06-14):** the `com.nanoclaw.caddy` launchd service was serving the
> **v1** install. Copied the (generic) `Caddyfile` to the v2 repo root and repointed the
> service's `--config`, `WorkingDirectory`, `NANOCLAW_GROUPS_DIR`, and log paths to v2
> (plist backup: `~/Library/LaunchAgents/com.nanoclaw.caddy.plist.bak-v1`). The reverse
> proxies (TREK/Kivra/Jellyfin/etc.) are unaffected — same Caddyfile, host services. v2's
> `Caddyfile` is now tracked in the repo. Web-publish/cook-mode serve from v2 group `public/`
> dirs via this service.

### Group B — DONE + VERIFIED (2026-06-14)

Both confirmed over Telegram: `tvoverlay` (TV notification) and `shield-adb` (screenshot —
authenticated with the host's trusted key via `ADB_VENDOR_KEYS`, no TV-side RSA prompt).


Correction to the original audit: **`SHIELD_IP` *is* available to the agent** — it's in
`telegram_main`'s `data/v2-sessions/<id>/.claude-shared/settings.json` `env` (carried over from
v1), and the agent-runner runs the SDK with `settingSources: ['project','user','local']`
(`container/agent-runner/src/providers/claude.ts:418`), so the `user` settings.json `env` reaches
the agent's Bash. The audit checked raw container env (`docker exec … env`), which doesn't show
SDK-applied settings env — hence the false "empty" reading.

| Skill | Verdict | What was done |
|---|---|---|
| `tvoverlay` | ✅ FIXED | needed only `SHIELD_IP` (present) + `curl` (in image) + the skill-shadowing fix. No changes required beyond shadowing. Pending a Shield-on-LAN test. |
| `shield-adb` | ✅ FIXED | (1) `adb` added to `telegram_main` `packages_apt` → per-group image rebuilt (verified `adb` v1.0.41 in the image); (2) host `~/.android` allowlisted RO + added as an `additionalMount` (lands at `/workspace/extra/android`); (3) `ADB_VENDOR_KEYS=/workspace/extra/android/adbkey` added to settings.json `env` so adb authenticates as this host (Shield already trusts the key — no TV prompt); (4) SKILL.md paths `/workspace/group`→`/workspace/agent` + key-mount note updated. Takes effect on next spawn (container.json re-materializes the mount from the DB). Pending a Shield-on-LAN `adb connect` test. |

> **Security note:** shield-adb mounts the host's **private** adb key (`~/.android/adbkey`) RO into
> the telegram_main container, so the agent can authenticate to the Shield as this Mac. Scoped to
> telegram_main; allowlist entry is read-only.
>
> **Gotcha:** the host **caches the mount allowlist for its process lifetime**
> (`src/modules/mount-security/index.ts`). After editing
> `~/.config/nanoclaw/mount-allowlist.json` you MUST restart the host service, or new mounts are
> silently rejected at spawn (`Additional mount REJECTED … not under any allowed root`) — which
> manifested here as the Shield prompting for the RSA key (adb fell back to a self-generated key).
> Verified in a replica container: key mounts at `/workspace/extra/android/adbkey`, `ADB_VENDOR_KEYS`
> resolves, adb v1.0.41 present.

> Decision needed for Group B: how to surface `SHIELD_IP` to containers in v2 — v1 had a
> fork commit mirroring it into per-group `settings.json` env; that wasn't carried over.
> Cleanest v2 option is probably a per-group container-config env field, or an OneCLI
> secret if it should be treated as a credential.

### Testing approach (per skill)

Instruction-only skills are tested behaviorally: (a) DM the bot a triggering message and
watch it invoke the skill, or (b) shell into a running container and run the skill's own
commands. Quick environment probes used in the audit:
`adb version` / `sqlite3 --version` → command-not-found; `echo "[$SHIELD_IP]"` → `[]`;
`ls -d /workspace/group` → no such dir; `touch /workspace/global/x` → read-only FS;
`curl -sv http://ghostfolio:3333/...` → could-not-resolve-host.

## Already handled during the migration (no action needed)

- Telegram channel → v2 Chat SDK adapter (installed from `upstream/channels`; `chat` dep
  bumped to `^4.27.0`).
- OneCLI gateway/CLI upgraded from stale v1.2.1 → pinned gateway 1.36.0 / CLI 2.2.5
  (the v1.2.1 gateway served `/api/agents`; the v2 SDK needs `/v1/agents` — this was the
  root cause of the initial "no reply").
- Owner seeded (global), access policy `strict` on all groups, Yasmin imported as member
  of Yasmin + yanicius.
- `CLAUDE.local.md` cleaned (boilerplate stripped, "Greg" identity restored to
  telegram_main, integrations kept with FIXMEs).
- Swarm groups (`telegram_swarm`, `telegram_yasmin-swarm`) dropped per §7B.2; folders
  archived to `docs/v1-fork-reference/dropped-swarm-groups/`.
- Container skills (shield-adb, tvoverlay, ghostfolio, groceries, cook-mode, task-scripts,
  web-publish, capabilities, status) copied into `container/skills/` and committed — but
  8 of 9 need v2 adaptation before they work (see §6). Only `task-scripts` is ready.
- Scheduled tasks: 7 active ported into `telegram_main` (`migrated=7, skipped=0`).
- Upgrade tripwire (`data/upgrade-state.json`) stamped at 2.1.15.
- OneCLI v2 agents are `secretMode=all` (external APIs get matching secrets).
