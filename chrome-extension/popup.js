const JOBAGENT_URL = 'https://jobagent.uk'

// Decode JWT payload without verifying signature (display only)
function decodeJwt(token) {
  try {
    const payload = token.split('.')[1]
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
  } catch {
    return null
  }
}

async function init() {
  const accountStatus = document.getElementById('account-status')
  const linkedinStatus = document.getElementById('linkedin-status')
  const connectLinkedinBtn = document.getElementById('connect-linkedin-btn')
  const signinBtn = document.getElementById('signin-btn')
  const openDashboardBtn = document.getElementById('open-dashboard-btn')

  openDashboardBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: JOBAGENT_URL })
  })

  // Read token cached by auth-sync.js content script
  const stored = await chrome.storage.local.get(['authToken', 'userId'])

  if (!stored.authToken) {
    accountStatus.textContent = 'Not signed in'
    accountStatus.className = 'status-value disconnected'
    signinBtn.style.display = 'block'
    signinBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: `${JOBAGENT_URL}/login` })
    })
    linkedinStatus.textContent = 'Sign in first'
    return
  }

  // Decode JWT to get email and check expiry — no network call needed
  const payload = decodeJwt(stored.authToken)
  const expired = payload?.exp && payload.exp * 1000 < Date.now()

  if (!payload || expired) {
    accountStatus.textContent = expired ? 'Session expired' : 'Invalid token'
    accountStatus.className = 'status-value disconnected'
    chrome.storage.local.remove(['authToken', 'userId'])
    signinBtn.style.display = 'block'
    signinBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: `${JOBAGENT_URL}/login` })
    })
    linkedinStatus.textContent = 'Sign in first'
    return
  }

  accountStatus.textContent = payload.email || 'Connected'
  accountStatus.className = 'status-value connected'

  // Check LinkedIn session cookie
  const liCookie = await chrome.cookies.get({
    url: 'https://www.linkedin.com',
    name: 'li_at'
  })

  if (liCookie) {
    linkedinStatus.textContent = 'Connected'
    linkedinStatus.className = 'status-value connected'
    chrome.runtime.sendMessage({ type: 'SAVE_LINKEDIN_SESSION' })
  } else {
    linkedinStatus.textContent = 'Not connected'
    linkedinStatus.className = 'status-value disconnected'
    connectLinkedinBtn.style.display = 'block'
    connectLinkedinBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: 'https://www.linkedin.com/login' })
    })
  }
}

init()
