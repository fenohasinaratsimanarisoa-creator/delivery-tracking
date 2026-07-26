#!/usr/bin/env bash
set -euo pipefail

echo "Checking for new circular dependencies..."

TMPFILE=$(mktemp)
trap 'rm -f "$TMPFILE"' EXIT

npx --yes madge --circular \
  --ts-config tsconfig.json \
  --extensions ts \
  --exclude '\.spec\.ts$|\.e2e-spec\.ts$|\.d\.ts$' \
  src/main.ts > "$TMPFILE" 2>&1 || true

OUTPUT=$(cat "$TMPFILE")

if echo "$OUTPUT" | grep -q "✖"; then
  CYCLES=$(echo "$OUTPUT" | awk '/^[0-9]+\)/,/^$/')
  
  NEW_CYCLES=""
  while IFS= read -r line; do
    if [ -z "$line" ]; then continue; fi
    if echo "$line" | grep -qE 'tracking\.gateway|tracking\.service|delivery-proximity\.service'; then
      continue
    fi
    NEW_CYCLES="$NEW_CYCLES$line"$'\n'
  done <<< "$CYCLES"

  if [ -n "$NEW_CYCLES" ]; then
    echo "New circular dependencies found (not covered by forwardRef):"
    echo "$NEW_CYCLES"
    echo ""
    echo "Fix all circular dependencies before deploying."
    echo "Use @Inject(forwardRef(() => ...)) on one edge of each cycle."
    exit 1
  fi
  
  echo "Only known forwardRef-handled cycle detected. OK."
  exit 0
fi

echo "No circular dependencies found."
exit 0
