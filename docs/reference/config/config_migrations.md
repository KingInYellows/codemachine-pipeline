# RepoConfig Migration Checklist

**Purpose:** This document provides a systematic checklist for migrating RepoConfig schema versions, ensuring deterministic upgrades without data loss.

**Related:** ADR-2 (State Persistence), `docs/reference/config/RepoConfig_schema.md`

---

## General Migration Process

Follow these steps for any schema version migration:

### 1. Pre-Migration Assessment

- [ ] **Identify current version:** Check `schema_version` field in `.codepipe/config.json`
- [ ] **Identify target version:** Determine the schema version you're upgrading to
- [ ] **Review breaking changes:** Consult the version-specific migration guide below
- [ ] **Check environment:** Ensure you have the correct CLI version installed
- [ ] **Test environment:** Consider testing migration in a non-production environment first

### 2. Backup Configuration

- [ ] **Create backup:** `cp .codepipe/config.json .codepipe/config.json.backup`
- [ ] **Record backup location:** Note the full path to backup file
- [ ] **Verify backup:** `cat .codepipe/config.json.backup` to confirm content

### 3. Apply Migration

- [ ] **Review required changes:** See version-specific guide below
- [ ] **Update schema_version:** Change to target version (do this LAST)
- [ ] **Add config_history entry:** Document the migration (see template below)
- [ ] **Update deprecated fields:** Migrate any deprecated fields to new locations
- [ ] **Add new required fields:** If new required fields were added, populate them

### 4. Validation

- [ ] **Syntax check:** Ensure JSON is valid: `jq . .codepipe/config.json`
- [ ] **Schema validation:** Run `codepipe init --validate-only`
- [ ] **Review warnings:** Address any deprecation warnings
- [ ] **Check credentials:** Verify environment variables still work
- [ ] **Test basic command:** Run `codepipe --help` to ensure CLI works

### 5. Post-Migration

- [ ] **Commit changes:** Git commit the updated config
- [ ] **Document changes:** Add notes to team documentation
- [ ] **Monitor first run:** Watch for issues during first feature pipeline run
- [ ] **Archive backup:** Keep backup for at least 30 days

---

## Config History Entry Template

When migrating, add an entry to the `config_history` array:

```json
{
  "timestamp": "2025-12-15T14:30:00.000Z",
  "schema_version": "TARGET_VERSION",
  "changed_by": "YOUR_EMAIL_OR_USERNAME",
  "change_description": "Migrated from X.Y.Z to TARGET_VERSION - [brief description of changes]",
  "migration_applied": true,
  "backup_path": ".codepipe/config.json.backup"
}
```

**Example:**

```json
{
  "timestamp": "2025-12-15T14:30:00.000Z",
  "schema_version": "2.0.0",
  "changed_by": "alice@example.com",
  "change_description": "Migrated from 1.0.0 to 2.0.0 - Added governance controls, migrated approval settings",
  "migration_applied": true,
  "backup_path": ".codepipe/config.json.backup"
}
```

---

## Version-Specific Migration Guides

### Migrating to 1.0.0 (Initial Release)

**From:** Legacy config (pre-1.0.0)
**To:** 1.0.0
**Breaking Changes:** None (initial release)

#### Changes

1. **Added fields:**
   - `governance` - New governance controls section
   - `config_history` - Migration history tracking

2. **Deprecated fields:**
   - `governance_notes` → Use `governance.governance_notes` instead
   - `safety.require_approval_for_*` → Use `governance.approval_workflow` instead
   - `safety.prevent_force_push` → Use `governance.risk_controls.prevent_force_push` instead

#### Migration Steps

1. **Add governance section (optional but recommended):**

   ```json
   "governance": {
     "approval_workflow": {
       "require_approval_for_prd": true,
       "require_approval_for_spec": true,
       "require_approval_for_plan": true,
       "require_approval_for_code": true,
       "require_approval_for_pr": true,
       "require_approval_for_deploy": true
     },
     "accountability": {
       "record_approver_identity": true,
       "require_approval_reason": false,
       "audit_log_retention_days": 365
     },
     "risk_controls": {
       "prevent_auto_merge": true,
       "prevent_force_push": true,
       "require_branch_protection": true,
       "max_files_per_pr": 100,
       "max_lines_changed_per_pr": 5000
     },
     "compliance_tags": [],
     "governance_notes": "YOUR_GOVERNANCE_NOTES_HERE"
   }
   ```

2. **Add config_history section:**

   ```json
   "config_history": [
     {
       "timestamp": "2025-12-15T10:00:00.000Z",
       "schema_version": "1.0.0",
       "changed_by": "YOUR_EMAIL",
       "change_description": "Migrated to 1.0.0 schema",
       "migration_applied": true,
       "backup_path": ".codepipe/config.json.backup"
     }
   ]
   ```

