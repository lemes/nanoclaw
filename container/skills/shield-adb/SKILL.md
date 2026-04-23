---
name: shield-adb
description: Control the NVIDIA Shield TV Pro at 192.168.0.112 via ADB. Take screenshots, launch apps, install/uninstall packages, send input events, read logs, inspect device state. Use when the user asks to do anything with the Shield, the TV, Jellyfin on the Shield, or RetroArch.
allowed-tools: Bash(adb:*)
---

# Shield ADB

Wire-level control of the NVIDIA Shield TV Pro via ADB over WiFi. Authorization is pre-arranged: the Mac's RSA keypair (`~/.android/adbkey`) is mounted read-only into the container, and the Shield already trusts that key, so no TV-side dialog appears.

**Target:** `192.168.0.112:5555`

## First-call setup

Every container run starts with no active ADB daemon. Connect once at the start of a session:

```bash
adb connect 192.168.0.112:5555
```

Then scope all subsequent commands with `-s 192.168.0.112:5555` (safer when multiple devices exist) or omit `-s` if it's the only device.

## Capabilities & recipes

### Screenshot

```bash
adb -s 192.168.0.112:5555 exec-out screencap -p > /tmp/shield.png
```

Pipe direct to `exec-out` (not `shell`) to preserve the PNG binary.

### Launch an app

```bash
adb -s 192.168.0.112:5555 shell monkey -p org.jellyfin.androidtv 1
adb -s 192.168.0.112:5555 shell monkey -p com.retroarch 1
adb -s 192.168.0.112:5555 shell monkey -p com.netflix.ninja 1
```

### Send input events

```bash
adb -s 192.168.0.112:5555 shell input keyevent KEYCODE_HOME
adb -s 192.168.0.112:5555 shell input keyevent KEYCODE_BACK
adb -s 192.168.0.112:5555 shell input keyevent 26          # power toggle
adb -s 192.168.0.112:5555 shell input keyevent KEYCODE_DPAD_DOWN
adb -s 192.168.0.112:5555 shell input keyevent KEYCODE_DPAD_CENTER
adb -s 192.168.0.112:5555 shell input keyevent KEYCODE_MEDIA_PLAY_PAUSE
```

### Inspect state

```bash
# What's currently foregrounded
adb -s 192.168.0.112:5555 shell dumpsys activity activities | grep mResumedActivity

# Device info
adb -s 192.168.0.112:5555 shell getprop ro.product.model

# Storage
adb -s 192.168.0.112:5555 shell df -h /data

# Installed user apps
adb -s 192.168.0.112:5555 shell pm list packages -3
```

### Transfer files

```bash
# Push a file from the container to the Shield
adb -s 192.168.0.112:5555 push /workspace/group/somefile /sdcard/Download/

# Pull a file from the Shield to the container
adb -s 192.168.0.112:5555 pull /sdcard/Download/somefile /workspace/group/
```

### Logs

```bash
adb -s 192.168.0.112:5555 logcat -d | grep -i jellyfin | tail -100
```

Use `-d` (dump and exit) not a live tail — a live tail will block the agent.

### Open a URL (e.g. a Jellyfin deep link)

```bash
adb -s 192.168.0.112:5555 shell am start -a android.intent.action.VIEW -d "http://192.168.0.168:8096"
```

## Known device facts (see `../../global/home-media.md` for full spec)

- Shield TV Pro 2019, Android 11, Tegra X1+, 3 GB RAM, 12 GB `/data` (~8.7 GB free)
- Outputs 4K @ 59.94 Hz HDR10 (internal render is 1080p, upscaled via Lanczos / NVIDIA AI)
- Hardware decoders: H.264, HEVC, VP9, Dolby Vision all at 4K. **No AV1.**
- Jellyfin client installed (`org.jellyfin.androidtv`), reads from Mac server at `http://192.168.0.168:8096`
- RetroArch installed (`com.retroarch`), ROMs at `/sdcard/ROMs/`

## Constraints

- No root — system apps can only be removed per-user with `pm uninstall --user 0 <pkg>` (reversible with `cmd package install-existing <pkg>`).
- If `adb connect` returns "failed to authenticate", the RSA key mount isn't in place; report back so the user can debug the host setup.
- If `adb connect` returns "connection refused", Network debugging is off on the Shield (Settings → Device Preferences → Developer options → Network debugging).
- The Shield at the physical IP `192.168.0.112` is the assumption. If the LAN changes, update this file.
