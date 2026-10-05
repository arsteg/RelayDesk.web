#!/usr/bin/env bash
# Restore a backup made by scripts/backup.sh. DESTRUCTIVE: replaces existing objects.
# Usage: scripts/restore.sh backups/relaydesk-YYYYMMDDTHHMMSSZ.dump
set -euo pipefail
FILE="${1:?usage: scripts/restore.sh <dump-file>}"
[[ -f "$FILE" ]] || { echo "No such file: $FILE" >&2; exit 1; }
read -r -p "This will overwrite the target database. Type 'restore' to continue: " ok
[[ "$ok" == "restore" ]] || { echo "Aborted."; exit 1; }

if [[ -n "${DATABASE_URL:-}" ]]; then
  pg_restore --clean --if-exists --no-owner --no-privileges --dbname="${DATABASE_URL%%\?*}" "$FILE"
else
  docker compose exec -T db pg_restore -U relaydesk --clean --if-exists --no-owner --no-privileges -d relaydesk < "$FILE"
fi
echo "Restore complete. Run 'npx prisma migrate deploy' if the backup predates newer migrations."
