#!/usr/bin/env bash
set -euo pipefail

HOSTNAME="${VIBECHECK_PUBLIC_HOST:-vibecheck.jingyeong.cloud}"
ORIGIN="${VIBECHECK_ORIGIN:-http://127.0.0.1:8787}"
CONFIG="${CLOUDFLARED_CONFIG:-/opt/jk/cloudflared/config.yml}"
CLOUDFLARED="${CLOUDFLARED_BIN:-/usr/local/bin/cloudflared}"

[ -r "$CONFIG" ] || { echo "cloudflare_config_readable=no"; exit 1; }
[ -w "$CONFIG" ] || { echo "cloudflare_config_writable=no"; exit 1; }
[ -x "$CLOUDFLARED" ] || { echo "cloudflared_binary=missing"; exit 1; }
curl -fsS "$ORIGIN/healthz" >/dev/null
echo "origin_health=200"

backup="${CONFIG}.vibecheck.bak"
[ -e "$backup" ] || cp "$CONFIG" "$backup"

HOSTNAME="$HOSTNAME" ORIGIN="$ORIGIN" CONFIG="$CONFIG" python3 <<'PY'
import os, re
from pathlib import Path

path = Path(os.environ["CONFIG"])
host = os.environ["HOSTNAME"]
origin = os.environ["ORIGIN"]
text = path.read_text()
lines = text.splitlines(True)

host_re = re.compile(r"^(\s*)-\s*hostname:\s*" + re.escape(host) + r"\s*(?:#.*)?$")
catch_re = re.compile(r"^(\s*)-\s*service:\s*http_status:404\s*(?:#.*)?$")

for i, line in enumerate(lines):
    m = host_re.match(line.rstrip("\r\n"))
    if not m:
        continue
    indent = m.group(1)
    for j in range(i + 1, min(len(lines), i + 5)):
        stripped = lines[j].strip()
        if stripped.startswith("- hostname:") or stripped.startswith("- service:"):
            break
        if stripped.startswith("service:"):
            ending = "\r\n" if lines[j].endswith("\r\n") else "\n"
            lines[j] = f"{indent}  service: {origin}{ending}"
            path.write_text("".join(lines))
            print("ingress_action=updated")
            raise SystemExit(0)
    raise SystemExit("existing hostname has no service line")

for i, line in enumerate(lines):
    m = catch_re.match(line.rstrip("\r\n"))
    if m:
        indent = m.group(1)
        ending = "\r\n" if line.endswith("\r\n") else "\n"
        lines[i:i] = [
            f"{indent}- hostname: {host}{ending}",
            f"{indent}  service: {origin}{ending}",
        ]
        path.write_text("".join(lines))
        print("ingress_action=added")
        raise SystemExit(0)

raise SystemExit("terminal http_status:404 ingress rule not found")
PY

"$CLOUDFLARED" --config "$CONFIG" tunnel ingress validate >/dev/null
rule="$($CLOUDFLARED --config "$CONFIG" tunnel ingress rule "https://${HOSTNAME}" 2>&1)"
printf '%s\n' "$rule" | grep -F "$HOSTNAME" >/dev/null
printf '%s\n' "$rule" | grep -F "$ORIGIN" >/dev/null
echo "ingress_validate=ok"
echo "ingress_rule=matched"

tunnel_id="$(awk -F: '/^[[:space:]]*tunnel:[[:space:]]*/ {gsub(/[[:space:]\"'"'"']/, "", $2); print $2; exit}' "$CONFIG")"
[ -n "$tunnel_id" ] || { echo "tunnel_id=missing"; exit 1; }

if getent ahosts "$HOSTNAME" >/dev/null 2>&1; then
  echo "dns_route=present"
else
  cert=""
  for candidate in "$HOME/.cloudflared/cert.pem" /opt/jk/cloudflared/cert.pem /etc/cloudflared/cert.pem; do
    if [ -r "$candidate" ]; then cert="$candidate"; break; fi
  done
  if [ -z "$cert" ]; then
    echo "dns_route=missing_no_origin_cert"
    exit 2
  fi
  "$CLOUDFLARED" --origincert "$cert" tunnel route dns "$tunnel_id" "$HOSTNAME" >/dev/null
  echo "dns_route=created"
fi

mapfile -t old_pids < <(pgrep -x cloudflared || true)
if [ "${#old_pids[@]}" -eq 0 ]; then
  echo "cloudflared_process=missing"
  exit 1
fi

current_user="$(id -un)"
owners=()
for pid in "${old_pids[@]}"; do
  owner="$(ps -o user= -p "$pid" | xargs)"
  [ -n "$owner" ] && owners+=("$owner")
done
printf '%s\n' "${owners[@]}" | sort -u | paste -sd, - | sed 's/^/cloudflared_owners=/'

service=""
for unit in jk-cloudflared.service cloudflared.service; do
  if systemctl show "$unit" -p LoadState --value 2>/dev/null | grep -qx loaded; then
    service="$unit"
    break
  fi
done

if [ -n "$service" ]; then
  echo "cloudflared_service=$service"
  restart_policy="$(systemctl show "$service" -p Restart --value 2>/dev/null || true)"
  main_pid="$(systemctl show "$service" -p MainPID --value 2>/dev/null || true)"
  echo "cloudflared_restart_policy=${restart_policy:-unknown}"
  if [ -n "$main_pid" ] && [ "$main_pid" != 0 ]; then
    main_owner="$(ps -o user= -p "$main_pid" 2>/dev/null | xargs || true)"
    echo "cloudflared_main_owner=${main_owner:-unknown}"
    if [ "$main_owner" = "$current_user" ] && [ "$restart_policy" != "no" ]; then
      kill -TERM "$main_pid"
      for _ in {1..40}; do
        new_pid="$(systemctl show "$service" -p MainPID --value 2>/dev/null || true)"
        if [ -n "$new_pid" ] && [ "$new_pid" != 0 ] && [ "$new_pid" != "$main_pid" ] && kill -0 "$new_pid" 2>/dev/null; then
          echo "cloudflared_reload=restarted_by_service"
          break
        fi
        sleep 0.25
      done
    else
      if systemctl restart "$service" >/dev/null 2>&1; then
        echo "cloudflared_reload=systemctl_restart"
      else
        echo "cloudflared_reload=blocked_owner_${main_owner:-unknown}"
        exit 3
      fi
    fi
  fi
fi

for _ in {1..30}; do
  if curl -fsS "https://${HOSTNAME}/healthz" >/dev/null 2>&1; then
    echo "public_health=200"
    exit 0
  fi
  sleep 1
done

echo "public_health=failed"
exit 4
