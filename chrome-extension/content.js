// Runs on LinkedIn job pages
// Handles Easy Apply automation

console.log('JobAgent content.js loaded on:', window.location.href)

// Signal to the website that the extension is installed
const signal = document.createElement('div')
signal.id = 'jobagent-extension-installed'
signal.style.display = 'none'
document.documentElement.appendChild(signal)

function randomDelay(min = 300, max = 1500) {
  const ms = Math.floor(Math.random() * (max - min) + min)
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function isLinkedInBlocking() {
  const captcha = document.querySelector(
    '[id*="captcha"], [class*="captcha"], [id*="challenge"], .challenge-page'
  )
  if (captcha) return 'captcha'
  if (document.title.includes('Security Verification') ||
      document.title.includes('Are you a robot')) {
    return 'verification'
  }
  if (document.querySelector('.error-container') &&
      document.body.innerText.includes('unusual activity')) {
    return 'rate_limit'
  }
  return null
}

// Check if this job has a pending application from JobAgent.
// Data is pushed into extension storage by the app at confirm-time to avoid
// SameSite cookie restrictions that block cross-site API fetches from linkedin.com.
// Retry up to 5 times — the DB write from mark-pending-extension may still be
// in flight when the LinkedIn page first loads.
async function checkPendingApplication() {
  const url = window.location.href
  console.log('JobAgent: checking pending application for:', url)

  const blockType = await isLinkedInBlocking()
  if (blockType) {
    console.log(`[JobAgent] LinkedIn blocking detected: ${blockType}`)
    chrome.runtime.sendMessage({ type: 'LINKEDIN_BLOCKED', blockType })
    chrome.storage.local.set({ isProcessingQueue: false })
    return
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    await randomDelay(1500, 3000)

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_PENDING_APPLICATION',
        jobUrl: url
      })
      console.log(`JobAgent: attempt ${attempt + 1}, response:`, response)

      if (response?.application) {
        console.log('JobAgent: found pending application, starting Easy Apply')
        await startEasyApply(response.application)
        return
      }

      console.log(`JobAgent: no pending application yet, retrying...`)
    } catch (e) {
      console.error(`JobAgent: attempt ${attempt + 1} error:`, e)
    }
  }

  console.log('JobAgent: no pending application after 5 attempts')
}

async function startEasyApply(application) {
  console.log('JobAgent: starting Easy Apply')

  const el = await waitForEasyApplyButton(20000)
  if (!el) {
    // Most LinkedIn listings aren't Easy Apply, and nothing tells us which
    // before we get here. Stop, hand the credit back ("manual"), and leave
    // the tab open so the user can apply on this page themselves.
    console.log('JobAgent: no Easy Apply button on this job, stopping')
    await reportResult(application.id, 'manual', { keepTab: true, reason: 'no_easy_apply' })
    return
  }

  console.log('JobAgent: clicking Easy Apply:', el.tagName)
  el.click()

  console.log('JobAgent: waiting for Easy Apply panel in shadow DOM...')
  const panel = await waitForEasyApplyPanel(15000)
  console.log('JobAgent: panel found:', !!panel)

  if (!panel) {
    console.log('JobAgent: panel not found')
    await reportResult(application.id, 'manual')
    return
  }

  await randomDelay(800, 1500)
  console.log('JobAgent: filling form')
  await fillApplicationForm(application, panel)
}

async function waitForEasyApplyButton(timeout) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const el = findEasyApplyElement()
    if (el) return el
    await randomDelay(300, 700)
  }
  return null
}

// The Easy Apply modal lives inside the shadow DOM of #interop-outlet.
// Regular document.querySelector() cannot pierce shadow boundaries.
function getEasyApplyPanel() {
  const interopOutlet = document.getElementById('interop-outlet')
  if (!interopOutlet?.shadowRoot) {
    console.log('JobAgent: no shadow root found')
    return null
  }
  const panel = interopOutlet.shadowRoot.querySelector(
    '.jobs-easy-apply-modal, [data-test-modal-id="easy-apply-modal"] [role="dialog"]'
  )
  console.log('JobAgent: shadow panel found:', !!panel)
  return panel
}

