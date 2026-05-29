// Content script — runs on jobagent.uk / localhost:3000
// Supabase SSR stores sessions in httpOnly cookies, not localStorage.
// A same-origin fetch to /api/auth/me works here because the content script
// executes in the page's origin context, so the session cookie is sent automatically.

console.log('JobAgent auth-sync.js loaded')

;(async () => {
  try {
    const res = await fetch('/api/auth/me')
    console.log('JobAgent: /api/auth/me status:', res.status)

    if (res.ok) {
      const user = await res.json()
      console.log('JobAgent: user found:', user.email)

      // Log cookie keys for debugging
      const cookieKeys = document.cookie.split(';').map(c => c.trim().split('=')[0])
      console.log('JobAgent: cookie keys:', cookieKeys)

      await chrome.storage.local.set({
        userId: user.id,
        userEmail: user.email,
        isLoggedIn: true,
        lastChecked: Date.now()
      })
      console.log('JobAgent: user info saved to extension storage')
    } else {
      await chrome.storage.local.set({ isLoggedIn: false })
      console.log('JobAgent: user not logged in')
    }
  } catch (e) {
    console.error('JobAgent auth-sync error:', e)
  }
})()
