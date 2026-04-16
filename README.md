# JobAgent — AI-Powered Job Assistant

An AI-powered job assistant for the Israeli market. Scrapes jobs daily from Indeed Israel, LinkedIn, and AllJobs, matches them to your CV using vector embeddings, tailors your CV per role using Claude, and automates LinkedIn Easy Apply — only when you explicitly confirm each application.

---

## Features

- **AI job matching** — vector similarity search finds jobs that semantically match your CV, not just keyword matches
- **CV upload** — upload existing CV in PDF or Word format
- **CV builder** — create a professional CV from scratch using AI, no existing CV needed
- **CV scoring** — Claude grades your CV out of 100 and gives specific actionable improvement tips
- **CV tailoring** — Claude rewrites your CV for each specific role when you apply
- **Cover letter generation** — personalised cover letter per job, fully editable before sending
- **Tailored CV download** — download the tailored CV as a professionally formatted .docx file
- **LinkedIn Easy Apply automation** — Playwright fills and submits the form after you confirm
- **Manual apply fallback** — for non-LinkedIn jobs, prepared cover letter and CV are ready to copy
- **Application tracker** — tracks every application with status management and stats
- **Chat assistant** — ask questions about your job search using live data from your account
- **Google Calendar integration** — schedule interviews directly from the app or via chat
- **Daily email notifications** — get emailed when new job matches are found each morning
- **Dashboard filters** — filter by work type, job type, match score, and minimum salary
- **Save and dismiss jobs** — save interesting jobs, dismiss irrelevant ones permanently
- **User preferences** — set target job titles, location, work arrangement, and minimum salary

---

## AI Techniques

### RAG — Retrieval Augmented Generation

**How it works in this project:**

1. When a user uploads or builds their CV, Claude Haiku extracts structured data — skills, job titles, years of experience, and a clean professional summary — from the raw text
2. The clean summary is converted to a 384-dimensional vector using `paraphrase-multilingual-MiniLM-L12-v2`, a multilingual model that handles both Hebrew and English equally
3. Every scraped job description is embedded using the same model and stored in PostgreSQL via the pgvector extension
4. When matching runs, a single SQL query uses cosine similarity to retrieve the top 50 jobs closest to the user's CV vector — no LLM is involved at this stage
5. The retrieved jobs are passed to Claude Haiku in ONE batch API call for scoring, reasoning, and gap analysis
6. Results are ranked and shown to the user with match percentage, reasons, and skill gaps

**Why this matters:**
Traditional keyword search misses "React developer" matching "frontend engineer". Vector similarity catches semantic equivalence across languages — a Hebrew job description matches an English CV because the multilingual model maps them to nearby vectors in the same embedding space.

**Cost efficiency:**
Jobs are embedded once when scraped and reused for all users forever. Matching 500 jobs against a user's CV costs $0.00 — only the final Claude batch scoring call costs money, approximately $0.03 per user per day regardless of how many jobs are in the database.

---

### Agentic Flow

**How it works in this project:**

When a user clicks Confirm & Apply, a Playwright agent autonomously:

1. Detects the job platform from the URL — LinkedIn, Indeed, or other
2. For LinkedIn Easy Apply:
   - Opens the persistent browser profile for this user
   - Finds and clicks the Easy Apply button
   - Fills name, email, phone from the user profile
   - Uploads the tailored CV file
   - Pastes the cover letter into the text field
   - Handles multi-step forms by looping through each step
   - Takes a screenshot before the final submit for the user's records
   - Clicks submit and waits for the confirmation page
3. For Indeed: handles multi-step application forms with up to 10 steps
4. For any other site: returns manual status with the job link, prepared cover letter ready to copy, and tailored CV ready to download

**Key design decision:**
Nothing is submitted without two explicit user actions. Clicking Apply triggers CV tailoring and saves a draft — nothing is sent. Clicking Confirm & Apply triggers the Playwright submission. The agent never acts without clear user intent at every step.

---

### Function Calling — Claude tool_use

