import type { McpServerConfig } from './types.js';

/** OpenCode `mcp` entry shape (local stdio server). */
export type OpenCodeMcpLocal = {
  type: 'local';
  command: string[];
  environment?: Record<string, string>;
  enabled: true;
};

/** OpenCode `mcp` entry shape (remote HTTP server). */
export type OpenCodeMcpRemote = {
  type: 'remote';
  url: string;
  headers?: Record<string, string>;
  enabled: true;
};

export type OpenCodeMcpEntry = OpenCodeMcpLocal | OpenCodeMcpRemote;

/** Remote (http/sse) MCP entry as it arrives from container config. */
type RemoteServerConfig = {
  type: 'http' | 'sse';
  url: string;
  headers?: Record<string, string>;
};

/**
 * Map NanoClaw v2 MCP definitions (same shape as Claude Agent SDK) into
 * OpenCode config `mcp` field. Stdio entries carry `command`; http/sse entries
 * carry `url` and have no command/args/env at all.
 */
export function mcpServersToOpenCodeConfig(
  servers: Record<string, McpServerConfig | RemoteServerConfig> | undefined,
): Record<string, OpenCodeMcpEntry> {
  const out: Record<string, OpenCodeMcpEntry> = {};
  if (!servers) return out;
  for (const [name, cfg] of Object.entries(servers)) {
    if ('url' in cfg) {
      out[name] = {
        type: 'remote',
        url: cfg.url,
        ...(cfg.headers ? { headers: cfg.headers } : {}),
        enabled: true,
      };
      continue;
    }
    out[name] = {
      type: 'local',
      command: [cfg.command, ...(cfg.args ?? [])],
      ...(cfg.env && Object.keys(cfg.env).length > 0 ? { environment: cfg.env } : {}),
      enabled: true,
    };
  }
  return out;
}
