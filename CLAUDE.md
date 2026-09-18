# Job Assistant App — Project Bible

## What this app does
AI job assistant for the global market. Scrapes thousands of jobs daily
from company career pages, LinkedIn, Indeed and more, matches them to
user CVs using vector embeddings (no LLM for matching), and auto-applies
on the user's behalf: a single "Apply" click submits directly to
supported ATS platforms (Greenhouse, Lever, Workable, Ashby, Comeet,
BambooHR) with no separate confirmation step, and batch auto-apply can
submit to many matched jobs at once via email. A separate "Tailor CV &
Apply" path still tailors the CV/cover letter and lets the user review
before applying, for jobs that need more care. LinkedIn listings with no
resolved ATS URL fall back to the browser extension or manual apply —
they are not silently auto-submitted.

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
DODO_PAYMENTS_API_KEY      Dodo Payments bearer token (dodo_test_... / dodo_live_...)
DODO_PAYMENTS_WEBHOOK_KEY  Dodo Payments webhook signing secret
DODO_PAYMENTS_ENVIRONMENT  test_mode or live_mode — defaults to test_mode if unset
DODO_PRO_MONTHLY_PRODUCT_ID          Dodo product ID, Pro plan / monthly
DODO_PRO_ANNUAL_PRODUCT_ID           Dodo product ID, Pro plan / annual
DODO_UNLIMITED_MONTHLY_PRODUCT_ID    Dodo product ID, Unlimited plan / monthly
DODO_UNLIMITED_ANNUAL_PRODUCT_ID     Dodo product ID, Unlimited plan / annual

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
There are two supported apply paths — know which one a change affects:

**Quick / Auto Apply** (`/api/apply/quick`, `/api/apply/batch-auto`)
1. User clicks Apply (single job) or triggers batch auto-apply (multiple jobs)
2. For ATS-detected jobs (Greenhouse, Lever, Workable, Ashby, Comeet,
   BambooHR) the application is submitted immediately — no review or
   confirm step in this path
3. Batch auto-apply sends a tailored application email per job directly
4. If the job is a LinkedIn listing with no resolved ATS `apply_url` →
   no automation here; return `needs_extension` and route to the
   Tailor & Apply flow / browser extension instead

**Tailor CV & Apply** (`/dashboard/apply/[jobId]`)
1. User clicks "Tailor CV & Apply" → Claude tailors CV (draft saved, nothing submitted)
2. User sees review screen → can edit cover letter → clicks Confirm
3. Only after Confirm → Playwright opens LinkedIn Easy Apply and submits
4. If job is not LinkedIn Easy Apply → show manual link, no automation
5. Screenshot taken before every submit and stored

## Billing (Dodo Payments)
- Checkout: `/api/dodo/checkout` creates a hosted Dodo Checkout Session
  server-side and returns `checkoutUrl` — the client just redirects
  (`window.location.href`). No client-side SDK, no overlay. Called from both
  `/pricing` and the onboarding plan-selection step.
- Webhook: `/api/dodo/webhook` verifies the signature (`dodo.webhooks.unwrap`)
  and updates `User.plan` / `planExpiresAt` on subscription events. Product ID
  → plan mapping is env-var driven (`lib/plan-limits.ts`) since test and live
  mode have entirely separate product catalogs.
- **Known gap:** the webhook handler has no idempotency/dedup table — a
  retried delivery just re-applies the same upsert, which is harmless today
  because the handler only writes plan/customer/expiry fields with no other
  side effects. If we ever add something non-idempotent on a webhook event
  (an email, a charge, anything else with an external effect) this needs a
  `webhook-id`-keyed claim table first (see the `webhook-integration` Dodo
  skill's idempotency pattern) — otherwise a retried delivery double-fires it.
- Paddle was the original processor; it rejected our account before going
  live, so `lib/paddle.ts`, `lib/paddle-client.ts`, and `app/api/paddle/*`
  were removed rather than kept as a second option.

## Playwright / browser automation caveats
- Playwright runs headless=True. For LinkedIn the user must have a saved
  session in browser_profile/{user_id}/ — see the LinkedIn login flow in preferences.
- Greenhouse's human-verification gate (its "security code" / "confirm
  you're a human" step, with #security-input-0..7 boxes) is reCAPTCHA-driven
  and ties the one-time code to the browser session that triggered it — our
  server's headless browser, not the user's. There's no way to hand that
  code to the user via a link, so this is treated as an ordinary
  needs_manual outcome (apply manually) rather than a status of its own to
  build a "finish" flow around. Verified manually — don't reintroduce a
  dedicated needs_security_code status without solving that first.

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