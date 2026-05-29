const JOBAGENT_URL = 'https://jobagent.uk'

async function init() {
  const stored = await chrome.storage.local.get(['authToken', 'userId'])

  const accountStatus = document.getElementById('account-status')
  const linkedinStatus = document.getElementById('linkedin-status')
  const connectLinkedinBtn = document.getElementById('connect-linkedin-btn')
  const signinBtn = document.getElementById('signin-btn')
  const openDashboardBtn = document.getElementById('open-dashboard-btn')

  openDashboardBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: JOBAGENT_URL })
  })

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

  // Check JobAgent auth
  try {
    const res = await fetch(`${JOBAGENT_URL}/api/auth/me`, {
      headers: { 'Authorization': `Bearer ${stored.authToken}` }
    })
    if (res.ok) {
      const user = await res.json()
      accountStatus.textContent = user.email || 'Connected'
      accountStatus.className = 'status-value connected'
    } else {
      accountStatus.textContent = 'Session expired'
      accountStatus.className = 'status-value disconnected'
    }
  } catch {
    accountStatus.textContent = 'Cannot connect'
    accountStatus.className = 'status-value disconnected'
  }

  // Check LinkedIn cookie
  const liCookie = await chrome.cookies.get({
    url: 'https://www.linkedin.com',
    name: 'li_at'
  })

  if (liCookie) {
    linkedinStatus.textContent = 'Connected'
    linkedinStatus.className = 'status-value connected'

    // Auto-save the LinkedIn session to JobAgent server
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
