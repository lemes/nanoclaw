import { spawn } from 'child_process';
import fs from 'fs';
import http from 'http';
import https from 'https';
import os from 'os';
import path from 'path';

import { log } from './log.js';

// LAN-only HTTP API for home automation, meant to be curled from the Android TV
// (Nvidia Shield) hardware buttons. Binds 0.0.0.0 like the location server; no
// auth — same trust model as the other LAN endpoints. GET and POST both work so
// dumb HTTP-button apps are fine.
//
//   POST /home/light/dim            IKEA light -20; below MIN_ON_LEVEL -> off
//   POST /home/light/brighten       IKEA light +20 (cap MAX_LEVEL); from off -> on at MIN_ON_LEVEL
//   POST /home/tv/brightness/toggle flip the "TV day mode" SmartThings virtual switch
//   GET  /home/status               { light, lightTarget, tvDayMode }
//   GET  /home                      health + endpoint list
//
// Light control hits the DIRIGERA hub's REST API directly; the TV "day mode"
// switch goes through the authenticated SmartThings CLI.
export const HOME_API_PORT = parseInt(process.env.HOME_API_PORT || '7101', 10);

// --- IKEA DIRIGERA (the smart light) ---
const DIRIGERA_IP = process.env.DIRIGERA_IP || '192.168.0.111';
const DIRIGERA_BASE = `https://${DIRIGERA_IP}:8443/v1`;
const DIRIGERA_TOKEN_PATH = path.join(os.homedir(), '.config', 'nanoclaw', 'dirigera-token');

// --- SmartThings (the Samsung TV "day mode" virtual switch) ---
const SMARTTHINGS_BIN = process.env.SMARTTHINGS_BIN || 'smartthings';
// "TV day mode" virtual switch: on = bright picture, off = dim picture.
const TV_DAYMODE_DEVICE = process.env.SMARTTHINGS_TV_DAYMODE_ID || '235ddd00-3e44-4f67-8130-3dfa5c6f6657';

// --- Light brightness stepping ---
// Dirigera lightLevel runs 1–100. Step 20 at a time; if a dim step would land
// below MIN_ON_LEVEL, turn the light off instead. Brighten from off turns the
// light on at MIN_ON_LEVEL.
const STEP = 20;
const MIN_ON_LEVEL = 20;
const MAX_LEVEL = 100;
// The hub reflects a write in GET /devices only after a few seconds, so back-to-back
// button presses would otherwise read stale state. Track what we last commanded and
// trust it for this long; after that, fall back to the hub (covers the IKEA remote
// being used directly, the bulb losing power, etc.).
const TARGET_TTL_MS = 5 * 60_000;

// --- Dirigera HTTP (self-signed cert on the hub, so rejectUnauthorized: false) ---
function dirigeraToken(): string {
  return fs.readFileSync(DIRIGERA_TOKEN_PATH, 'utf-8').trim();
}