3. **Migrate governance_notes (if present):**
   - Move value from root `governance_notes` to `governance.governance_notes`
   - Keep root field for backward compatibility (will show deprecation warning)

4. **Update schema_version:**

   ```json
   "schema_version": "1.0.0"
   ```

5. **Validate:** Run `codepipe init --validate-only`

---

### Migrating to 2.0.0 (Future)

**Status:** Not yet released
**Planned Changes:** TBD

_This section will be populated when version 2.0.0 is released._

---

## Common Migration Issues

### Issue: Validation fails after migration

**Symptoms:**

- `codepipe init --validate-only` reports errors
- Required fields missing

**Resolution:**

1. Check error message for specific missing field
2. Consult `docs/reference/config/RepoConfig_schema.md` for field requirements
3. Add missing fields with appropriate defaults
4. Re-run validation

### Issue: Environment variables no longer recognized

**Symptoms:**

- Warnings about missing credentials
- Integration features not working

**Resolution:**

1. Verify environment variables are still set: `env | grep AI_FEATURE`
2. Check if variable names changed in migration
3. Update environment variable names if needed
4. Review `docs/reference/config/RepoConfig_schema.md` for current env var names

### Issue: JSON syntax errors after manual edit

**Symptoms:**

- `Invalid JSON` error
- Config file won't load

**Resolution:**

1. Use `jq` to find syntax error: `jq . .codepipe/config.json`
2. Common issues: missing commas, trailing commas, unquoted strings
3. Use JSON linter or editor with JSON validation
4. If unfixable, restore from backup

### Issue: Deprecated field warnings

**Symptoms:**

- Validation passes but shows deprecation warnings
- Features work but warnings persist

**Resolution:**

1. Review warnings for specific deprecated fields
2. Migrate to new field locations per migration guide
3. Keep old fields temporarily for backward compatibility
4. Remove old fields in next major version

---

## Rollback Procedure

If migration fails and you need to rollback:

1. **Stop CLI:** Ensure no `codepipe` commands are running
2. **Restore backup:** `cp .codepipe/config.json.backup .codepipe/config.json`
3. **Verify restoration:** `codepipe init --validate-only`
4. **Document issue:** Note what went wrong for future attempts
5. **Seek help:** Consult documentation or open GitHub issue

---

## Automated Migration Scripts

### Script: validate-config.sh

Validates config without modifying it:

```bash
#!/bin/bash
# Validate RepoConfig without changes

set -e

CONFIG_PATH=".codepipe/config.json"

if [ ! -f "$CONFIG_PATH" ]; then
  echo "Error: Config file not found at $CONFIG_PATH"
  exit 1
fi

# Validate JSON syntax
echo "Checking JSON syntax..."
jq empty "$CONFIG_PATH" || {
  echo "Error: Invalid JSON syntax"
  exit 1
}

# Validate schema
echo "Validating schema..."
codepipe init --validate-only

echo "✓ Configuration is valid"
```

### Script: backup-config.sh

Creates timestamped backup:

```bash
#!/bin/bash
# Create timestamped config backup

set -e

CONFIG_PATH=".codepipe/config.json"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_PATH=".codepipe/config.json.backup.$TIMESTAMP"

if [ ! -f "$CONFIG_PATH" ]; then
  echo "Error: Config file not found at $CONFIG_PATH"
  exit 1
fi

cp "$CONFIG_PATH" "$BACKUP_PATH"
echo "✓ Backup created: $BACKUP_PATH"
```

---

## Schema Version Compatibility Matrix

| CLI Version | Supported Schema Versions | Recommended Schema |
| ----------- | ------------------------- | ------------------ |
| 0.1.x       | 1.0.0                     | 1.0.0              |
| 0.2.x       | 1.0.0, 1.1.0              | 1.1.0              |
| 1.0.x       | 1.0.0, 1.1.0, 2.0.0       | 2.0.0              |

_Note: Always use the latest CLI version for best compatibility._

---

## Getting Help

If you encounter issues during migration:

1. **Check documentation:**
   - `docs/reference/config/RepoConfig_schema.md` - Full schema reference
   - `.codepipe/templates/config.example.json` - Example config

2. **Validation command:**

   ```bash
   codepipe init --validate-only
   ```

3. **Community support:**
   - GitHub Issues: https://github.com/KingInYellows/codemachine-pipeline/issues
   - Team Slack: #codemachine-pipeline channel

4. **Emergency rollback:**
   - Restore from backup immediately
   - Document the issue
   - Seek help before retrying

---

## Changelog

| Date       | Version | Author           | Description                                  |
| ---------- | ------- | ---------------- | -------------------------------------------- |
| 2025-12-15 | 1.0.0   | CodeMachine Team | Initial migration checklist for schema 1.0.0 |
