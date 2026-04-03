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

## Naming conventions
- API routes: /app/api/[resource]/route.ts
- Python routes: /ai-service/routes/[resource].py
- Components: PascalCase, e.g. JobCard.tsx
- DB functions: camelCase, e.g. getUserCV()
- Python functions: snake_case, e.g. embed_job()