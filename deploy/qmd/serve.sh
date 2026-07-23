#!/bin/bash
# Supervisor for the qmd conversation-search stack (run by com.nanoclaw.qmd).
#
# Launches ONE isolated qmd MCP server per group (own config + DB, shared models)
# on a private loopback port, and generates a token-routed caddy site so the
# single container-facing port (:8182) dispatches each request to the caller's
# own instance — and only that instance. No valid token => 403 (closes the LAN
# hole). New groups are picked up automatically on the next loop.
set -uo pipefail
source "$(dirname "$0")/lib.sh"

[ -x "$QMD" ] || { echo "qmd not installed at $QMD" >&2; exit 1; }
mkdir -p "$INST_DIR"

# Generate the caddy include for the current group set. Returns the content on
# stdout; caller compares to the live file to decide whether to reload.
gen_caddy() {
  printf ':%s {\n' "$GATEWAY_PORT"
  local group port token
  for group in $(group_list); do
    port="$(get_port "$group")"
    token="$(get_token "$group")"
    printf '\t@g_%s header Authorization "Bearer %s"\n' "$group" "$token"
    printf '\thandle @g_%s {\n\t\treverse_proxy [::1]:%s\n\t}\n' "$group" "$port"
  done
  printf '\trespond "qmd: unauthorized" 403\n'
  printf '}\n'
}

sync_caddy() {
  local new; new="$(gen_caddy)"
  if [ ! -f "$CADDY_INCLUDE" ] || [ "$new" != "$(cat "$CADDY_INCLUDE")" ]; then
    printf '%s\n' "$new" > "$CADDY_INCLUDE"
    caddy reload --config "$REPO/Caddyfile" >/dev/null 2>&1 \
      && echo "[qmd-serve] caddy reloaded ($(group_list | tr '\n' ' '))" \
      || echo "[qmd-serve] WARN caddy reload failed"
  fi
}

start_instance() {
  local group="$1" port; port="$(get_port "$group")"
  mkdir -p "$(cfg_dir "$group")"
  XDG_CONFIG_HOME="$(cfg_dir "$group")" INDEX_PATH="$(index_path "$group")" \
    "$QMD" mcp --http --port "$port" >>"$REPO/logs/qmd.log" 2>&1 &
  echo $! > "$(inst_path "$group")/pid"
  echo "[qmd-serve] started $group on [::1]:$port (pid $!)"
}

instance_alive() {
  local group="$1" pidf; pidf="$(inst_path "$group")/pid"
  [ -f "$pidf" ] && kill -0 "$(cat "$pidf")" 2>/dev/null
}

cleanup() {
  local group
  for group in $(group_list); do
    [ -f "$(inst_path "$group")/pid" ] && kill "$(cat "$(inst_path "$group")/pid")" 2>/dev/null || true
  done
  exit 0
}
trap cleanup TERM INT

# Supervise loop: keep one instance per group alive; reconcile caddy on changes.
while true; do
  for group in $(group_list); do
    instance_alive "$group" || start_instance "$group"
  done
  sync_caddy
  sleep 10
done
