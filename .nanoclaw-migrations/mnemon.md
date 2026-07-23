# mnemon persistent memory — boot wiring

**Intent:** Register Claude Code memory hooks on container start via `mnemon setup --target claude-code`. The image's `entrypoint.sh` is bypassed at spawn time (`--entrypoint bash -c '...'` override in `src/container-runner.ts`), so setup must run in **both** places — `entrypoint.sh` for any other path that might invoke it, and the actual inline boot command for the live path.

**Files:** `container/Dockerfile`, `container/entrypoint.sh`, `src/container-runner.ts`, plus two structural guard tests (`src/mnemon-dockerfile.test.ts`, `src/mnemon-entrypoint.test.ts`) that fail loudly if any wiring point regresses.

**How to apply:**

### 1. `container/Dockerfile` — install the mnemon binary

Add this layer (placement doesn't matter much, but keep it near other global-CLI installs):

```dockerfile
# ---- mnemon — persistent agent memory ----------------------------------------
ARG MNEMON_VERSION=0.1.15
RUN ARCH=$(dpkg --print-architecture) && \
    curl -fsSL "https://github.com/mnemon-dev/mnemon/releases/download/v${MNEMON_VERSION}/mnemon_${MNEMON_VERSION}_linux_${ARCH}.tar.gz" \
    | tar -xz -C /usr/local/bin mnemon && \
    chmod +x /usr/local/bin/mnemon

ENV MNEMON_DATA_DIR=/home/node/.claude/mnemon
```

Check https://github.com/mnemon-dev/mnemon/releases for a newer version before pinning — 0.1.15 was current as of this guide's generation.

### 2. `container/entrypoint.sh`

Add before the stdin capture, using `;` (not `&&`) so a setup failure never blocks agent boot:

```bash
set -e

mnemon setup --target claude-code --yes --global >/dev/stderr 2>&1

cat > /tmp/input.json
exec bun run /app/src/index.ts < /tmp/input.json
```

### 3. `src/container-runner.ts` — the load-bearing wiring

In the function that builds the container spawn args (look for where `--entrypoint bash` is pushed and the boot command is constructed), gate to the `claude` provider only — other providers spawn their own process and never invoke the `claude` CLI, so setup would be inert for them:

```typescript
// mnemon — persistent memory. Its Claude Code hooks only fire under the
// claude provider; other providers spawn their own process and never invoke
// the `claude` CLI, so setup would be inert. `;` (not `&&`) so a setup failure
// never blocks the agent from booting. This is the load-bearing wiring: the
// image's entrypoint.sh is bypassed by the --entrypoint override above, so
// mnemon setup must run here, in the actual spawn command.
const bootCmd =
  provider === 'claude'
    ? 'mnemon setup --target claude-code --yes --global >/dev/stderr 2>&1; exec bun run /app/src/index.ts'
    : 'exec bun run /app/src/index.ts';
args.push('-c', bootCmd);
```

Note: the `provider` parameter to this function may currently be named `_provider` (unused) on a fresh checkout — rename to `provider` and use it here.

### 4. Guard tests (copy as-is, no modification needed)

`src/mnemon-dockerfile.test.ts` — asserts step 1 landed correctly.
`src/mnemon-entrypoint.test.ts` — asserts steps 2–3 landed correctly.

**Validate:** `pnpm test -- mnemon` after steps 1–3 are all in place.
