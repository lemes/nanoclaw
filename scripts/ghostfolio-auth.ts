#!/usr/bin/env npx tsx
/**
 * Ghostfolio JWT management for OneCLI.
 * Authenticates with Ghostfolio and registers/refreshes the JWT
 * as a generic OneCLI secret with Bearer header injection.
 *
 * Security token is read from ~/.config/nanoclaw/ghostfolio-token.
 * The JWT is never exposed to containers — OneCLI injects it at request time.
 *
 * Prerequisites:
 *   - Ghostfolio running (docker compose -f docker/docker-compose.yml up -d)
 *   - OneCLI installed and running (curl -fsSL onecli.sh/install | sh)
 *   - Security token from Ghostfolio Settings saved to:
 *     echo "<token>" > ~/.config/nanoclaw/ghostfolio-token
 *
 * Usage:
 *   npx tsx scripts/ghostfolio-auth.ts setup    # first time
 *   npx tsx scripts/ghostfolio-auth.ts refresh  # when JWT expires (~180 days)
 *
 * How it works:
 *   1. Reads security token from ~/.config/nanoclaw/ghostfolio-token
 *   2. POSTs to Ghostfolio /api/v1/auth/anonymous to get a JWT (valid ~180 days)
 *   3. Stores the JWT as an OneCLI generic secret with host pattern
 *      "host.docker.internal" and Authorization: Bearer header injection
 *   4. Containers curl Ghostfolio via http://host.docker.internal:3333,
 *      OneCLI proxy intercepts and injects the Bearer header
 */

import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const GHOSTFOLIO_URL = process.env.GHOSTFOLIO_URL ?? 'http://localhost:3333';
const TOKEN_PATH = path.join(os.homedir(), '.config', 'nanoclaw', 'ghostfolio-token');
const SECRET_NAME = 'Ghostfolio';
const HOST_PATTERN = 'ghostfolio';

async function readSecurityToken(): Promise<string> {
  if (!fs.existsSync(TOKEN_PATH)) {
    console.error(`Security token not found at ${TOKEN_PATH}`);
    console.error('Get your token from Ghostfolio settings and run:');
    console.error(`  echo "<your-token>" > ${TOKEN_PATH}`);
    process.exit(1);
  }
  return fs.readFileSync(TOKEN_PATH, 'utf-8').trim();
}

async function authenticate(securityToken: string): Promise<string> {
  const res = await fetch(`${GHOSTFOLIO_URL}/api/v1/auth/anonymous`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken: securityToken }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`Auth failed (${res.status}): ${body}`);
    process.exit(1);
  }

  const { authToken } = (await res.json()) as { authToken: string };
  return authToken;
}

function getExistingSecretId(): string | null {
  try {
    const output = execFileSync('onecli', ['secrets', 'list'], { encoding: 'utf-8' });
    const parsed = JSON.parse(output);
    // Handle both formats: plain array (v1.1) and { data: [...] } wrapper (v1.2+)
    const secrets = (Array.isArray(parsed) ? parsed : parsed.data) as Array<{ id: string; name: string }>;
    const match = secrets.find((s) => s.name === SECRET_NAME);
    return match?.id ?? null;
  } catch {
    return null;
  }
}

function createSecret(jwt: string): void {
  const output = execFileSync('onecli', [
    'secrets', 'create',
    '--name', SECRET_NAME,
    '--type', 'generic',
    '--value', jwt,
    '--host-pattern', HOST_PATTERN,
    '--header-name', 'Authorization',
    '--value-format', 'Bearer {value}',
  ], { stdio: 'pipe', encoding: 'utf-8' });
  // OneCLI ignores --header-name/--value-format on create — apply via update
  const { id } = JSON.parse(output) as { id: string };
  execFileSync('onecli', [
    'secrets', 'update',
    '--id', id,
    '--header-name', 'Authorization',
    '--value-format', 'Bearer {value}',
  ], { stdio: 'inherit' });
  console.log(`Created OneCLI secret "${SECRET_NAME}" for ${HOST_PATTERN}`);
}

function updateSecret(id: string, jwt: string): void {
  execFileSync('onecli', [
    'secrets', 'update',
    '--id', id,
    '--value', jwt,
  ], { stdio: 'inherit' });
  console.log(`Updated OneCLI secret "${SECRET_NAME}"`);
}

async function main() {
  const command = process.argv[2];

  if (!command || !['setup', 'refresh'].includes(command)) {
    console.log('Usage: npx tsx scripts/ghostfolio-auth.ts <setup|refresh>');
    console.log('  setup   — authenticate and create OneCLI secret');
    console.log('  refresh — re-authenticate and update existing secret');
    process.exit(0);
  }

  const securityToken = await readSecurityToken();
  console.log('Authenticating with Ghostfolio...');
  const jwt = await authenticate(securityToken);
  console.log('Got JWT successfully');

  if (command === 'setup') {
    const existingId = getExistingSecretId();
    if (existingId) {
      console.log(`Secret "${SECRET_NAME}" already exists, updating...`);
      updateSecret(existingId, jwt);
    } else {
      createSecret(jwt);
    }
    console.log('Bearer header injection configured via OneCLI.');
  } else {
    const existingId = getExistingSecretId();
    if (!existingId) {
      console.error(`No existing secret "${SECRET_NAME}" found. Run "setup" first.`);
      process.exit(1);
    }
    updateSecret(existingId, jwt);
  }

  console.log('\nDone. Verify with: onecli secrets list');
}

main();
