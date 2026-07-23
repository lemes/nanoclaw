// Standalone LAN sidecar — runs the fork-local HTTP servers that have no place
// in the upstream orchestrator: the home-automation API (Shield buttons →
// IKEA DIRIGERA light + Samsung TV "day mode") and the OwnTracks location
// endpoint. Kept out of src/index.ts so upstream NanoClaw merges don't conflict
// on the orchestrator's startup path; these three files (sidecar.ts, home-api.ts,
// location.ts) are entirely fork-local and could move to their own repo later.
//
// Run: npm run sidecar (prod) / npm run sidecar:dev (hot reload).
// Service: ~/Library/LaunchAgents/com.nanoclaw.sidecar.plist
import type http from 'http';

import { startHomeApiServer } from './home-api.js';
import { startLocationServer } from './location.js';
import { log } from './log.js';

const servers: http.Server[] = [startLocationServer(), startHomeApiServer()];

function shutdown(signal: NodeJS.Signals): void {
  log.info('Sidecar shutting down', { signal });
  let pending = servers.length;
  if (pending === 0) process.exit(0);
  for (const server of servers) {
    server.close(() => {
      if (--pending === 0) process.exit(0);
    });
  }
  // Don't let a hung connection block the restart.
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
