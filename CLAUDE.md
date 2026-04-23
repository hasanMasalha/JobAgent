# Job Assistant App — Project Bible

## What this app does
AI job assistant for the Israeli market. Scrapes jobs from Indeed Israel
and LinkedIn, matches them to user CVs using vector embeddings (no LLM
for matching), and lets users apply to LinkedIn Easy Apply jobs via
Playwright automation — but ONLY when the user explicitly clicks Apply
then confirms. Nothing is ever submitted automatically.

## Tech stack — do not deviate from this
- Frontend + API routes: Next.js 14 (App Router), TypeScript, Tailwind CSS
- AI/Python service: FastAPI on port 8000
- Database: PostgreSQL via Supabase with pgvector extension
- ORM: Prisma (Next.js side)
- DB driver (Python side): asyncpg + psycopg2
- Embeddings: sentence-transformers, model = paraphrase-multilingual-MiniLM-L12-v2
- Job scraping: JobSpy library
- Browser automation: Playwright (Python)
- Auth: Supabase Auth with @supabase/ssr
- Background jobs: APScheduler (Python side)

## Project structure
/                          Next.js root
/app                       App router pages
/app/(auth)/login          Login page
/app/(auth)/signup         Signup page
/app/dashboard             Main dashboard
/app/dashboard/onboarding  CV upload + preferences
/app/dashboard/applications Application tracker
/app/api                   Next.js API routes
/lib/db.ts                 Prisma client singleton
/lib/supabase.ts           Supabase client
/prisma/schema.prisma      Database schema
/ai-service                Python FastAPI app
/ai-service/main.py        FastAPI entry point
/ai-service/scraper.py     JobSpy scraping
/ai-service/embedder.py    Embedding model (loaded once)
/ai-service/applier.py     Playwright apply logic
/ai-service/scheduler.py   APScheduler daily jobs
/ai-service/routes/        FastAPI route files
/ai-service/requirements.txt

## Environment variables (never hardcode values)
DATABASE_URL               Supabase postgres connection string
SUPABASE_URL               Supabase project URL
SUPABASE_ANON_KEY          Supabase anon key
ANTHROPIC_API_KEY          Claude API key
REDIS_URL                  Upstash Redis URL
PYTHON_SERVICE_URL         http://localhost:8000
GOOGLE_CLIENT_ID           Google OAuth 2.0 client ID
GOOGLE_CLIENT_SECRET       Google OAuth 2.0 client secret
GOOGLE_REDIRECT_URI        https://yourdomain.com/api/auth/google/callback

## Database tables
users          id, email, name, linkedin_session_path,
               google_access_token, google_refresh_token,
               google_connected, created_at
cvs            id, user_id, raw_text, skills_json, clean_summary,
               embedding vector(384), updated_at
jobs           id, title, company, description, location, url,
               source, salary_min, salary_max, embedding vector(384),
               scraped_at
job_preferences id, user_id, titles[], locations[], remote_ok,
                min_salary, updated_at
applications   id, user_id, job_id, status, tailored_cv,
               cover_letter, applied_at
user_job_interactions  id, user_id, job_id, action (saved/dismissed)

## Application status values
draft → applied → interviewing → offer / rejected / cancelled

## Claude API usage rules (cost control)
- CV extraction on upload: claude-haiku-3-5 (once per CV)
- Job batch scoring: claude-haiku-3-5 (once per day per user, all jobs in ONE call)
- CV tailoring on apply: claude-sonnet-4-20250514 (only when user clicks Apply)
- Chat assistant: claude-haiku-3-5 (per message)
- NEVER call the API per-job per-user for matching — use pgvector for that

## Apply flow rules — critical
1. User clicks Apply → Claude tailors CV (draft saved, nothing submitted)
2. User sees review screen → can edit cover letter → clicks Confirm
3. Only after Confirm → Playwright opens LinkedIn Easy Apply and submits
4. If job is not LinkedIn Easy Apply → show manual link, no automation
5. Screenshot taken before every submit and stored

