#!/usr/bin/env bash
# Pre-deploy CSP validation: verifies vercel.json CSP connect-src URLs
# match NEXT_PUBLIC_API_URL and NEXT_PUBLIC_WS_URL env vars.
#
# Usage: ./scripts/validate-csp.sh
# Reads env vars from Vercel (if linked) or from .env.production / .env.local.

set -euo pipefail

VERCEL_JSON="$(dirname "$0")/../vercel.json"
FAILED=0

pass() { echo "  PASS: $1"; }
fail() { FAILED=$((FAILED + 1)); echo "  FAIL: $1"; }
warn() { echo "  WARN: $1"; }

echo "=== CSP Validation ==="

# Extract CSP connect-src from vercel.json
CSP_VALUE=$(grep -o "connect-src[^;]*" "$VERCEL_JSON" 2>/dev/null || echo "")
if [ -z "$CSP_VALUE" ]; then
  fail "No connect-src directive found in $VERCEL_JSON"
  exit 1
fi
echo "CSP connect-src: $CSP_VALUE"
echo ""

# Check 1: No localhost in CSP
echo "[1] No localhost in CSP"
if echo "$CSP_VALUE" | grep -qi "localhost\|127\.0\.0\.1"; then
  fail "CSP connect-src contains localhost"
else
  pass "No localhost in CSP connect-src"
fi

# Check 2: API URL in CSP
echo "[2] API URL consistency"
# Try to resolve API URL from env
API_URL="${NEXT_PUBLIC_API_URL:-}"
if [ -z "$API_URL" ]; then
  # Try .env.production
  if [ -f "$(dirname "$0")/../.env.production" ]; then
    API_URL=$(grep "^NEXT_PUBLIC_API_URL=" "$(dirname "$0")/../.env.production" 2>/dev/null | cut -d= -f2- || echo "")
  fi
fi
if [ -n "$API_URL" ]; then
  API_HOST=$(echo "$API_URL" | sed -E 's|https?://||' | sed 's|/.*||')
  if echo "$CSP_VALUE" | grep -q "$API_HOST"; then
    pass "API host '$API_HOST' found in CSP connect-src"
  else
    fail "API host '$API_HOST' (from NEXT_PUBLIC_API_URL) NOT in CSP connect-src"
  fi
else
  warn "NEXT_PUBLIC_API_URL not set — cannot cross-check CSP"
fi

# Check 3: WS URL in CSP
echo "[3] WS URL consistency"
WS_URL="${NEXT_PUBLIC_WS_URL:-}"
if [ -z "$WS_URL" ]; then
  if [ -f "$(dirname "$0")/../.env.production" ]; then
    WS_URL=$(grep "^NEXT_PUBLIC_WS_URL=" "$(dirname "$0")/../.env.production" 2>/dev/null | cut -d= -f2- || echo "")
  fi
fi
if [ -n "$WS_URL" ]; then
  WS_HOST=$(echo "$WS_URL" | sed -E 's|wss?://||' | sed 's|/.*||')
  if echo "$CSP_VALUE" | grep -q "$WS_HOST"; then
    pass "WS host '$WS_HOST' found in CSP connect-src"
  else
    fail "WS host '$WS_HOST' (from NEXT_PUBLIC_WS_URL) NOT in CSP connect-src"
  fi
else
  warn "NEXT_PUBLIC_WS_URL not set — cannot cross-check CSP"
fi

# Check 4: Solana RPC in CSP
echo "[4] Solana RPC in CSP"
if echo "$CSP_VALUE" | grep -q "solana.com\|rpcpool.com"; then
  pass "Solana RPC domains found in CSP connect-src"
else
  fail "No Solana RPC domains in CSP connect-src (need solana.com or rpcpool.com)"
fi

echo ""
if [ "$FAILED" -gt 0 ]; then
  echo "=== VALIDATION FAILED — $FAILED issues ==="
  exit 1
else
  echo "=== ALL CHECKS PASSED ==="
  exit 0
fi
