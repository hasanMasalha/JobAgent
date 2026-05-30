// Background service worker
// Handles messages from content script and popup
// Communicates with JobAgent server

// Fallback to production; overridden at runtime by serverUrl in storage (set by auth-sync.js)
async function getServerUrl() {
  const stored = await chrome.storage.local.get(['serverUrl'])
  return stored.serverUrl || 'https://jobagent.uk'
}

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

        const res = await fetch(fullUrl)
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
    ;(async () => {
      try {
        const tab = await chrome.tabs.create({
          url: message.jobUrl,
          active: false, // stays in background — user keeps their current tab
        })
        console.log('[JobAgent bg] opened background tab:', tab.id)
        await chrome.storage.local.set({
          activeApplyTab: tab.id,
          activeApplicationId: message.applicationId,
        })
        sendResponse({ success: true, tabId: tab.id })
      } catch (e) {
        console.error('[JobAgent bg] OPEN_APPLY_TAB error:', e)
        sendResponse({ success: false })
      }
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
          headers: { 'Content-Type': 'application/json' },
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

  // Content script cannot make cross-origin fetches on LinkedIn (CSP) so it
  // delegates the status update here. We use userId from storage instead of
  // credentials:include because SameSite=Lax blocks cookies in SW context.
  if (message.type === 'REPORT_APPLICATION_COMPLETE') {
    ;(async () => {
      try {
        const stored = await chrome.storage.local.get(['userId', 'activeApplyTab'])
        const url = await getServerUrl()
        const status = message.status || 'applied'
        console.log('[JobAgent bg] updating status:', message.applicationId, '→', status)
        const res = await fetch(`${url}/api/applications/update-status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            applicationId: message.applicationId,
            status,
            userId: stored.userId,
          }),
        })
        const resText = await res.text()
        console.log('[JobAgent bg] update-status response:', res.status, resText)

        // Close the background tab
        if (stored.activeApplyTab) {
          try {
            await chrome.tabs.remove(stored.activeApplyTab)
            await chrome.storage.local.remove(['activeApplyTab', 'activeApplicationId'])
            console.log('[JobAgent bg] closed apply tab')
          } catch {
            console.log('[JobAgent bg] tab already closed')
          }
        }

        // Notify the user
        const applied = (message.status || 'applied') === 'applied'
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icon48.png',
          title: applied ? 'JobAgent — Application Submitted ✅' : 'JobAgent — Manual Apply Needed',
          message: applied
            ? 'Your application was submitted successfully!'
            : 'This job requires manual application. Your cover letter is saved.',
        })
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
            headers: { 'Content-Type': 'application/json' },
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

  // Open LinkedIn tab in background so the user stays on the dashboard
  if (message.type === 'OPEN_APPLY_TAB') {
    ;(async () => {
      try {
        const tab = await chrome.tabs.create({
          url: message.jobUrl,
          active: false, // stays in background — user keeps their current tab
        })
        console.log('[JobAgent bg] opened background tab:', tab.id)
        await chrome.storage.local.set({
          activeApplyTab: tab.id,
          activeApplicationId: message.applicationId,
        })
        sendResponse({ success: true, tabId: tab.id })
      } catch (e) {
        console.error('[JobAgent bg] OPEN_APPLY_TAB error:', e)
        sendResponse({ success: false })
      }
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
