# OpenCode: .env reading + per-group model override

**Intent:** Two small patches to `src/providers/opencode.ts` on top of the stock `/add-opencode` install. Confirmed absent from both `upstream/main` and `upstream/providers` as of this guide's generation — check again at migration time in case upstream picked up equivalent logic since (`git show upstream/providers:src/providers/opencode.ts | grep -i model`).

**Files:** `src/providers/opencode.ts`

**How to apply** (after `/add-opencode` has been re-run on the fresh checkout):

1. Add imports at the top:
   ```typescript
   import { getContainerConfig } from '../db/container-configs.js';
   import { readEnvFile } from '../env.js';
   ```

2. Inside the `registerProviderContainerConfig('opencode', (ctx) => { ... })` callback, after the `NO_PROXY`/`no_proxy` env setup and before the `return`, insert:

   ```typescript
   // Read provider/model config from the .env file (like the claude provider
   // reads ANTHROPIC_BASE_URL), falling back to process.env. The host does NOT
   // load .env into process.env and the launchd plist only injects PATH/HOME, so
   // reading ctx.hostEnv alone would miss every OPENCODE_* value and leave the
   // container on the bare opencode defaults (provider=anthropic, no model).
   const dotenv = readEnvFile(['OPENCODE_PROVIDER', 'OPENCODE_MODEL', 'OPENCODE_SMALL_MODEL', 'OPENCODE_BASE_URL']);
   const pick = (key: string): string | undefined => ctx.hostEnv[key] ?? dotenv[key];

   for (const key of ['OPENCODE_PROVIDER', 'OPENCODE_MODEL', 'OPENCODE_SMALL_MODEL'] as const) {
     const value = pick(key);
     if (value) env[key] = value;
   }

   // Per-group model override: the container config's `model` field, when set,
   // wins over the install-wide OPENCODE_MODEL from .env. This is what lets a
   // single opencode group (e.g. for model experimentation) swap its model via
   // `ncl groups config update --model <X>` + restart — including the agent
   // doing it to itself from chat — without touching shared .env. Format follows
   // OpenCode's `<provider>/<vendor>/<model>` convention, e.g.
   // `openrouter/anthropic/claude-sonnet-4.6`. The small model stays sourced
   // from .env unless a per-group OPENCODE_SMALL_MODEL is added later.
   const groupModel = getContainerConfig(ctx.agentGroupId)?.model;
   if (groupModel) env.OPENCODE_MODEL = groupModel;

   // The container provider reads ANTHROPIC_BASE_URL as the baseURL for a
   // non-anthropic OpenCode provider. We source it from the opencode-namespaced
   // OPENCODE_BASE_URL rather than the shared ANTHROPIC_BASE_URL, because the
   // claude provider (src/providers/claude.ts) reads ANTHROPIC_BASE_URL from the
   // same .env and injects it into claude containers — a shared value would
   // repoint claude groups at the opencode endpoint. Sourcing from a distinct
   // key keeps claude and opencode groups isolated in one install. Only injected
   // here for opencode-provider groups.
   const opencodeBaseUrl = pick('OPENCODE_BASE_URL');
   if (opencodeBaseUrl) env.ANTHROPIC_BASE_URL = opencodeBaseUrl;
   ```

   Note the original stock loop reads `ctx.hostEnv[key]` directly — replace that read with `pick(key)`, don't leave both.

3. Validate: `pnpm run build`, `pnpm exec tsc -p container/agent-runner/tsconfig.json --noEmit`.

## Additional patch: `registerMemorySessionHook` on the container provider

**Discovered 2026-07-23 during the upgrade.** The `providers` branch predates upstream's provider-agnostic memory rewrite. Upstream's `AgentProvider` interface (`container/agent-runner/src/providers/types.ts`) now requires `registerMemorySessionHook`, and `container/agent-runner/src/index.ts` calls it unconditionally on whatever provider is active. The freshly-fetched `container/agent-runner/src/providers/opencode.ts` does not implement it, so the container typecheck fails with:

```
error TS2420: Class 'OpenCodeProvider' incorrectly implements interface 'AgentProvider'.
  Property 'registerMemorySessionHook' is missing
```

