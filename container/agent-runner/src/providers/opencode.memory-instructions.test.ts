import { describe, it, expect } from 'bun:test';

import { buildOpenCodeConfig } from './opencode.js';

// OpenCode has no session-start hook, so the memory files the Claude hook
// renders must ride the instructions list or the group boots memory-less.
describe('buildOpenCodeConfig instructions', () => {
  it('includes the shared memory files', () => {
    const instructions = buildOpenCodeConfig({}).instructions as string[];
    expect(instructions).toContain('/workspace/agent/memory/index.md');
    expect(instructions).toContain('/workspace/agent/memory/system/definition.md');
  });
});
