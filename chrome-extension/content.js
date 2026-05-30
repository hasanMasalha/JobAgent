// Runs on LinkedIn job pages
// Handles Easy Apply automation

console.log('JobAgent content.js loaded on:', window.location.href)

// Signal to the website that the extension is installed
const signal = document.createElement('div')
signal.id = 'jobagent-extension-installed'
signal.style.display = 'none'
document.documentElement.appendChild(signal)

// Check if this job has a pending application from JobAgent.
// Data is pushed into extension storage by the app at confirm-time to avoid
// SameSite cookie restrictions that block cross-site API fetches from linkedin.com.
// Retry up to 5 times — the DB write from mark-pending-extension may still be
// in flight when the LinkedIn page first loads.
async function checkPendingApplication() {
  const url = window.location.href
  console.log('JobAgent: checking pending application for:', url)

  for (let attempt = 0; attempt < 5; attempt++) {
    await sleep(2000)

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
    console.log('JobAgent: Easy Apply element not found')
    await reportResult(application.id, 'manual')
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

  await sleep(1000)
  console.log('JobAgent: filling form')
  await fillApplicationForm(application, panel)
}

async function waitForEasyApplyButton(timeout) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const el = findEasyApplyElement()
    if (el) return el
    await sleep(500)
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

// LinkedIn renders Easy Apply as <a href="...apply/..."> not a <button>.
// Search buttons, links, and ARIA roles; also match Hebrew text.
function findEasyApplyElement() {
  const easyApplyTexts = [
    'Easy Apply',
    'הגש מועמדות בקלות',
    'הגש מועמדות',
  ]

  const candidates = document.querySelectorAll(
    'button, a, [role="link"], [role="button"]'
  )

  for (const el of candidates) {
    if (el.offsetParent === null) continue  // not visible

    const text = el.textContent.trim()
    const ariaLabel = el.getAttribute('aria-label') || ''
    const href = el.getAttribute('href') || ''

    if (easyApplyTexts.some(t => text.includes(t) || ariaLabel.includes(t))) {
      console.log('JobAgent: found Easy Apply element by text:', el.tagName, text)
      return el
    }

    if (href.includes('/apply/') && href.includes('openSDUIApplyFlow')) {
      console.log('JobAgent: found Easy Apply element by href:', href.substring(0, 80))
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
    await sleep(1500)

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

    // Log current step inputs
    const inputs = currentPanel.querySelectorAll('input, textarea, select')
    console.log(`JobAgent: step ${step}, inputs:`, inputs.length)
    inputs.forEach((input, i) => {
      const label = getInputLabel(input)
      console.log(`  Input ${i}: type=${input.type} label="${label}"`)
    })

    await fillCurrentStep(currentPanel, application)

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
      console.log('JobAgent: all buttons:', allBtns.map(b => b.getAttribute('aria-label')))
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
  }
}

async function fillCurrentStep(scope, application) {
  console.log('JobAgent: === fillCurrentStep ===')
  console.log('JobAgent: all inputs:',
    Array.from(scope.querySelectorAll('input, select, textarea'))
      .map(el => ({
        type: el.type,
        id: el.id,
        name: el.name,
        value: el.value,
        ariaLabel: el.getAttribute('aria-label'),
        label: getInputLabel(el)
      }))
  )
  console.log('JobAgent: all fieldsets:',
    Array.from(scope.querySelectorAll('fieldset'))
      .map(f => f.querySelector('legend')?.textContent?.trim())
  )

  // Text / URL / textarea inputs
  const textInputs = scope.querySelectorAll('input[type="text"], input[type="url"], textarea')
  for (const input of textInputs) {
    if (input.value) continue
    const label = getInputLabel(input)
    if (!label) continue

    const l = label.toLowerCase()
    console.log('JobAgent: filling input:', l)

    if (l.includes('linkedin') || l.includes('profile')) {
      setInputValue(input, application.linkedin_url ||
        `https://www.linkedin.com/in/${application.user_name || 'profile'}`)
    } else if (l.includes('phone') || l.includes('mobile')) {
      setInputValue(input, application.phone || '')
    } else if (l.includes('website') || l.includes('portfolio')) {
      setInputValue(input, application.portfolio || '')
    } else if (l.includes('city') || l.includes('location')) {
      setInputValue(input, application.city || 'Tel Aviv')
    } else if (l.includes('salary') || l.includes('compensation')) {
      setInputValue(input, application.expected_salary || '')
    } else if (l.includes('notice') || l.includes('start date')) {
      setInputValue(input, application.notice_period || '30 days')
    }
  }

  // Number inputs (years of experience)
  const numberInputs = scope.querySelectorAll('input[type="number"]')
  for (const input of numberInputs) {
    if (input.value) continue
    const label = getInputLabel(input)
    setInputValue(input, getYearsAnswer(label, application.skills || []))
  }

  // Fieldsets with real radio inputs (work auth, sponsorship, yes/no questions)
  const fieldsets = scope.querySelectorAll('fieldset')
  for (const fieldset of fieldsets) {
    const legend = fieldset.querySelector('legend, span')
    console.log('JobAgent: fieldset legend:', legend?.textContent?.substring(0, 50))

    const radios = fieldset.querySelectorAll('input[type="radio"]')
    const alreadySelected = Array.from(radios).find(r => r.checked)
    if (alreadySelected || radios.length === 0) continue

    // Prefer "Yes" for auth/sponsorship questions; fall back to first option
    const yesRadio = Array.from(radios).find(r =>
      r.value?.toLowerCase() === 'yes' ||
      r.nextSibling?.textContent?.toLowerCase().includes('yes') ||
      r.parentElement?.textContent?.toLowerCase().includes('yes')
    )
    const toClick = yesRadio || radios[0]
    console.log('JobAgent: clicking radio:', toClick?.value,
      toClick?.parentElement?.textContent?.trim().substring(0, 30))
    toClick.click()
    toClick.dispatchEvent(new Event('change', { bubbles: true }))
  }

  // ARIA radiogroups (older LinkedIn UI)
  const radioGroups = scope.querySelectorAll('[role="radiogroup"]')
  for (const group of radioGroups) {
    const selected = group.querySelector('[aria-checked="true"]')
    if (!selected) {
      const yesOption = group.querySelector('[data-test-text-selectable-option__input]')
      if (yesOption) yesOption.click()
    }
  }

  // Select dropdowns
  const selects = scope.querySelectorAll('select')
  for (const select of selects) {
    if (select.value) continue
    const label = getInputLabel(select)
    console.log('JobAgent: select field:', label)

    const answer = getAnswerForField(label, application)
    if (answer) {
      select.value = answer
      select.dispatchEvent(new Event('change', { bubbles: true }))
    } else {
      // Fall back to first non-empty option
      const firstOption = Array.from(select.options).find(o => o.value && o.value !== '')
      if (firstOption) {
        select.value = firstOption.value
        select.dispatchEvent(new Event('change', { bubbles: true }))
      }
    }
  }
}

function getYearsAnswer(label, skills) {
  if (!label) return '0'

  const labelLower = label.toLowerCase()

  const genericPatterns = [
    'years of work experience',
    'years of professional experience',
    'total years',
    'overall experience'
  ]

  const skipWords = new Set([
    'years', 'experience', 'how', 'many', 'have', 'you',
    'with', 'work', 'working', 'using', 'knowledge'
  ])

  const techWords = labelLower
    .split(/\s+/)
    .filter(w => w.length > 2 && !skipWords.has(w))

  const skillsLower = skills.map(s => s.toLowerCase())
  const hasSkill = techWords.some(tech =>
    skillsLower.some(skill => skill.includes(tech) || tech.includes(skill))
  )

  if (genericPatterns.some(p => labelLower.includes(p))) {
    return '2'
  }

  return hasSkill ? '2' : '0'
}

function getAnswerForField(label, application) {
  if (!label) return null
  const l = label.toLowerCase()

  if (l.includes('phone') || l.includes('mobile')) return application.phone
  if (l.includes('city') || l.includes('location')) return application.city || 'Tel Aviv'
  if (l.includes('linkedin')) return application.linkedin_url || ''
  if (l.includes('website') || l.includes('portfolio')) return application.portfolio || ''
  if (l.includes('salary') || l.includes('compensation')) return application.expected_salary || ''
  if (l.includes('notice') || l.includes('start date')) return application.notice_period || '30 days'

  return null
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

// All network calls go through background.js — content scripts cannot make
// cross-origin fetches on pages with strict CSP (LinkedIn blocks them).
async function reportResult(applicationId, status) {
  try {
    await chrome.runtime.sendMessage({
      type: 'REPORT_APPLICATION_COMPLETE',
      applicationId,
      status,
      jobUrl: window.location.href
    })
  } catch (e) {
    console.error('JobAgent: failed to report result', e)
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

  await sleep(3000) // wait for SDUI page to render

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
