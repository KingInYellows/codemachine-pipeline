#!/bin/bash
#
# Security scan for documentation
# Checks for real credentials, API keys, and sensitive information
#

set -euo pipefail

echo "🔒 Scanning documentation for security issues"
echo ""

errors=0
EXCLUDE_PATHS='^docs/(archive|research|solutions|plans|brainstorms)/'

# Reusable function to check for a secret pattern in docs
# Usage: check_secret "description" "regex_pattern" [fail|warn] [exclude_regex]
check_secret() {
  local description="$1"
  local pattern="$2"
  local severity="${3:-fail}"
  local exclude_regex="${4:-}"

  echo "Checking for ${description}..."
  local matches
  matches=$(grep -rEn "$pattern" docs/ README.md 2>/dev/null | grep -vE "$EXCLUDE_PATHS" | grep -v "EXAMPLE\|PLACEHOLDER\|DO_NOT_USE" || true)
  if [ -n "$exclude_regex" ]; then
    matches=$(echo "$matches" | grep -vE "$exclude_regex" || true)
  fi
  if [ -n "$matches" ]; then
    if [ "$severity" = "fail" ]; then
      echo "❌ Found potential ${description}:"
      # Do NOT print the matched line content to CI logs (may contain real credentials).
      echo "$matches" | sed 's/:[^:]*$/: [REDACTED]/'
      errors=$((errors + 1))
    else
      echo "⚠️  Found ${description} (verify not sensitive):"
      # Do NOT print the matched line content to CI logs (may contain PII/secrets).
      echo "$matches" | sed 's/:[^:]*$/: [REDACTED]/'
    fi
  else
    echo "✅ No ${description} found"
  fi
}

# Check for real GitHub tokens (ghp_*)
check_secret "real GitHub tokens" "ghp_[A-Za-z0-9]{36}" "fail" "ghp_[xX]{36}"

# Check for real Anthropic API keys (sk-ant-*)
check_secret "real Anthropic API keys" "sk-ant-[A-Za-z0-9_-]{48,}"

# Check for real OpenAI API keys (sk-proj-*, sk-svcacct-*)
check_secret "real OpenAI API keys" "sk-(proj|svcacct)-[A-Za-z0-9_-]{32,}" "fail"

# Check for real Linear API keys (lin_api_*)
check_secret "real Linear API keys" "lin_api_[A-Za-z0-9]{40}"

# Check for email addresses (potential PII) - warn only
check_secret "email addresses" "[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}" "warn"

# Check for internal URLs (warn only; localhost examples are common in docs)
check_secret "internal URLs/IPs" "https?://(127\.0\.0\.1|192\.168\.|10\.|172\.16\.|172\.17\.|172\.18\.|172\.19\.|172\.2[0-9]\.|172\.3[0-1]\.)" "warn"

# Check for AWS credentials (AKIA for long-term, ASIA for temporary/STS)
check_secret "AWS access keys" "(AKIA|ASIA)[0-9A-Z]{16}"

# Summary
echo ""
if [ $errors -eq 0 ]; then
  echo "✅ Security scan passed - no sensitive data found"
  exit 0
else
  echo "❌ Security scan failed - found $errors issues"
  echo ""
  echo "Fix these issues before merging:"
  echo "1. Replace real tokens with placeholders"
  echo "2. Add EXAMPLE/PLACEHOLDER/DO_NOT_USE markers"
  echo "3. Remove internal URLs and IPs"
  exit 1
fi