async function waitForEasyApplyPanel(timeout = 15000) {
  return new Promise((resolve) => {
    const panel = getEasyApplyPanel()
    if (panel) return resolve(panel)

    const interval = setInterval(() => {
      const panel = getEasyApplyPanel()
      if (panel) {
        clearInterval(interval)
        resolve(panel)
      }
    }, 500)

    setTimeout(() => {
      clearInterval(interval)
      resolve(null)
    }, timeout)
  })
}

// LinkedIn renders Easy Apply as a <button>, or as <a href="...apply/...">.
//
// Only the Easy Apply control itself counts. This runs on every LinkedIn job
// we open, and most of them have a plain "Apply" button that leaves for the
// company's site — so the match is strict (jaIsEasyApplyLabel, answers.js),
// and links to another job or to a search are skipped. No match means no
// Easy Apply: startEasyApply stops and reports manual.
function findEasyApplyElement() {
  const candidates = document.querySelectorAll(
    'button, a, [role="link"], [role="button"]'
  )

  for (const el of candidates) {
    if (el.offsetParent === null) continue  // not visible

    const href = el.getAttribute('href') || ''

    if (href.includes('/apply/') && href.includes('openSDUIApplyFlow')) {
      console.log('JobAgent: found Easy Apply element by href:', href.substring(0, 80))
      return el
    }

    // A link that goes to another job or a search is never the apply control.
    if (href.includes('/jobs/view/') || href.includes('/jobs/search')) continue

    if (jaIsEasyApplyLabel(el.textContent, el.getAttribute('aria-label'))) {
      console.log('JobAgent: found Easy Apply element by label:', el.tagName)
      return el
    }
  }

  return null
}

async function fillApplicationForm(application, panel) {
  console.log('JobAgent: fillApplicationForm called')

  // Use passed panel; re-fetch from shadow DOM each step in case LinkedIn re-renders it
  const scope = panel || getEasyApplyPanel() || document

  let step = 0
  const maxSteps = 10

  while (step < maxSteps) {
    await randomDelay(800, 2000)

    const currentPanel = getEasyApplyPanel() || scope

    // Check if submitted
    const successMsg = currentPanel.querySelector(
      '[aria-label*="submitted"], .artdeco-inline-feedback--success'
    )
    if (successMsg) {
      console.log('JobAgent: application submitted!')
      await reportResult(application.id, 'applied')
      showSuccessNotification()
      return
    }

    // A required question the user hasn't given us an answer for: stop here
    // and hand over. Nothing is guessed and nothing is submitted.
    const missing = await fillCurrentStep(currentPanel, application)
    if (missing.length) {
      await stopForUser(application, missing)
      return
    }

    // Named next/submit buttons (English + Hebrew)
    const nextBtn = currentPanel.querySelector(
      'button[aria-label="Continue to next step"], ' +
      'button[aria-label="Review your application"], ' +
      'button[aria-label="Submit application"], ' +
      'button[aria-label="המשך לשלב הבא"], ' +
      'button[aria-label="שלח מועמדות"], ' +
      'button[aria-label="בדוק את מועמדותך"]'
    )

    console.log('JobAgent: next button:', nextBtn?.getAttribute('aria-label'))

    if (nextBtn) {
      nextBtn.click()
      step++
    } else {
      // Fallback: primary-styled button in the panel
      const allBtns = Array.from(currentPanel.querySelectorAll('button'))
      const primary = allBtns.find(b => b.classList.contains('artdeco-button--primary'))
      if (primary) {
        console.log('JobAgent: clicking primary btn:', primary.textContent.trim())
        primary.click()
        step++
      } else {
        console.log('JobAgent: no button found, stopping')
        break
      }
    }

    // LinkedIn refused the step (a question it requires is still empty and
    // wasn't marked as required in a way we recognise): stop here too.
    await randomDelay(800, 1500)
    const afterPanel = getEasyApplyPanel() || scope
    if (hasValidationError(afterPanel)) {
      await stopForUser(application, findUnanswered(afterPanel, false))
      return
    }
  }

  // Loop ended without detecting a success message — report manual so the
  // dashboard polling can stop waiting.
  console.log('[JobAgent] form loop ended without success, reporting manual')
  await reportResult(application.id, 'manual', { keepTab: true })
}

