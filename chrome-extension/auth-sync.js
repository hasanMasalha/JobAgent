// Content script — runs on jobagent.uk pages
// Reads the Supabase session from localStorage and caches it in extension storage
// so popup.js can display the logged-in email without a round-trip API call.

function syncAuth() {
  try {
    // @supabase/ssr browser client stores session under sb-<project-ref>-auth-token
    const key = Object.keys(localStorage).find(
      (k) => k.startsWith('sb-') && k.includes('auth-token')
    )
    if (!key) return

    const raw = localStorage.getItem(key)
    if (!raw) return

    let session
    try { session = JSON.parse(raw) } catch { return }

    const token = session?.access_token
    const userId = session?.user?.id
    if (!token || !userId) return

    chrome.runtime.sendMessage({ type: 'SAVE_AUTH', token, userId })
  } catch (e) {
    // localStorage may be inaccessible in some sandboxed contexts
  }
}

syncAuth()
