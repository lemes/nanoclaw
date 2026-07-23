---
name: gcal-nango
description: Read and write the user's Google Calendar(s) via the Nango OAuth proxy — list calendars, list/search events, create events, and onboard new accounts. Use when the user asks about their calendar, schedule, meetings, availability, or wants to add an event. Multi-account (per-user connections).
allowed-tools: Bash(curl:*)
---

# Google Calendar (via Nango)

This is the **kept-Nango** path (v2-migration-plan §7B.1): calendar here is genuinely
multi-account — each user has their own Google account behind a Nango `connection_id`,
which OneCLI's single-account `google-calendar` app can't replicate. The OneCLI **"Nango"**
generic secret (hostPattern `nango`) injects auth automatically — never add auth headers.

> **⚠️ v2 carry-over gap (see `docs/v2-migration-followups.md` §1):** these calls hit
> `http://nango:3003`, which requires (1) the Nango proxy running and (2) a `nango` host
> alias wired into the agent container. As of the v1→v2 migration the host alias is **not**
> configured, so `curl http://nango:3003/...` fails with a DNS error until that's done.
> Fix it **once here** and every group's calendar works.

Google Calendar is accessed via Nango's HTTP proxy. No MCP tools — use `curl` in Bash.

**Base URL:** `http://nango:3003/proxy/calendar/v3`
**Required headers:**
```
Provider-Config-Key: google-calendar
Connection-Id: <user-connection-id>
```

**Look up connected users:**
```bash
# List all connected Google Calendar accounts
curl -s http://nango:3003/connections
# Each connection has a connection_id and end_user with id/display_name/email
```

**Common API calls:**
```bash
# List calendars (replace <connection-id> with the user's connection_id from above)
curl -s http://nango:3003/proxy/calendar/v3/users/me/calendarList \
  -H "Provider-Config-Key: google-calendar" \
  -H "Connection-Id: <connection-id>"

# List events (use timeMin/timeMax as query params, ISO 8601)
curl -s "http://nango:3003/proxy/calendar/v3/calendars/primary/events?timeMin=2026-03-28T00:00:00Z&timeMax=2026-03-29T00:00:00Z" \
  -H "Provider-Config-Key: google-calendar" \
  -H "Connection-Id: <connection-id>"

# Create event
curl -s -X POST http://nango:3003/proxy/calendar/v3/calendars/primary/events \
  -H "Provider-Config-Key: google-calendar" \
  -H "Connection-Id: <connection-id>" \
  -H "Content-Type: application/json" \
  -d '{"summary":"Event title","start":{"dateTime":"2026-03-28T10:00:00+01:00"},"end":{"dateTime":"2026-03-28T11:00:00+01:00"}}'
```

Full API reference: https://developers.google.com/calendar/api/v3/reference
Nango handles OAuth token refresh automatically.

**Adding a new user's Google Calendar:**
```bash
# 1. Create a connect session (replace display_name and id with the user's info)
curl -s -X POST http://nango:3003/connect/sessions \
  -H "Content-Type: application/json" \
  -d '{"end_user": {"id": "username", "display_name": "Display Name"}, "allowed_integrations": ["google-calendar"]}'

# 2. From the response, take the "token" field and build this URL:
#    https://viniciuss-macbook-pro.tailc7cd9d.ts.net:3009/?session_token=<token>&apiURL=https%3A%2F%2Fviniciuss-macbook-pro.tailc7cd9d.ts.net
# 3. Send that URL to the user — they open it on any device (phone works via Tailscale)
# 4. After they complete Google sign-in, check their connection:
curl -s http://nango:3003/connections
# 5. Use the new connection_id in future API calls for that user
```
