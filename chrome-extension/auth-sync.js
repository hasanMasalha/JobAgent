// Content script — runs on jobagent.uk pages
// Reads the Supabase session from localStorage and caches it in extension storage

console.log('JobAgent auth-sync.js loaded')

async function syncAuth() {
  try {
    const keys = Object.keys(localStorage)
    console.log('JobAgent: localStorage keys:', keys)

    const authKey = keys.find(k =>
      k.includes('auth-token') ||
      k.includes('supabase') ||
      k.startsWith('sb-')
    )
    console.log('JobAgent: auth key found:', authKey)

    if (!authKey) return

    const raw = localStorage.getItem(authKey)
    let parsed
    try { parsed = JSON.parse(raw) } catch (e) {
      console.error('JobAgent: failed to parse session JSON', e)
      return
    }

    const token = parsed?.access_token
    const userId = parsed?.user?.id
    console.log('JobAgent: token found:', !!token, '| userId:', userId)

    if (token) {
      await chrome.storage.local.set({ authToken: token, userId })
      console.log('JobAgent: token saved to extension storage')
    }
  } catch (e) {
    console.error('JobAgent auth-sync error:', e)
  }
}

syncAuth()
