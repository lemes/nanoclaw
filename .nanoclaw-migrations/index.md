# NanoClaw Migration Guide

Generated: 2026-07-23T09:20:35Z
Last updated: 2026-07-23T09:36:00Z
Base: 3f39f576530874ed80ab48fb484300872193743a
HEAD at generation: 6b738e259fc174438ecc548fe0a36f16b44dbc37
Upstream: 641963c1e4b7ba4f000a18dfc5e2fea29069feec

Tier 3 (complex). 405 upstream commits vs 26 local commits, 83 changed files.

## Migration Plan

Order of operations, upgrade phase:

1. **Reapply the 5 installed `add-*` skills first** (see `skills.md`) — `add-telegram`, `add-opencode`, `add-gmail-tool`, `add-mnemon`, `add-karpathy-llm-wiki`. Additive and idempotent; run `add-opencode` before the OpenCode customization below. **Do not reapply the other 25 skills** — they were never installed (see the correction note in `skills.md`).
2. **Apply the OpenCode customization** (`opencode-customization.md`) on top of the freshly reapplied `src/providers/opencode.ts`.
3. **Apply fork-local features**: sidecar/location/home-api (`sidecar-location-home-api.md`), voice transcription (`transcription.md`), mnemon wiring (`mnemon.md`), http MCP server type (`mcp-http-and-config.md`). These touch `src/container-runner.ts` and `src/container-config.ts` from multiple angles — apply them in the order listed in each file's "How to apply", re-reading the file state between edits since `add-ollama-provider`/`add-ollama-tool` also touch `container-runner.ts`/`container-config.ts`.
4. **Copy container skills + qmd deploy + docs + group CLAUDE.md** (`copy-as-is.md`) — no code risk, do last.
5. Validate: `pnpm run build && pnpm test`, then `./container/build.sh` (container files changed).
6. **Post-upgrade, before using any group:** run `/migrate-memory` for each of the 4 live groups — upstream's provider-agnostic memory rewrite means legacy memory is not read until migrated. Then confirm destinations are set (`ncl destinations list`) since `send_message` no longer has an implicit reply target, and restart the service.

## Upstream breaking changes (405 commits) — how each lands here

| Breaking change | Impact on this fork | Handled by |
|---|---|---|
| **Provider-agnostic memory** — shared OKF `memory/` tree, persona in `instructions.prepend.md` | All 4 live groups (`telegram_main`, `telegram_opencode`, `telegram_yanicius`, `telegram_yasmin`) have legacy memory and **must run `/migrate-memory` before use** | Post-upgrade step 6 below |
| **Scheduled tasks → `ncl tasks`** — 6 scheduling MCP tools removed | 3 custom container skills reference the removed tools | Fixups in `copy-as-is.md` |
| **Explicit `to` on `send_message`/`send_file`** | `vercel-cli` already compliant; check live groups have destinations set | Audit in `copy-as-is.md` |
| **Channel install skills are the source of truth** — `setup/add-<channel>.sh` deleted | None; the guide already reapplies via `/add-<channel>` | `skills.md` |
| **`whatsapp-formatting`/`slack-formatting` → `channels` branch** | Restored automatically by reapplying those skills | `skills.md` |
| **Chat SDK pinned `4.29.0`** | Adapters must match the bridge or typecheck fails | Reapplying each `/add-<channel>` |

## Risk areas

- **Gates step 1:** the `/add-*` skills fetch from `origin`, but `channels`/`providers` only exist on `upstream` in this fork. All 30 skill reapplications fail until this is handled — see the blocker box in `skills.md` for the two fixes. *(Resolved 2026-07-23 by pushing both branches to `origin`.)*
- **Container skills carry stale tool instructions.** `task-scripts`, `capabilities`, and `status` name MCP scheduling tools that no longer exist. Upstream deleted its own `task-scripts` skill outright; this fork's copy is still worth keeping (the `wakeAgent` script contract survived) but needs its syntax updated. See `copy-as-is.md`.

- `src/container-runner.ts` and `src/container-config.ts` are each touched by **three** things: an `add-*` skill (ollama-provider/ollama-tool), the mnemon boot-command wiring, and the http-MCP-type change. Apply skills first, then layer the two customizations on top, re-reading the file after each step rather than patching blind against the guide's snippets.
- `src/providers/opencode.ts` is both a skill-owned file and a customization target — always reapply the skill first, then the patch in `opencode-customization.md`.
- `container/skills/qmd/SKILL.md` and `container/skills/location-awareness/SKILL.md` are inert without their host-side services (`deploy/qmd/install.sh`, the sidecar location server + OwnTracks + Tailscale). Copying the file alone doesn't make the feature work — see `copy-as-is.md`.

## Skill Interactions

None found beyond the container-runner.ts/container-config.ts triple-ownership noted above under Risk areas — that's a sequencing issue, not a semantic conflict (the three changes touch disjoint code within the same files).

## Sections

- [skills.md](skills.md) — the 5 actually-installed `add-*` skills to reapply (corrected down from a bogus list of 30)
- [opencode-customization.md](opencode-customization.md) — per-group model override + .env reading patch
- [sidecar-location-home-api.md](sidecar-location-home-api.md) — LAN GPS + home-automation servers
- [transcription.md](transcription.md) — local whisper.cpp voice transcription
- [mnemon.md](mnemon.md) — persistent memory boot wiring
- [mcp-http-and-config.md](mcp-http-and-config.md) — http MCP server type + config.ts additions
- [copy-as-is.md](copy-as-is.md) — custom container skills, qmd deploy, docs (incl. fork-local `docs/permission-model.md` + its root CLAUDE.md index row), group CLAUDE.md
