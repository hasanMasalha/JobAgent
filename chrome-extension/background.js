// Signed token from /api/auth/me (stored by auth-sync.js) — the only way the
// extension identifies the user to the API. It never sends a bare userId.
function authHeader(stored) {
  return stored && stored.extensionToken ? { Authorization: `Bearer ${stored.extensionToken}` } : {}
}

// Sent on every API call. The server refuses to hand an application to a
// version older than the first one that stopped guessing answers (1.5.0),
// and a request without this header counts as older.
const EXTENSION_VERSION = chrome.runtime.getManifest().version
const versionHeader = { 'X-JobAgent-Extension-Version': EXTENSION_VERSION }

// Background service worker
// Handles messages from content script and popup
// Communicates with JobAgent server

// Fallback to production; overridden at runtime by serverUrl in storage (set by auth-sync.js)
async function getServerUrl() {
  const stored = await chrome.storage.local.get(['serverUrl'])
  return stored.serverUrl || 'https://jobagent.uk'
}

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
]

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]
}

const MAX_APPLIES_PER_HOUR = 12

// Extract LinkedIn job ID from a URL, handling two formats:
//   /jobs/view/4417922448/          → standard
//   /jobs/view/hebrew-text-4417922448?originalSubdomain=il  → Hebrew slug
function extractJobId(url) {
  // Standard: numeric ID immediately after /view/
  const standard = url.match(/\/jobs\/view\/(\d+)/)
  if (standard) return standard[1]

  // Hebrew/slug format: find the last long numeric sequence in the path
  const path = url.split('?')[0]
  const numbers = path.match(/(\d{8,})/g)
  if (numbers && numbers.length > 0) return numbers[numbers.length - 1]

  return null
}

// Open the LinkedIn job URL in a visible tab.
// chrome.windows.create with state:'minimized' + left/top/width/height conflicts
// per Chrome API spec ("state cannot be combined with positional properties") and
// fails silently — so we open a plain active tab instead.
function openApplyWindow(jobUrl, applicationId) {
  console.log('[JobAgent bg] openApplyWindow — opening tab for:', jobUrl, 'appId:', applicationId)
  chrome.tabs.create({ url: jobUrl, active: true })
    .then(tab => {
      console.log('[JobAgent bg] tab created successfully, id:', tab.id)
      return chrome.storage.local.set({
        activeApplyTab: tab.id,
        activeApplicationId: applicationId,
      })
    })
    .catch(e => console.error('[JobAgent bg] tabs.create failed:', e.message))
}

