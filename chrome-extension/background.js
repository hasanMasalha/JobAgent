// Background service worker
// Handles messages from content script and popup
// Communicates with JobAgent server

const JOBAGENT_URL = 'https://jobagent.uk'

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_AUTH_TOKEN') {
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
    // Notify JobAgent server that application was submitted
    chrome.storage.local.get(['authToken'], async (data) => {
      try {
        await fetch(`${JOBAGENT_URL}/api/applications/update-status`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${data.authToken}`
          },
          body: JSON.stringify({
            applicationId: message.applicationId,
            status: 'applied',
            jobUrl: message.jobUrl
          })
        })
      } catch (e) {
        console.error('Failed to update application status', e)
      }
    })
    sendResponse({ success: true })
    return true
  }

  if (message.type === 'SAVE_LINKEDIN_SESSION') {
    // Auto-detect and save LinkedIn session
    chrome.cookies.get(
      { url: 'https://www.linkedin.com', name: 'li_at' },
      async (cookie) => {
        if (cookie) {
          try {
            const stored = await chrome.storage.local.get(['authToken', 'userId'])
            await fetch(`${JOBAGENT_URL}/api/linkedin/save-cookie`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${stored.authToken}`
              },
              body: JSON.stringify({
                user_id: stored.userId,
                cookie: cookie.value
              })
            })
            sendResponse({ success: true })
          } catch (e) {
            sendResponse({ success: false, error: e.message })
          }
        } else {
          sendResponse({ success: false, error: 'Not logged in to LinkedIn' })
        }
      }
    )
    return true
  }
})
