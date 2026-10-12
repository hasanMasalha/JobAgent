// grant.html: asks Chrome for access to Greenhouse's pages
// (optional_host_permissions). chrome.permissions.request only works from a
// click on an extension page, which is why this page exists. background.js
// opens the form in this tab once access is given; without it, the
// application is handed back (credit returned).
const ORIGINS = ['https://*.greenhouse.io/*']

function report(granted) {
  chrome.runtime.sendMessage({ type: 'ATS_PERMISSION_RESULT', granted })
}

document.getElementById('allow').addEventListener('click', async () => {
  const status = document.getElementById('status')
  let granted = false
  try {
    granted = await chrome.permissions.request({ origins: ORIGINS })
  } catch (e) {
    console.error('[JobAgent grant]', e)
  }
  status.textContent = granted
    ? 'Thanks — opening the application form…'
    : "Access wasn't given, so nothing was sent and your auto-apply was returned. You can close this tab."
  report(granted)
})

document.getElementById('cancel').addEventListener('click', () => {
  document.getElementById('status').textContent =
    'Nothing was sent and your auto-apply was returned. You can close this tab.'
  report(false)
})