function optionText(radio, fieldset) {
  const lbl = radio.closest('label') || fieldset.querySelector(`label[for="${radio.id}"]`)
  return (lbl?.textContent || radio.value || '').trim()
}

function selectUnanswered(select) {
  const chosen = select.options[select.selectedIndex]
  return !select.value || !chosen || /^(select|choose|בחר)/i.test(chosen.text.trim())
}

function isRequired(el) {
  if (el.required || el.getAttribute('aria-required') === 'true') return true
  const group = el.closest(
    'fieldset, [data-test-form-element], .fb-dash-form-element, .jobs-easy-apply-form-element, .fb-form-element'
  )
  if (!group) return false
  return group.getAttribute('aria-required') === 'true' ||
    !!group.querySelector('[aria-required="true"], [required], [class*="required"]')
}

// Labels of questions on this step that have no answer. With requiredOnly,
// only the ones LinkedIn marks as required.
function findUnanswered(scope, requiredOnly = true) {
  const missing = []
  const add = (el, label) => {
    if (requiredOnly && !isRequired(el)) return
    missing.push((label || 'A question on this step').replace(/\s+/g, ' ').trim().slice(0, 140))
  }

  const fields = scope.querySelectorAll(
    'input[type="text"], input[type="url"], input[type="email"], input[type="tel"], input[type="number"], textarea'
  )
  for (const input of fields) {
    if (!input.value?.trim()) add(input, getInputLabel(input))
  }

  for (const fieldset of scope.querySelectorAll('fieldset')) {
    const radios = Array.from(fieldset.querySelectorAll('input[type="radio"]'))
    if (radios.length && !radios.some(r => r.checked)) {
      const legend = fieldset.querySelector('legend, [data-test-form-element-label]')
      add(radios[0], legend?.textContent)
    }
  }

  for (const select of scope.querySelectorAll('select')) {
    if (selectUnanswered(select)) add(select, getInputLabel(select))
  }

  return Array.from(new Set(missing))
}

function hasValidationError(scope) {
  return !!scope.querySelector('.artdeco-inline-feedback--error, [aria-invalid="true"]')
}

// Hand the application back to the user: say which questions need them,
// leave the form open in this tab, and report "manual" (which also returns
// the auto-apply credit).
async function stopForUser(application, missing) {
  console.log('[JobAgent] stopping, no answer from the user for:', missing)

  document.getElementById('jobagent-stop-notice')?.remove()
  const box = document.createElement('div')
  box.id = 'jobagent-stop-notice'
  box.setAttribute('role', 'status')
  box.style.cssText = `
    position:fixed;top:20px;right:20px;z-index:999999;max-width:360px;
    background:white;color:#14202e;border:2px solid #1a2e5e;border-radius:12px;
    padding:16px 18px;box-shadow:0 12px 40px rgba(0,0,0,0.25);
    font:14px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;
  `
  const title = document.createElement('div')
  title.style.cssText = 'font-weight:600;margin-bottom:6px'
  title.textContent = 'JobAgent stopped here'
  const body = document.createElement('div')
  body.textContent = missing.length
    ? 'You haven\'t given JobAgent an answer for:'
    : 'LinkedIn needs an answer JobAgent doesn\'t have from you.'
  const list = document.createElement('ul')
  list.style.cssText = 'margin:6px 0 8px 18px;padding:0'
  for (const q of missing.slice(0, 6)) {
    const li = document.createElement('li')
    li.textContent = q
    list.appendChild(li)
  }
  const foot = document.createElement('div')
  foot.textContent = 'Nothing was submitted. Answer and submit the application yourself in this tab.'
  const close = document.createElement('button')
  close.type = 'button'
  close.textContent = 'Close'
  close.style.cssText = 'margin-top:10px;padding:6px 12px;border:1px solid #c9d1db;border-radius:8px;background:#f5f6f8;cursor:pointer'
  close.onclick = () => box.remove()
  box.append(title, body, list, foot, close)
  document.body.appendChild(box)

  await reportResult(application.id, 'manual', { keepTab: true })
}

