#!/bin/bash
# (Re)build each group's ISOLATED qmd index. One config + DB per group, so a
# group's instance can only ever see its own conversations.
#
# For each groups/<folder>/conversations:
#   - ensure that group's isolated index has a collection pointing at it
#   - re-index changed transcripts (qmd update) + refresh vectors (qmd embed)
#
# Run hourly by com.nanoclaw.qmd-refresh; also safe to run by hand.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

[ -x "$QMD" ] || { echo "qmd not installed at $QMD — run install.sh first" >&2; exit 1; }

for group in $(group_list); do
  conv="$GROUPS_DIR/$group/conversations"
  mkdir -p "$(cfg_dir "$group")"

  # Each isolated index holds exactly one collection. `collection add <path>`
  # derives the name from the basename ("conversations") — add then rename to
  # the group folder so query results read naturally.
  if ! qmd_for "$group" collection list 2>/dev/null | grep -q "qmd://$group/"; then
    echo "[qmd-refresh] $group: register collection"
    qmd_for "$group" collection add "$conv" >/dev/null 2>&1 || true
    qmd_for "$group" collection rename conversations "$group" >/dev/null 2>&1 || true
  fi

  echo "[qmd-refresh] $group: update + embed"
  qmd_for "$group" update >/dev/null
  qmd_for "$group" embed  >/dev/null
done

echo "[qmd-refresh] done ($(date -u +%FT%TZ))"
