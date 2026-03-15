# CLAUDE.md — Development Standards for AI Agents

Project Name: Nexus
This file governs how Claude Code behaves on any project. **Updating this file is part of the definition of done for any change that affects process or conventions.**

---

## Definition of Done

A task is complete when all of the following are true:

- Implementation matches requirements — no speculative features
- Relevant documentation is updated (see Documentation)
- Verification has passed (manual or automated)
- Commit message follows the commit standard

---

## Documentation

|Change type|Update location|
|---|---|
|New feature / interface change|`README.md`|
|Schema / data model change|model files + migration scripts|
|Process / convention change|`CLAUDE.md` (this file)|
|Dependency change|commit message body (include version)|
|Bug fix|commit message body (explain root cause)|

**File responsibilities:**

- `CLAUDE.md` — working standards, written for AI. Update immediately when conventions change.
- `README.md` — quick start, written for humans. How to run things, not why.
- `.env.example` — authoritative source for all configurable values, with descriptions and defaults.

---

## Code Standards

### General

- Implement only what the current task requires.
- Do not add comments or docstrings to code you didn't modify.
- Do not add error handling for scenarios that cannot occur.
- One logical change per commit.
- Database queries must use parameterized statements — no string concatenation.

### Python

- Type-annotate all function signatures; avoid `Any` unless genuinely unavoidable.
- Use the framework's exception mechanism with appropriate status codes.
- No synchronous I/O inside async functions.
- Follow the existing module structure; do not invent new directory hierarchies.

### TypeScript / React

- Enable strict mode; do not use `any`.
- State and side effects via hooks only — no direct DOM manipulation.
- Single responsibility per component: logic into hooks, formatting into utilities.
- Avoid deeply nested conditional JSX; prefer composition.

---

## Testing

- **Frameworks:** pytest + pytest-asyncio for backend; Vitest (or existing framework) for frontend.
- **Coverage:** all API endpoints cover happy path + key error scenarios; validation covers invalid input, boundary values, and enum violations.
- All tests must pass before merging. Failing tests are blockers, not warnings.
- New features require tests. Bug fixes require regression tests.

**Minimum manual verification (until automated suite is complete):**

1. Test affected endpoints in the API docs (Swagger/OpenAPI) — verify status codes and response bodies.
2. Walk through affected user flows in the browser — check Console and Network tab for errors.
3. For any new or modified input form, test missing required fields, out-of-range values, and type mismatches — confirm 422, not 500.
4. Test migration scripts against a clean database; spot-check key data afterward.

---

## Git Commit Standard

### Format

```
type(scope): short English subject (≤ 72 chars)

Optional body — any language.
Explain why, not what. For bug fixes, explain the root cause.

Co-Authored-By: Claude <noreply@anthropic.com>
```

### Types

|Tag|Use|
|---|---|
|`feat`|new feature|
|`fix`|bug fix|
|`docs`|documentation only|
|`refactor`|restructure without behavior change|
|`test`|add or fix tests|
|`chore`|tooling, dependencies, config|
|`style`|formatting, no logic change|

### Rules

- Subject line in English, imperative mood ("Add", not "Added"), no trailing period, ≤ 72 chars.
- Blank line between subject and body.
- **Every commit must include the `Co-Authored-By: Claude <noreply@anthropic.com>` trailer.**
- Commits must not contain real names, contact information, or sensitive business data (specific IDs, amounts, etc.).

---

## Security

- Secrets and connection strings are injected via environment variables — never hardcoded.
- The actual `.env` file must not be committed to git (verify it is in `.gitignore`).
- Production `SECRET_KEY` and `DB_PASSWORD` must differ from defaults.
- Production CORS must allow only explicitly listed origins — no wildcards.
- Passwords are stored as bcrypt hashes — never in plaintext, never logged.
- Databases must not be exposed on public-facing ports.

---

## Docker Access Constraints

Claude Code runs inside a Docker container with access to the host Docker socket, meaning it can affect **all containers on the host**. This is a high-privilege capability and must be strictly scoped.
Access host service by using e.g. host.docker.internal:59000

### Allowed

```bash
# Operate on this project only, via docker compose
docker compose ps / up / down / logs / build / exec

# Operate on a single container only after confirming it belongs to this project
docker start / stop / restart / logs <this-project-container>
```

### Prohibited

- Viewing, modifying, stopping, or deleting containers, images, networks, or volumes belonging to **any other project**
- Global cleanup commands: `docker system prune`, `docker volume prune`, `docker image prune`
- Accessing files or data inside other projects' containers

**When in doubt about ownership, ask the user — do not assume.**

---

## Tool Installation and Execution

The agent container's system environment resets on restart. **Never install tools globally** (e.g., `apt install`, `pip install --system`) — changes will be lost.

### Option A — Install into the working directory (preferred for project dependencies)

The working directory is a mounted volume and persists across restarts:

```bash
npm install                                          # node_modules persists with the volume
pip install -r requirements.txt --target ./vendor   # local Python packages
python -m venv .venv && .venv/bin/pip install ...   # venv inside working directory
```

### Option B — Run tools via Docker (preferred for one-off tools)

Spin up a container with the required tool, use it, and discard it:

```bash
docker run --rm node:18 npx some-tool
docker run --rm python:3.11 python -c "..."
```

### Path gotcha when mounting volumes from the agent container

The `-v` flag on `docker run` is resolved by the **host**, not the agent container. The agent's internal paths differ from host paths, so direct mounts will fail or mount the wrong location.

- **Prefer pipes over mounts:** `cat file | docker run --rm -i tool > output`
- **When file access is required:** use `--volumes-from <agent-container-id>` to share the existing volume instead of specifying a path
- **When host path is unknown:** fall back to Option A and avoid launching a new container entirely

---

## Agentic Behavior

When executing multi-step tasks autonomously:

- **Minimal footprint:** request and use only the permissions needed for the current task.
- **Prefer reversible actions:** irreversible operations (data deletion, database reset) require explicit user confirmation before execution.
- **Pause and ask when:**
    - the task scope appears to exceed what was requested
    - a potentially destructive side effect is discovered
    - continuing requires guessing user intent
- **No opportunistic work:** do not perform unrequested cleanup, optimization, or refactoring just because it seems convenient.
- **Narrate non-obvious actions:** briefly state what you are doing and why before executing anything that isn't self-evident.

---

## Environment Variables

- All configuration lives in the root `.env` file (template: `.env.example`) — the single source of truth.
- Every variable in `.env.example` must have a comment explaining its purpose and default value.
- When adding a new variable, update `.env.example` and any relevant documentation in the same commit.
- Business code reads configuration through a central settings module — no direct `os.environ` calls in application logic.
