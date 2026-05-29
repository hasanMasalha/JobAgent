const JOBAGENT_URL = 'https://jobagent.uk'

async function checkAuth() {
  const stored = await chrome.storage.local.get([
    'isLoggedIn', 'userEmail', 'userId', 'lastChecked'
  ])

  // Accept cached auth for up to 5 minutes
  const isFresh = stored.lastChecked &&
    (Date.now() - stored.lastChecked) < 5 * 60 * 1000

  if (stored.isLoggedIn && stored.userEmail && isFresh) {
    return { email: stored.userEmail, id: stored.userId }
  }

  return null
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

  const user = await checkAuth()

  if (!user) {
    accountStatus.textContent = 'Not signed in'
    accountStatus.className = 'status-value disconnected'
    signinBtn.style.display = 'block'
    signinBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: `${JOBAGENT_URL}/login` })
    })
    linkedinStatus.textContent = 'Sign in first'
    return
  }

  accountStatus.textContent = user.email
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