**How it works in this project:**

The chat assistant uses Claude's official tool_use API. Claude is given four tools it can call to fetch live data from the database:

| Tool | What it does |
|------|-------------|
| `get_my_matches` | Queries pgvector for current job matches filtered by min score |
| `get_my_applications` | Fetches applications from DB filtered by status |
| `get_application_stats` | Returns counts grouped by status |
| `schedule_interview` | Creates a real Google Calendar event via the Calendar API |

**The agentic loop:**
1. User sends a message
2. Claude decides which tool to call based on the question
3. The tool queries the real database and returns live results
4. Claude uses the actual data to answer accurately
5. If needed, Claude calls multiple tools before answering

**Example:**
User: "Which companies haven't replied to me?"
Claude calls → get_my_applications({ status: "applied" })
DB returns   → applications older than 30 days with no update
Claude says  → "Wix (47 days), Amdocs (38 days), Tower (31 days).
Want help writing a follow-up email?"

Without function calling, Claude guesses from whatever context was injected into the system prompt — which gets stale and can be wrong. With function calling, Claude reads your actual live database every time.

---

## External Service Integrations

### 1. Anthropic Claude API

Used for CV extraction on upload, job batch scoring, CV tailoring on apply, cover letter generation, AI CV building from scratch, CV scoring and feedback, and the chat assistant with function calling.

**Models used:**
- `claude-haiku-3-5` — CV extraction, batch job scoring, chat assistant. Fast and cost-efficient for high-frequency tasks.
- `claude-sonnet-4-20250514` — CV tailoring per role, CV generation from scratch. Higher quality for output the user will actually send to employers.

**Files:**
- `/ai-service/routes/cv.py` — extraction and embedding
- `/ai-service/routes/matching.py` — batch scoring
- `/app/api/apply/prepare/route.ts` — tailoring
- `/app/api/cv/generate/route.ts` — generation
- `/app/api/chat/route.ts` — function calling

---

### 2. Google Calendar API

Used for creating interview calendar events when a user marks an application as interviewing, or asks the chat assistant to schedule an interview.

**OAuth flow:**
1. User clicks Connect Google Calendar in their profile
2. App redirects to Google OAuth consent screen requesting `calendar.events` scope
3. User approves, Google returns auth code
4. App exchanges code for access token and refresh token, stored in DB
5. On scheduling: POST to Google Calendar API creates the event with 24-hour email reminder and 1-hour popup reminder
6. Event link returned and shown to user

**Files:**
- `/app/api/auth/google/route.ts` — OAuth initiation
- `/app/api/auth/google/callback/route.ts` — token exchange
- `/lib/google-calendar.ts` — event creation

---

### 3. Indeed + LinkedIn via JobSpy

Used for daily job scraping targeting the Israeli market. JobSpy is an open-source library that scrapes both platforms concurrently and returns structured data.

**Configuration:**
- Search terms: software engineer, backend developer, frontend developer, full stack developer, data engineer, devops engineer, product manager, QA engineer
- Location: Israel, country_indeed set to Israel
- Results: 30 jobs per search term, last 48 hours only to keep data fresh
- Deduplication: jobs are skipped on insert if the URL already exists
- Scheduling: runs daily at 05:00 UTC via APScheduler

**Files:**
- `/ai-service/scraper.py`
- `/ai-service/scheduler.py`

---

### 4. Resend

Used for daily email notifications sent to users after the matching pipeline completes each morning.

**Email content:**
- Subject: "{count} new job matches today"
- Shows top 5 matches with job title, company, location, and match score badge
- Color-coded scores: green above 80%, amber 60-79%
- Single call-to-action button linking to the dashboard
- Unsubscribe link that sets email_notifications to false

**Only sent when:**
- User has email_notifications set to true in their profile
- At least one new match was found that day

**Files:**
- `/lib/email.ts`
- `/app/api/email/send-matches/route.ts`

---

