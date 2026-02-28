# Shell Injection createSafeCommit Commit Message in Shell Command

**ID:** 102
**Status:** pending
**Severity:** high
**Category:** security
**Effort:** small
**Confidence:** 0.90
**Scanner:** security-debt-scanner

## Affected Files

- `src/workflows/branchManager.ts` lines 688-692

## Description

The commit message is composed from three inputs — message (caller-supplied), taskId (caller-supplied), and config.featureId — and embedded into a shell command using exec(). The only sanitization is escaping double-quote characters. A message or taskId containing a backtick, $(), or newline followed by shell commands can still escape the quoting context. No validation is applied to message or taskId values before they are embedded.

## Suggested Remediation

Replace the execAsync template-literal invocation with execFileAsync('git', ['commit', '-m', commitMessage], { cwd: config.workingDir }). Remove the manual double-quote replacement — it is unnecessary and incomplete when using execFile. Add input validation for the message and taskId parameters to reject embedded newlines.
