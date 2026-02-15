# Expected npm Warnings

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

**Security Status:** ✅ Safe

- No vulnerable glob versions (10.2.x-10.4.x or 11.0.x) are present
- CI enforces security checks on every build via `npm run security:glob-guard`
- Override is durable and will not regress

**Verification:**
To verify the security status, run:

```bash
npm run security:glob-guard
```

This script checks for vulnerable glob versions and will exit with an error if any are found.

**Action Required:** None

This warning can be safely ignored. The override ensures that only secure versions of the `glob` dependency are used throughout the dependency tree, even if some packages request older versions.
