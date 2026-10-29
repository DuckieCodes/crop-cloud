#!/usr/bin/env bash
# Launch Crop Cloud in its own app window (no browser tabs or address bar).
# Pass "framecrop" or "photocrop" to open that app directly, e.g.  ./start.sh framecrop
DIR="$(cd "$(dirname "$0")" && pwd)"

PAGE="index.html"
case "$1" in
  framecrop) PAGE="apps/framecrop/index.html"; shift ;;
  photocrop) PAGE="apps/photocrop/index.html"; shift ;;
esac

BROWSER="$(command -v chromium || command -v chromium-browser || command -v google-chrome || true)"
if [ -z "$BROWSER" ]; then
  echo "Chromium not found. Opening in the default browser instead."
  exec xdg-open "$DIR/$PAGE"
fi

exec "$BROWSER" \
  --app="file://$DIR/$PAGE" \
  --user-data-dir="$HOME/.config/crop-cloud" \
  --class=CropCloud \
  --window-size=1440,880 \
  --no-first-run \
  --no-default-browser-check \
  "$@"