// Hand back applications the extension is not going to get to: the hourly cap
// was reached, or LinkedIn stopped us. Each one was marked pending and charged
// an auto-apply when it was queued, so leaving it there strands the credit.
// Reporting "manual" refunds it (/api/applications/update-status) and shows
// the job under "Action needed". Returns how many were handed back.
async function releaseUnprocessed() {
  const stored = await chrome.storage.local.get([
    'extensionToken', 'applyQueue', 'applyQueueIndex', 'activeApplicationId'
  ])
  const queue = stored.applyQueue || []
  const ids = queue.slice(stored.applyQueueIndex || 0).map(j => j.id)
  if (stored.activeApplicationId && !ids.includes(stored.activeApplicationId)) {
    ids.push(stored.activeApplicationId)
  }

  await chrome.storage.local.set({ isProcessingQueue: false })
  await chrome.storage.local.remove(['applyQueue', 'applyQueueIndex', 'activeApplicationId'])

  const url = await getServerUrl()
  let released = 0
  for (const id of ids) {
    try {
      const res = await fetch(`${url}/api/applications/update-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': getRandomUserAgent(), ...versionHeader, ...authHeader(stored) },
        body: JSON.stringify({ applicationId: id, status: 'manual' }),
      })
      if (res.ok) released++
      else console.error('[JobAgent bg] could not release application', id, res.status)
    } catch (e) {
      console.error('[JobAgent bg] could not release application', id, e)
    }
  }
  console.log('[JobAgent bg] released', released, 'of', ids.length, 'unprocessed applications')
  return released
}

async function processNextInQueue() {
  console.log('[JobAgent bg] processNextInQueue called')
  const stored = await chrome.storage.local.get([
    'applyQueue', 'applyQueueIndex', 'activeApplyTab', 'applyQueueResults'
  ])
  const queue = stored.applyQueue || []
  const index = stored.applyQueueIndex || 0
  console.log('[JobAgent bg] queue length:', queue.length, 'index:', index, 'activeTab:', stored.activeApplyTab)

  if (index >= queue.length) {
    // Close the LinkedIn tab when the whole queue is done
    if (stored.activeApplyTab) {
      try { await chrome.tabs.remove(stored.activeApplyTab) } catch {}
    }
    await chrome.storage.local.set({ isProcessingQueue: false })
    await chrome.storage.local.remove(['activeApplyTab', 'activeApplicationId', 'applyQueue', 'applyQueueIndex'])
    // Say what actually happened, not "applied to all": some jobs stop at a
    // question or turn out not to offer Easy Apply.
    const results = stored.applyQueueResults || { applied: 0, notApplied: 0 }
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon48.png',
      title: 'JobAgent — Batch finished',
      message: results.notApplied > 0
        ? `${results.applied} of ${queue.length} submitted. ${results.notApplied} need you to finish them yourself; their auto-applies were returned.`
        : `${results.applied} of ${queue.length} submitted.`,
    })
    console.log('[JobAgent bg] queue complete', results)
    return
  }

  // Rate limit: stop if the hourly cap is reached. Nothing resumes a stopped
  // queue, so the jobs it didn't reach are handed back rather than left
  // pending with their credits spent.
  const rateData = await chrome.storage.local.get(['sessionApplyCount', 'sessionStartTime'])
  const now = Date.now()
  const oneHour = 60 * 60 * 1000
  if (!rateData.sessionStartTime || now - rateData.sessionStartTime > oneHour) {
    await chrome.storage.local.set({ sessionApplyCount: 0, sessionStartTime: now })
  } else if ((rateData.sessionApplyCount || 0) >= MAX_APPLIES_PER_HOUR) {
    console.log('[JobAgent] Rate limit reached — stopping for safety')
    if (stored.activeApplyTab) {
      try { await chrome.tabs.remove(stored.activeApplyTab) } catch {}
      await chrome.storage.local.remove(['activeApplyTab'])
    }
    const released = await releaseUnprocessed()
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon48.png',
      title: 'JobAgent — Stopped for this hour',
      message: `${MAX_APPLIES_PER_HOUR} applications this hour is the limit. ${released} job${released !== 1 ? 's were' : ' was'} not attempted and the auto-applies were returned. Queue them again in an hour.`
    })
    return
  }

  const job = queue[index]
  console.log(`[JobAgent bg] processing job ${index + 1}/${queue.length}:`, job.url, 'id:', job.id)

  if (stored.activeApplyTab && index > 0) {
    // Reuse the existing tab for subsequent jobs
    try {
      await chrome.tabs.update(stored.activeApplyTab, { url: job.url, active: true })
      console.log('[JobAgent bg] navigated existing tab to:', job.url)
    } catch (e) {
      // Tab was closed — open a fresh one
      console.log('[JobAgent bg] tab gone, opening new tab:', e.message)
      openApplyWindow(job.url, job.id)
      return
    }
  } else {
    // First job (or no existing tab) — open a new tab
    console.log('[JobAgent bg] opening first tab in queue')
    openApplyWindow(job.url, job.id)
    return
  }

  await chrome.storage.local.set({ activeApplicationId: job.id })
}

// Messages from within the extension (content script, popup)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PING') {
    sendResponse({ pong: true, version: EXTENSION_VERSION })
    return true
  }

  // Step marker for content.js's failure logs: "this tab clicked Easy Apply"
  // — the step name, which rule matched and when, nothing about the
  // application. Kept per tab in chrome.storage.session (memory only, gone
  // when the browser closes) so the page loaded after a navigating click can
  // say so; content scripts can't read storage.session themselves.
  if (message.type === 'SET_APPLY_STEP' || message.type === 'CLEAR_APPLY_STEP' || message.type === 'TAKE_APPLY_STEP') {
    ;(async () => {
      const key = `applyStep:${sender.tab?.id}`
      if (message.type === 'SET_APPLY_STEP') {
        await chrome.storage.session.set({ [key]: { step: message.step, rule: message.rule, at: Date.now() } })
        sendResponse({ ok: true })
        return
      }
      const stored = message.type === 'TAKE_APPLY_STEP' ? await chrome.storage.session.get(key) : {}
      await chrome.storage.session.remove(key)
      const marker = stored[key]
      // Two minutes covers a navigation; anything older is unrelated.
      sendResponse(marker && Date.now() - marker.at < 2 * 60 * 1000 ? marker : null)
    })()
    return true
  }

  if (message.type === 'STORE_PENDING_APPLICATION') {
    chrome.storage.local.set({ pendingApplication: message.application })
    sendResponse({ success: true })
    return true
  }

  if (message.type === 'GET_PENDING_APPLICATION') {
    // Fetch from the API — background.js is exempt from page CSP and can reach the server.
    // Passes jobId or jobUrl so check-pending can look up the pending application.
    ;(async () => {
      try {
        const stored = await chrome.storage.local.get(['userId', 'extensionToken'])
        const serverUrl = await getServerUrl()
        const jobId = message.jobId || extractJobId(message.jobUrl || '')
        const param = (jobId
          ? `jobId=${jobId}`
          : `jobUrl=${encodeURIComponent(message.jobUrl || '')}`)
        const fullUrl = `${serverUrl}/api/apply/check-pending?${param}`

        console.log('[JobAgent bg] GET_PENDING_APPLICATION — userId:', stored.userId)
        console.log('[JobAgent bg] jobUrl:', message.jobUrl, '→ jobId:', jobId)
        console.log('[JobAgent bg] calling:', fullUrl)

        const res = await fetch(fullUrl, {
          headers: { 'User-Agent': getRandomUserAgent(), ...versionHeader, ...authHeader(stored) }
        })
        const data = await res.json()
        console.log('[JobAgent bg] check-pending response:', data)
        sendResponse(data.pending ? { application: data.application } : { application: null })
      } catch (e) {
        console.error('[JobAgent bg] GET_PENDING_APPLICATION error:', e)
        sendResponse({ application: null })
      }
    })()
    return true
  }

  if (message.type === 'OPEN_APPLY_TAB') {
    sendResponse({ success: true })
    openApplyWindow(message.jobUrl, message.applicationId)
    return false
  }

  if (message.type === 'START_APPLY_QUEUE') {
    ;(async () => {
      await chrome.storage.local.set({
        applyQueue: message.jobs,
        applyQueueIndex: 0,
        isProcessingQueue: true,
        applyQueueResults: { applied: 0, notApplied: 0 },
      })
      console.log('[JobAgent bg] queue started, jobs:', message.jobs.length)
      await processNextInQueue()
      sendResponse({ success: true })
    })()
    return true
  }

  if (message.type === 'FOCUS_TAB') {
    // Content script on the hidden tab asks to become visible (unknown question popup)
    if (sender.tab?.id) {
      chrome.tabs.update(sender.tab.id, { active: true })
    }
    sendResponse({ success: true })
    return true
  }

  if (message.type === 'SAVE_ANSWER') {
    ;(async () => {
      try {
        const stored = await chrome.storage.local.get(['extensionToken'])
        const serverUrl = await getServerUrl()
        await fetch(`${serverUrl}/api/apply/answers`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'User-Agent': getRandomUserAgent(), ...versionHeader, ...authHeader(stored) },
          body: JSON.stringify({
            question: message.question,
            answer: message.answer,
          }),
        })
        console.log('[JobAgent bg] saved answer for:', message.question)
      } catch (e) {
        console.error('[JobAgent bg] Failed to save answer:', e)
      }
      sendResponse({ success: true })
    })()
    return true
  }

  if (message.type === 'LINKEDIN_BLOCKED') {
    ;(async () => {
      // The blocked application, and any queued behind it, were charged when
      // they were marked pending. Nothing will retry them: hand them back.
      const released = await releaseUnprocessed()
      const returned = released > 0
        ? ` ${released} application${released !== 1 ? 's were' : ' was'} not submitted and the auto-applies were returned.`
        : ''
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icon48.png',
        title: 'JobAgent — LinkedIn Verification Required',
        message: (message.blockType === 'captcha'
          ? 'LinkedIn wants to verify you are human. Please complete the verification then try again.'
          : 'LinkedIn detected unusual activity. Please wait 30 minutes before applying again.') + returned
      })
      sendResponse({ success: true })
    })()
    return true
  }

  // Content script cannot make cross-origin fetches on LinkedIn (CSP) so it
  // delegates the status update here. The service worker can't send the
  // site's session cookie, so it authenticates with the signed extensionToken.
  if (message.type === 'REPORT_APPLICATION_COMPLETE') {
    ;(async () => {
      try {
        const stored = await chrome.storage.local.get([
          'extensionToken', 'activeApplyTab'
        ])
        const url = await getServerUrl()
        const status = message.status || 'applied'
        console.log('[JobAgent bg] updating status:', message.applicationId, '→', status, 'reason:', message.reason)
        if (sender.tab?.id) await chrome.storage.session.remove(`applyStep:${sender.tab.id}`)
        const res = await fetch(`${url}/api/applications/update-status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'User-Agent': getRandomUserAgent(), ...versionHeader, ...authHeader(stored) },
          body: JSON.stringify({
            applicationId: message.applicationId,
            status,
          }),
        })
        const resText = await res.text()
        console.log('[JobAgent bg] update-status response:', res.status, resText)

        if (status === 'applied') {
          const countData = await chrome.storage.local.get(['sessionApplyCount'])
          await chrome.storage.local.set({
            sessionApplyCount: (countData.sessionApplyCount || 0) + 1
          })
        }

        const queueNow = await chrome.storage.local.get(['isProcessingQueue'])
        // The form is waiting for the user: leave the tab open for a single
        // application. A queue reuses the tab for its next job either way.
        const keepTab = message.keepTab === true && !queueNow.isProcessingQueue

        // Close the apply tab
        if (stored.activeApplyTab && keepTab) {
          await chrome.tabs.update(stored.activeApplyTab, { active: true }).catch(() => {})
          await chrome.storage.local.remove(['activeApplyTab', 'activeApplicationId'])
        } else if (stored.activeApplyTab) {
          try {
            await chrome.tabs.remove(stored.activeApplyTab)
            console.log('[JobAgent bg] closed apply tab')
          } catch {
            console.log('[JobAgent bg] tab already closed')
          }
          await chrome.storage.local.remove(['activeApplyTab', 'activeApplicationId'])
        }
        // This application is settled either way. Left behind, a later
        // releaseUnprocessed() would report it again.
        await chrome.storage.local.remove(['activeApplicationId'])

        // Notify the user (only for single applications, not mid-queue)
        const queueState = await chrome.storage.local.get([
          'isProcessingQueue', 'applyQueue', 'applyQueueIndex'
        ])
        if (!queueState.isProcessingQueue) {
          const applied = status === 'applied'
          chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icon48.png',
            title: applied ? 'JobAgent — Application Submitted ✅' : 'JobAgent — Finish this one yourself',
            message: applied
              ? 'Your application was submitted successfully!'
              : message.reason === 'no_easy_apply'
                ? "This job doesn't offer Easy Apply, so nothing was submitted. Apply in the LinkedIn tab yourself."
              : message.reason === 'submit_unconfirmed'
                ? "JobAgent clicked Submit but LinkedIn didn't confirm it. Check the LinkedIn tab: it may have gone in."
              : message.reason === 'dry_run'
                ? 'Dry run: every step was filled and it stopped before Submit application. Nothing was submitted.'
              : message.reason === 'panel_not_found'
                ? "Easy Apply didn't open, so nothing was submitted. Apply on LinkedIn yourself."
              : keepTab
                ? 'JobAgent stopped at a question it has no answer from you for. Nothing was submitted. Finish in the LinkedIn tab.'
                : 'JobAgent could not submit this application. Apply on LinkedIn yourself.',
          })
        } else {
          // Advance the queue, keeping count for the notice at the end
          const nextIndex = (queueState.applyQueueIndex || 0) + 1
          const counted = await chrome.storage.local.get(['applyQueueResults'])
          const results = counted.applyQueueResults || { applied: 0, notApplied: 0 }
          if (status === 'applied') results.applied++
          else results.notApplied++
          await chrome.storage.local.set({ applyQueueIndex: nextIndex, applyQueueResults: results })
          console.log('[JobAgent bg] queue advancing to index', nextIndex)
          const advanceDelay = Math.floor(Math.random() * (8000 - 3000) + 3000)
          setTimeout(processNextInQueue, advanceDelay)
        }
      } catch (e) {
        console.error('[JobAgent bg] Failed to update application status', e)
      }
      sendResponse({ success: true })
    })()
    return true
  }
})

