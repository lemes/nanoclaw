---
name: shield-adb
description: Control an NVIDIA Shield TV via ADB over WiFi. Take screenshots, launch apps, install/uninstall packages, send input events, read logs, inspect device state. Use when the user asks to do anything with the Shield TV, its installed apps (Jellyfin, RetroArch, Netflix, etc.), or to look at what's on the TV screen.
allowed-tools: Bash(adb:*)
---

# Shield ADB

Wire-level control of an NVIDIA Shield TV via ADB over WiFi. The host Mac's ADB keypair is mounted read-only at `~/.android`, so the Shield accepts the container's identity without a TV-side authorization dialog.

## Setup (host)

Set `SHIELD_IP` to the Shield's `host:port` on the host, then restart NanoClaw so the container sees it:

```
# In your NanoClaw .env (gitignored)
SHIELD_IP=192.168.0.112:5555
```

ADB network debugging must be enabled on the Shield: Settings → Device Preferences → Developer options → **Network debugging**.

If `SHIELD_IP` is unset inside the container, every snippet below will fail fast with a clear message — tell the user to set it and restart NanoClaw.

## First-call setup (per container run)

Each container starts with no active ADB daemon. Connect once at the top of the session:

```bash
adb connect "${SHIELD_IP:?SHIELD_IP is not set - configure it in the host .env}"
```

Then scope subsequent commands with `-s "$SHIELD_IP"` (safer when multiple devices exist).

## Capabilities & recipes

### Screenshot

```bash
adb -s "$SHIELD_IP" exec-out screencap -p > /tmp/shield.png
```

Pipe direct to `exec-out` (not `shell`) to preserve the PNG binary.

### Launch an app

```bash
adb -s "$SHIELD_IP" shell monkey -p org.jellyfin.androidtv 1
adb -s "$SHIELD_IP" shell monkey -p com.retroarch 1
adb -s "$SHIELD_IP" shell monkey -p com.netflix.ninja 1
```

### Send input events

```bash
adb -s "$SHIELD_IP" shell input keyevent KEYCODE_HOME
adb -s "$SHIELD_IP" shell input keyevent KEYCODE_BACK
adb -s "$SHIELD_IP" shell input keyevent 26          # power toggle
adb -s "$SHIELD_IP" shell input keyevent KEYCODE_DPAD_DOWN
adb -s "$SHIELD_IP" shell input keyevent KEYCODE_DPAD_CENTER
adb -s "$SHIELD_IP" shell input keyevent KEYCODE_MEDIA_PLAY_PAUSE
```

### Inspect state

```bash
# What's currently foregrounded
adb -s "$SHIELD_IP" shell dumpsys activity activities | grep mResumedActivity

# Device info
adb -s "$SHIELD_IP" shell getprop ro.product.model

# Storage
adb -s "$SHIELD_IP" shell df -h /data

# Installed user apps
adb -s "$SHIELD_IP" shell pm list packages -3
```

### Transfer files

```bash
adb -s "$SHIELD_IP" push /workspace/group/somefile /sdcard/Download/
adb -s "$SHIELD_IP" pull /sdcard/Download/somefile /workspace/group/
```

### Logs

```bash
adb -s "$SHIELD_IP" logcat -d | grep -i jellyfin | tail -100
```

Use `-d` (dump and exit) not a live tail — a live tail will block the agent.

### Open a URL (e.g. a Jellyfin deep link)

```bash
adb -s "$SHIELD_IP" shell am start -a android.intent.action.VIEW -d "http://<jellyfin-host>:8096"
```

### Find the remote (make it beep)

```bash
adb -s "$SHIELD_IP" shell monkey -p com.nvidia.remotelocator 1
```

Launches NVIDIA's built-in Remote Locator app, which triggers the remote to beep via Bluetooth.

## Constraints

- No root — system apps can only be removed per-user with `pm uninstall --user 0 <pkg>` (reversible with `cmd package install-existing <pkg>`).
- If `adb connect` returns **"failed to authenticate"**, the RSA key mount isn't in place; report back so the user can debug the host setup (`~/.android` needs to exist and be mounted into the container).
- If `adb connect` returns **"connection refused"**, Network debugging is off on the Shield — toggle it off and back on to restart the ADB daemon.
- If the container can reach the router (192.168.0.1) but not the Shield, **Tailscale may be blocking LAN access**. Fix: Tailscale → enable "Allow local network access".
- If `$SHIELD_IP` is unset, tell the user to add `SHIELD_IP=<host>:<port>` to the NanoClaw `.env` and restart.