// Fills in what the user has given us an answer for (see answers.js) and
// returns the required questions that are still unanswered. Nothing is
// guessed: no default numbers, no "Yes" for a question we don't recognise,
// no first option of a dropdown.
async function fillCurrentStep(scope, application) {
  console.log('JobAgent: === fillCurrentStep ===')

  // Text / number / URL / email / textarea inputs
  const textInputs = scope.querySelectorAll(
    'input[type="text"], input[type="url"], input[type="email"], input[type="tel"], input[type="number"], textarea'
  )
  for (const input of textInputs) {
    if (input.value?.trim()) continue
    const label = getInputLabel(input)

    let answer = jaAnswerForLabel(label, application)

    // null: no answer from the user for this one. Use what they answered for
    // this exact question before, or ask them (only when the tab is visible).
    // Empty string: a field we leave empty on purpose.
    if (answer === null && label) {
      answer = await getAnswerForUnknown(label, application)
    }

    if (answer) {
      console.log('JobAgent: filling input:', label)
      await humanType(input, String(answer))
    }
  }

  // Yes/no and other radio questions
  for (const fieldset of scope.querySelectorAll('fieldset')) {
    const legend = fieldset.querySelector('legend, [data-test-form-element-label]')
    const legendText = legend?.textContent?.trim() || ''

    const radios = Array.from(fieldset.querySelectorAll('input[type="radio"]'))
    if (radios.length === 0 || radios.some(r => r.checked)) continue

    const options = radios.map(r => optionText(r, fieldset))
    const wantYes = jaBooleanAnswer(legendText, application)
    let index = wantYes === null ? -1 : jaYesNoOption(options, wantYes)
    if (index === -1) index = jaMatchOption(options, jaSavedAnswer(legendText, application))

    if (index !== -1) {
      console.log('JobAgent: answering radio question:', legendText.substring(0, 50))
      radios[index].click()
      radios[index].dispatchEvent(new Event('change', { bubbles: true }))
    }
  }

  // Select dropdowns
  for (const select of scope.querySelectorAll('select')) {
    if (!selectUnanswered(select)) continue
    const label = getInputLabel(select)
    const answer = jaAnswerForLabel(label, application) || jaSavedAnswer(label, application)
    const options = Array.from(select.options)
    const index = jaMatchOption(options.map(o => o.text), answer)
    if (index !== -1) {
      select.value = options[index].value
      select.dispatchEvent(new Event('change', { bubbles: true }))
    }
  }

  return findUnanswered(scope)
}

// ── Learn-as-you-go popup ─────────────────────────────────────────────────────

