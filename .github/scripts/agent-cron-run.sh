#!/usr/bin/env bash
# Invokes agent-initiator → agent-tick → agent-initiator-followup in one runner.
set -euo pipefail

BASE_URL="${SUPABASE_FUNCTION_URL%/}"

if [[ "$BASE_URL" == */functions/v1/agent-initiator ]]; then
  INIT_URL="$BASE_URL"
elif [[ "$BASE_URL" == */functions/v1/agent-tick ]]; then
  INIT_URL="${BASE_URL%/agent-tick}/agent-initiator"
elif [[ "$BASE_URL" == */functions/v1 ]]; then
  INIT_URL="$BASE_URL/agent-initiator"
elif [[ "$BASE_URL" == https://*.supabase.co ]] || [[ "$BASE_URL" == http://*.supabase.co ]]; then
  INIT_URL="$BASE_URL/functions/v1/agent-initiator"
else
  INIT_URL="$BASE_URL/functions/v1/agent-initiator"
fi

if [[ "$BASE_URL" == */functions/v1/agent-tick ]]; then
  TICK_URL="$BASE_URL"
elif [[ "$BASE_URL" == */functions/v1/agent-initiator ]]; then
  TICK_URL="${BASE_URL%/agent-initiator}/agent-tick"
elif [[ "$BASE_URL" == */functions/v1 ]]; then
  TICK_URL="$BASE_URL/agent-tick"
elif [[ "$BASE_URL" == https://*.supabase.co ]] || [[ "$BASE_URL" == http://*.supabase.co ]]; then
  TICK_URL="$BASE_URL/functions/v1/agent-tick"
else
  TICK_URL="$BASE_URL/functions/v1/agent-tick"
fi

if [[ "$BASE_URL" == */functions/v1/agent-initiator-followup ]]; then
  FOLLOWUP_URL="$BASE_URL"
elif [[ "$BASE_URL" == */functions/v1/agent-initiator ]]; then
  FOLLOWUP_URL="${BASE_URL%/agent-initiator}/agent-initiator-followup"
elif [[ "$BASE_URL" == */functions/v1/agent-tick ]]; then
  FOLLOWUP_URL="${BASE_URL%/agent-tick}/agent-initiator-followup"
elif [[ "$BASE_URL" == */functions/v1 ]]; then
  FOLLOWUP_URL="$BASE_URL/agent-initiator-followup"
elif [[ "$BASE_URL" == https://*.supabase.co ]] || [[ "$BASE_URL" == http://*.supabase.co ]]; then
  FOLLOWUP_URL="$BASE_URL/functions/v1/agent-initiator-followup"
else
  FOLLOWUP_URL="$BASE_URL/functions/v1/agent-initiator-followup"
fi

post_endpoint() {
  local label="$1"
  local url="$2"
  local log_json="${3:-0}"

  echo "=== ${label}: ${url} ==="
  if [[ "$log_json" == "1" ]]; then
    RESPONSE="$(curl --fail --show-error --silent \
      --retry 3 --retry-delay 5 \
      -X POST \
      -H "x-cron-secret: ${CRON_SECRET}" \
      -H "content-type: application/json" \
      -d '{}' \
      "$url")"
    echo "${label} response:"
    echo "$RESPONSE" | jq .
  else
    curl --fail --show-error --silent \
      --retry 3 --retry-delay 5 \
      -X POST \
      -H "x-cron-secret: ${CRON_SECRET}" \
      -H "content-type: application/json" \
      -d '{}' \
      "$url"
  fi
}

PASSES="${AGENT_TICK_PASSES:-1}"
INTERVAL_SEC="${AGENT_TICK_INTERVAL_SEC:-90}"

for pass in $(seq 1 "$PASSES"); do
  echo "======== Pass ${pass}/${PASSES} ========"
  post_endpoint "agent-initiator" "$INIT_URL" 0
  post_endpoint "agent-tick" "$TICK_URL" 1
  post_endpoint "agent-initiator-followup" "$FOLLOWUP_URL" 1
  if [ "$pass" -lt "$PASSES" ]; then
    echo "Sleeping ${INTERVAL_SEC}s before next pass…"
    sleep "$INTERVAL_SEC"
  fi
done
