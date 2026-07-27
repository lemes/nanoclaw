# qmd — conversation search (per-group isolated + token-auth)

Semantic + keyword search over each group's past conversations, exposed to agent
containers as the `qmd` MCP server. Built on [qmd](https://github.com/tobi/qmd)
(on-device BM25 + vector embeddings + reranking — no API key, nothing leaves the box).

Each group gets a **fully isolated** qmd instance and a **bearer token**: a container
can reach only its own instance (configured with only its own collection), and callers
without a valid token are rejected.

## Architecture

```
agent container ──http+Bearer<group-token>──▶ host.docker.internal:8182
                                                     │  caddy (generated qmd.caddy)
                                  token match ───────┤  routes by token, else 403
                                                     ▼
                       group A ▶ localhost:8190  qmd mcp --http   (cfg+DB: inst/A/)
                       group B ▶ localhost:8191  qmd mcp --http   (cfg+DB: inst/B/)
                          ...      supervised by com.nanoclaw.qmd (serve.sh)
                                                     │
                       shared on host:               ▼
                       ~/.cache/qmd/models/  (~1.6GB GGUF, shared by all instances)
                       ~/.nanoclaw-qmd/inst/<group>/  cfg/ (1 collection), index.sqlite, token, pid
                       ~/.nanoclaw-qmd/ports.tsv       stable group→port map
                       ~/.nanoclaw-qmd/qmd.caddy       generated token-routed site
```

Why per-instance: isolation is **enforced, not advised**. A group's qmd process is
started with `XDG_CONFIG_HOME`/`INDEX_PATH` pointing at a config that lists only that
group's collection and a DB holding only its data — it has no way to read another
group's history. The token both routes the request and gates access (closing the
LAN/tailnet exposure of an unauthenticated port).

Why the caddy hop at all: qmd's HTTP server hardcodes `listen(port,"localhost")`, which is
loopback-only and unreachable from containers; caddy bridges the container-facing `:8182`.
The upstream address stays spelled `localhost` on purpose — macOS resolves it per-process
to `::1` or `127.0.0.1`, so pinning either family 502s whenever an instance picks the other.

The qmd CLI lives in `~/.nanoclaw-qmd` (standalone npm install, **not** the pnpm
workspace) so its native build scripts (`better-sqlite3`, `node-llama-cpp`) don't
interact with the repo's supply-chain policy.

## Components

| File | Role |
|------|------|
| `lib.sh`                          | shared paths, stable port map, per-group token, isolated `qmd_for` |
| `serve.sh`                        | supervisor: one qmd instance/group + generate & reload token-routed caddy |
| `refresh.sh`                      | (re)build each group's isolated index + embeddings |
| `export-opencode.mjs`             | render OpenCode sessions to `conversations/` markdown (see below) |
| `install.sh`                      | idempotent deploy: install, index, caddy import, load services, wire MCP |
| `com.nanoclaw.qmd.plist`          | launchd: runs `serve.sh` (KeepAlive) |
| `com.nanoclaw.qmd-refresh.plist`  | launchd: runs `refresh.sh` hourly |
| `Caddyfile.snippet`               | the `import` line install.sh adds (real site is generated outside the repo) |
| `../../container/skills/qmd/`     | container skill teaching agents `mcp__qmd__*` (auto-scoped to their group) |

## Deploy

```bash
bash deploy/qmd/install.sh
ncl groups restart --id <group-id>   # per group, to pick up the MCP server
```

First run downloads ~1.6GB of models (shared across instances) and embeds existing
history (telegram_main's 20 files took ~6.5 min). Subsequent refreshes are incremental.
New groups are picked up automatically: refresh.sh indexes any new `conversations/`
dir and serve.sh starts its instance + adds its caddy route on the next loop (wire its
MCP with `install.sh` re-run or `ncl groups config add-mcp-server`).

## OpenCode groups

Everything here keys on `groups/<folder>/conversations/`. Only the **claude** provider
writes that dir (it archives transcripts from a PreCompact hook); OpenCode has no such hook,
so an OpenCode group would never get an instance, a port or a token — it'd be invisible to
the whole stack.

`export-opencode.mjs` closes that gap from the host. OpenCode does persist every session, in
its own `opencode.db` under the per-session XDG mount, so the exporter reads those databases
read-only and renders the same markdown the claude provider would have written. `refresh.sh`
runs it before `group_list()`, since that call is what decides which groups exist.

It writes one file per top-level session, named `<date>-<title-slug>-<session-suffix>.md`,
and skips writes when content is unchanged — rewriting a transcript would bump its mtime and
make the hourly pass re-embed the whole corpus for nothing. Subagent sessions and tool output
are left out; only text turns are exported, matching the claude side.

```bash
node deploy/qmd/export-opencode.mjs               # run by hand
node deploy/qmd/export-opencode.mjs --self-check  # assert the transcript parsing
```

## Resource note

Each group runs its own qmd process. Models load lazily (on first query) and stay
resident in that process — up to ~1–2 GB RAM per *actively searched* group (embedding
300M + reranker 0.6B + optional 1.7B query-expansion). Idle instances are light. For a
handful of personal groups this is fine; it does grow with the number of groups that
actually run searches.

## Operate

```bash
launchctl kickstart -k gui/$(id -u)/com.nanoclaw.qmd     # restart supervisor (all instances)
bash deploy/qmd/refresh.sh                                # manual reindex (all groups)
tail -f logs/qmd.log logs/qmd-refresh.log                 # logs
cat ~/.nanoclaw-qmd/ports.tsv                             # group → port map
```

To remove: `launchctl bootout gui/$(id -u)/com.nanoclaw.qmd{,-refresh}`, delete the
plists from `~/Library/LaunchAgents`, drop the `import ~/.nanoclaw-qmd/qmd.caddy` line
from the Caddyfile (+ `caddy reload`), and `rm -rf ~/.nanoclaw-qmd ~/.config/qmd ~/.cache/qmd`.
