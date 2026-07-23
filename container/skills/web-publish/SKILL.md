---
name: web-publish
description: Create web pages that are instantly accessible via a shareable URL. Write HTML/CSS/JS files to the shared apps directory and send the user a clickable link.
---

# Web Publish

Create web pages, dashboards, reports, or any static content and serve it as a live URL the user can open on any device.

## How it works

Files you write to `/workspace/extra/apps/` are served instantly by Caddy over HTTPS on the user's Tailscale network, from a single shared publishing space at `/apps/`. Pages live independently of any group — they survive even if a group is deleted, and any group can read them.

> **Write access:** the shared space is read-write only for publisher groups. If a write fails with a read-only/permission error, this group is mounted read-only — tell the user the page can't be published from here.

## Base URL

```
https://viniciuss-macbook-pro.tailc7cd9d.ts.net:8443/apps/
```

The path is the same for every group — no group folder in the URL.

## Publishing a page

1. Write your HTML file into the shared apps directory:

```bash
# Example: a simple report
cat > /workspace/extra/apps/report.html << 'HTMLEOF'
<!DOCTYPE html>
<html><head><title>Report</title></head>
<body><h1>Hello from NanoClaw</h1></body>
</html>
HTMLEOF
```

2. Send the user the link:

```
https://viniciuss-macbook-pro.tailc7cd9d.ts.net:8443/apps/report.html
```

## Guidelines

- **Self-contained pages preferred** — inline CSS/JS when possible so a single `.html` file is all that's needed.
- **For multi-file sites** — use subdirectories (e.g., `/workspace/extra/apps/dashboard/index.html` with assets alongside it).
- **Shared namespace** — all groups publish into the same tree, so pick distinctive names. Use a subdirectory (e.g. `/workspace/extra/apps/<topic>/…`) to group related pages and avoid clobbering another page.
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
