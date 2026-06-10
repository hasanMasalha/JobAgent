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

async function processNextInQueue() {
  console.log('[JobAgent bg] processNextInQueue called')
  const stored = await chrome.storage.local.get([
    'applyQueue', 'applyQueueIndex', 'activeApplyTab'
  ])
  const queue = stored.applyQueue || []
  const index = stored.applyQueueIndex || 0
  console.log('[JobAgent bg] queue length:', queue.length, 'index:', index, 'activeTab:', stored.activeApplyTab)

  // Rate limit: pause if the hourly cap is reached
  const rateData = await chrome.storage.local.get(['sessionApplyCount', 'sessionStartTime'])
  const now = Date.now()
  const oneHour = 60 * 60 * 1000
  if (!rateData.sessionStartTime || now - rateData.sessionStartTime > oneHour) {
    await chrome.storage.local.set({ sessionApplyCount: 0, sessionStartTime: now })
  } else if ((rateData.sessionApplyCount || 0) >= MAX_APPLIES_PER_HOUR) {
    console.log('[JobAgent] Rate limit reached — pausing for safety')
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon48.png',
      title: 'JobAgent — Paused',
      message: `Applied to ${MAX_APPLIES_PER_HOUR} jobs this hour. Resuming in 1 hour to stay safe.`
    })
    await chrome.storage.local.set({ isProcessingQueue: false })
    return
  }

  if (index >= queue.length) {
    // Close the LinkedIn tab when the whole queue is done
    if (stored.activeApplyTab) {
      try { await chrome.tabs.remove(stored.activeApplyTab) } catch {}
    }
    await chrome.storage.local.set({ isProcessingQueue: false })
    await chrome.storage.local.remove(['activeApplyTab', 'activeApplicationId'])
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon48.png',
      title: 'JobAgent ✅',
      message: `Applied to all ${queue.length} jobs!`,
    })
    console.log('[JobAgent bg] queue complete')
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
    sendResponse({ pong: true })
    return true
  }

  if (message.type === 'GET_AUTH_TOKEN') {
    // Return stored token if present; content scripts use credentials:include as primary
    chrome.storage.local.get(['authToken', 'userId'], (data) => {
      sendResponse({ token: data.authToken, userId: data.userId })
    })
    return true
  }

  if (message.type === 'SAVE_AUTH') {
    chrome.storage.local.set({
      authToken: message.token,
      userId: message.userId
    })
    sendResponse({ success: true })
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
        const stored = await chrome.storage.local.get(['userId'])
        const serverUrl = await getServerUrl()
        const jobId = message.jobId || extractJobId(message.jobUrl || '')
        const param = jobId
          ? `jobId=${jobId}&userId=${stored.userId}`
          : `jobUrl=${encodeURIComponent(message.jobUrl || '')}&userId=${stored.userId}`
        const fullUrl = `${serverUrl}/api/apply/check-pending?${param}`

        console.log('[JobAgent bg] GET_PENDING_APPLICATION — userId:', stored.userId)
        console.log('[JobAgent bg] jobUrl:', message.jobUrl, '→ jobId:', jobId)
        console.log('[JobAgent bg] calling:', fullUrl)

        const res = await fetch(fullUrl, {
          headers: { 'User-Agent': getRandomUserAgent() }
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
        const stored = await chrome.storage.local.get(['userId'])
        const serverUrl = await getServerUrl()
        await fetch(`${serverUrl}/api/apply/answers`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'User-Agent': getRandomUserAgent() },
          body: JSON.stringify({
            userId: stored.userId,
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
      await chrome.storage.local.set({ isProcessingQueue: false })
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icon48.png',
        title: 'JobAgent — LinkedIn Verification Required',
        message: message.blockType === 'captcha'
          ? 'LinkedIn wants to verify you are human. Please complete the verification then try again.'
          : 'LinkedIn detected unusual activity. Please wait 30 minutes before applying again.'
      })
      sendResponse({ success: true })
    })()
    return true
  }

  // Content script cannot make cross-origin fetches on LinkedIn (CSP) so it
  // delegates the status update here. We use userId from storage instead of
  // credentials:include because SameSite=Lax blocks cookies in SW context.
  if (message.type === 'REPORT_APPLICATION_COMPLETE') {
    ;(async () => {
      try {
        const stored = await chrome.storage.local.get([
          'userId', 'activeApplyTab'
        ])
        const url = await getServerUrl()
        const status = message.status || 'applied'
        console.log('[JobAgent bg] updating status:', message.applicationId, '→', status)
        const res = await fetch(`${url}/api/applications/update-status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'User-Agent': getRandomUserAgent() },
          body: JSON.stringify({
            applicationId: message.applicationId,
            status,
            userId: stored.userId,
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

        // Close the apply tab
        if (stored.activeApplyTab) {
          try {
            await chrome.tabs.remove(stored.activeApplyTab)
            console.log('[JobAgent bg] closed apply tab')
          } catch {
            console.log('[JobAgent bg] tab already closed')
          }
          await chrome.storage.local.remove(['activeApplyTab', 'activeApplicationId'])
        }

        // Notify the user (only for single applications, not mid-queue)
        const queueState = await chrome.storage.local.get([
          'isProcessingQueue', 'applyQueue', 'applyQueueIndex'
        ])
        if (!queueState.isProcessingQueue) {
          const applied = status === 'applied'
          chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icon48.png',
            title: applied ? 'JobAgent — Application Submitted ✅' : 'JobAgent — Manual Apply Needed',
            message: applied
              ? 'Your application was submitted successfully!'
              : 'This job requires manual application. Your cover letter is saved.',
          })
        } else {
          // Advance the queue
          const nextIndex = (queueState.applyQueueIndex || 0) + 1
          await chrome.storage.local.set({ applyQueueIndex: nextIndex })
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

  if (message.type === 'SAVE_LINKEDIN_SESSION') {
    chrome.cookies.get(
      { url: 'https://www.linkedin.com', name: 'li_at' },
      async (cookie) => {
        if (!cookie) {
          sendResponse({ success: false, error: 'Not logged in to LinkedIn' })
          return
        }
        try {
          const stored = await chrome.storage.local.get(['userId'])
          const jobagentUrl = await getServerUrl()
          await fetch(`${jobagentUrl}/api/linkedin/save-cookie`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'User-Agent': getRandomUserAgent() },
            credentials: 'include',
            body: JSON.stringify({
              user_id: stored.userId,
              cookie: cookie.value
            })
          })
          sendResponse({ success: true })
        } catch (e) {
          sendResponse({ success: false, error: e.message })
        }
      }
    )
    return true
  }
})

// Messages sent from the jobagent web app (externally_connectable)
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  console.log('[JobAgent bg] external message:', message.type, 'from:', sender.url)

  if (message.type === 'PING') {
    sendResponse({ pong: true })
    return true
  }

  if (message.type === 'JOBAGENT_AUTH') {
    chrome.storage.local.set({
      authToken: message.token,
      userId: message.userId
    })
    sendResponse({ success: true })
    return true
  }

  // Open LinkedIn in a minimized off-screen window so the user stays on
  // the dashboard. Respond immediately (sync) to avoid MV3 SW timing issues.
  if (message.type === 'OPEN_APPLY_TAB') {
    sendResponse({ success: true })
    openApplyWindow(message.jobUrl, message.applicationId)
    return false
  }

  // Queue multiple LinkedIn jobs for batch apply.
  if (message.type === 'START_APPLY_QUEUE') {
    console.log('[JobAgent bg] START_APPLY_QUEUE received, jobs:', message.jobs?.length, message.jobs)
    ;(async () => {
      await chrome.storage.local.set({
        applyQueue: message.jobs,
        applyQueueIndex: 0,
        isProcessingQueue: true,
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
