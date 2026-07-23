#!/bin/bash
# Deploy the qmd conversation-search stack (per-group isolation + token auth).
# Idempotent — safe to re-run.
#
#   1. Install the qmd CLI into ~/.nanoclaw-qmd (isolated from the pnpm workspace
#      so native build scripts don't touch the supply-chain policy).
#   2. Build each group's isolated index + embeddings (refresh.sh).
#   3. Ensure the Caddyfile imports the generated, token-routed qmd site.
#   4. Load the launchd services (supervisor + hourly refresh). The supervisor
#      starts per-group servers and writes/reloads the caddy include.
#   5. Wire each group's container with the qmd MCP URL + its OWN bearer token.
#
# Run AFTER reviewing the branch. Re-running only applies what's missing.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

LA="$HOME/Library/LaunchAgents"
QMD_VERSION="2.5.3"
MCP_URL="http://host.docker.internal:$GATEWAY_PORT/mcp"
IMPORT_LINE="import $CADDY_INCLUDE"

echo "==> 1/5 install qmd@$QMD_VERSION into $QDIR"
mkdir -p "$QDIR"; cd "$QDIR"
[ -f package.json ] || npm init -y >/dev/null
npm install "@tobilu/qmd@$QMD_VERSION" >/dev/null
echo "    qmd $("$QMD" --version 2>/dev/null || echo '?')"

echo "==> 2/5 build per-group indexes (first run downloads ~1.6GB of models)"
bash "$REPO/deploy/qmd/refresh.sh"

echo "==> 3/5 ensure Caddyfile imports the token-routed qmd site"
# Generate an initial include so caddy can validate the import target.
mkdir -p "$INST_DIR"; [ -f "$CADDY_INCLUDE" ] || printf ':%s {\n\trespond 403\n}\n' "$GATEWAY_PORT" > "$CADDY_INCLUDE"
if ! grep -qF "$IMPORT_LINE" "$REPO/Caddyfile"; then
  # Drop any earlier inline :8182 block from the first design, then import.
  printf '\n# qmd conversation search (deploy/qmd) — token-routed, generated include.\n%s\n' "$IMPORT_LINE" >> "$REPO/Caddyfile"
  echo "    added: $IMPORT_LINE"
else
  echo "    import already present"
fi

echo "==> 4/5 load launchd services"
mkdir -p "$REPO/logs"
for svc in com.nanoclaw.qmd com.nanoclaw.qmd-refresh; do
  cp "$REPO/deploy/qmd/$svc.plist" "$LA/$svc.plist"
  launchctl bootout "gui/$(id -u)/$svc" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$LA/$svc.plist"
  echo "    loaded $svc"
done

echo "==> 5/5 wire qmd MCP into each group (own token)"
NCL="$REPO/node_modules/.bin/ncl"; [ -x "$NCL" ] || NCL="ncl"
for group in $(group_list); do
  gid="$("$NCL" groups list 2>/dev/null | grep -E "[[:space:]]$group[[:space:]]" | grep -oE 'ag-[0-9]+-[a-z0-9]+' | head -1)"
  [ -n "$gid" ] || { echo "    !! no agent group id for folder $group — wire manually"; continue; }
  token="$(get_token "$group")"
  "$NCL" groups config add-mcp-server --id "$gid" --name qmd \
    --url "$MCP_URL" --headers "{\"Authorization\":\"Bearer $token\"}" >/dev/null 2>&1 \
    && echo "    wired qmd into $group ($gid)" \
    || echo "    (qmd already wired or skipped for $group)"
done

echo
echo "Done. Restart each group to pick up the MCP server:"
echo "  ncl groups restart --id <group-id>"
echo "Each group reaches only its own collection; calls without its token get 403."