Fix — add the import and a no-op method to the `OpenCodeProvider` class (the same stance `providers/mock.ts` takes; the hook is a Claude Code mechanism and OpenCode has no session-start hook equivalent):

```typescript
import type { MemorySessionHookRegistration } from '../memory/session-hook.js';

// …inside class OpenCodeProvider, after the constructor:
registerMemorySessionHook(_hook: MemorySessionHookRegistration): void {}
```

Re-running `/add-opencode` overwrites this file wholesale and reintroduces the error, so reapply this each time until the `providers` branch catches up.

## Additional patch: lazy-load `@opencode-ai/sdk` (required — crashes claude groups otherwise)

**Discovered 2026-07-23, after the upgrade, by a live crash of the `telegram_main` group.**

The agent-runner source is a **shared read-only mount** from the host tree (`src/container-runner.ts` mounts `container/agent-runner/src` at `/app/src`), but each group may pin its **own baked image** via `container_configs.image_tag`. Those two facts combine badly: the provider barrel's `import './opencode.js'` reaches *every* group, and the stock `opencode.ts` top-level-imports `@opencode-ai/sdk`. Any group whose pinned image predates that dependency dies at boot with:

```
error: Cannot find module '@opencode-ai/sdk' from '/app/src/providers/opencode.ts'
```

This kills **claude-provider groups that never touch OpenCode** — `telegram_main` (image `…:ag-1781443191239-otytf8`, built Jun 20) crashed on the first message after the upgrade.

Fix — make the type import type-only and defer the value import into `ensureSharedRuntime`:

```typescript
// top of file — type-only, erased at runtime
import type { OpencodeClient } from '@opencode-ai/sdk';

// inside ensureSharedRuntime, just before the client is created:
const { createOpencodeClient } = await import('@opencode-ai/sdk');
const client = createOpencodeClient({ baseUrl: url });
```

Prefer this to rebuilding every per-group image: those images carry self-mod `install_packages` customizations, and lazy-loading fixes current *and* future stale-image groups with a two-line diff. Verify against a stale image directly:

```bash
docker run --rm -v "$PWD/container/agent-runner/src:/app/src:ro" \
  --entrypoint bun <stale-per-group-image> \
  -e "await import('/app/src/providers/index.js'); console.log('BARREL OK')"
```

Re-running `/add-opencode` overwrites this too. Reapply both patches together.

## Stale steps in `add-opencode` SKILL.md — skip them

Upstream moved global CLI installs out of the Dockerfile and into the `container/cli-tools.json` manifest (installed by `container/install-cli-tools.sh`). Three of the skill's steps are now obsolete against upstream trunk:

- **Step 5(a)** — `ARG OPENCODE_VERSION=1.4.17` in the Dockerfile. There is no longer a "Pin CLI versions" ARG block, and no `ARG VERCEL_VERSION` to anchor to.
- **Step 5(b)** — the standalone `RUN … pnpm install -g "opencode-ai@${OPENCODE_VERSION}"` block. The per-CLI install blocks are gone.
- **Step 6** — copying `opencode-dockerfile.test.ts` into `src/`. It asserts the two Dockerfile lines above exist, so on the new base it **fails**. Do not copy it; delete it if a previous run left it behind.

Instead, add one entry to `container/cli-tools.json`:

```json
{ "name": "opencode-ai", "version": "1.4.17" }
```

Same applies to `/add-gmail-tool`: its Dockerfile `GMAIL_MCP_VERSION` step and `gmail-dockerfile.test.ts` are stale — the fork wires Gmail through the manifest instead (`@gongrzhe/server-gmail-autoauth-mcp@1.1.11` + `zod-to-json-schema@3.22.5`) and keeps a fork-authored `gmail-cli-tools.test.ts` guard in place of the Dockerfile one.

**Env vars this depends on** (already in `.env`, not part of the code migration, just confirm they're set): `OPENCODE_PROVIDER`, `OPENCODE_MODEL`, `OPENCODE_SMALL_MODEL`, `OPENCODE_BASE_URL`.
