#!/usr/bin/env bash
# Logical backup of the RelayDesk database (custom format, compressed).
# Usage: scripts/backup.sh [output-dir]
#   Uses DATABASE_URL if set, otherwise the docker compose "db" service.
set -euo pipefail
OUT_DIR="${1:-backups}"
mkdir -p "$OUT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$OUT_DIR/relaydesk-$STAMP.dump"

if [[ -n "${DATABASE_URL:-}" ]]; then
  pg_dump --format=custom --no-owner --no-privileges --dbname="${DATABASE_URL%%\?*}" --file="$FILE"
else
  docker compose exec -T db pg_dump -U relaydesk --format=custom --no-owner --no-privileges relaydesk > "$FILE"
fi
echo "Backup written to $FILE ($(du -h "$FILE" | cut -f1))"