// ── Greenhouse applications (1.6.0) ─────────────────────────────────────────
// The site hands over one application at a time (START_ATS_APPLY), already
// charged an auto-apply and marked pending_extension. The extension opens the
// form in a tab of the user's own browser and greenhouse.js fills it with the
// server's answers. Every way this can end reports back: applied only on
// Greenhouse's confirmation; anything else is "manual", which refunds the
// credit — including the user closing the tab.
//
// Access to Greenhouse's pages is asked for the first time it's needed
// (optional_host_permissions), from grant.html: Chrome only shows that prompt
// after a click on an extension page.
const GREENHOUSE_ORIGINS = ['https://*.greenhouse.io/*']

function isGreenhouseUrl(raw) {
  try {
    const u = new URL(raw)
    return u.protocol === 'https:' && (u.hostname === 'greenhouse.io' || u.hostname.endsWith('.greenhouse.io'))
  } catch {
    return false
  }
}

// One application at a time, kept in storage so it survives the service
// worker being stopped: { applicationId, tabId, phase, … }.
//   phase: permission → filling → submitted (→ awaiting_code)
async function getAtsApply() {
  return (await chrome.storage.local.get(['atsApply'])).atsApply || null
}

async function setAtsApply(patch) {
  const current = await getAtsApply()
  const next = { ...(current || {}), ...patch }
  await chrome.storage.local.set({ atsApply: next })
  return next
}