async function showQuestionOverlay(question, onAnswer) {
  // If the tab is hidden (background apply mode), skip the popup and resolve
  // immediately with null — we don't want to yank the user's focus mid-browse.
  if (document.visibilityState === 'hidden') {
    console.log('[JobAgent] skipping overlay in background tab for:', question)
    onAnswer(null, false)
    return
  }

  // Visible tab — bring it forward if needed, then show the overlay.
  try {
    await chrome.runtime.sendMessage({ type: 'FOCUS_TAB' })
  } catch { /* ignore — tab may already be active */ }

  document.getElementById('jobagent-question-overlay')?.remove()

  const overlay = document.createElement('div')
  overlay.id = 'jobagent-question-overlay'
  overlay.style.cssText = `
    position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
    z-index:999999;background:white;border:2px solid #1a2e5e;
    border-radius:12px;padding:24px;min-width:400px;max-width:500px;
    box-shadow:0 20px 60px rgba(0,0,0,0.3);
    font-family:-apple-system,BlinkMacSystemFont,sans-serif;
  `
  overlay.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px">
      <div style="background:#1a2e5e;color:white;padding:4px 12px;
                  border-radius:20px;font-size:12px;font-weight:600">JobAgent</div>
      <span style="font-size:13px;color:#666">needs your help</span>
    </div>
    <p style="font-size:15px;font-weight:500;color:#111;margin-bottom:16px;line-height:1.5">
      ${question}
    </p>
    <input id="jobagent-answer-input" type="text" placeholder="Type your answer…"
      style="width:100%;padding:10px 12px;border:2px solid #1a2e5e;border-radius:8px;
             font-size:14px;box-sizing:border-box;margin-bottom:10px;outline:none;" />
    <label style="display:flex;align-items:center;gap:8px;font-size:13px;
                  color:#666;margin-bottom:16px;cursor:pointer">
      <input type="checkbox" id="jobagent-save-answer" checked
             style="width:16px;height:16px;cursor:pointer" />
      Remember this answer for future applications
    </label>
    <div style="display:flex;gap:8px">
      <button id="jobagent-submit-answer" style="flex:1;background:#1a2e5e;color:white;
        border:none;padding:11px;border-radius:8px;font-size:14px;
        font-weight:500;cursor:pointer;">Continue →</button>
      <button id="jobagent-skip-answer" style="padding:11px 16px;background:#f5f6f8;
        border:1px solid #e0e0e0;border-radius:8px;font-size:14px;
        cursor:pointer;color:#666;">Skip</button>
    </div>
  `

  document.body.appendChild(overlay)
  const input = document.getElementById('jobagent-answer-input')
  input.focus()

  const submit = () => {
    const answer = input.value.trim()
    const save = document.getElementById('jobagent-save-answer').checked
    overlay.remove()
    onAnswer(answer || null, save)
  }

  document.getElementById('jobagent-submit-answer').onclick = submit
  document.getElementById('jobagent-skip-answer').onclick = () => {
    overlay.remove()
    onAnswer(null, false)
  }
  input.addEventListener('keydown', e => { if (e.key === 'Enter') submit() })
}

async function getAnswerForUnknown(question, application) {
  if (!question) return null
  const normalized = question.toLowerCase().trim()

  // The user's own answer to this exact question from a previous application
  const saved = jaSavedAnswer(question, application)
  if (saved) {
    console.log('JobAgent: using saved answer for:', normalized)
    return saved
  }

  // Ask user via popup
  return new Promise((resolve) => {
    showQuestionOverlay(question, async (answer, save) => {
      if (answer && save) {
        try {
          await chrome.runtime.sendMessage({
            type: 'SAVE_ANSWER',
            question: normalized,
            answer,
          })
          if (!application.savedAnswers) application.savedAnswers = {}
          application.savedAnswers[normalized] = answer
        } catch (e) {
          console.error('JobAgent: failed to send SAVE_ANSWER', e)
        }
      }
      resolve(answer)
    })
  })
}

function getInputLabel(input) {
  if (input.getAttribute('aria-label')) return input.getAttribute('aria-label')

  const id = input.id
  if (id) {
    // getRootNode() returns the shadow root when inside shadow DOM so
    // label[for=...] is found even when it lives in the same shadow tree.
    const root = input.getRootNode()
    const label = root.querySelector(`label[for="${id}"]`)
    if (label) return label.textContent.trim()
  }

  const parentLabel = input.closest('label')
  if (parentLabel) return parentLabel.textContent.trim()

  const container = input.closest(
    '.fb-dash-form-element, .jobs-easy-apply-form-element, ' +
    '.fb-form-element, [data-test-form-element]'
  )
  if (container) {
    const label = container.querySelector('label, legend, span[data-test-form-element-label]')
    if (label) return label.textContent.trim()
  }

  // Fieldset legend — covers radio groups and other grouped inputs
  const fieldset = input.closest('fieldset')
  if (fieldset) {
    const legend = fieldset.querySelector('legend')
    if (legend) return legend.textContent.trim()
  }

  return null
}

function setInputValue(input, value) {
  // Use the native setter for both <input> and <textarea> so React sees the change
  const proto = input instanceof HTMLTextAreaElement
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype
  const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set

  if (nativeSetter) {
    nativeSetter.call(input, value)
  } else {
    input.value = value
  }

  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

async function humanType(element, text) {
  element.focus()
  await randomDelay(100, 300)

  // Use native setter so React's fiber reconciler sees the value change
  const proto = element instanceof HTMLTextAreaElement
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype
  const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  const setVal = (v) => nativeSetter ? nativeSetter.call(element, v) : (element.value = v)

  setVal('')
  element.dispatchEvent(new Event('input', { bubbles: true }))
  await randomDelay(100, 200)

  for (const char of text) {
    setVal(element.value + char)
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new KeyboardEvent('keypress', { key: char, bubbles: true }))
    await randomDelay(50, 150)
  }

  element.dispatchEvent(new Event('change', { bubbles: true }))
  await randomDelay(200, 500)
}

// All network calls go through background.js — content scripts cannot make
// cross-origin fetches on pages with strict CSP (LinkedIn blocks them).
// keepTab: leave the LinkedIn tab open so the user can finish the form.
// reason: why it stopped, for the notification only — it isn't sent to the server.
async function reportResult(applicationId, status, { keepTab = false, reason = null } = {}) {
  console.log('[JobAgent] reportResult called:', applicationId, status)
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'REPORT_APPLICATION_COMPLETE',
      applicationId,
      status,
      keepTab,
      reason,
      jobUrl: window.location.href
    })
    console.log('[JobAgent] reportResult response:', response)
  } catch (e) {
    console.error('[JobAgent] failed to report result:', e)
  }
}

function showSuccessNotification() {
  const notification = document.createElement('div')
  notification.style.cssText = `
    position: fixed; top: 20px; right: 20px; z-index: 99999;
    background: #1a2e5e; color: white; padding: 16px 24px;
    border-radius: 8px; font-size: 14px; font-weight: 500;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  `
  notification.textContent = 'JobAgent: Application submitted successfully!'
  document.body.appendChild(notification)
  setTimeout(() => notification.remove(), 5000)
}

function waitForElement(selector, timeout = 10000) {
  return new Promise((resolve) => {
    const el = document.querySelector(selector)
    if (el) return resolve(el)

    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector)
      if (el) {
        observer.disconnect()
        resolve(el)
      }
    })

    observer.observe(document.body, { childList: true, subtree: true })
    setTimeout(() => { observer.disconnect(); resolve(null) }, timeout)
  })
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Handler for the new SDUI apply flow — LinkedIn opens a full page at
// /jobs/view/{id}/apply/?openSDUIApplyFlow=true instead of a modal.
// The form is rendered directly in the page body, no modal wrapper.
async function handleApplyFlowPage() {
  console.log('JobAgent: handleApplyFlowPage called')
  const url = window.location.href
  console.log('JobAgent: apply page URL:', url)

  await randomDelay(2000, 4000) // wait for SDUI page to render

  const blockType = await isLinkedInBlocking()
  if (blockType) {
    console.log(`[JobAgent] LinkedIn blocking detected: ${blockType}`)
    chrome.runtime.sendMessage({ type: 'LINKEDIN_BLOCKED', blockType })
    chrome.storage.local.set({ isProcessingQueue: false })
    return
  }

  const stored = await chrome.storage.local.get(['pendingApplyData'])
  console.log('JobAgent: stored data:', stored.pendingApplyData)
  const pendingData = stored.pendingApplyData

  if (!pendingData) {
    console.log('JobAgent: no pending apply data in storage')
    return
  }

  if (Date.now() - pendingData.timestamp > 5 * 60 * 1000) {
    console.log('JobAgent: pending apply data is stale')
    await chrome.storage.local.remove(['pendingApplyData'])
    return
  }

  console.log('JobAgent: found pending apply data:', pendingData.applicationId)
  await fillApplicationForm(pendingData.application)
}

// Route to the right handler based on the current page
const url = window.location.href
if (url.includes('/apply/') || url.includes('openSDUIApplyFlow')) {
  console.log('JobAgent: detected apply flow page')
  handleApplyFlowPage()
} else {
  console.log('JobAgent: detected job listing page')
  checkPendingApplication()
}
