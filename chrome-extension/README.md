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

## Icons
Placeholder icons are generated PNG files (16×16, 48×48, 128×128).
Replace with production assets before publishing to the Chrome Web Store.

## Environment
Add `NEXT_PUBLIC_EXTENSION_ID` to `.env.local` with the extension ID
shown in chrome://extensions after loading unpacked.