async function apiFetch(path, init = {}) {
  const stored = await chrome.storage.local.get(['extensionToken'])
  const serverUrl = await getServerUrl()
  return fetch(`${serverUrl}${path}`, {
    ...init,
    headers: { ...(init.headers || {}), ...versionHeader, ...authHeader(stored) },
  })
}

function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  }
  return btoa(bin)
}

const ATS_MESSAGES = {
  applied: 'Your application was submitted — Greenhouse confirmed it.',
  missing_answers: "Stopped before submitting: the form asks questions you haven't answered. Nothing was sent and the auto-apply was returned. Finish in the open tab.",
  needs_user: 'Stopped before submitting: the form has fields JobAgent can\'t fill for you. Nothing was sent and the auto-apply was returned. Finish in the open tab.',
  fill_failed: "Stopped before submitting: a field couldn't be filled in. Nothing was sent and the auto-apply was returned. Check the open tab.",
  submit_unconfirmed: "Submit was clicked but Greenhouse didn't confirm it. Check the tab: it may have gone in. The auto-apply was returned.",
  form_error: "Greenhouse didn't accept the form. Nothing was confirmed and the auto-apply was returned. Check the open tab.",
  captcha_detected: 'Greenhouse asked for a security check before the form. Nothing was sent and the auto-apply was returned.',
  permission_denied: 'JobAgent needs access to Greenhouse pages to fill in the form. Nothing was sent and the auto-apply was returned.',
  tab_closed: 'The application tab was closed before it finished. Nothing was confirmed and the auto-apply was returned.',
  dry_run: 'Dry run: everything was filled in and Submit was not clicked.',
}

