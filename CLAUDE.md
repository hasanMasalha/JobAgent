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
INTERNAL_API_KEY           Shared secret between Next.js and the AI service
                           (X-Internal-Key). Unset = both sides fail closed
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
EXTENSION_TOKEN_SECRET     ≥32 random chars; signs the Chrome extension's API token
                           (lib/extension-token.ts). Unset = extension API calls fail closed

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
- CV tailoring on apply: claude-sonnet-4-20250514 (only when user clicks Apply).
  The apply page calls `/api/apply/prepare` on every load, so the route
  returns the existing draft — no Claude call, no tailoring credit — while
  `Application.tailored_cv_hash` (SHA-256 of the CV `raw_text` it was tailored
  from) still matches the user's CV. `Application.cv_changes` stores the
  change list with it. It used to charge and call Sonnet before looking for
  the draft, so every reload cost a credit.
- Chat assistant: claude-haiku-3-5 (per message)
- CV score (My CV, CV builder preview): claude-haiku-4-5, once per version
  of the CV text. `/api/cv/score` caches the result on `CV.score_json`,
  keyed by `CV.score_text_hash` (SHA-256 of `raw_text`), and calls Claude
  only when the text has changed. It used to score on every page visit.
- NEVER call the API per-job per-user for matching — use pgvector for that
- NEVER call the API on page load without a cache in front of it. A page
  can be reloaded any number of times; a Claude call belongs behind a user
  action or a cache keyed to the input it depends on.

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
   Tailor & Apply flow / browser extension instead. This check runs before
   the `apply_type === "external"` branch, which would otherwise record the
   job as applied manually.

**`apply_type = 'extension'` means a confirmed LinkedIn Easy Apply job.**
The only source is LinkedIn's own marker on the logged-out job page:
`public_jobs_apply-link-onsite` / `-simple_onsite` (the application happens on
LinkedIn) versus `-offsite` (`ai-service/linkedin_easy_apply.py`,
`detect_easy_apply`). `linkedin_fetcher.py` reads it from the page it already
opens for the description and passes `is_easy_apply` True / False / None;
`_detect_apply_type` stores `extension` only for True, and a recruiter email or
ATS URL still wins (`auto`). `backfill_easy_apply.py` is the one-off for rows
scraped before 2026-10-02. Unknown is stored as `external` — never guess True.
The marker names are LinkedIn internals: if detection stops finding Easy Apply
jobs, check them first. Until 2026-10-02 nothing set this at all (JobSpy takes
`easy_apply` as a search filter but doesn't return it, and it is only used for
Indeed anyway), so no row was ever `extension`; the Extension badge showed for
every LinkedIn job on 30 May – 3 June and 2 October 2026 and for none between.
- **Card:** badge, Extension tab, batch checkbox and the enabled Apply all go
  by the stored type. A confirmed job's Apply opens `/dashboard/apply/[jobId]`
  (the LinkedIn review screen). A LinkedIn listing that isn't confirmed is
  external like any other: External badge, Apply disabled.
- **The extension still checks on the page.** Easy Apply can be withdrawn
  after the scrape; with no button it stops, reports `manual` (credit
  refunded) and leaves the tab open. The review screen says which case the job
  is in (`easy_apply_confirmed` from `/api/apply/prepare`).
- **Finding the button** (`jaEasyApplyMatch`, `chrome-extension/answers.js`):
  text or aria-label *contains* "Easy Apply" / "הגש מועמדות בקלות", then the
  `openSDUIApplyFlow` link. Never the bare Hebrew "הגש מועמדות" (the external
  Apply button) or a filter control. #99 (2026-10-02) made it exact-text and
  skipped `/jobs/view/` links, and it stopped finding the button; restored
  2026-10-05. Don't tighten it again without a real LinkedIn page to test on.
  Failures log `JobAgent [find]` / `[click]` / `[panel]` / `[navigated]`.
