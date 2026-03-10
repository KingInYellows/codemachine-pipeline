# Patch Files Written to World-Writable tmp Without Secure Permissions

**ID:** 105
**Status:** complete
**Severity:** high
**Category:** security
**Effort:** medium
**Confidence:** 0.87
**Scanner:** security-debt-scanner

## Affected Files

- `src/workflows/patchManager.ts` lines 424-450
- `src/workflows/patchManager.ts` lines 641-721

## Description

Patch content (unified diffs that modify repository source files) is written to /tmp using a predictable filename pattern: patch-<patchId>-<timestamp>.diff. On a shared system: (1) a symlink attack could redirect the write to an arbitrary path (TOCTOU between writeFile and git apply), (2) other users can read, modify, or replace the patch file between writeFile and git apply, (3) the file is written without explicit permissions (typically 0644), making it world-readable. The /tmp path is also hardcoded, breaking on Windows.

## Suggested Remediation

Use os.mkdtemp() to create a private temporary directory (mode 0700) within os.tmpdir(), write the patch file there, and clean up the entire directory in the finally block. Alternatively, pipe patch content directly to git apply via stdin using the --stdin flag, eliminating the temp file entirely: execFileAsync('git', ['apply', '--check'], { input: patch.content, cwd: workingDir }).
