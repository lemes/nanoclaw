#!/bin/bash
# Shared config + helpers for the qmd conversation-search stack.
# Sourced by install.sh, serve.sh, refresh.sh. Kept bash-3.2 compatible
# (macOS /bin/bash) — no associative arrays, no `wait -n`.

# launchd runs with a minimal PATH (/usr/bin:/bin:/usr/sbin:/sbin) that lacks
# Homebrew's bin. qmd's shebang is `#!/usr/bin/env node` and we also shell out
# to `caddy`; both live in /opt/homebrew/bin. Without this, the launchd jobs
# fail with `env: node: No such file or directory` and caddy reloads no-op.
export PATH="/opt/homebrew/bin:$PATH"

REPO="/Users/vin/code/nanoclaw"
QDIR="$HOME/.nanoclaw-qmd"
QMD="$QDIR/node_modules/.bin/qmd"
GROUPS_DIR="$REPO/groups"
INST_DIR="$QDIR/inst"            # per-group state: cfg/, index.sqlite, token, pid
PORTS_FILE="$QDIR/ports.tsv"     # stable group<TAB>port assignments (never reused)
CADDY_INCLUDE="$QDIR/qmd.caddy"  # generated caddy site (tokens) — outside the repo
BASE_PORT=8190                   # per-group loopback ports start here
GATEWAY_PORT=8182                # single container-facing port (caddy, token-routed)

# Groups that have a conversations/ dir, sorted, one per line.
group_list() {
  local d
  for d in "$GROUPS_DIR"/*/conversations; do
    [ -d "$d" ] && basename "$(dirname "$d")"
  done | sort
}

# Stable port for a group. Assigned once, persisted, never reused on delete.
get_port() {
  local group="$1" line port maxp
  [ -f "$PORTS_FILE" ] || : > "$PORTS_FILE"
  line="$(grep -E "^${group}	" "$PORTS_FILE" 2>/dev/null | head -1)"
  if [ -n "$line" ]; then
    printf '%s\n' "$line" | cut -f2; return
  fi
  maxp="$(cut -f2 "$PORTS_FILE" 2>/dev/null | sort -n | tail -1)"
  [ -n "$maxp" ] || maxp=$((BASE_PORT - 1))
  port=$((maxp + 1))
  printf '%s\t%s\n' "$group" "$port" >> "$PORTS_FILE"
  printf '%s\n' "$port"
}

inst_path()  { printf '%s/%s\n' "$INST_DIR" "$1"; }            # base dir for a group
cfg_dir()    { printf '%s/%s/cfg\n' "$INST_DIR" "$1"; }        # XDG_CONFIG_HOME
index_path() { printf '%s/%s/index.sqlite\n' "$INST_DIR" "$1"; } # INDEX_PATH

# Get-or-create a per-group bearer token (48 hex chars).
get_token() {
  local group="$1" f; f="$(inst_path "$group")/token"
  mkdir -p "$(inst_path "$group")"
  if [ ! -s "$f" ]; then
    ( umask 077; openssl rand -hex 24 > "$f" )
  fi
  cat "$f"
}

# Run a qmd subcommand against a group's ISOLATED config + DB (shared models).
qmd_for() {
  local group="$1"; shift
  mkdir -p "$(cfg_dir "$group")"
  XDG_CONFIG_HOME="$(cfg_dir "$group")" INDEX_PATH="$(index_path "$group")" \
    "$QMD" "$@"
}