## Architecture
```
Browser
↕ HTTPS
Next.js 14 (App Router + API Routes)
↕ HTTP on port 8000          ↕ Supabase SDK
Python FastAPI Service      PostgreSQL + pgvector
├── sentence-transformers       (Supabase)
│   (local, runs on server)
├── Playwright
│   (headless Chromium)
├── JobSpy
│   (Indeed + LinkedIn)
└── APScheduler
    (05:00 scrape, 06:00 match)

External APIs called:
  Anthropic Claude API
  Google Calendar API
  Resend Email API
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend + API routes | Next.js 14 App Router, TypeScript, Tailwind CSS |
| AI and Python service | Python 3.11, FastAPI |
| Database | PostgreSQL with pgvector extension via Supabase |
| ORM | Prisma |
| Embeddings | sentence-transformers, paraphrase-multilingual-MiniLM-L12-v2 |
| Job scraping | JobSpy |
| Browser automation | Playwright with persistent browser profiles |
| Authentication | Supabase Auth |
| Background scheduling | APScheduler with AsyncIOScheduler |
| Email | Resend |
| CV document generation | docx npm package |
| External integrations | Anthropic Claude API, Google Calendar API, Resend |

---

## Project Structure
```
/
├── app/
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   └── signup/page.tsx
│   ├── dashboard/
│   │   ├── page.tsx                  Main job matching dashboard
│   │   ├── applications/page.tsx     Application tracker
│   │   ├── cv-builder/
│   │   │   ├── page.tsx              4-step AI CV builder form
│   │   │   └── preview/page.tsx      Generated CV preview
│   │   ├── apply/[jobId]/page.tsx    Apply flow — tailor and confirm
│   │   ├── chat/page.tsx             Chat assistant with function calling
│   │   ├── my-cv/page.tsx            CV score and feedback
│   │   └── profile/page.tsx          CV upload, preferences, notifications
│   └── api/
│       ├── cv/                       CV upload, generate, score, download
│       ├── apply/                    Prepare and submit applications
│       ├── match/                    Trigger matching pipeline
│       ├── jobs/                     Job interactions, scrape status
│       ├── chat/                     Chat with function calling
│       ├── email/                    Send match notifications
│       ├── auth/google/              Google OAuth flow
│       └── calendar/                 Calendar event creation
├── ai-service/
│   ├── main.py                       FastAPI entry point and scheduler startup
│   ├── scraper.py                    JobSpy scraping with AllJobs enrichment
│   ├── embedder.py                   Multilingual embedding model singleton
│   ├── applier.py                    Playwright apply automation
│   ├── scheduler.py                  APScheduler daily jobs
│   └── routes/
│       ├── cv.py                     CV processing and extraction
│       ├── matching.py               pgvector search and Claude scoring
│       ├── jobs.py                   Scrape and store endpoint
│       ├── apply.py                  Playwright apply handler
│       └── linkedin_auth.py          LinkedIn session management
├── lib/
│   ├── db.ts                         Prisma client singleton
│   ├── supabase.ts                   Supabase server and browser clients
│   ├── email.ts                      Resend email functions
│   ├── generate-cv.ts                Professional .docx CV generation
│   └── google-calendar.ts            Google Calendar event creation
├── components/
│   ├── JobCard.tsx                   Job card with match score and actions
│   ├── JobFilters.tsx                Dashboard filter bar
│   └── CVScoreCard.tsx               CV score display with improvements
├── prisma/
│   └── schema.prisma                 Database schema with all tables
├── CLAUDE.md                         Project context for Claude Code sessions
└── .env.example                      All required environment variables
```

---

## How the matching pipeline works end to end
```
Day 0 — User onboarding:
Upload CV (PDF/Word) or build CV with AI builder
↓
Claude Haiku extracts: skills[], titles[], summary
↓
paraphrase-multilingual-MiniLM-L12-v2 embeds summary
↓
CV vector stored in cvs table (done once, reused forever)

Every day at 05:00 UTC — scraping:
JobSpy pulls 240+ jobs from Indeed + LinkedIn Israel
↓
Each job embedded locally (free, no API call)
↓
Upserted to jobs table — duplicates skipped by URL