// Reports the application's outcome and forgets it. "manual" refunds the
// auto-apply (update-status), and may carry the questions the user hasn't
// answered, which the Applications page then asks.
async function finishAtsApply(state, status, reason, missingQuestions) {
  await chrome.storage.local.remove(['atsApply'])
  try {
    const res = await apiFetch('/api/applications/update-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        applicationId: state.applicationId,
        status,
        ...(missingQuestions && missingQuestions.length ? { missingQuestions } : {}),
      }),
    })
    console.log('[JobAgent bg] ATS result', state.applicationId, status, reason, res.status)
  } catch (e) {
    console.error('[JobAgent bg] could not report ATS result', state.applicationId, e)
  }
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icon48.png',
    title: status === 'applied' ? 'JobAgent — Application submitted ✅' : 'JobAgent — Finish this one yourself',
    message: ATS_MESSAGES[status === 'applied' ? 'applied' : reason] ||
      'JobAgent could not submit this application. Nothing was confirmed and the auto-apply was returned.',
  })
}

// Opens the form for an application (in `tabId` when given: the grant page).
async function openAtsForm(applicationId, tabId) {
  const state = await getAtsApply()
  if (!state || state.applicationId !== applicationId) return
  let pkg = null
  try {
    const res = await apiFetch(`/api/apply/ats-package/${encodeURIComponent(applicationId)}`)
    pkg = res.ok ? await res.json() : null
  } catch {}
  if (!pkg || pkg.ats !== 'greenhouse' || !isGreenhouseUrl(pkg.form_url)) {
    console.warn('[JobAgent bg] no Greenhouse form for', applicationId, pkg && pkg.ats, pkg && pkg.form_url)
    return finishAtsApply(state, 'manual', 'form_not_found')
  }
  // The phase is set before the tab loads, so the load can't be missed.
  await setAtsApply({ phase: 'filling', formUrl: pkg.form_url })
  let tab
  try {
    tab = tabId
      ? await chrome.tabs.update(tabId, { url: pkg.form_url, active: true })
      : await chrome.tabs.create({ url: pkg.form_url, active: true })
  } catch {
    tab = await chrome.tabs.create({ url: pkg.form_url, active: true })
  }
  await setAtsApply({ tabId: tab.id })
  // A load that finished before tabId was stored (greenhouse.js runs once per page).
  const now = await chrome.tabs.get(tab.id).catch(() => null)
  if (now && now.status === 'complete' && isGreenhouseUrl(now.url || '')) injectGreenhouse(tab.id)
}

