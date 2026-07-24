/**
 * Structural guard for the mnemon spawn-command reach-in.
 *
 * This is the load-bearing half of the mnemon wiring, and the half the
 * `/add-mnemon` skill does NOT install. The skill adds `mnemon setup` to
 * container/entrypoint.sh — but the host overrides the image entrypoint at
 * spawn time (`--entrypoint bash` in buildContainerArgs), so that line never
 * runs for a live container. Only the inline boot command below does.
 *
 * Guarded here rather than in mnemon-entrypoint.test.ts because that file is
 * copied verbatim from the skill and gets overwritten when it is re-run.
 *
 * Two properties, both of which silently break memory if lost:
 *   1. The boot command invokes `mnemon setup --target claude-code`.
 *   2. It is chained with `;` not `&&`, so a setup failure cannot stop the
 *      agent from booting.
 */
import fs from 'fs';
import path from 'path';

import { describe, it, expect } from 'vitest';

function runner(): string {
  return fs.readFileSync(path.resolve(__dirname, 'container-runner.ts'), 'utf8');
}

describe('container spawn command runs mnemon setup', () => {
  const text = runner();

  it('still overrides the image entrypoint (why this guard exists)', () => {
    // If this ever stops being true, entrypoint.sh becomes live and this
    // reach-in is redundant — revisit rather than blindly keeping both.
    expect(text).toMatch(/'--entrypoint',\s*'bash'/);
  });

  it('invokes mnemon setup targeting claude-code in the boot command', () => {
    expect(text).toMatch(/mnemon setup --target claude-code[^\n]*exec bun run/);
  });

  it('chains with ; so a setup failure never blocks agent boot', () => {
    const line = text
      .split('\n')
      .find((l) => l.includes('mnemon setup --target claude-code') && l.includes('exec bun'));
    expect(line).toBeDefined();
    expect(line).toContain('; exec bun run');
    expect(line).not.toContain('&& exec bun run');
  });
});
