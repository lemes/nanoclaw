# Sidecar: OwnTracks location + Shield home-automation LAN servers

**Intent:** Three fork-local LAN HTTP servers, deliberately kept out of `src/index.ts` (a heavily-upstream-churned file) to avoid merge conflicts on every sync. Not a skill — pure custom source, no upstream equivalent, no dependency on any add-* skill.

**Files:** `src/sidecar.ts` (new), `src/location.ts` (new), `src/home-api.ts` (new), plus the `LOCATIONS_DIR`/`LOCAL_SHARE_DIR` export addition to `src/config.ts` and the read-only mount wiring in `src/container-runner.ts` (both covered in `mcp-http-and-config.md` — apply this section's three new files first, then that one).

**How to apply:**

### 1. `src/location.ts` (new file)

LAN HTTP server, port 7100 (env `LOCATION_PORT`), receives OwnTracks GPS payloads, persists to `~/.local/share/nanoclaw/locations/<user>.json`.

```typescript
export const LOCATION_PORT = parseInt(process.env.LOCATION_PORT || '7100', 10);

export interface LocationUpdate {
  latitude: number;
  longitude: number;
  accuracy?: number;
  altitude?: number;
  velocity?: number;
  heading?: number;
  timestamp: string;
}

function handleOwnTracksPayload(body: any): LocationUpdate | null {
  if (body._type && body._type !== 'location') return null;
  const lat = body.lat ?? body.latitude;
  const lon = body.lon ?? body.longitude;
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  return {
    latitude: lat,
    longitude: lon,
    accuracy: body.acc ?? body.accuracy,
    altitude: body.alt ?? body.altitude,
    velocity: body.vel ?? body.velocity,
    heading: body.cog ?? body.heading,
    timestamp: body.tst ? new Date(body.tst * 1000).toISOString() : new Date().toISOString(),
  };
}

function persistLocation(user: string, loc: LocationUpdate): void {
  fs.mkdirSync(LOCATIONS_DIR, { recursive: true });
  const file = path.join(LOCATIONS_DIR, `${user}.json`);
  fs.writeFileSync(file, JSON.stringify(loc, null, 2) + '\n');
}

// Routes:
//   POST /location/:user  — accepts OwnTracks payload (both lat/lon and latitude/longitude field names)
//   GET  /location/:user  — read one user
//   GET  /location        — read all users
// OwnTracks expects an empty JSON array `[]` in the POST response body.
export function startLocationServer(): http.Server { /* ... */ }
```

Directory (`LOCATIONS_DIR`, from `src/config.ts`) is auto-created on startup so the container mount at `/workspace/locations` resolves even before the first update.

### 2. `src/home-api.ts` (new file)

LAN-only HTTP API, port 7101 (env `HOME_API_PORT`), for Shield hardware buttons.

```typescript
export const HOME_API_PORT = parseInt(process.env.HOME_API_PORT || '7101', 10);

const DIRIGERA_IP = process.env.DIRIGERA_IP || '192.168.0.111';
const DIRIGERA_BASE = `https://${DIRIGERA_IP}:8443/v1`;
const DIRIGERA_TOKEN_PATH = path.join(os.homedir(), '.config', 'nanoclaw', 'dirigera-token');

const SMARTTHINGS_BIN = process.env.SMARTTHINGS_BIN || 'smartthings';
const TV_DAYMODE_DEVICE = process.env.SMARTTHINGS_TV_DAYMODE_ID || '235ddd00-3e44-4f67-8130-3dfa5c6f6657';

const STEP = 20;
const MIN_ON_LEVEL = 20;
const MAX_LEVEL = 100;
const TARGET_TTL_MS = 5 * 60_000; // absorbs hub read-after-write lag

// Routes: POST /home/light/dim, POST /home/light/brighten,
//         POST /home/tv/brightness/toggle, GET /home/status, GET /home (health)
export function startHomeApiServer(): http.Server { /* ... */ }
```

Controls IKEA DIRIGERA lights via its self-signed-HTTPS REST API and a Samsung TV "day mode" virtual switch via the SmartThings CLI (redirect stdio to temp files — the CLI hangs on piped stdio). Tracks commanded state for 5 minutes to smooth over the hub's read-after-write lag.

### 3. `src/sidecar.ts` (new file)

Orchestrator entry point that starts both servers and handles graceful shutdown.

```typescript
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
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```

**Run this as its own process** (not wired into `src/index.ts` — that's the point). Check how it's launched in the current install (likely a separate launchd/systemd unit or a second `pnpm` script) and reproduce that same launch mechanism on the new checkout.

**External dependencies, not part of code migration:** OwnTracks app configured to POST to this host's LAN IP on port 7100; DIRIGERA hub reachable at `192.168.0.111:8443` with a valid token at `~/.config/nanoclaw/dirigera-token`; `smartthings` CLI installed and authenticated. See `docs/LOCATION.md` (copied as-is per `copy-as-is.md`) for full setup.
