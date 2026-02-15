#!/bin/bash
#
# Security scan for documentation
# Checks for real credentials, API keys, and sensitive information
#

set -e

echo "🔒 Scanning documentation for security issues"
echo ""

errors=0

# Check for real GitHub tokens (ghp_*)
echo "Checking for real GitHub tokens..."
if grep -rE "ghp_[A-Za-z0-9]{36}" docs/ README.md 2>/dev/null | grep -v "EXAMPLE\|PLACEHOLDER\|DO_NOT_USE"; then
  echo "❌ Found potential real GitHub token"
  errors=$((errors + 1))
else
  echo "✅ No real GitHub tokens found"
fi

# Check for real Anthropic API keys (sk-ant-*)
echo "Checking for real Anthropic API keys..."
if grep -rE "sk-ant-[A-Za-z0-9_-]{48,}" docs/ README.md 2>/dev/null | grep -v "EXAMPLE\|PLACEHOLDER\|DO_NOT_USE"; then
  echo "❌ Found potential real Anthropic API key"
  errors=$((errors + 1))
else
  echo "✅ No real Anthropic API keys found"
fi

# Check for real OpenAI API keys (sk-*)
echo "Checking for real OpenAI API keys..."
if grep -rE "sk-[A-Za-z0-9]{32,}" docs/ README.md 2>/dev/null | grep -v "EXAMPLE\|PLACEHOLDER\|DO_NOT_USE\|sk-ant-"; then
  echo "❌ Found potential real OpenAI API key"
  errors=$((errors + 1))
else
  echo "✅ No real OpenAI API keys found"
fi

# Check for real Linear API keys (lin_api_*)
echo "Checking for real Linear API keys..."
if grep -rE "lin_api_[A-Za-z0-9]{40}" docs/ README.md 2>/dev/null | grep -v "EXAMPLE\|PLACEHOLDER\|DO_NOT_USE"; then
  echo "❌ Found potential real Linear API key"
  errors=$((errors + 1))
else
  echo "✅ No real Linear API keys found"
fi

# Check for email addresses (potential PII)
echo "Checking for email addresses..."
if grep -rE "[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}" docs/ README.md 2>/dev/null | grep -v "noreply@anthropic.com\|example.com\|EXAMPLE\|placeholder"; then
  echo "⚠️  Found email addresses (verify not PII)"
  # Don't fail, just warn
else
  echo "✅ No email addresses found"
fi

# Check for internal URLs
echo "Checking for internal URLs..."
if grep -rE "https?://(localhost|127\.0\.0\.1|192\.168\.|10\.|172\.16\.|172\.17\.|172\.18\.|172\.19\.|172\.2[0-9]\.|172\.3[0-1]\.)" docs/ README.md 2>/dev/null | grep -v "example\|placeholder\|EXAMPLE"; then
  echo "❌ Found internal URLs/IPs"
  errors=$((errors + 1))
else
  echo "✅ No internal URLs found"
fi

# Check for AWS credentials
echo "Checking for AWS credentials..."
if grep -rE "AKIA[0-9A-Z]{16}" docs/ README.md 2>/dev/null | grep -v "EXAMPLE\|PLACEHOLDER"; then
  echo "❌ Found potential AWS access key"
  errors=$((errors + 1))
else
  echo "✅ No AWS credentials found"
fi

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
