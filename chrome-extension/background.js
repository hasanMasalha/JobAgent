// Background service worker
// Handles messages from content script and popup
// Communicates with JobAgent server

// Fallback to production; overridden at runtime by serverUrl in storage (set by auth-sync.js)
async function getServerUrl() {
  const stored = await chrome.storage.local.get(['serverUrl'])
  return stored.serverUrl || 'https://jobagent.uk'
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
    chrome.storage.local.get(['pendingApplication'], (data) => {
      const app = data.pendingApplication || null
      if (app) chrome.storage.local.remove('pendingApplication')
      sendResponse({ application: app })
    })
    return true
  }

  // Content script cannot make cross-origin fetches on LinkedIn (CSP) so it
  // delegates the status update here. We use userId from storage instead of
  // credentials:include because SameSite=Lax blocks cookies in SW context.
  if (message.type === 'REPORT_APPLICATION_COMPLETE') {
    chrome.storage.local.get(['userId'], async (stored) => {
      try {
        const url = await getServerUrl()
        const res = await fetch(`${url}/api/applications/update-status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            applicationId: message.applicationId,
            status: message.status || 'applied',
            userId: stored.userId
          })
        })
        console.log('[JobAgent bg] update-status response:', res.status)
      } catch (e) {
        console.error('[JobAgent bg] Failed to update application status', e)
      }
      sendResponse({ success: true })
    })
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
