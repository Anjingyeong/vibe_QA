#!/usr/bin/env bash
set -euo pipefail
HOSTNAME="${VIBECHECK_PUBLIC_HOST:-vibecheck.jingyeong.cloud}"
for _ in {1..60}; do
  if curl -fsS --connect-timeout 5 --max-time 10 "https://${HOSTNAME}/healthz" >/dev/null 2>&1; then
    echo "public_health=200"
    exit 0
  fi
  sleep 1
done
echo "public_health=failed"
exit 1
