# http MCP server type + config.ts additions + destinations/scheduling instruction tweaks

## 1. `src/container-config.ts` — discriminated union MCP type

**Intent:** Support both stdio (default, spawned child process) and http (remote MCP endpoint) servers, mirroring the Claude Agent SDK's shape so configs pass through untranslated. http requests honor `HTTPS_PROXY`, routing through the OneCLI gateway for credential injection.

**Apply after any `add-*` skill that touches this file** (check for conflicts — none found as of this guide).

```typescript
/**
 * MCP server config materialized into `container.json`. A discriminated union:
 *   - stdio (default): spawn `command` with `args`/`env` (the common case).
 *   - http: connect to a remote MCP endpoint at `url`. The container's MCP
 *     client honors `HTTPS_PROXY`, so http requests route through the OneCLI
 *     gateway for credential injection; `headers` are sent verbatim (e.g. an
 *     `X-Forwarded-Proto` header for a backend that forces HTTPS).
 * Mirrors the SDK's `McpStdioServerConfig | McpHttpServerConfig` shape so the
 * map passes straight through to the Claude Agent SDK with no translation.
 */
export type McpServerConfig =
  | {
      type?: 'stdio';
      command: string;
      args?: string[];
      env?: Record<string, string>;
      instructions?: string;
    }
  | {
      type: 'http';
      url: string;
      headers?: Record<string, string>;
      instructions?: string;
    };
```

Replace the old single-shape `McpServerConfig` interface with this union. Everywhere else in the file that reads `command`/`args`/`env` off an `McpServerConfig` should still work unchanged for the stdio variant (structurally compatible).

## 2. `src/cli/resources/groups.ts` — `config add-mcp-server` supports both types

Detect type via presence of `--url`:

```typescript
const url = args.url as string | undefined;
const isHttp = args.type === 'http' || url !== undefined;

let entry: McpServerConfig;
if (isHttp) {
  if (!url) throw new Error('--url is required for an http MCP server');
  entry = {
    type: 'http',
    url,
    headers: args.headers ? (JSON.parse(args.headers as string) as Record<string, string>) : undefined,
  };
} else {
  const command = args.command as string;
  if (!command) throw new Error('--command is required (or pass --url for an http MCP server)');
  entry = {
    command,
    args: args.args ? (JSON.parse(args.args as string) as string[]) : [],
    env: args.env ? (JSON.parse(args.env as string) as Record<string, string>) : {},
  };
}

const servers = JSON.parse(row.mcp_servers) as Record<string, McpServerConfig>;
servers[name] = entry;
updateContainerConfigJson(id, 'mcp_servers', servers);
```

## 3. `src/config.ts` — new paths + `.env` pinning

Add to the `readEnvFile([...])` key list: `CONTAINER_IMAGE`, `CONTAINER_IMAGE_BASE`.

```typescript
export const LOCAL_SHARE_DIR = path.join(HOME_DIR, '.local', 'share', 'nanoclaw');
export const LOCATIONS_DIR = path.join(LOCAL_SHARE_DIR, 'locations');

export const CONTAINER_IMAGE_BASE =
  process.env.CONTAINER_IMAGE_BASE || envConfig.CONTAINER_IMAGE_BASE || getContainerImageBase(PROJECT_ROOT);
export const CONTAINER_IMAGE =
  process.env.CONTAINER_IMAGE || envConfig.CONTAINER_IMAGE || getDefaultContainerImage(PROJECT_ROOT);
```

`LOCAL_SHARE_DIR` is for durable, project-independent state that survives group reshuffles (currently only used for `LOCATIONS_DIR`, written by `src/location.ts` — see `sidecar-location-home-api.md`).

## 4. `src/container-runner.ts` — mount `LOCATIONS_DIR` read-only

```typescript
import { LOCATIONS_DIR } from './config.js'; // add to existing config import

// In the mount-building function:
if (fs.existsSync(LOCATIONS_DIR)) {
  mounts.push({ hostPath: LOCATIONS_DIR, containerPath: '/workspace/locations', readonly: true });
}
```

This is separate from the mnemon boot-command change in the same file (`mnemon.md`) — apply both, they touch different functions.

## 5. Instruction text tweaks (no functional code, just guidance strings)

**`container/agent-runner/src/destinations.ts`** — clarify that `send_message` and the final `<message>` block are each their own delivery; never repeat content across both:

> "The `send_message` MCP tool is the same delivery, available mid-turn — use it ONLY for a quick interstitial acknowledgment ('on it', 'looking now') before a slow tool call, never for your actual answer. Deliver your real reply exactly once: either through `send_message` OR through a final-response `<message>` block, never both. Each `send_message` call and each final-response `<message>` block lands as its own separate message, so anything you already sent via `send_message` this turn must NOT be repeated (or reworded) in your final `<message>` block — that double-sends it to the user."

**`container/agent-runner/src/mcp-tools/scheduling.instructions.md`** — add a "Writing the task prompt" section:

> "The `prompt` runs later in a fresh, non-interactive session. Whatever you want delivered to the user, instruct that run to produce it as its **single final response** — the final response is delivered to the channel automatically. Do **not** tell the task to use the `send_message` tool to deliver its main output: `send_message` plus the auto-delivered final response would send the same content twice. (`send_message` is only for a mid-turn aside before the final answer.) So phrase delivery as 'produce/output the briefing as your reply', never 'send a message with the briefing'."

**`container/agent-runner/src/mcp-tools/scheduling.ts`** — update the `schedule_task` tool's `prompt` parameter description to match:

```typescript
prompt: {
  type: 'string',
  description:
    'Task instructions/prompt, run later in a non-interactive session. Its final response is delivered to the channel automatically, so write the prompt to produce the deliverable AS that final response — do not instruct it to call the send_message tool for its main output (that would double-send).',
},
```

## 6. `.gitignore` — ignore install-specific Caddyfile

```
# Install-specific Caddy config (personal tailnet hostname + reverse proxies)
/Caddyfile
```
