# Shell Injection exec Template Literals in branchManager

**ID:** 101
**Status:** complete
**Severity:** high
**Category:** security
**Effort:** medium
**Confidence:** 0.92
**Scanner:** security-debt-scanner

## Affected Files

- `src/workflows/branchManager.ts` lines 219, 231, 243, 347, 356, 451

## Description

All six git operations in branchManager.ts use exec() (which spawns a shell) with template literals that embed variable data directly into the shell command string. Although double-quotes are included around each variable, a value containing an embedded double-quote followed by shell metacharacters (e.g. a branch name like `foo" && rm -rf /`) can escape the quoting and inject arbitrary shell commands. The branchName comes from external inputs (featureId passed through generateBranchName). The validateBranchName function does NOT block embedded double-quotes, backticks, or dollar signs, which are sufficient for injection.

## Suggested Remediation

Replace all execAsync() calls that construct commands with template literals with execFileAsync('git', [...args]) (promisified execFile). Pass each variable as a separate element of the argv array. Remove execAsync and the promisify(exec) import; use execFile exclusively in this module as patchManager already does.
