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

# Supabase edge + LLM can exceed 60s; avoid curl 56 (peer closed) aborting the whole cron.
CURL_MAX_TIME_SEC="${AGENT_CURL_MAX_TIME_SEC:-180}"

post_endpoint() {
  local label="$1"
  local url="$2"

  echo "=== ${label}: ${url} ==="
  local tmp
  tmp="$(mktemp)"
  local curl_status=0
  curl --show-error --silent \
    --http1.1 \
    --max-time "$CURL_MAX_TIME_SEC" \
    --retry 2 --retry-delay 5 \
    -X POST \
    -H "x-cron-secret: ${CRON_SECRET}" \
    -H "content-type: application/json" \
    -d '{}' \
    -o "$tmp" \
    -w "%{http_code}" \
    "$url" >"${tmp}.code" || curl_status=$?

  local http_code
  http_code="$(cat "${tmp}.code" 2>/dev/null || echo "000")"
  echo "${label} HTTP ${http_code}"

  if [[ -s "$tmp" ]]; then
    echo "${label} response:"
    if jq -e . "$tmp" >/dev/null 2>&1; then
      jq . "$tmp"
    else
      cat "$tmp"
    fi
  else
    echo "${label} response: (empty body)"
  fi

  rm -f "$tmp" "${tmp}.code"

  if [[ "$curl_status" -ne 0 ]] || [[ "$http_code" -lt 200 ]] || [[ "$http_code" -ge 300 ]]; then
    echo "WARNING: ${label} failed (curl=${curl_status}, http=${http_code})"
    return 1
  fi
  return 0
}

PASSES="${AGENT_TICK_PASSES:-1}"
INTERVAL_SEC="${AGENT_TICK_INTERVAL_SEC:-90}"
FAILED=0

for pass in $(seq 1 "$PASSES"); do
  echo "======== Pass ${pass}/${PASSES} ========"
  post_endpoint "agent-initiator" "$INIT_URL" || FAILED=1
  post_endpoint "agent-tick" "$TICK_URL" || FAILED=1
  post_endpoint "agent-initiator-followup" "$FOLLOWUP_URL" || FAILED=1
  if [ "$pass" -lt "$PASSES" ]; then
    echo "Sleeping ${INTERVAL_SEC}s before next pass…"
    sleep "$INTERVAL_SEC"
  fi
done

if [ "$FAILED" -ne 0 ]; then
  echo "One or more endpoints failed; see warnings above."
  exit 1
fi