Every day at 06:00 UTC — matching:
pgvector cosine similarity: top 50 jobs per user (no LLM)
↓
ONE Claude Haiku call scores all 50 jobs
Returns: score, reasons[], gaps[] per job
↓
Results cached for the day
↓
Resend email sent if new matches found

When user clicks Apply:
Claude Sonnet tailors CV for this specific role
Claude writes personalised cover letter
Application saved as draft — nothing sent yet
↓
User reviews cover letter (editable) and CV changes
↓
User clicks Confirm and Apply
↓
Playwright opens LinkedIn Easy Apply modal
Fills all fields, uploads tailored CV, submits
Screenshot saved before submit
↓
Application status updated to applied
Google Calendar event created if requested
```

---

## Key design decisions

**No LLM for matching** — pgvector handles similarity search entirely. Claude only sees the top 50 results in one batch call. This keeps API costs at approximately $0.03 per user per day regardless of how many jobs are in the database.

**Two-click apply rule** — clicking Apply triggers tailoring and saves a draft. Clicking Confirm triggers Playwright submission. Nothing is ever sent without two explicit user actions. This protects users from accidental applications and builds trust.

**Multilingual embeddings** — `paraphrase-multilingual-MiniLM-L12-v2` was chosen specifically because it handles Hebrew and English in the same vector space. Essential for the Israeli market where job descriptions and CVs mix both languages.

**Local embedding model** — sentence-transformers runs on the server with zero cost per embedding and no data sent to external APIs during the matching step. Only the final scoring step touches the Claude API.

**Haiku for volume, Sonnet for quality** — Claude Haiku handles all high-frequency tasks (extraction, scoring, chat). Claude Sonnet is reserved for CV tailoring and generation where the output quality directly affects the user's job prospects.

**Persistent browser profiles** — Playwright uses a per-user persistent browser profile so LinkedIn session cookies are preserved between apply sessions. Users log in to LinkedIn once and all future Easy Apply submissions use that session.

---

## Getting Started

### Prerequisites

- Node.js 20 or later
- Python 3.11 or later
- A Supabase project with pgvector extension enabled
- Anthropic API key
- Google Cloud project with Calendar API enabled
- Resend account

### 1. Clone and install

```bash
git clone https://github.com/yourusername/job-agent
cd job-agent
npm install
```

### 2. Environment variables

```bash
cp .env.example .env
# Fill in all values — see table below
```

### 3. Enable pgvector in Supabase

Run this in your Supabase SQL editor before running migrations:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

### 4. Database setup

```bash
npx prisma generate
npx prisma db push
```

### 5. Python service

```bash
cd ai-service
pip install -r requirements.txt
playwright install chromium
uvicorn main:app --reload --port 8000
```

### 6. Start the frontend

```bash
npm run dev
```

Open http://localhost:3000

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Supabase PostgreSQL connection string |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anon key |
| `ANTHROPIC_API_KEY` | Claude API key from console.anthropic.com |
| `PYTHON_SERVICE_URL` | FastAPI service URL, default http://localhost:8000 |
| `GOOGLE_CLIENT_ID` | Google OAuth 2.0 client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth 2.0 client secret |
| `GOOGLE_REDIRECT_URI` | OAuth callback URL |
| `RESEND_API_KEY` | Resend API key for email notifications |
| `INTERNAL_API_KEY` | Secret key for internal service-to-service calls |
| `NEXT_PUBLIC_APP_URL` | Your app public URL, e.g. https://jobagent.up.railway.app |

---

## Running in production

Both services need to run simultaneously. For production deployment, Railway is recommended — it supports both Next.js and Python services with automatic deploys from GitHub.

When deploying, update `PYTHON_SERVICE_URL` in your Next.js environment variables to point to the deployed Python service URL instead of localhost.

The APScheduler inside the Python service handles all daily automation — scraping at 05:00 UTC and matching at 06:00 UTC — as long as the service stays running.
