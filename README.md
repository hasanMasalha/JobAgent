# JobAgent

An AI-powered job assistant for the Israeli market. It scrapes jobs from Indeed Israel and LinkedIn, matches them to your CV using vector embeddings, and automates LinkedIn Easy Apply — but only when you explicitly confirm each application.

## What it does

- **Job scraping** — pulls listings from Indeed Israel and LinkedIn daily via JobSpy
- **CV matching** — embeds your CV and job descriptions using `paraphrase-multilingual-MiniLM-L12-v2` and ranks matches with pgvector (no LLM involved in matching)
- **CV tailoring** — when you click Apply, Claude Sonnet rewrites your CV for that specific job and drafts a cover letter
- **LinkedIn Easy Apply automation** — Playwright submits the application only after you review and confirm; a screenshot is saved before every submit
- **Application tracker** — tracks every application through draft → applied → interviewing → offer / rejected / cancelled

## Tech stack

| Layer | Technology |
|---|---|
| Frontend + API | Next.js 14 (App Router), TypeScript, Tailwind CSS |
| AI / Python service | FastAPI (port 8000) |
| Database | PostgreSQL via Supabase + pgvector |
| ORM | Prisma |
| Embeddings | sentence-transformers |
| Job scraping | JobSpy |
| Browser automation | Playwright |
| Auth | Supabase Auth |
| Background jobs | APScheduler |

## Project structure

```
/app                    Next.js pages (auth, dashboard, applications)
/app/api                Next.js API routes
/ai-service             Python FastAPI service
  main.py               Entry point
  scraper.py            JobSpy scraping
  embedder.py           Embedding model
  applier.py            Playwright apply logic
  scheduler.py          Daily background jobs
  routes/               FastAPI route files
/prisma/schema.prisma   Database schema
/lib                    Shared Next.js utilities
```

## Getting started

### 1. Environment variables

```bash
cp .env.example .env
# Fill in all values in .env
```

### 2. Next.js frontend

```bash
npm install
npm run dev
```

### 3. Python AI service

```bash
cd ai-service
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### 4. Database

```bash
npx prisma generate
npx prisma db push
```

Open [http://localhost:3000](http://localhost:3000) to use the app.

## Environment variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | Supabase PostgreSQL connection string |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anon key |
| `ANTHROPIC_API_KEY` | Claude API key |
| `REDIS_URL` | Upstash Redis URL |
| `PYTHON_SERVICE_URL` | FastAPI service URL (default: `http://localhost:8000`) |
