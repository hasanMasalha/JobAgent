// Content script — runs on jobagent.uk / localhost:3000
// Next.js uses client-side navigation, so this script only runs once on the
// initial page load. We intercept history.pushState to re-check auth after
// each SPA navigation (e.g. /login → /dashboard after successful sign-in).

console.log('JobAgent auth-sync.js loaded')

async function syncAuth() {
  const path = window.location.pathname
  // Skip auth check on login/signup pages — user isn't authenticated yet
  if (path === '/login' || path === '/signup') {
    console.log('JobAgent: skipping auth sync on', path)
    return
  }

  try {
    const res = await fetch('/api/auth/me')
    console.log('JobAgent: /api/auth/me status:', res.status, 'on', path)

    if (res.ok) {
      const user = await res.json()
      console.log('JobAgent: user found:', user.email)
      await chrome.storage.local.set({
        userId: user.id,
        userEmail: user.email,
        isLoggedIn: true,
        lastChecked: Date.now()
      })
      console.log('JobAgent: user info saved to extension storage')
    } else {
      await chrome.storage.local.set({ isLoggedIn: false })
    }
  } catch (e) {
    console.error('JobAgent auth-sync error:', e)
  }
}

// Intercept Next.js client-side navigation
const originalPushState = history.pushState.bind(history)
history.pushState = function (...args) {
  originalPushState(...args)
  setTimeout(syncAuth, 300) // wait for Next.js to finish rendering
}

window.addEventListener('popstate', () => setTimeout(syncAuth, 300))

// Run on initial page load
syncAuth()
