# TREK deployment

Docker + Caddy + Google Places API configuration for the self-hosted TREK
instance used by nanoclaw.

## Container

- `compose.yml` — binds `127.0.0.1:3000`; external access goes through Caddy.
- `.env` (gitignored) — holds `ENCRYPTION_KEY` only. Admin user was seeded on
  first boot and the password has since been rotated via the UI.
- `data/` + `uploads/` (gitignored) — SQLite DB, JWT/encryption keys, and user
  uploads. Back these up separately.

Internal URL: `http://127.0.0.1:3000`
External URL: `https://viniciuss-macbook-pro.tailc7cd9d.ts.net:8444` (Caddy terminates TLS via Tailscale cert; see repo-root `Caddyfile`).

## Google Cloud configuration

TREK calls Places API (New) server-side from `mapsService.ts` and
`authService.ts`. Google sees requests originating from the Mac's public
IPv4; no `Referer` header is sent (server-side `fetch`, not browser).

All commands below run against:

- **Project**: `<project-id>`
- **Billing account**: `<billing-account-id>` — "My Maps Billing Account" (SEK)

### Budget alert

Monthly budget on the Maps billing account with thresholds at 50/90/100 % actual
spend plus forecasted-100 % (earliest warning signal). Email notifications go
to billing admins.

```bash
gcloud billing budgets create \
  --billing-account=<billing-account-id> \
  --display-name="TREK/Maps budget alert" \
  --budget-amount=50SEK \
  --threshold-rule=percent=0.5 \
  --threshold-rule=percent=0.9 \
  --threshold-rule=percent=1.0 \
  --threshold-rule=percent=1.0,basis=forecasted-spend
```

### Daily quota caps (runaway protection)

Five of the seven Places API (New) metrics expose a `1/d/{project}` limit.
Defaults are 125 000–175 000/day; these caps are well below that but above
expected personal use.

| Metric | Daily cap |
| --- | --- |
| `AutocompletePlacesRequest` | 500 |
| `GetPhotoMediaRequest` | 200 |
| `GetPlaceRequest` | 100 |
| `SearchTextRequest` | 50 |
| `SearchNearbyRequest` | 50 |

```bash
for pair in AutocompletePlacesRequest:500 GetPhotoMediaRequest:200 GetPlaceRequest:100 SearchTextRequest:50 SearchNearbyRequest:50; do
  metric=${pair%:*}; value=${pair#*:}
  gcloud alpha services quota update \
    --consumer=projects/<project-id> \
    --service=places.googleapis.com \
    --metric=places.googleapis.com/$metric \
    --unit="1/d/{project}" --value=$value --force
done
```

### Per-minute quota caps (the other two metrics)

`SearchMediaRequest` and `SearchReviewPostsRequest` don't expose a daily unit.
They're capped per-minute instead:

| Metric | Per-minute cap |
| --- | --- |
| `SearchMediaRequest` | 30 |
| `SearchReviewPostsRequest` | 30 |

```bash
for m in SearchMediaRequest SearchReviewPostsRequest; do
  gcloud alpha services quota update \
    --consumer=projects/<project-id> \
    --service=places.googleapis.com \
    --metric=places.googleapis.com/$m \
    --unit="1/min/{project}" --value=30 --force
done
```

### API key restrictions

**Not applied.** The right restriction for TREK's server-side Places calls is
by IP, not HTTP referrer (referrer restrictions fail because `fetch()` from
Node doesn't send a `Referer`). A single IP restriction would work, but the
Mac's public IPv4 may be dynamic, and the budget alert + quota caps already
provide budget protection. Revisit if the key is ever suspected leaked.

To re-enable later: GCP Console → APIs & Services → Credentials → select the
key → Application restrictions → IP addresses → add current `curl ipify.org`
value; API restrictions → limit to "Places API" and "Places API (New)".

## TREK MCP (nanoclaw integration)

See the main repo README and `docs/ONECLI-PROXY.md` for the OneCLI side.
Relevant pieces in this integration:

- MCP URL in `container/agent-runner/src/index.ts` points at the Caddy HTTPS
  endpoint (needed so undici's CONNECT-via-HTTPS-PROXY matches OneCLI's MITM).
- OneCLI secret "TREK MCP" — `hostPattern: viniciuss-macbook-pro.tailc7cd9d.ts.net`,
  `pathPattern: /mcp`, injects `Authorization: Bearer trek_...`.
- Selective-mode OneCLI agents (per-group) need the TREK secret explicitly
  granted via `onecli agents set-secrets`; default agent gets it automatically.