- **Finding the form** (`getEasyApplyPanel`, `content.js`): since about
  October it's an open native `<dialog>` in the main document marked
  `data-test-modal-id`/`data-testid="dialog"` (obfuscated classes); the
  30 May version (`#interop-outlet` shadow root) is still tried after it. A
  modal `<dialog>` makes the rest of the page inert, so the extension's own
  popups go inside it (`overlayHost`). Each step logs its fields and buttons
  (`JobAgent [step N]`).
- **Step buttons** (`jaStepButton`, `answers.js`): the new form's buttons have
  no aria-label — "Next", "Review", "Submit application" by exact text. Nothing
  else is clicked (Dismiss, Back, Edit, Upload…). `JA_DRY_RUN` in `content.js`
  stops at Submit application for testing an unpacked build on a real job; a
  test fails if it ships `true`. **Known gap:** how the new form confirms a
  submission hasn't been seen; the success check is from May.
- **Don't use `extract_apply_url_with_session` for this.** It browses LinkedIn
  with a user's saved login, one browser per job.

**Batch extension apply** (Matches → select Easy Apply jobs → Apply):
`/api/apply/batch-mark-pending` marks each job `pending_extension` and charges
one auto-apply, then the page sends `START_APPLY_QUEUE` to the extension.
- The page calls `extensionReadiness()` (`lib/extension-client.ts`) **before**
  marking or charging — it used to charge first and then find no extension.
  If the hand-over fails after marking, it reports each job `manual` to get
  the credits back.