function injectGreenhouse(tabId) {
  chrome.scripting.executeScript({ target: { tabId }, files: ['greenhouse.js'] })
    .catch(e => console.error('[JobAgent bg] could not start greenhouse.js', e))
}

async function startAtsApply(applicationId) {
  const current = await getAtsApply()
  if (current) {
    const alive = current.tabId ? await chrome.tabs.get(current.tabId).then(() => true, () => false) : false
    if (alive) return false // one at a time
    await finishAtsApply(current, 'manual', 'tab_closed')
  }
  await chrome.storage.local.set({ atsApply: { applicationId, phase: 'permission', startedAt: Date.now() } })
  if (await chrome.permissions.contains({ origins: GREENHOUSE_ORIGINS })) {
    openAtsForm(applicationId)
  } else {
    const tab = await chrome.tabs.create({ url: chrome.runtime.getURL('grant.html'), active: true })
    await setAtsApply({ tabId: tab.id })
  }
  return true
}

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== 'complete') return
  const state = await getAtsApply()
  if (!state || state.tabId !== tabId || state.phase === 'permission') return
  const url = tab.url || ''
  if (url.startsWith('chrome-extension:') || url === 'about:blank') return // the grant page, before it navigates
  if (!isGreenhouseUrl(url)) {
    // Greenhouse's form only lives on greenhouse.io; JobAgent doesn't follow
    // it anywhere else. After Submit that means no confirmation it can read.
    return finishAtsApply(state, 'manual', state.phase === 'filling' ? 'form_not_found' : 'submit_unconfirmed')
  }
  injectGreenhouse(tabId)
})

chrome.tabs.onRemoved.addListener(async tabId => {
  const state = await getAtsApply()
  if (state && state.tabId === tabId) {
    await finishAtsApply(state, 'manual', state.phase === 'filling' || state.phase === 'permission' ? 'tab_closed' : 'submit_unconfirmed')
  }
})

