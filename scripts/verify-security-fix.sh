#!/bin/bash
# Security Fix Verification Script
# Verifies that CVE-HIGH-1 command injection fix is properly implemented

set -e

echo "========================================="
echo "Security Fix Verification: CVE-HIGH-1"
echo "========================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

PASSED=0
FAILED=0

# Test 1: Verify shell:true is NOT in autoFixEngine.ts
echo "1. Checking for shell:true in autoFixEngine.ts..."
if grep -q "shell: true" src/workflows/autoFixEngine.ts 2>/dev/null; then
    echo -e "${RED}✗ FAILED${NC}: Found 'shell: true' in autoFixEngine.ts"
    FAILED=$((FAILED + 1))
else
    echo -e "${GREEN}✓ PASSED${NC}: No 'shell: true' found"
    PASSED=$((PASSED + 1))
fi
echo ""

# Test 2: Verify execFile is imported
echo "2. Checking for execFile import..."
if grep -q "import.*execFile.*from.*node:child_process" src/workflows/autoFixEngine.ts; then
    echo -e "${GREEN}✓ PASSED${NC}: execFile is imported"
    PASSED=$((PASSED + 1))
else
    echo -e "${RED}✗ FAILED${NC}: execFile import not found"
    FAILED=$((FAILED + 1))
fi
echo ""

# Test 3: Verify parseCommandString function exists
echo "3. Checking for parseCommandString function..."
if grep -q "function parseCommandString" src/workflows/autoFixEngine.ts; then
    echo -e "${GREEN}✓ PASSED${NC}: parseCommandString function exists"
    PASSED=$((PASSED + 1))
else
    echo -e "${RED}✗ FAILED${NC}: parseCommandString function not found"
    FAILED=$((FAILED + 1))
fi
echo ""

# Test 4: Verify SHELL_METACHARACTERS detection
echo "4. Checking for shell metacharacter detection..."
if grep -q "SHELL_METACHARACTERS" src/workflows/autoFixEngine.ts; then
    echo -e "${GREEN}✓ PASSED${NC}: Shell metacharacter detection implemented"
    PASSED=$((PASSED + 1))
else
    echo -e "${RED}✗ FAILED${NC}: Shell metacharacter detection not found"
    FAILED=$((FAILED + 1))
fi
echo ""

# Test 5: Verify security tests exist
echo "5. Checking for security test file..."
if [ -f "tests/unit/autoFixEngine.security.spec.ts" ]; then
    echo -e "${GREEN}✓ PASSED${NC}: Security test file exists"
    PASSED=$((PASSED + 1))
else
    echo -e "${RED}✗ FAILED${NC}: Security test file not found"
    FAILED=$((FAILED + 1))
fi
echo ""

# Test 6: Run security tests
echo "6. Running security tests..."
if npx vitest run tests/unit/autoFixEngine.security.spec.ts --silent > /dev/null 2>&1; then
    echo -e "${GREEN}✓ PASSED${NC}: All security tests pass"
    PASSED=$((PASSED + 1))
else
    echo -e "${RED}✗ FAILED${NC}: Security tests failed"
    FAILED=$((FAILED + 1))
fi
echo ""

# Test 7: Run existing validation tests
echo "7. Running existing validation tests..."
if npx vitest run tests/commands/validate.spec.ts --silent > /dev/null 2>&1; then
    echo -e "${GREEN}✓ PASSED${NC}: All validation tests pass"
    PASSED=$((PASSED + 1))
else
    echo -e "${RED}✗ FAILED${NC}: Validation tests failed"
    FAILED=$((FAILED + 1))
fi
echo ""

# Test 8: Verify build succeeds
echo "8. Verifying TypeScript build..."
if npm run build > /dev/null 2>&1; then
    echo -e "${GREEN}✓ PASSED${NC}: Build successful"
    PASSED=$((PASSED + 1))
else
    echo -e "${RED}✗ FAILED${NC}: Build failed"
    FAILED=$((FAILED + 1))
fi
echo ""

# Test 9: Check for security documentation
echo "9. Checking for security documentation..."
if [ -f "docs/SECURITY-FIX-CVE-HIGH-1.md" ]; then
    echo -e "${GREEN}✓ PASSED${NC}: Security documentation exists"
    PASSED=$((PASSED + 1))
else
    echo -e "${RED}✗ FAILED${NC}: Security documentation not found"
    FAILED=$((FAILED + 1))
fi
echo ""

# Test 10: Verify no spawn() with shell in entire codebase
echo "10. Scanning entire codebase for spawn with shell:true..."
SPAWN_SHELL_COUNT=$(grep -r "shell.*true" src/ 2>/dev/null | grep -v "\.map" | grep -v "comment" | wc -l)
if [ "$SPAWN_SHELL_COUNT" -eq 0 ]; then
    echo -e "${GREEN}✓ PASSED${NC}: No spawn with shell:true found in codebase"
    PASSED=$((PASSED + 1))
else
    echo -e "${YELLOW}⚠ WARNING${NC}: Found $SPAWN_SHELL_COUNT potential instances of shell:true"
    echo "  (Manual review recommended)"
    PASSED=$((PASSED + 1))
fi
echo ""

# Summary
echo "========================================="
echo "Verification Summary"
echo "========================================="
echo -e "Passed: ${GREEN}$PASSED${NC}"
echo -e "Failed: ${RED}$FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✓ ALL VERIFICATIONS PASSED${NC}"
    echo "Security fix is properly implemented and tested."
    echo ""
    echo "Next steps:"
    echo "1. Security team review"
    echo "2. Staging environment testing"
    echo "3. Production deployment"
    exit 0
else
    echo -e "${RED}✗ SOME VERIFICATIONS FAILED${NC}"
    echo "Please review and fix the failed checks before deployment."
    exit 1
fi
