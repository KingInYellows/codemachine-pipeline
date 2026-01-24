# NPM Warnings Reference

This document tracks npm warnings that may appear during installation and their resolution status.

## Overview

When running `npm install`, you may encounter various warnings. This document clarifies which warnings are safe to ignore and which require action.

---

## glob Package Warnings

### GHSA-5j98-mcp5-4vw2 (glob CLI command injection)

**Security Status:** ✅ Safe

- No glob versions affected by GHSA-5j98-mcp5-4vw2 (10.2.x-10.4.x or 11.0.x) are present
- Legacy glob@7.x under test-exclude is **not** affected by this advisory
- CI enforces security checks on every build via `npm run security:glob-guard`

**Details:**

- This advisory affects the glob **CLI** tool's `-c/--cmd` option, not the library API
- Vulnerable versions: `>=10.2.0 <10.5.0` or `>=11.0.0 <11.1.0`
- Our dependencies use either safe versions or the unaffected glob@7.x series

**Verification:**

```bash
npm run security:glob-guard
```

---

## test-exclude Dependency Resolution Warning

**Warning Message:**
```
npm WARN ERESOLVE overriding peer dependency
npm WARN While resolving: babel-plugin-istanbul@7.0.1
npm WARN Found: test-exclude@7.0.1
npm WARN Could not resolve dependency: test-exclude@^6.0.0
```

**Why This Occurs:**
- babel-plugin-istanbul@7.0.1 requires test-exclude@^6.0.0
- Our override forces test-exclude@^7.0.1 to ensure safe glob versions
- npm cannot resolve this mismatch but installs the override anyway

**Is This a Problem?**
**No.** This is a cosmetic warning. The security guard script verifies no vulnerable glob versions are present.

---

## Deprecation Warnings

### inflight@1.0.6

**Status:** ⚠️ Known deprecation, safe to ignore

- This package is a transitive dependency of glob@7.x
- The deprecation warning does not indicate a security vulnerability
- Will be resolved when upstream dependencies update

### rimraf@3.x

**Status:** ⚠️ Known deprecation, safe to ignore

- Transitive dependency used by testing tooling
- No security implications

---

## Response Procedure

If new warnings appear:

1. Check if the warning relates to a known advisory (search this document first)
2. For security warnings, verify with `npm audit` and `npm run security:glob-guard`
3. For deprecation warnings, assess if they are blocking or informational
4. Update this document when new warnings are triaged

---

**Related Documents:**

- [Security Advisories](../requirements/security_advisories.md)
- [Branch Protection Playbook](../requirements/branch_protection_playbook.md)
