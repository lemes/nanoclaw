---
name: web-publish
description: Create web pages that are instantly accessible via a shareable URL. Write HTML/CSS/JS files to the public directory and send the user a clickable link.
---

# Web Publish

Create web pages, dashboards, reports, or any static content and serve it as a live URL the user can open on any device.

## How it works

Files you write to `/workspace/group/public/` are served instantly by Caddy over HTTPS on the user's Tailscale network.

## Base URL

```
https://viniciuss-macbook-pro.tailc7cd9d.ts.net:8443/{group}/
```

Get your group name from the environment:

```bash
echo $NANOCLAW_GROUP_FOLDER
```

## Publishing a page

1. Create the public directory if it doesn't exist:

```bash
mkdir -p /workspace/group/public
```

2. Write your HTML file:

```bash
# Example: a simple report
cat > /workspace/group/public/report.html << 'HTMLEOF'
<!DOCTYPE html>
<html><head><title>Report</title></head>
<body><h1>Hello from NanoClaw</h1></body>
</html>
HTMLEOF
```

3. Send the user the link:

```
https://viniciuss-macbook-pro.tailc7cd9d.ts.net:8443/$NANOCLAW_GROUP_FOLDER/report.html
```

Always resolve `$NANOCLAW_GROUP_FOLDER` to the actual value before sending the link.

## Guidelines

- **Self-contained pages preferred** — inline CSS/JS when possible so a single `.html` file is all that's needed.
- **For multi-file sites** — use subdirectories (e.g., `/workspace/group/public/dashboard/index.html` with assets alongside it).
- **File names** — use lowercase, hyphens, no spaces (e.g., `weekly-report.html`, `budget-tracker.html`).
- **Always send the full URL** to the user after creating the page so they can open it immediately.
- **Overwrite is fine** — updating a file updates the live page instantly.
- **No server-side logic** — this is static file serving only. Use JavaScript for interactivity.

## Good use cases

- Data visualizations and charts (use Chart.js, D3, etc. via CDN)
- Reports and summaries formatted as nice HTML
- Interactive tools (calculators, converters, planners)
- Photo galleries or media pages
- Shareable reference pages (cheat sheets, lookup tables)
