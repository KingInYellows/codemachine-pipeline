# Homelab Quickstart Guide

**Get codepipe running in under 5 minutes.**

This guide walks you through installing and running your first AI-assisted feature pipeline on a local homelab environment. No GitHub or Linear accounts required.

---

## Prerequisites

Before starting, ensure you have:

- **Node.js 24+** - Check with `node --version`
- **Git** - Check with `git --version`
- **A code editor** (VS Code, Neovim, etc.)

---

## Step 1: Install codepipe

Install globally via npm:

```bash
npm install -g codemachine-pipeline
```

Verify the installation:

```bash
codepipe --version
```

---

## Step 2: Initialize Your Repository

Navigate to your project directory (or create a new one):

```bash
mkdir my-project && cd my-project
git init
```

Run the initialization wizard:

```bash
codepipe init
```

This scaffolds a schema-validated RepoConfig at:

```
.codepipe/config.json
```

For homelab/offline-friendly usage, make sure GitHub and Linear are disabled in that file:

```json
{
  "github": { "enabled": false },
  "linear": { "enabled": false }
}
```

To actually run pipelines, you also need an agent endpoint configured via:

```bash
export AGENT_ENDPOINT="https://your-agent-service.example.com/v1"
```

Or by setting `runtime.agent_endpoint` in `.codepipe/config.json`. See `docs/reference/config/RepoConfig_schema.md`.

---

## Step 3: Start a Feature Run

Create your first AI-assisted feature:

```bash
codepipe start --prompt "Add a utility function to validate email addresses"
```

This provisions a run directory at `.codepipe/runs/<feature-id>/` containing:

- `manifest.json` - Feature metadata and status
- `artifacts/` - Generated PRD/spec/plan artifacts
- `queue/` - Task queue state (e.g., `queue_snapshot.json`, `queue_operations.log`)
- `logs/` and `telemetry/` - Execution logs and observability data

For the authoritative structure, see `docs/reference/run_directory_schema.md` and `docs/reference/queue-v2-operations.md`.

---

## Step 4: Check Status

Monitor progress with:

```bash
codepipe status
```

For detailed output including task breakdown:

```bash
codepipe status --verbose
```

For machine-readable JSON:

```bash
codepipe status --json
```

---

## Step 5: Approve and Execute

When the pipeline pauses for approval:

```bash
codepipe approve prd --approve --signer "you@example.com"
```

Then resume execution:

```bash
codepipe resume
```

Review generated artifacts in `.codepipe/runs/<feature-id>/artifacts/`.

---

## Docker Alternative

Run codepipe in a container without installing Node.js:

```yaml
# docker-compose.yml
version: '3.8'
services:
  codepipe:
    image: node:24-alpine
    working_dir: /app
    volumes:
      - .:/app
    command: >
      sh -c "apk add --no-cache git &&
             npm install -g codemachine-pipeline &&
             codepipe init --yes &&
             codepipe status"
```

Start with:

```bash
docker compose run codepipe
```

For interactive use:

```bash
docker compose run codepipe sh
# Inside container:
codepipe start --prompt "Your feature description"
```

---

## Common Commands

| Command                                                     | Description                         |
| ----------------------------------------------------------- | ----------------------------------- |
| `codepipe init`                                             | Initialize repository configuration |
| `codepipe start --prompt "..."`                             | Start a new feature run             |
| `codepipe status`                                           | Show current run status             |
| `codepipe status --json`                                    | Machine-readable status output      |
| `codepipe approve prd --approve --signer "you@example.com"` | Approve the PRD gate (example)      |
| `codepipe resume`                                           | Resume a paused or failed run       |
| `codepipe doctor`                                           | Diagnose environment issues         |

---

## Troubleshooting

### `command not found: codepipe`

Ensure npm global bin is in your PATH:

```bash
export PATH="$(npm config get prefix)/bin:$PATH"
```

Add this to your `~/.bashrc` or `~/.zshrc` for persistence.

### Permission Denied Errors

If npm install fails with EACCES:

```bash
# Option 1: Use a Node version manager (recommended)
nvm install 24
nvm use 24

# Option 2: Configure npm for user-level installs
mkdir -p "$HOME/.npm-global"
npm config set prefix "$HOME/.npm-global"
export PATH="$HOME/.npm-global/bin:$PATH"
```

### Node Version Too Old

codepipe requires Node.js 24+. Upgrade with nvm:

```bash
nvm install 24
nvm alias default 24
```

Or download directly from [nodejs.org](https://nodejs.org/).

### Config File Not Found

Run `codepipe init` first to generate `.codepipe/config.json`.

---

## Offline Mode

codepipe works without GitHub/Linear when those integrations are disabled, but you still need an agent endpoint to generate PRDs/plans/code.

For true offline operation, point `AGENT_ENDPOINT` at a local agent service (for example, a homelab-hosted OpenAI-compatible gateway):

```bash
export AGENT_ENDPOINT="http://localhost:8080/v1"
```

---

## Next Steps

- [Init Playbook](ops/init_playbook.md) - Detailed initialization options
- [Doctor Reference](ops/doctor_reference.md) - Environment diagnostics
- [CLI Reference](ops/cli-reference.md) - Full command reference
- [RepoConfig Schema](requirements/RepoConfig_schema.md) - Configuration options

---

## Getting Help

- Run `codepipe doctor` to diagnose common issues
- Check logs in `.codepipe/runs/<feature-id>/telemetry/`
- File issues at the project repository
