# JobAgent Chrome Extension

## Development Setup
1. Open Chrome → chrome://extensions
2. Enable "Developer mode" (top right toggle)
3. Click "Load unpacked"
4. Select the /chrome-extension folder
5. Extension is now installed locally

## Files
- manifest.json — Extension configuration
- background.js — Service worker (handles server communication)
- content.js — Runs on LinkedIn pages (handles Easy Apply)
- greenhouse.js — Fills and submits a Greenhouse form (1.6.0); injected by
  background.js into the one tab it opened for an application
- grant.html/js — Asks for access to greenhouse.io the first time
  (optional_host_permissions; Chrome needs a click on an extension page)
- popup.html/js — Extension popup UI

## How it works
1. User logs in to jobagent.uk
2. Auth token is saved to extension storage
3. User clicks "Auto Apply" on a job in dashboard
4. Application marked as 'pending_extension' in DB
5. LinkedIn job page opens in new tab
6. content.js detects pending application
7. Fills and submits Easy Apply form
8. Reports completion back to dashboard

## Greenhouse (1.6.0)
1. Apply on a Greenhouse job in Matches; the site charges an auto-apply, marks
   the application `pending_extension` and sends `START_ATS_APPLY`
2. background.js asks for greenhouse.io access if it doesn't have it
   (grant.html), fetches `/api/apply/ats-package/[id]` and opens `form_url`
   (only on https://*.greenhouse.io)
3. greenhouse.js gets the questions and answers (`/api/apply/form-answers/[id]`)
   and the CV (`…/ats-package/[id]/cv`) through background.js, fills each field
   by its id, and stops before Submit if anything required is left
4. Submitted only on Greenhouse's confirmation; anything else, or closing the
   tab, reports `manual` (credit refunded)

To test on a real job without submitting, set `GH_DRY_RUN = true` in
greenhouse.js in an unpacked build (it stops at Submit application). It must
be `false` in a release; a test checks. `JA_DRY_RUN` in content.js does the
same for LinkedIn.

## Icons
Placeholder icons are generated PNG files (16×16, 48×48, 128×128).
Replace with production assets before publishing to the Chrome Web Store.

## Environment
Add `NEXT_PUBLIC_EXTENSION_ID` to `.env.local` with the extension ID
shown in chrome://extensions after loading unpacked.
