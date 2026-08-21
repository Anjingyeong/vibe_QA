#!/usr/bin/env bash
set -euo pipefail

RUNTIME_ROOT="${VIBECHECK_RUNTIME_ROOT:-$HOME/.local/share/vibecheck}"
APP_DIR="$RUNTIME_ROOT/app"
NEXT_DIR="$RUNTIME_ROOT/app.next"
PREV_DIR="$RUNTIME_ROOT/app.prev"
BROWSER_ROOT="$RUNTIME_ROOT/ms-playwright"
DEB_DIR="$RUNTIME_ROOT/pw-debs"
LIB_ROOT="$RUNTIME_ROOT/pw-libs"
ARTIFACT_DIR="$RUNTIME_ROOT/artifacts"
LOG_FILE="$RUNTIME_ROOT/vibecheck.log"
PID_FILE="$RUNTIME_ROOT/vibecheck.pid"

mkdir -p "$RUNTIME_ROOT" "$BROWSER_ROOT" "$ARTIFACT_DIR"
rm -rf "$NEXT_DIR"
mkdir -p "$NEXT_DIR"
cp -a package.json package-lock.json src "$NEXT_DIR/"

cd "$NEXT_DIR"
npm ci
PLAYWRIGHT_BROWSERS_PATH="$BROWSER_ROOT" npx playwright install chromium

seed_packages=(
  libatk1.0-0t64 libatk-bridge2.0-0t64 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1
  libasound2t64 libatspi2.0-0t64 libavahi-common3 libavahi-client3 libfontconfig1
  libxrender1 libxcb-render0 libxcb-shm0 libpixman-1-0 libthai0 libharfbuzz0b libxi6
  libcairo2 libpango-1.0-0 libglib2.0-0t64 libnss3 libnspr4 libcups2t64 libdbus-1-3
  libdrm2 libx11-6 libxcb1 libxext6 libxkbcommon0
)

rm -rf "$DEB_DIR" "$LIB_ROOT"
mkdir -p "$DEB_DIR" "$LIB_ROOT"

mapfile -t package_closure < <(
  apt-cache depends --recurse --no-recommends --no-suggests --no-conflicts --no-breaks --no-replaces --no-enhances "${seed_packages[@]}" 2>/dev/null \
    | awk '/^[[:alnum:]][[:alnum:]+.-]*(:[[:alnum:]-]+)?$/ { print $1 }' \
    | sort -u
)

for pkg in "${seed_packages[@]}" "${package_closure[@]}"; do
  [ -n "$pkg" ] || continue
  if dpkg-query -W -f='${Status}' "$pkg" 2>/dev/null | grep -q 'install ok installed'; then
    continue
  fi
  if apt-cache show "$pkg" >/dev/null 2>&1; then
    (cd "$DEB_DIR" && apt-get download "$pkg" >/dev/null)
  fi
done

shopt -s nullglob
for deb in "$DEB_DIR"/*.deb; do
  dpkg-deb -x "$deb" "$LIB_ROOT"
done
shopt -u nullglob

LIB_PATH="$(find "$LIB_ROOT" -type f -name '*.so*' -printf '%h\n' 2>/dev/null | sort -u | paste -sd: -)"
BROWSER_BIN="$(PLAYWRIGHT_BROWSERS_PATH="$BROWSER_ROOT" node --input-type=module -e "import { chromium } from 'playwright'; console.log(chromium.executablePath())")"

missing="$(LD_LIBRARY_PATH="$LIB_PATH" ldd "$BROWSER_BIN" 2>/dev/null | awk '/not found/ {print $1}' | sort -u | paste -sd, -)"
if [ -n "$missing" ]; then
  echo "browser_missing_libraries=$missing"
  exit 1
fi

echo 'browser_missing_libraries=0'
LD_LIBRARY_PATH="$LIB_PATH" PLAYWRIGHT_BROWSERS_PATH="$BROWSER_ROOT" node --input-type=module <<'NODE'
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.setContent('<title>VibeCheck runtime smoke</title>');
if ((await page.title()) !== 'VibeCheck runtime smoke') process.exitCode = 1;
await browser.close();
NODE

echo 'browser_launch=ok'

if [ -f "$PID_FILE" ]; then
  old_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "$old_pid" ] && kill -0 "$old_pid" 2>/dev/null; then
    kill "$old_pid" 2>/dev/null || true
    for _ in {1..20}; do
      kill -0 "$old_pid" 2>/dev/null || break
      sleep 0.25
    done
  fi
fi

rm -rf "$PREV_DIR"
if [ -d "$APP_DIR" ]; then mv "$APP_DIR" "$PREV_DIR"; fi
mv "$NEXT_DIR" "$APP_DIR"

cd "$APP_DIR"
: > "$LOG_FILE"
env -u RUNNER_TRACKING_ID \
  LD_LIBRARY_PATH="$LIB_PATH" \
  PLAYWRIGHT_BROWSERS_PATH="$BROWSER_ROOT" \
  NODE_ENV=production \
  HOST=127.0.0.1 \
  PORT=8787 \
  VIBECHECK_JOB_STORE="$ARTIFACT_DIR/jobs.json" \
  VIBECHECK_RUNS="${VIBECHECK_RUNS:-3}" \
  VIBECHECK_MAX_PAGES="${VIBECHECK_MAX_PAGES:-4}" \
  VIBECHECK_CONCURRENCY="${VIBECHECK_CONCURRENCY:-1}" \
  VIBECHECK_MAX_JOBS="${VIBECHECK_MAX_JOBS:-50}" \
  VIBECHECK_JOB_TTL_MS="${VIBECHECK_JOB_TTL_MS:-86400000}" \
  VIBECHECK_RATE_LIMIT="${VIBECHECK_RATE_LIMIT:-5}" \
  VIBECHECK_RATE_WINDOW_MS="${VIBECHECK_RATE_WINDOW_MS:-3600000}" \
  GROQ_API_KEY="${GROQ_API_KEY:-}" \
  GEMINI_API_KEY="${GEMINI_API_KEY:-}" \
  setsid nohup node src/web/server.js >>"$LOG_FILE" 2>&1 </dev/null &
new_pid=$!
echo "$new_pid" > "$PID_FILE"

for _ in {1..60}; do
  if curl -fsS http://127.0.0.1:8787/healthz >/dev/null 2>&1; then
    echo "health=200"
    echo "runtime_pid=$new_pid"
    if [ -n "${GROQ_API_KEY:-}" ]; then
      echo 'ai_provider=groq'
    elif [ -n "${GEMINI_API_KEY:-}" ]; then
      echo 'ai_provider=gemini'
    else
      echo 'ai_provider=none'
    fi
    for cfg in /opt/jk/cloudflared/config.yml /etc/cloudflared/config.yml; do
      if [ -e "$cfg" ]; then
        readable=no; writable=no
        [ -r "$cfg" ] && readable=yes
        [ -w "$cfg" ] && writable=yes
        echo "cloudflared_config=$cfg readable=$readable writable=$writable"
      fi
    done
    command -v cloudflared >/dev/null 2>&1 && echo "cloudflared_bin=$(command -v cloudflared)" || true
    exit 0
  fi
  sleep 1
done

tail -n 100 "$LOG_FILE" || true
kill "$new_pid" 2>/dev/null || true
exit 1
