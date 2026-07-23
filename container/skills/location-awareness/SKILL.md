---
name: location-awareness
description: Read live GPS positions for the people you assist (e.g. vin, yasmin) from OwnTracks. Use whenever location context is relevant — "where is X", weather for someone, nearby places, travel/commute time, distance between people, or whether someone is home/at work. Read on demand; do not poll.
allowed-tools: Read, Bash(cat:*), Bash(ls:*)
---

# Location Awareness (OwnTracks live GPS)

Each person's phone runs OwnTracks and posts their GPS over a Tailscale tunnel to
the NanoClaw sidecar, which writes one file per user. The files are mounted
**read-only** into your container.

## Where the data is

```
/workspace/locations/<user>.json
```

One file per person (e.g. `vin.json`, `yasmin.json`). List what's available:

```bash
ls /workspace/locations/
```

Read a person's latest position:

```bash
cat /workspace/locations/vin.json
```

## File shape

```json
{
  "latitude": 59.351774,
  "longitude": 18.005366,
  "accuracy": 15,
  "altitude": 35,
  "velocity": 5,
  "heading": 180,
  "timestamp": "2026-06-20T09:19:51.000Z"
}
```

Only `latitude`, `longitude`, and `timestamp` are guaranteed. `accuracy`,
`altitude`, `velocity`, and `heading` appear only when the phone reports them.

## How to use it

- **Read on demand**, only when location actually matters to the request. Don't
  read these files for unrelated questions.
- Always check `timestamp` — it's the last time the phone reported. OwnTracks
  uses battery-efficient "significant change" reporting, so a position can be
  minutes to hours old. If it's stale, say so rather than implying it's live.
- A **missing file** means that person hasn't reported a location yet (or hasn't
  set up OwnTracks). Don't guess — say you don't have their location.
- These files are **read-only**. You cannot set or update anyone's location.
- Coordinates are decimal degrees (WGS84). Feed them straight into mapping,
  weather, distance, or travel-time lookups.

## Examples

- "Where's Vin?" → read `vin.json`, reverse-geocode or describe the coords, note
  how fresh the `timestamp` is.
- "What's the weather where Yasmin is?" → read `yasmin.json`, use lat/lon for the
  weather lookup.
- "How far apart are we?" → read both files, compute distance from the coords.