// From greenhouse.js (the application's own tab only) and grant.js.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message.type || !message.type.startsWith('ATS_')) return false
  ;(async () => {
    const state = await getAtsApply()
    const ours = !!state && !!sender.tab && sender.tab.id === state.tabId

    if (message.type === 'ATS_PERMISSION_RESULT') {
      if (!state || state.phase !== 'permission' || !ours) return sendResponse({ ok: false })
      sendResponse({ ok: true })
      if (message.granted) return openAtsForm(state.applicationId, state.tabId)
      return finishAtsApply(state, 'manual', 'permission_denied')
    }
    if (!ours) return sendResponse(null)

    if (message.type === 'ATS_GET_STATE') {
      return sendResponse({
        applicationId: state.applicationId, phase: state.phase,
        submittedAt: state.submittedAt, codeAt: state.codeAt, textBefore: state.textBefore,
      })
    }

    if (message.type === 'ATS_GET_DATA') {
      try {
        const res = await apiFetch(`/api/apply/form-answers/${encodeURIComponent(state.applicationId)}`)
        const form = res.ok ? await res.json() : null
        if (!form) return sendResponse({ ok: false, reason: 'data_unavailable' })
        if (!form.supported) return sendResponse({ ok: false, reason: 'form_not_found' })
        let cv = null
        const cvRes = await apiFetch(`/api/apply/ats-package/${encodeURIComponent(state.applicationId)}/cv`)
        if (cvRes.ok) {
          const disposition = cvRes.headers.get('Content-Disposition') || ''
          const filename = (disposition.match(/filename="([^"]+)"/) || [])[1] || 'CV.pdf'
          cv = {
            filename,
            mimeType: cvRes.headers.get('Content-Type') || 'application/pdf',
            base64: bufferToBase64(await cvRes.arrayBuffer()),
          }
        }
        return sendResponse({ ok: true, questions: form.questions, answers: form.answers, missing: form.missing, cv })
      } catch (e) {
        console.error('[JobAgent bg] ATS_GET_DATA', e)
        return sendResponse({ ok: false, reason: 'data_unavailable' })
      }
    }

    if (message.type === 'ATS_RESOLVE') {
      try {
        const res = await apiFetch('/api/apply/resolve-answers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ applicationId: state.applicationId, questions: message.questions }),
        })
        return sendResponse(res.ok ? await res.json() : null)
      } catch {
        return sendResponse(null)
      }
    }

    if (message.type === 'ATS_SUBMITTING') {
      await setAtsApply({ phase: 'submitted', submittedAt: Date.now(), textBefore: message.textBefore || '' })
      return sendResponse({ ok: true })
    }

    if (message.type === 'ATS_AWAITING_CODE') {
      await setAtsApply({ phase: 'awaiting_code', codeAt: Date.now() })
      chrome.tabs.update(sender.tab.id, { active: true }).catch(() => {})
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icon48.png',
        title: 'JobAgent — Greenhouse sent you a code',
        message: 'Greenhouse emailed you a security code. Enter it in the application tab and press Submit.',
      })
      return sendResponse({ ok: true })
    }

    if (message.type === 'ATS_RESULT') {
      sendResponse({ ok: true })
      const status = message.status === 'applied' ? 'applied' : 'manual'
      return finishAtsApply(state, status, message.reason, message.missingQuestions)
    }

    sendResponse(null)
  })()
  return true
})

// Messages sent from the jobagent web app (externally_connectable)
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  console.log('[JobAgent bg] external message:', message.type, 'from:', sender.url)

  if (message.type === 'PING') {
    sendResponse({ pong: true, version: EXTENSION_VERSION })
    return true
  }

  // Open LinkedIn in a minimized off-screen window so the user stays on
  // the dashboard. Respond immediately (sync) to avoid MV3 SW timing issues.
  if (message.type === 'OPEN_APPLY_TAB') {
    sendResponse({ success: true })
    openApplyWindow(message.jobUrl, message.applicationId)
    return false
  }

  // One Greenhouse application, already charged and pending_extension.
  // Answered at once: the page gives up after 5 seconds and refunds.
  if (message.type === 'START_ATS_APPLY') {
    if (typeof message.applicationId !== 'string' || !message.applicationId) {
      sendResponse({ success: false })
      return false
    }
    startAtsApply(message.applicationId)
      .then(ok => sendResponse({ success: ok }))
      .catch(e => {
        console.error('[JobAgent bg] START_ATS_APPLY', e)
        sendResponse({ success: false })
      })
    return true
  }

  // Queue multiple LinkedIn jobs for batch apply.
  if (message.type === 'START_APPLY_QUEUE') {
    console.log('[JobAgent bg] START_APPLY_QUEUE received, jobs:', message.jobs?.length, message.jobs)
    ;(async () => {
      await chrome.storage.local.set({
        applyQueue: message.jobs,
        applyQueueIndex: 0,
        isProcessingQueue: true,
        applyQueueResults: { applied: 0, notApplied: 0 },
      })
      console.log('[JobAgent bg] queue stored, calling processNextInQueue')
      await processNextInQueue()
      sendResponse({ success: true })
    })()
    return true
  }

  // Sent from the apply page when user confirms — stores application data so
  // content.js can pick it up without needing cross-site cookies
  if (message.type === 'STORE_PENDING_APPLICATION') {
    chrome.storage.local.set({ pendingApplication: message.application }, () => {
      console.log('[JobAgent bg] stored pending application:', message.application?.id)
      sendResponse({ success: true })
    })
    return true
  }
})
