/**
 * Host-side container config for the `opencode` provider.
 *
 * OpenCode's `opencode serve` process stores state under XDG_DATA_HOME, which
 * we pin to a per-session host directory mounted at /opencode-xdg. The
 * OPENCODE_* env vars tell the CLI which provider/model to use at runtime
 * (read on the host, injected into the container). NO_PROXY / no_proxy are
 * merged with host values so the in-container OpenCode client can talk to
 * 127.0.0.1 even when HTTPS_PROXY is set by OneCLI.
 */
import fs from 'fs';
import path from 'path';

import { getContainerConfig } from '../db/container-configs.js';
import { readEnvFile } from '../env.js';

import { registerProviderContainerConfig } from './provider-container-registry.js';

function mergeNoProxy(current: string | undefined, additions: string): string {
  if (!current?.trim()) return additions;
  const parts = new Set(
    current
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean),
  );
  for (const addition of additions.split(',')) {
    const trimmed = addition.trim();
    if (trimmed) parts.add(trimmed);
  }
  return [...parts].join(',');
}

registerProviderContainerConfig('opencode', (ctx) => {
  const opencodeDir = path.join(ctx.sessionDir, 'opencode-xdg');
  fs.mkdirSync(opencodeDir, { recursive: true });

  const env: Record<string, string> = {
    XDG_DATA_HOME: '/opencode-xdg',
    NO_PROXY: mergeNoProxy(ctx.hostEnv.NO_PROXY, '127.0.0.1,localhost'),
    no_proxy: mergeNoProxy(ctx.hostEnv.no_proxy, '127.0.0.1,localhost'),
  };
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

  return {
    mounts: [{ hostPath: opencodeDir, containerPath: '/opencode-xdg', readonly: false }],
    env,
  };
});
