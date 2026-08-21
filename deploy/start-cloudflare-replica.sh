#!/usr/bin/env bash
set -euo pipefail

HOSTNAME="${VIBECHECK_PUBLIC_HOST:-vibecheck.jingyeong.cloud}"
CONFIG="${CLOUDFLARED_CONFIG:-/opt/jk/cloudflared/config.yml}"
CLOUDFLARED="${CLOUDFLARED_BIN:-/usr/local/bin/cloudflared}"
RUNTIME_ROOT="${VIBECHECK_RUNTIME_ROOT:-$HOME/.local/share/vibecheck}"
PID_FILE="$RUNTIME_ROOT/cloudflared-vibecheck.pid"
LOG_FILE="$RUNTIME_ROOT/cloudflared-vibecheck.log"

[ -r "$CONFIG" ] || { echo "cloudflare_config_readable=no"; exit 1; }
[ -x "$CLOUDFLARED" ] || { echo "cloudflared_binary=missing"; exit 1; }
"$CLOUDFLARED" --config "$CONFIG" tunnel ingress validate >/dev/null
echo "ingress_validate=ok"

credentials_file="$(sed -n 's/^[[:space:]]*credentials-file:[[:space:]]*//p' "$CONFIG" | head -n1 | tr -d '"' | xargs)"
[ -n "$credentials_file" ] || { echo "credentials_file=missing"; exit 1; }
[ -r "$credentials_file" ] || { echo "credentials_file=unreadable"; exit 1; }
echo "credentials_file=readable"

mkdir -p "$RUNTIME_ROOT"
if [ -f "$PID_FILE" ]; then
  old_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "$old_pid" ] && kill -0 "$old_pid" 2>/dev/null; then
    kill -TERM "$old_pid" 2>/dev/null || true
    for _ in {1..20}; do
      kill -0 "$old_pid" 2>/dev/null || break
      sleep 0.25
    done
  fi
fi

: >"$LOG_FILE"
env -u RUNNER_TRACKING_ID setsid nohup "$CLOUDFLARED" --config "$CONFIG" tunnel run >>"$LOG_FILE" 2>&1 </dev/null &
new_pid=$!
echo "$new_pid" >"$PID_FILE"

for _ in {1..40}; do
  if kill -0 "$new_pid" 2>/dev/null; then
    if grep -Eq 'Registered tunnel connection|Connection .* registered' "$LOG_FILE" 2>/dev/null; then
      echo "cloudflared_replica=connected"
      break
    fi
  else
    echo "cloudflared_replica=exited"
    tail -n 30 "$LOG_FILE" || true
    exit 1
  fi
  sleep 0.5
done
kill -0 "$new_pid" 2>/dev/null || { echo "cloudflared_replica=not_running"; exit 1; }
echo "cloudflared_pid=$new_pid"

for _ in {1..60}; do
  if curl -fsS --connect-timeout 5 --max-time 10 "https://${HOSTNAME}/healthz" >/dev/null 2>&1; then
    echo "public_health=200"
    exit 0
  fi
  sleep 1
done

echo "public_health=failed"
exit 2
