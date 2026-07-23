# Applied Skills

> **Corrected 2026-07-23.** An earlier version of this file listed 30 `add-*` skills. That list was wrong — it enumerated every SKILL.md present under `.claude/skills/`, which upstream trunk ships for *all* channels and providers whether or not they are installed. Reapplying all 30 would have installed 17 unused channel adapters, two unused providers, and six unused tools, along with their pinned dependencies.
>
> The list below is what this fork has **actually installed**, verified three ways: the local commit history since the migration base, the artifacts present in the tree, and the dependency pins in `package.json` / `container/cli-tools.json`.

## The five installed skills

| Skill | Evidence it is installed | Installed by |
|---|---|---|
| `add-telegram` | `src/channels/telegram.ts` + `telegram-pairing.ts` + `telegram-markdown-sanitize.ts` (none in base); `import './telegram.js';` in `src/channels/index.ts`; `@chat-adapter/telegram` pinned in `package.json` | v1→v2 migration (`91a99ae9`) |
| `add-opencode` | `src/providers/opencode.ts` (not in base); `opencode-ai@1.4.17` in `container/cli-tools.json` | `41d8ce0b`, `e1d78a37` |
| `add-gmail-tool` | `@gongrzhe/server-gmail-autoauth-mcp@1.1.11` + `zod-to-json-schema@3.22.5` in `container/cli-tools.json` | `f3a20562` |
| `add-mnemon` | `src/mnemon-dockerfile.test.ts`, `src/mnemon-entrypoint.test.ts` | `f8dc076d` |
| `add-karpathy-llm-wiki` | `container/skills/wiki/` (not in base) | `ef16131d`, `2766eb85` |

`cli` is the always-on built-in channel and needs no skill. `claude` is the built-in provider.

## Explicitly NOT installed — do not reapply

Confirmed absent from the tree, the barrel, and the dependency pins. Reapplying any of these would add an adapter and its deps for a channel this install does not use:

- **Channels:** deltachat, discord, emacs, gchat, github, imessage, linear, matrix, resend, signal, slack, teams, webex, wechat, whatsapp, whatsapp-cloud
- **Providers:** codex, ollama-provider
- **Tools:** atomic-chat-tool, gcal-tool, ollama-tool, macos-statusbar, rtk, dashboard

Two things that look like installed skills but are not:

- **`add-vercel`** — `vercel@52.2.1` in `container/cli-tools.json` and `container/skills/vercel-cli/` are **upstream baseline**, present in the migration base and still shipped by upstream trunk. Not a fork addition; do nothing.
- **`add-gcal-tool`** — the fork's calendar integration is the hand-written `container/skills/gcal-nango/` (Nango OAuth proxy), unrelated to the upstream skill. It is covered in `copy-as-is.md`, not here.

## How to apply

The `channels` and `providers` branches are now on `origin` (pushed 2026-07-23), so each skill's stock `git fetch origin <branch>` works unmodified. Run in this order:

1. `/add-telegram` — brings the adapter to Chat SDK **4.29.0**. Upstream pinned `chat` exactly at `4.29.0`; this fork still carries `chat: ^4.27.0` and `@chat-adapter/telegram: 4.27.0`. The adapter's `ChatInstance` must match the bridge's or `createChatSdkBridge(...)` fails to typecheck, so this reapplication is **required**, not optional.
2. `/add-opencode` — then layer the patch in `opencode-customization.md` on top of the freshly fetched `src/providers/opencode.ts`.
3. `/add-gmail-tool`
4. `/add-mnemon` — then apply the boot wiring in `mnemon.md`.
5. `/add-karpathy-llm-wiki` — then diff `container/skills/wiki/SKILL.md` against the fork's copy and keep the fork's PDF-handling fix (`2766eb85`: read PDFs natively via the Read tool, not `pdftotext`).

### Faster path: the deterministic engine

Upstream now ships a skill-apply engine that executes a SKILL.md's `nc:` directive fences directly, so these skills can be applied without hand-running each step:

```bash
pnpm exec tsx scripts/skill-apply.ts .claude/skills/add-telegram   # PLAN only — no writes
```

The CLI is plan-only; `applySkill(skillDir, root, opts)` from `scripts/skill-apply.ts` performs the write. Skills that carry no `nc:` fences (the contributed ones — likely `add-mnemon`, `add-karpathy-llm-wiki`) simply have no directives to plan and must be applied from their prose the usual way. Plan each skill first and read the output before applying.

**Known follow-up:** `ncl groups config add-mcp-server` / `add-package` calls made after these skills were installed (per-group MCP wiring, extra packages) live in the **central DB** (`data/v2.db`), not in code — they are not part of this code migration and carry over automatically since `data/` is never touched.