function dirigeraRequest(method: string, pathPart: string, body?: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const req = https.request(
      `${DIRIGERA_BASE}${pathPart}`,
      {
        method,
        rejectUnauthorized: false,
        headers: {
          Authorization: `Bearer ${dirigeraToken()}`,
          ...(payload
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
              }
            : {}),
        },
      },
      (res) => {
        let chunks = '';
        res.on('data', (c) => (chunks += c));
        res.on('end', () => {
          if ((res.statusCode ?? 0) >= 400) {
            reject(new Error(`dirigera ${method} ${pathPart} -> ${res.statusCode} ${chunks}`));
            return;
          }
          try {
            resolve(chunks ? JSON.parse(chunks) : null);
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

interface LightState {
  id: string;
  isOn: boolean;
  lightLevel: number;
  isReachable: boolean;
}

// The light's device id never changes, so cache it to skip a GET /devices when
// our remembered target is still fresh.
let cachedLightId: string | null = null;

async function getLight(): Promise<LightState> {
  const devices = await dirigeraRequest('GET', '/devices');
  const light = (devices as any[]).find((d) => d.type === 'light');
  if (!light) throw new Error('no light device found on the DIRIGERA hub');
  cachedLightId = light.id;
  return {
    id: light.id,
    isOn: !!light.attributes?.isOn,
    lightLevel: typeof light.attributes?.lightLevel === 'number' ? light.attributes.lightLevel : 0,
    isReachable: light.isReachable !== false,
  };
}

// Last state we commanded, used to absorb the hub's read-after-write lag.
let lightTarget: { isOn: boolean; lightLevel: number; ts: number } | null = null;

function rememberLight(isOn: boolean, lightLevel: number): void {
  lightTarget = { isOn, lightLevel, ts: Date.now() };
}

/** Effective light state for stepping: our recent command if fresh, else the live hub state. */
async function effectiveLight(): Promise<{
  id: string;
  isOn: boolean;
  lightLevel: number;
}> {
  if (cachedLightId && lightTarget && Date.now() - lightTarget.ts < TARGET_TTL_MS) {
    return {
      id: cachedLightId,
      isOn: lightTarget.isOn,
      lightLevel: lightTarget.lightLevel,
    };
  }
  return getLight();
}

async function setLightAttr(id: string, attributes: Record<string, unknown>): Promise<void> {
  await dirigeraRequest('PATCH', `/devices/${id}`, [{ attributes }]);
}

async function dimLight(): Promise<object> {
  const light = await effectiveLight();
  if (!light.isOn) {
    rememberLight(false, light.lightLevel);
    return {
      device: 'light',
      action: 'dim',
      result: 'already-off',
      isOn: false,
    };
  }
  const next = light.lightLevel - STEP;
  if (next < MIN_ON_LEVEL) {
    await setLightAttr(light.id, { isOn: false });
    rememberLight(false, light.lightLevel);
    return {
      device: 'light',
      action: 'dim',
      result: 'turned-off',
      from: light.lightLevel,
      isOn: false,
    };
  }
  await setLightAttr(light.id, { lightLevel: next });
  rememberLight(true, next);
  return {
    device: 'light',
    action: 'dim',
    result: 'dimmed',
    from: light.lightLevel,
    to: next,
    isOn: true,
  };
}

async function brightenLight(): Promise<object> {
  const light = await effectiveLight();
  if (!light.isOn) {
    // The bulb's "last value" on-behavior ignores a lightLevel sent in the same
    // PATCH as isOn, so turn it on first, then set the level.
    await setLightAttr(light.id, { isOn: true });
    await setLightAttr(light.id, { lightLevel: MIN_ON_LEVEL });
    rememberLight(true, MIN_ON_LEVEL);
    return {
      device: 'light',
      action: 'brighten',
      result: 'turned-on',
      to: MIN_ON_LEVEL,
      isOn: true,
    };
  }
  const next = Math.min(light.lightLevel + STEP, MAX_LEVEL);
  await setLightAttr(light.id, { lightLevel: next });
  rememberLight(true, next);
  return {
    device: 'light',
    action: 'brighten',
    result: 'brightened',
    from: light.lightLevel,
    to: next,
    isOn: true,
  };
}

// --- SmartThings CLI runner ---
// The CLI hangs when its stdout is a pipe: its update-check subprocess inherits
// the pipe fd and keeps it open after the CLI exits, so a piped-stdio child
// (execFile/spawn) never sees stdout close. Redirect stdio to a temp file
// instead — no pipe, so we resolve cleanly on `exit` — then read the file back.
function runSmartthings(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const outPath = path.join(
      os.tmpdir(),
      `nanoclaw-st-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.out`,
    );
    let fd: number;
    try {
      fd = fs.openSync(outPath, 'w');
    } catch (err) {
      reject(err);
      return;
    }
    const child = spawn(SMARTTHINGS_BIN, args, { stdio: ['ignore', fd, fd] });
    const finish = (code: number | null, signal: NodeJS.Signals | null, err?: Error) => {
      clearTimeout(timer);
      try {
        fs.closeSync(fd);
      } catch {
        /* already closed */
      }
      let out = '';
      try {
        out = fs.readFileSync(outPath, 'utf-8');
      } catch {
        /* nothing written */
      }
      fs.rm(outPath, { force: true }, () => {});
      if (err) {
        reject(err);
      } else if (code === 0) {
        resolve(out);
      } else {
        reject(
          new Error(
            `smartthings ${args.join(' ')} -> ${signal ? `killed (${signal})` : `exit ${code}`}: ${out.trim().slice(0, 300)}`,
          ),
        );
      }
    };
    const timer = setTimeout(() => child.kill('SIGKILL'), 20000);
    child.on('error', (err) => finish(null, null, err));
    child.on('exit', (code, signal) => finish(code, signal));
  });
}

function tvDayModeFromStatus(json: string): string | undefined {
  try {
    return JSON.parse(json)?.components?.main?.switch?.switch?.value;
  } catch {
    return undefined;
  }
}

// --- SmartThings: toggle the TV "day mode" virtual switch ---
async function toggleTvBrightness(): Promise<object> {
  const statusJson = await runSmartthings(['devices:status', TV_DAYMODE_DEVICE, '-j']);
  const current = tvDayModeFromStatus(statusJson);
  const next = current === 'on' ? 'off' : 'on';
  await runSmartthings(['devices:commands', TV_DAYMODE_DEVICE, `switch:${next}`]);
  return {
    device: 'tv',
    action: 'brightness-toggle',
    from: current ?? 'unknown',
    to: next,
  };
}

async function readStatus(): Promise<object> {
  const [light, st] = await Promise.allSettled([
    getLight(),
    runSmartthings(['devices:status', TV_DAYMODE_DEVICE, '-j']),
  ]);
  return {
    light:
      light.status === 'fulfilled'
        ? {
            isOn: light.value.isOn,
            lightLevel: light.value.lightLevel,
            isReachable: light.value.isReachable,
          }
        : `error: ${(light as PromiseRejectedResult).reason?.message}`,
    lightTarget,
    tvDayMode:
      st.status === 'fulfilled'
        ? (tvDayModeFromStatus(st.value) ?? 'unknown')
        : `error: ${(st as PromiseRejectedResult).reason?.message}`,
  };
}

// --- routes ---
// Match on path only; accept GET or POST so dumb HTTP-button apps work either way.
const ACTIONS: Record<string, () => Promise<object>> = {
  '/home/light/dim': dimLight,
  '/home/light/brighten': brightenLight,
  '/home/tv/brightness/toggle': toggleTvBrightness,
  '/home/status': readStatus,
};

const ENDPOINTS = Object.keys(ACTIONS);

export function startHomeApiServer(): http.Server {
  const server = http.createServer((req, res) => {
    const url = (req.url || '').split('?')[0].replace(/\/$/, '') || '/';
    const method = req.method || 'GET';

    if ((url === '/' || url === '/home') && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, endpoints: ENDPOINTS }, null, 2) + '\n');
      return;
    }

    const action = ACTIONS[url];
    if (!action || (method !== 'GET' && method !== 'POST')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found', endpoints: ENDPOINTS }));
      return;
    }

    // Drain any request body we don't care about.
    req.resume();
    action()
      .then((result) => {
        log.info('Home API action', { url, result });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result) + '\n');
      })
      .catch((err) => {
        log.warn('Home API action failed', {
          url,
          err: err?.message ?? String(err),
        });
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err?.message ?? String(err) }) + '\n');
      });
  });

  server.listen(HOME_API_PORT, () => {
    log.info('Home API server listening', { port: HOME_API_PORT });
    console.log(`  Home API: http://0.0.0.0:${HOME_API_PORT}/home (${ENDPOINTS.join(', ')})`);
  });

  return server;
}
