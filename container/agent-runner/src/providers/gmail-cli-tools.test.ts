/**
 * Structural guard for the Gmail MCP package-install integration point (container image).
 *
 * `@gongrzhe/server-gmail-autoauth-mcp` provides the `gmail-mcp` CLI binary installed into
 * the image — it is not importable or typed from this tree, so the build leg can't catch its
 * removal and there's no runtime seam to behavior-test. In this install the package is wired
 * through `container/cli-tools.json` (the manifest `install-cli-tools.sh` reads), not a
 * hand-written Dockerfile RUN block. This asserts the manifest still carries the gmail package
 * pinned, plus the `zod-to-json-schema` workaround pin. Drop either and this goes red,
 * signalling the agent would boot without `gmail-mcp` on PATH (or with a broken import).
 *
 * Why zod-to-json-schema is pinned: gmail-mcp@1.1.11 declares `zod-to-json-schema: ^3.22.1`;
 * left unpinned pnpm resolves 3.25.x, which imports the `zod/v3` subpath that only exists in
 * zod>=3.25 while zod itself resolves to 3.24.x — ERR_PACKAGE_PATH_NOT_EXPORTED at import.
 * Co-installing zod-to-json-schema@3.22.5 in the same global install dedupes it below the
 * subpath. Re-check this pin if the gmail package version is bumped.
 */
import fs from 'fs';
import path from 'path';

import { describe, it, expect } from 'bun:test';

type Tool = { name: string; version: string; onlyBuilt?: boolean };

function manifest(): Tool[] {
  // container/agent-runner/src/providers/ -> ../../../cli-tools.json == container/cli-tools.json
  const p = path.join(import.meta.dir, '..', '..', '..', 'cli-tools.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

describe('container/cli-tools.json installs the Gmail MCP server', () => {
  const tools = manifest();
  const find = (name: string) => tools.find((t) => t.name === name);

  it('lists @gongrzhe/server-gmail-autoauth-mcp pinned to an exact version', () => {
    const gmail = find('@gongrzhe/server-gmail-autoauth-mcp');
    expect(gmail).toBeDefined();
    // Exact pin, not a range — the supply-chain policy + reproducibility depend on it.
    expect(/^\d+\.\d+\.\d+$/.test(gmail!.version)).toBe(true);
  });

  it('pins the zod-to-json-schema workaround to 3.22.5', () => {
    const zod = find('zod-to-json-schema');
    expect(zod).toBeDefined();
    expect(zod!.version).toBe('3.22.5');
  });
});
