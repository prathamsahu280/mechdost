#!/usr/bin/env bash
# Set or replace settings in /opt/mechdost/.env from KEY=VALUE lines on stdin (docs/runbooks/deploy.md § 3.5).
# Prints only the names it set, never the values, so it is safe to run where output is logged:
#   grep -E '^(KEY1|KEY2)=' .env | ssh ubuntu@13.207.157.3 'bash /opt/mechdost/set-env.sh'
set -euo pipefail
ENV_FILE=/opt/mechdost/.env
umask 077
touch "$ENV_FILE"
chmod 600 "$ENV_FILE"
while IFS= read -r line || [ -n "$line" ]; do
  line="${line%$'\r'}"
  [[ -z "$line" || "$line" == \#* ]] && continue
  key="${line%%=*}"
  if [[ ! "$key" =~ ^[A-Z][A-Z0-9_]*$ ]] || [[ "$line" != *=* ]]; then
    echo "skipped a line that is not KEY=VALUE" >&2
    continue
  fi
  tmp="$(mktemp)"
  grep -v -E "^#? ?${key}=" "$ENV_FILE" > "$tmp" || true
  printf '%s\n' "$line" >> "$tmp"
  cat "$tmp" > "$ENV_FILE"
  rm -f "$tmp"
  echo "set $key"
done
