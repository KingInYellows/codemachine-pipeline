# Security Advisory Requirements

<!-- anchor: security-advisory-overview -->

This document defines requirements for responding to security advisories that affect the dependency tree and CLI tooling.

**Version:** 1.0.0
**Last Updated:** 2026-01-03
**Related Documents:**

- [Branch Protection Playbook](branch_protection_playbook.md)
- [Validation Playbook](validation_playbook.md)

---

## Overview

Security advisories affecting build-time or CLI tooling must be detected early and remediated before release. This repository enforces a lightweight guard to detect reintroduction of known vulnerable dependency chains.

---

<!-- anchor: ghsa-5j98-mcp5-4vw2 -->

## GHSA-5j98-mcp5-4vw2 (glob CLI command injection)

**Summary:** The glob CLI `-c/--cmd` option can execute filenames via `shell: true` in vulnerable versions. The glob library API is not affected, but CLI usage can lead to command injection in CI or developer environments.

**Risk Trigger:** Introducing `@oclif/plugin-plugins` or other CLI tooling that depends on glob CLI versions `>=10.2.0 <10.5.0` or `>=11.0.0 <11.1.0`.

### Requirements

1. **Dependency hygiene:** Do not add `@oclif/plugin-plugins` unless there is an explicit product requirement.
2. **Guard script:** `npm run security:glob-guard` must pass before submission.
3. **Remediation:** If vulnerable glob CLI versions are detected, upgrade to `glob@>=10.5.0` or `glob@>=11.1.0`, or remove the dependency chain entirely.

### Guard Script

The guard lives at `scripts/tooling/check_glob_cli_advisory.js` and checks for:

- Direct dependency on @oclif/plugin-plugins in `package.json`.
- Presence of @oclif/plugin-plugins in `package-lock.json`.
- Any `glob` package entries in `package-lock.json` that fall into the vulnerable ranges.

**Run locally:**

```bash
npm run security:glob-guard
```

### Response Procedure

1. Identify the dependency path that introduces the vulnerable glob CLI.
2. Remove `@oclif/plugin-plugins` if it is unused.
3. If the plugin is required, pin to a version that resolves the advisory and verify the lockfile glob versions are safe.
4. Re-run `npm run security:glob-guard` to confirm remediation.

---

**End of Document**
