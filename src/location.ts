import fs from 'fs';
import http from 'http';
import path from 'path';

import { GROUPS_DIR } from './config.js';
import { logger } from './logger.js';

export const LOCATION_PORT = parseInt(
  process.env.LOCATION_PORT || '7100',
  10,
);

const LOCATIONS_DIR = path.join(GROUPS_DIR, 'global', 'locations');

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
  // OwnTracks sends _type: "location" with lat/lon fields
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
    timestamp: body.tst
      ? new Date(body.tst * 1000).toISOString()
      : new Date().toISOString(),
  };
}

function persistLocation(user: string, loc: LocationUpdate): void {
  fs.mkdirSync(LOCATIONS_DIR, { recursive: true });
  const file = path.join(LOCATIONS_DIR, `${user}.json`);
  fs.writeFileSync(file, JSON.stringify(loc, null, 2) + '\n');
}

function readLocation(user: string): string | null {
  const file = path.join(LOCATIONS_DIR, `${user}.json`);
  try {
    return fs.readFileSync(file, 'utf-8');
  } catch {
    return null;
  }
}

function readAllLocations(): Record<string, LocationUpdate> {
  try {
    const files = fs.readdirSync(LOCATIONS_DIR).filter((f) => f.endsWith('.json'));
    const result: Record<string, LocationUpdate> = {};
    for (const file of files) {
      const user = path.basename(file, '.json');
      const data = fs.readFileSync(path.join(LOCATIONS_DIR, file), 'utf-8');
      result[user] = JSON.parse(data);
    }
    return result;
  } catch {
    return {};
  }
}

/** Extract user name from URL path: /location/vin → "vin" */
function parseUserFromUrl(url: string): string | null {
  const match = url.match(/^\/location\/([a-zA-Z0-9_-]+)\/?$/);
  return match ? match[1].toLowerCase() : null;
}

export function startLocationServer(): http.Server {
  const server = http.createServer((req, res) => {
    const url = (req.url || '').split('?')[0];
    const user = parseUserFromUrl(url);

    // POST /location/:user — update a user's location
    if (req.method === 'POST' && user) {
      let data = '';
      req.on('data', (chunk) => (data += chunk));
      req.on('end', () => {
        try {
          const body = JSON.parse(data);
          const loc = handleOwnTracksPayload(body);
          if (!loc) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end('[]');
            return;
          }
          persistLocation(user, loc);
          logger.info(
            { user, lat: loc.latitude, lon: loc.longitude },
            'Location updated',
          );
          // OwnTracks expects a JSON array response
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('[]');
        } catch (err) {
          logger.warn({ err, user }, 'Invalid location payload');
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid payload' }));
        }
      });
      return;
    }

    // GET /location/:user — read a single user's location
    if (req.method === 'GET' && user) {
      const loc = readLocation(user);
      if (loc) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(loc);
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `no location data for ${user}` }));
      }
      return;
    }

    // GET /location — read all users' locations
    if (req.method === 'GET' && (url === '/' || url === '/location' || url === '/location/')) {
      const all = readAllLocations();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(all, null, 2) + '\n');
      return;
    }

    res.writeHead(404);
    res.end();
  });

  server.listen(LOCATION_PORT, () => {
    logger.info({ port: LOCATION_PORT }, 'Location server listening');
    console.log(`  Location endpoint: http://0.0.0.0:${LOCATION_PORT}/location/:user`);
  });

  return server;
}