- The route queues LinkedIn listings only, at most `MAX_EXTENSION_BATCH` (12,
  `lib/extension-batch.ts` — the extension's `MAX_APPLIES_PER_HOUR`); the rest
  come back in `overBatchLimit`, not charged.
- Nothing resumes a stopped queue. When the hourly cap or a LinkedIn
  verification stops it, the extension's `releaseUnprocessed()` reports every
  job it didn't reach as `manual` so the credits return.
- `update-status` ignores `manual` / `failed` for an application that is
  already `applied` or later, so a late release can't undo a submission.
- No review screen in batch: the server still sends only answers the user
  gave, and the six Application details only once confirmed.

**Auto-apply limit** (`autoAppliesPerMonth`, `lib/usage.ts`) — every path
where JobAgent submits for the user spends one credit via
`checkAndIncrementAutoApply` (atomic): quick apply's ATS branch, batch email
auto-apply, extension jobs queued by `batch-mark-pending`, and both branches
of `mark-pending-extension` (`jobId`, and `application_id` — the apply page's
LinkedIn confirm). A submission that doesn't go through
refunds via `refundAutoApplyForApplication`, keyed on
`Application.auto_apply_charged` so it refunds at most once: quick apply
refunds inline on an immediate ATS error, and — since its form is filled in a
background thread after the route has returned — the AI service refunds when
that thread ends `needs_manual` (`routes/ats_apply.py` `_mark_needs_manual`,
same conditional UPDATE; until 2026-10-04 those kept the credit); extension applies refund
when `/api/applications/update-status` receives `manual` or `failed`, or when
`check-pending` refuses an outdated extension. External jobs and Tailor &
Apply's ATS / other-site submits are not charged an auto-apply — those are
capped by `cvTailoringPerMonth` at the same numbers. Any new submit path must
charge.

**Tailor CV & Apply** (`/dashboard/apply/[jobId]`)
1. User clicks "Tailor CV & Apply" → Claude tailors CV (draft saved, nothing submitted)
2. User sees review screen → can edit cover letter → clicks Confirm
3. Only after Confirm → Playwright opens LinkedIn Easy Apply and submits
4. If job is not LinkedIn Easy Apply → show manual link, no automation
5. Screenshot taken before every submit and stored

**LinkedIn jobs on the apply page are not tailored.** Easy Apply sends the
résumé saved on the user's LinkedIn profile — the extension uploads no CV and
no cover letter — so `/api/apply/prepare` returns `linkedin: true` with no
Claude call and no tailoring credit, and the review screen says so and lists
the answers the extension will use. Confirm spends one auto-apply credit
instead. Only `?mode=download` tailors a CV for a LinkedIn job (the user
uploads it by hand). Plain Apply on a LinkedIn job lands here too, so it must
stay free of a tailoring charge.

**Known gaps in Tailor & Apply** (found 2026-10-01, not fixed):
- **A blocked LinkedIn tab is reported as open.** The fallback
  `window.open(job_url)` result isn't checked, so "LinkedIn is open in a new
  tab" shows even when the browser blocked it. The application is already
  `pending_extension` (and charged an auto-apply) by then. Only reached when
  the extension answered the version check but not the open-tab message, or
  when `NEXT_PUBLIC_EXTENSION_ID` is unset.
- **No retry after a failed submission.** The error screens only offer "Back
  to matches". Reopening the job reuses the draft now (no new charge), but the
  application may no longer be `draft` after a failed submit, in which case
  it tailors again and spends another credit.
- **The cover letter and CV scroll inside their own boxes.** On a phone the
  letter shows two paragraphs and the CV is capped at 70vh, so Confirm can be
  reached without seeing the end of either. Same on desktop with a long CV.

## Billing (Dodo Payments)
- Checkout: `/api/dodo/checkout` creates a hosted Dodo Checkout Session
  server-side and returns `checkoutUrl` — the client just redirects
  (`window.location.href`). No client-side SDK, no overlay. Called from both
  `/pricing` and the onboarding plan-selection step.
- Webhook: `/api/dodo/webhook` verifies the signature (`dodo.webhooks.unwrap`)
  and updates `User.plan` / `planExpiresAt` on subscription events. Product ID
  → plan mapping is env-var driven (`lib/plan-limits.ts`) since test and live
  mode have entirely separate product catalogs.
- Webhook idempotency: each delivery claims its `webhook-id` in
  `WebhookEvent` (unique) in the same transaction as the plan write, and
  confirmation emails are sent only for a delivery that won the claim. Anything
  new with an external effect must sit behind that claim too. The user is
  matched by `dodoSubscriptionId` first, then `metadata.userId`, then customer
  email; an event whose user or plan can't be resolved is logged and still
  claimed (a retry would resolve no better).
- Existing subscribers never get a second checkout: `/api/dodo/checkout`
  calls `subscriptions.changePlan` (`prorated_immediately`; upgrades and
  monthly→annual apply now, downgrades and annual→monthly at the next billing
  date) and rejects a request for the plan they already have with 409.
  Dodo's own 409 (a change already pending or scheduled) is passed on as a
  409 with a plain message. `User.plan` is still updated only by the
  `subscription.plan_changed` webhook.
- **An accepted `changePlan` is not a changed plan.** With
  `on_payment_failure: prevent_change` Dodo keeps the old plan when the
  prorated charge fails and sends no `subscription.plan_changed`. Checkout
  returns `{ changed, effective, paymentId }` (the `changePlan` response has
  `payment_id` but no `effective_at`; `paymentId` is null when nothing was
  charged), and the pricing page and onboarding plan picker poll
  `GET /api/dodo/plan-change-status` (`waitForPlanChange`, `lib/plan-change.ts`,
  3s × 45s) before saying anything: `applied` only when the subscription's
  `product_id` is the target, `failed` when the payment failed or the
  subscription is `on_hold` (shows Dodo's `error_message`, which is written
  for merchants — reword if it reads badly), otherwise `pending` → "not
  confirmed yet". The status route is read-only and takes the subscription
  from the user's row; a client-supplied `paymentId` is only read if it
  belongs to that subscription. Never show success from the checkout response
  alone — until 2026-10-02 the UI did, and a failed upgrade looked like one
  that was "being updated".
- `payment.failed` (for a subscription) and `subscription.on_hold` are
  log-only at error level, no plan change: on_hold is recoverable, and
  `subscription.expired` / `cancelled` do the downgrade.
- **Known gap:** no double-click / in-flight guard on checkout — a free user
  double-clicking a plan button can still create two Checkout Sessions.
- Plan limits: `PLAN_LIMITS` in `lib/plan-limits.ts` lists only limits that
  `lib/usage.ts` enforces (matches/day, auto-applies/month, CV tailoring/month,
  Browse All Jobs listings/day). Plan bullets on `/pricing`, the onboarding
  plan picker and confirmation emails are generated from it by
  `planFeatureList()`, and prices live in `PLAN_PRICES_USD` — never hardcode
  either. `savedJobsMax` and `cvVersionsMax` were removed (2026-09-28) because
  nothing enforced them; they aren't part of the offer, so don't reintroduce
  them without enforcement.
- `refund.succeeded` is deliberately log-only (no plan change): a refund doesn't
  cancel the Dodo subscription, so a downgrade would be undone by the next
  `subscription.renewed`. Revoking access is a manual decision. Any other
  event type without a handler logs a `received event with no handler` warning.
- Paddle was the original processor; it rejected our account before going
  live, so `lib/paddle.ts`, `lib/paddle-client.ts`, and `app/api/paddle/*`
  were removed rather than kept as a second option.

## Chrome extension privacy policy
`/privacy` is the extension's policy and the Chrome Web Store listing links
to it. It lists what the extension stores (`chrome.storage.local`), sends
(saved answers, application outcomes, its version number) and
receives (account email, Application details, CV skills, saved answers — no
CV and no cover letter).
Any change to what `chrome-extension/` stores or sends must update it in
the same PR — the Store reviews the listing against it.

## Chrome extension auth
- The extension's service worker can't send the site's session cookie, so
  the routes it calls (`/api/apply/check-pending`, `/api/applications/update-status`,
  `POST /api/apply/answers`) authenticate with `getSessionOrExtensionUserId()`:
  the session user, or a signed `extensionToken` sent as
  `Authorization: Bearer`. `/api/auth/me` issues the token (14-day expiry);
  `auth-sync.js` stores it whenever the user is on the site.
- **Never accept a user id from the query or body as identity.** These routes
  used to (`user?.id ?? body.userId`), which let anyone who knew a user id read
  their profile, change their application statuses and refunds, and rewrite
  the answers the extension types into real applications. Fixed 2026-09-29.
- `EXTENSION_TOKEN_SECRET` is a GitHub secret written into the server's `.env`
  by `deploy.yml`. If the GitHub secret is empty the deploy writes an empty
  value and every extension call 401s.
- Since 1.1.1 the extension sends only the signed token — no `userId`, and
  no LinkedIn `li_at` cookie (the popup reads it locally for status). The
  old `authToken` / `JOBAGENT_AUTH` / `SAVE_LINKEDIN_SESSION` paths were
  removed with the site's token cookie (2026-09-29); don't reintroduce them.
- **Never put a Supabase access token anywhere JS or other origins can read
  it** (non-HttpOnly cookies, `postMessage(…, "*")`). The site did both for
  the extension until 2026-09-29.

## Extension answers — never invent one
- The extension types into real job applications. **It answers a question
  only with something the user gave us**: a Profile field they saved, or an
  answer they typed for that exact question before
  (`chrome-extension/answers.js`). No answer → the field stays blank; if
  LinkedIn requires it, the extension stops without submitting, reports
  `manual` (credit refunded) and leaves the tab open for the user. Never add
  a fallback value, a default Yes, or "pick the first option". Until
  2026-10-01 it sent "2" years, salary "1", "Tel Aviv", "Israel", a
  Bachelor's degree, Yes to any unrecognised yes/no question and the first
  option of any dropdown.
- A Profile answer is used only for the question it was asked as: work
  authorisation is for Israel, salary is monthly NIS, years are the total.
- The same goes for the server: `/api/apply/check-pending` sends `null`, not
  a fallback. Six `User` columns had database defaults (notice period, years,
  education, work authorised, sponsorship, relocation); the 2026-10-01
  migration dropped the defaults and cleared the six for every user (all
  testers then), and they are sent only once
  `application_details_confirmed_at` is set — by saving Profile or by
  "These are correct" on the apply review screen. **Known gap:** the Profile
  form still starts those six with the old values for a user who has none;
  they become the user's answers only when the user presses Save.
- **Version gate:** the extension sends `X-JobAgent-Extension-Version`.
  `check-pending` gives nothing to a version below `MIN_EXTENSION_VERSION`
  (`lib/extension-version.ts`, 1.5.0 — the first that stops instead of
  guessing); a request with no header counts as older. The application is
  set to `manual` and refunded. The apply page asks the extension for its
  version (PING) before marking or charging. Raise `MIN_EXTENSION_VERSION`
  whenever a released version turns out to answer wrongly.

## ATS answers — facts only from the user
Quick apply / batch submit ATS forms (Greenhouse, Lever, Ashby…) with no
review step. Decided 2026-10-04 (`ai-service/application_answers.py`):
- **Factual and eligibility questions** (years, work authorisation,
  sponsorship, salary, notice, current company, how you heard, location…) are
  answered only from the user's Profile or an `EasyApplyAnswer` they saved for
  that question — the same matching and limits as the extension's
  `answers.js` (work authorisation is for Israel, salary monthly NIS, total
  years only for total experience), and the six Application details only once
  `application_details_confirmed_at` is set.
- **Claude** may write the answer to an open-ended free-text question ("why
  this company"), grounded in the CV — `claude_may_answer` decides. Never for
  a select, yes/no or factual question.
- **A required question with no answer → not submitted**: `missing_answers`,
  `needs_manual`, credit refunded. Never a default, a "first option" or
  Claude picking an option. EEO questions get "decline to self-identify" or
  nothing; data-processing consent is the one thing ticked for the user (not
  marketing or background-check consent).
- Success only on the ATS's own confirmation; "no error and no confirmation"
  is `unconfirmed` (needs_manual), not applied.
- Until 2026-10-04 the filler answered "2" years, work authorisation "Yes",
  "Negotiable", "Immediate", "Self-employed", "LinkedIn", the first option of
  unrecognised dropdowns and of EEO questions without a decline option,
  country/location "Israel" for everyone, and had Claude answer the rest.
- **Ashby** has its own filler (`ai-service/ashby_form.py`), driven by the
  form JSON the job page loads (`ApiJobPosting`) and `data-field-path`
  containers; it used to get the Greenhouse filler, which matched nothing.
  Ashby runs invisible reCAPTCHA v3, which we can't solve: "We couldn't
  submit your application" is reported as `ashby_rejected`.
- **Known gap:** Greenhouse's phone dial-code picker can only choose Israel,
  so it's set only for an Israeli number; another country's number leaves it
  unset, and a board that requires it fails.

## Service-to-service auth (INTERNAL_API_KEY)
- The AI service requires `X-Internal-Key` on every route except `/health`
  (`ai-service/internal_auth.py`, a middleware in `main.py`). It fails
  closed: with the key unset, everything but `/health` returns 401. Port 8000
  was once reachable from the internet with no auth, and `/ats-apply` and
  `/linkedin/save-cookie` take `user_id` from the body.
- Next.js calls it only via `pythonFetch()` (`lib/python-service.ts`), which
  adds the base URL and the header. Never `fetch(PYTHON_SERVICE_URL…)` directly.
- Internal-only Next routes (`/api/email/*`, `/api/admin/*`) check the key
  with `isInternalRequest()` (`lib/internal-auth.ts`). **No "is it localhost?"
  shortcut** — Host and X-Forwarded-For are set by the caller.
- User-facing routes that proxy to the AI service must require a session and
  must not forward caller-supplied URLs or user ids (`/api/jobs/check-status`
  checks the job's stored URL, not one from the body).
- Cron workflows read the key from the server's `.env` over SSH rather than
  from GitHub secrets. FastAPI is bound to `127.0.0.1:8000` (production and
  local compose); Next reaches it as `http://fastapi:8000`.
- **Outstanding:** workflows still reach the server over SSH with a long-lived
  key (`EC2_SSH_KEY`); moving to SSM Session Manager hasn't started. Also
  unconfirmed: how Cloudflare reaches port 3000, and whether 3000 is
  reachable directly (bypassing Cloudflare).

## Outstanding product decisions
Not bugs; questions that need an answer before the code changes. The site
is positioned as global and priced in USD, so both are real gaps.
- **Israel-specific application details.** Profile → Application details
  asks "Authorized to work in Israel?" and "Expected salary (monthly, NIS)",
  with a +972 phone placeholder. These answers are typed into real
  applications. Needs a decision on what to ask instead (per-country work
  authorization? currency picker?) before rewording.
- **Salaries shown in shekels.** Saved jobs formats `salary_min`/`salary_max`
  with a fixed ₪ sign, whatever the job's country. Needs a currency per job
  (or none) before it's shown to a global audience.
- **Location is free text on Profile, a country list in onboarding.** A user
  can have "Tel Aviv" in one and "Israel" in the other. Pick one model for
  `job_preferences.locations`.
- **Hidden LinkedIn connection section.** Profile hides it behind
  `LINKEDIN_SECTION_ENABLED`; that flag also gates its Playwright status
  check (`/api/linkedin/session-status`), which used to run on every Profile
  visit for a section nobody could see. Turn both on together.

## Daily job intake
- **One scheduled trigger:** the AI service's APScheduler runs
  `_run_daily_pipeline` at 05:00 UTC — scrape, then Active Jobs DB, then
  Arbeitnow, then matching for every user, each step after the last finishes
  (`ai-service/scheduler.py`). Don't add a cron workflow that starts intake:
  until 2026-10-04 the Daily Scrape and Fetch Active Jobs DB workflows ran
  both a second time, two full scrapes at once every morning.
- `POST /scrape-and-store` only *starts* a background scrape and returns
  (409 while one runs; `scrape_runner.py` allows one at a time).
  `GET /scrape-and-store/status` has the state and the timing report. The
  "Run Scrape (manual)" workflow calls it; `skip_known=false` re-visits every
  LinkedIn detail page, for measuring.
- The scrape searches the default markets plus every `JobPreference`
  location (`ai-service/locations.py`) and includes company career pages.
- **Every source stores through `routes/jobs.py` `upsert_job`**, which
  embeds the job. Matching reads only rows with an embedding: Active Jobs DB
  rows were written without one until 2026-10-04 and never reached matches.
- Active Jobs DB is billed per job: `ACTIVE_JOBS_MAX_PER_RUN` (default 200)
  caps a run, shared across markets. Its location parameter is
  `location_filter` (full names, "United States" not "US").
- Arbeitnow (`arbeitnow_fetcher.py`, free, no key): a job's `url` is
  Arbeitnow's page and its `/apply` redirect is the employer's ATS, stored as
  `apply_url`. Arbeitnow's Cloudflare returns 429 to lookups faster than about
  one a second, so they run one at a time (`ARBEITNOW_APPLY_DELAY_S`, 2s);
  a job whose lookup is refused is not stored that run — stored without its
  link it would stay `external` for good.

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

## Design system
- Tokens: `app/globals.css` (CSS variables, light + `.dark`) mapped to
  semantic Tailwind names in `tailwind.config.ts` — use `bg-surface`,
  `text-ink-muted`, `bg-brand` etc., not raw hex or `gray-*`/`blue-*`.
- Shared components: `app/components/ui/` (Button, Card, Field/Input,
  Badge/StatusPill, Notice, Meter, EmptyState, Spinner/Skeleton,
  PageHeader, MatchScore). Application status labels/colours live only in
  `lib/application-status.ts`.
- Reference page: `/dev/design-system` (404s in production).
- Fonts are bundled in `app/fonts` (Public Sans, Source Serif 4), not
  fetched via `next/font/google` — a Google Fonts outage must not break
  the Docker build.
- **Known inconsistency:** the logo (`public/logo.png`) is a brighter royal
  blue than the brand navy `#1B3A5C` used in the UI and generated CVs.
  Left as is for now; revisit with a recoloured logo.

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