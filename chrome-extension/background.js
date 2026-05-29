// Background service worker
// Handles messages from content script and popup
// Communicates with JobAgent server

const JOBAGENT_URL = 'https://jobagent.uk'

// Messages from within the extension (content script, popup)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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

  if (message.type === 'APPLICATION_COMPLETE') {
    // Use session cookie — background service workers send cookies via credentials:include
    fetch(`${JOBAGENT_URL}/api/applications/update-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        applicationId: message.applicationId,
        status: 'applied',
        jobUrl: message.jobUrl
      })
    }).catch((e) => console.error('Failed to update application status', e))
    sendResponse({ success: true })
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
          await fetch(`${JOBAGENT_URL}/api/linkedin/save-cookie`, {
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

// Messages sent from the jobagent.uk website (postMessage bridge via externally_connectable)
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (message.type === 'JOBAGENT_AUTH') {
    chrome.storage.local.set({
      authToken: message.token,
      userId: message.userId
    })
    sendResponse({ success: true })
    return true
  }
})
