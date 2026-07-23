---
name: tvoverlay
description: Send on-screen notifications and overlays to the NVIDIA Shield TV via TvOverlay REST API. Use when the user wants to push a message, alert, or notification to the TV screen.
---

# TvOverlay

Send visible on-screen notifications to the NVIDIA Shield TV using the TvOverlay app's REST API.

**TvOverlay** is installed on the Shield (v10030) and runs as a persistent overlay service.
**API base:** `http://${SHIELD_IP%:*}:5001`

## Send a notification

```bash
curl -s -X POST "http://${SHIELD_IP%:*}:5001/notify" \
  -H "Content-Type: application/json" \
  -d '{"title":"Greg","message":"Your message here","duration":8}'
```

### `/notify` fields

| Field | Description | Type | Default | Optional |
|---|---|---|---|---|
| id | Unique identifier (for editing in queue) | string | random | ✓ |
| title | Main text | string | null | ✓ |
| message | Secondary text | string | null | ✓ |
| source | Extra info text | string | null | ✓ |
| image | MDI icon, image URL, or base64 bitmap | string | null | ✓ |
| video | Video URL (RTSP, HLS, DASH, SmoothStreaming) | string | null | ✓ |
| largeIcon | Large icon (MDI, URL, or base64) | string | null | ✓ |
| smallIcon | Small icon | string | null | ✓ |
| smallIconColor | Hex color tint for smallIcon | string | null | ✓ |
| corner | Position: `bottom_start`, `bottom_end`, `top_start`, `top_end` | string | hot corner setting | ✓ |
| duration | Seconds visible | integer | duration setting | ✓ |

## Send a fixed/persistent notification

```bash
curl -s -X POST "http://${SHIELD_IP%:*}:5001/notify_fixed" \
  -H "Content-Type: application/json" \
  -d '{"message":"Persistent message","icon":"mdi:bell"}'
```

### `/notify_fixed` fields

| Field | Description | Type | Default | Optional |
|---|---|---|---|---|
| id | Unique identifier | string | random | ✓ |
| visible | Whether visible | boolean | true | ✓ |
| icon | MDI icon, URL, or base64 | string | null | ✓ |
| message | Text to display | string | null | ✓ |
| messageColor | Text color (hex) | string | #FFFFFF | ✓ |
| iconColor | Icon color tint | string | null | ✓ |
| borderColor | Border color | string | #FFFFFF | ✓ |
| backgroundColor | Background color | string | #66000000 | ✓ |
| shape | `circle`, `rounded`, `rectangular` | string | rounded | ✓ |
| expiration | Epoch, `1y2w3d4h5m6s`, or seconds | string/int | null | ✓ |

## Overlay control

```bash
curl -s -X POST "http://${SHIELD_IP%:*}:5001/set/overlay" \
  -H "Content-Type: application/json" \
  -d '{"clockOverlayVisibility":50,"hotCorner":"top_end"}'
```

| Field | Description | Type |
|---|---|---|
| clockOverlayVisibility | Clock visibility (0–95) | integer |
| overlayVisibility | Background visibility (0–95) | integer |
| hotCorner | `bottom_start`, `bottom_end`, `top_start`, `top_end` | string |

## Notification settings

```bash
curl -s -X POST "http://${SHIELD_IP%:*}:5001/set/notifications" \
  -H "Content-Type: application/json" \
  -d '{"notificationDuration":8}'
```

| Field | Description | Type |
|---|---|---|
| displayNotifications | Show notifications | boolean |
| displayFixedNotifications | Show fixed notifications | boolean |
| notificationLayoutName | Layout name | string |
| notificationDuration | Duration in seconds | integer |
| fixedNotificationsVisibility | Visibility -1–95 (-1 = same as clock) | integer |

## Check status

```bash
curl -s "http://${SHIELD_IP%:*}:5001/"
```

Key fields in response:
- `status.permissionState` — should be `GRANTED`
- `status.batteryOptimizationState` — should be `BLOCKED` (whitelisted)
- `notifications.displayNotifications` — should be `true`

## Notes

- Works over LAN — the container can reach the Shield directly via `$SHIELD_IP`
- Notifications appear as an overlay on top of any app or the home screen
- If TvOverlay stops running, restart via ADB: `adb -s "$SHIELD_IP" shell am start -n com.tabdeveloper.tvoverlay/.SetupActivity`
- `SYSTEM_ALERT_WINDOW` permission is granted, battery optimization is whitelisted
