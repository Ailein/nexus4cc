#!/bin/bash
# Watchdog: probes the public URL and restarts nexus-tunnel if it is unhealthy.

set -u

URL="${WATCHDOG_URL:?Set WATCHDOG_URL to the public health-check URL (e.g. https://your.domain/)}"
INTERVAL="${WATCHDOG_INTERVAL:-60}"
TIMEOUT="${WATCHDOG_TIMEOUT:-10}"
FAIL_THRESHOLD="${WATCHDOG_FAIL_THRESHOLD:-2}"
COOLDOWN="${WATCHDOG_COOLDOWN:-120}"
TARGET="${WATCHDOG_TARGET:-nexus-tunnel}"
PM2_BIN="${PM2_BIN:-/opt/homebrew/bin/pm2}"

ts() { date '+%Y-%m-%dT%H:%M:%S%z'; }
log() { echo "[$(ts)] $*"; }

fails=0
last_restart=0

log "watchdog start url=$URL interval=${INTERVAL}s timeout=${TIMEOUT}s threshold=$FAIL_THRESHOLD cooldown=${COOLDOWN}s target=$TARGET"

while true; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time "$TIMEOUT" "$URL" || echo "000")

  if [[ "$code" =~ ^(2|3)[0-9][0-9]$ ]]; then
    if (( fails > 0 )); then
      log "recovered status=$code (was failing $fails times)"
    fi
    fails=0
  else
    fails=$((fails + 1))
    log "unhealthy status=$code fails=$fails/$FAIL_THRESHOLD"

    if (( fails >= FAIL_THRESHOLD )); then
      now=$(date +%s)
      since=$((now - last_restart))
      if (( last_restart > 0 && since < COOLDOWN )); then
        log "cooldown active (${since}s/${COOLDOWN}s), skipping restart"
      else
        log "restarting $TARGET via pm2"
        if "$PM2_BIN" restart "$TARGET" >/dev/null 2>&1; then
          last_restart=$now
          fails=0
          log "restart ok"
        else
          log "restart FAILED"
        fi
      fi
    fi
  fi

  sleep "$INTERVAL"
done