## Playwright / browser automation caveats
- Playwright runs headless=True. For LinkedIn the user must have a saved
  session in browser_profile/{user_id}/ — see the LinkedIn login flow in preferences.

## Linting

Run these before committing:

```bash
# Python (ai-service/)
ruff check ai-service/

# TypeScript/Next.js
npm run lint
```

`_`-prefixed variables are intentionally unused in both configs.

## Naming conventions
- API routes: /app/api/[resource]/route.ts
- Python routes: /ai-service/routes/[resource].py
- Components: PascalCase, e.g. JobCard.tsx
- DB functions: camelCase, e.g. getUserCV()
- Python functions: snake_case, e.g. embed_job()

# GitHub Platform Reference

GitHub-specific tooling and CI configuration. For the operational workflow (ticket-driven development, branch strategy, PR lifecycle, run reports), see the root CLAUDE.md.

## Tooling Standard (ADR-020)

Two tools, each for its job:

| Tool | Use for | Never use for |
|------|---------|---------------|
| git | Push, pull, commit, branch — all code movement | GitHub platform ops (issues, PRs, checks) |
| gh CLI | Issues, PRs, checks, releases — all GitHub platform ops | Pushing code (use git push) |
| MCP GitHub plugin | Read-only fallback (reading issues, PRs) when gh is unavailable | *Pushing code* — push_files creates synthetic commits disconnected from local git state |

*Why this matters:* git push sends the exact committed objects from your local repo. MCP push_files creates a new commit on the server from raw content you provide — if a local linter auto-fixed your files, the API push won't reflect that, causing CI failures on code that passed locally.

*Credentials:* Run gh auth setup-git once to make git use gh's token. This eliminates credential fragmentation between the two tools.

## CI Pipeline

.github/workflows/pr-tests.yml runs automatically on every PR to main:
- *Path filtering:* Uses dorny/paths-filter to detect changes in src/orchestrator/, docs/, and src/control-center/
- *Lint:* uv run ruff check src/ tests/ (from src/orchestrator/ working directory)
- *Test:* uv run pytest tests/ -v --tb=short (from src/orchestrator/ working directory)
- *Control Center:* Placeholder job for future frontend CI
- *Auto-merge:* Squash-merges the PR if all required jobs pass or are skipped.

If CI fails, fix the issue on the branch and push again — the workflow re-triggers automatically.

## GitHub CLI Quick Reference

### Ticket Operations

```bash
gh issue list --state open                           # List open tickets
gh issue view <NUMBER>                               # Read a ticket
gh issue view <NUMBER> --json body --jq '.body'      # Read ticket body (raw)
gh issue close <NUMBER> --reason completed            # Close after merge
gh issue edit <NUMBER> --milestone "<name>"           # Assign milestone
```

### PR Operations

```bash
gh pr create --title "..." --body "..."              # Create PR
gh pr view <NUMBER>                                   # Check PR status
gh pr checks <NUMBER>                                 # Check CI status
gh pr diff <NUMBER>                                   # Verify PR diff
```

### Posting Comments

```bash
gh issue comment <NUMBER> --body "PR: #<PR-number>"  # Link PR to ticket
gh issue comment <NUMBER> --body "## Run Report ..."  # Post run report
```

## Using the Orchestrator

```bash
cd src/orchestrator && uv run orqestra ticket implement <N> --team blja-team
```

Other commands (all from src/orchestrator/ directory):
```bash
uv run orqestra init --team blja-team                                    # Start session
uv run orqestra brainstorm --team blja-team                              # Design a feature
uv run orqestra ticket create "description" --team blja-team --flow small_feature  # Create ticket
uv run orqestra ticket list --team blja-team                             # List open tickets
```

## Autonomous Bug Fixing

- When given a bug report: just fix it. Don't ask for hand-holding.
- Point at logs, errors, failing tests — then resolve them.
- Zero context switching required from the user.
- Go fix failing CI tests without being told how.