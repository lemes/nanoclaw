# Location Awareness

NanoClaw can track live GPS positions for multiple users so the agent knows where everyone is. Location data flows from each user's phone to the agent automatically via OwnTracks and a Tailscale tunnel.

## How It Works

```
Phone (OwnTracks)
  │  HTTP POST to /location/:user
  ▼
Tailscale tunnel (encrypted WireGuard mesh)
  │
  ▼
NanoClaw location server (port 7100)
  │  Parses OwnTracks payload, writes per-user file
  ▼
groups/global/locations/:user.json
  │  Mounted read-only into agent containers
  ▼
Agent reads on demand when location context is relevant
```

### 1. OwnTracks (phone)

[OwnTracks](https://owntracks.org/) runs in the background on your phone and sends your GPS coordinates over HTTP on significant location changes. The payload looks like:

```json
{
  "_type": "location",
  "lat": 59.351774,
  "lon": 18.005366,
  "acc": 15,
  "alt": 35,
  "tst": 1711569591
}
```

Non-location events (`_type: "transition"`, `_type: "waypoint"`, etc.) are ignored.

### 2. Tailscale tunnel

[Tailscale](https://tailscale.com/) (free for personal use) creates an encrypted WireGuard tunnel between your phone and Mac. OwnTracks POSTs to `http://<mac-tailscale-ip>:7100/location/<user>`. This works from any network — home wifi, mobile data, roaming.

### 3. Location server (`src/location.ts`)

A plain Node.js HTTP server started at NanoClaw boot.

**Endpoints:**

| Method | Path | Description |
|---|---|---|
| POST | `/location/:user` | Update a user's location (OwnTracks sends here) |
| GET | `/location/:user` | Read a single user's latest location |
| GET | `/location` | Read all users' locations |

On each POST it:

1. Parses the JSON body
2. Validates `_type` is `"location"` (or absent)
3. Extracts and normalizes fields (`lat`→`latitude`, `lon`→`longitude`, `acc`→`accuracy`, `alt`→`altitude`, `vel`→`velocity`, `cog`→`heading`)
4. Converts `tst` (Unix epoch seconds) to an ISO 8601 timestamp
5. Writes to `groups/global/locations/<user>.json`
6. Returns `[]` (OwnTracks expects a JSON array response)

Only the latest position per user is stored — no history. User names in the URL are lowercased and must match `[a-zA-Z0-9_-]`.

### 4. Container mount

| Group type | Mount path | Access |
|---|---|---|
| Non-main groups | `/workspace/global/locations/*.json` | Read-only (via `groups/global/` mount) |
| Main group | `/workspace/project/groups/global/locations/*.json` | Read-only (via project root mount) |

### 5. Agent usage

The agent instructions in `groups/global/CLAUDE.md` tell the agent to read files in `/workspace/global/locations/` when location context is relevant — weather, nearby places, travel time, distance between users, etc. Each user has their own file (e.g. `vin.json`, `yasmin.json`). The agent reads on demand, not by polling.

## Setup

### Step 1: Install Tailscale

Tailscale creates an encrypted tunnel between your phone and Mac so they can reach each other from any network. Free for personal use (up to 100 devices).

**On your Mac:**

1. Download from [tailscale.com/download](https://tailscale.com/download) or install via Homebrew:
   ```bash
   brew install --cask tailscale
   ```
2. Open Tailscale from Applications and sign in (Google, Apple, GitHub, etc.)
3. Tailscale appears in your menu bar — click it and confirm it's connected

**On your iPhone:**

1. Install **Tailscale** from the App Store
2. Open it and sign in with the **same account** you used on your Mac
3. Toggle the VPN on when prompted — both devices are now on the same tailnet

**Verify the connection:**

```bash
# On your Mac, find its Tailscale IP
tailscale ip -4
# Example output: 100.67.119.72

# Confirm your phone can reach it (ping from phone, or just proceed to the next step)
```

### Step 2: Install and configure OwnTracks

OwnTracks is a free, open-source app that silently tracks your GPS in the background and sends updates over HTTP.

**On your iPhone:**

1. Install **OwnTracks** from the App Store
2. Open OwnTracks and allow location access — choose **"Always"** so it works in the background
3. Tap the **ⓘ** button (top left corner) → **Settings**
4. Set **Mode** to **HTTP** (tap the mode indicator at the top)
5. Tap **URL** and enter:
   ```
   http://<mac-tailscale-ip>:7100/location/<your-name>
   ```
   Replace `<mac-tailscale-ip>` with the IP from Step 1, and `<your-name>` with your name (e.g. `http://100.67.119.72:7100/location/vin`)
6. Leave **Authentication** empty (no user/password needed)
7. Go back to the map screen
8. Tap the **upload arrow** (top right) to send a manual location update

**Reporting settings (optional):**

- By default OwnTracks uses "Significant changes" mode — it sends updates when you move ~500m or change cell towers. This is battery-efficient.
- For more frequent updates: Settings → **Reporting** → switch to **Move** mode, and set a desired interval (e.g. 60 seconds). This uses more battery.

### Step 3: Verify it works

After sending a manual update from OwnTracks, check that NanoClaw received it:

```bash
# Read your location
curl http://localhost:7100/location/vin

# Read all users' locations
curl http://localhost:7100/location
```

You should see:
```json
{
  "vin": {
    "latitude": 59.351774,
    "longitude": 18.005366,
    "accuracy": 15,
    "altitude": 35,
    "timestamp": "2026-03-27T20:19:51.000Z"
  }
}
```

Or read the file directly:
```bash
cat groups/global/locations/vin.json
```

If you get `{"error":"no location data for vin"}`, check:
- Is Tailscale connected on both devices? (green icon in menu bar / VPN active on phone)
- Is NanoClaw running? (`launchctl list | grep nanoclaw`)
- Is OwnTracks set to HTTP mode with the correct URL (including `/vin` at the end)?

**Send a test update from your Mac** (useful for debugging without your phone):

```bash
curl -X POST http://localhost:7100/location/vin \
  -d '{"_type":"location","lat":59.33,"lon":18.07,"tst":1711540800}'
```

### Adding more users

Each person installs Tailscale + OwnTracks on their phone and sets their OwnTracks URL to:

```
http://<mac-tailscale-ip>:7100/location/<their-name>
```

Their location appears at `groups/global/locations/<their-name>.json` and is readable by all groups. No server-side configuration needed — just a new URL.

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `LOCATION_PORT` | `7100` | Port for the location HTTP server |

Set in `.env` to override:
```
LOCATION_PORT=8080
```

## File structure

```
groups/global/locations/
├── vin.json
├── yasmin.json
└── ...
```

Each file contains:

```json
{
  "latitude": 59.351774,
  "longitude": 18.005366,
  "accuracy": 15,
  "altitude": 35,
  "velocity": 5,
  "heading": 180,
  "timestamp": "2026-03-27T20:19:51.000Z"
}
```

Not every field is always present — `accuracy`, `altitude`, `velocity`, and `heading` depend on what the phone reports.

## Future: Geofence triggers

The location server can be extended to support geofence-based triggers — e.g., "when I arrive at the office, run a task". This would involve storing named waypoints and comparing each incoming location update against them.
