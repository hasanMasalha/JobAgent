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
  console.log('JobAgent: starting Easy Apply for:', application.id)

  const el = await waitForEasyApplyButton(20000)
  if (!el) {
    console.log('JobAgent: Easy Apply element not found')
    await reportResult(application.id, 'manual')
    return
  }

  const href = el.getAttribute('href') || ''
  console.log('JobAgent: Easy Apply href:', href)

  if (href.includes('/apply/') || href.includes('openSDUIApplyFlow')) {
    // Link navigates to a new page — save application data for the apply page to pick up
    await chrome.storage.local.set({
      pendingApplyData: {
        applicationId: application.id,
        application: application,
        timestamp: Date.now()
      }
    })
    console.log('JobAgent: saved apply data, navigating to apply page')
    el.click()
    return
  }

  // Old modal flow (fallback)
  el.click()
  await sleep(2000)
  const modal = await waitForElement(
    '.jobs-easy-apply-modal, [data-test-modal], .artdeco-modal',
    10000
  )
  console.log('JobAgent: modal appeared:', !!modal)
  if (modal) {
    await fillApplicationForm(application)
  }
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

// pageRoot is document.body for the SDUI full-page flow; null uses modal detection
async function fillApplicationForm(application, pageRoot = null) {
  console.log('JobAgent: fillApplicationForm called')
  console.log('JobAgent: page URL:', window.location.href)

  const inputs = document.querySelectorAll('input, textarea, select')
  console.log('JobAgent: found inputs:', inputs.length)
  inputs.forEach((input, i) => {
    console.log(`Input ${i}:`, input.type, input.name,
      input.getAttribute('aria-label'), input.value?.substring(0, 20))
  })

  let step = 0
  const maxSteps = 10

  while (step < maxSteps) {
    await sleep(1500)

    // Classic apply: find the modal. SDUI apply: use the full page body.
    const modal = pageRoot || document.querySelector('.jobs-easy-apply-modal, [data-test-modal]')
    if (!modal) break

    // Check if submitted
    const successMsg = modal.querySelector(
      '[aria-label*="submitted"], .artdeco-inline-feedback--success'
    )
    if (successMsg) {
      await reportResult(application.id, 'applied')
      showSuccessNotification()
      break
    }

    // Fill current step fields
    await fillCurrentStep(modal, application)

    // Click Next or Submit
    const nextBtn = modal.querySelector(
      'button[aria-label="Continue to next step"], ' +
      'button[aria-label="Review your application"], ' +
      'button[aria-label="Submit application"]'
    )

    if (nextBtn) {
      nextBtn.click()
      step++
    } else {
      break
    }
  }
}

async function fillCurrentStep(modal, application) {
  // Fill phone number
  const phoneInput = modal.querySelector(
    'input[name*="phone"], input[id*="phone"]'
  )
  if (phoneInput && !phoneInput.value) {
    setInputValue(phoneInput, application.phone || '')
  }

  // Fill text inputs that are empty
  const textInputs = modal.querySelectorAll('input[type="text"], textarea')
  for (const input of textInputs) {
    const label = getInputLabel(input)
    if (!input.value && label) {
      const answer = getAnswerForField(label, application)
      if (answer) setInputValue(input, answer)
    }
  }

  // Handle number inputs (years of experience)
  const numberInputs = modal.querySelectorAll('input[type="number"]')
  for (const input of numberInputs) {
    if (!input.value) {
      const label = getInputLabel(input)
      const answer = getYearsAnswer(label, application.skills || [])
      setInputValue(input, answer)
    }
  }

  // Handle radio buttons / yes-no questions
  const radioGroups = modal.querySelectorAll('[role="radiogroup"]')
  for (const group of radioGroups) {
    const selected = group.querySelector('[aria-checked="true"]')
    if (!selected) {
      const yesOption = group.querySelector(
        '[data-test-text-selectable-option__input]'
      )
      if (yesOption) yesOption.click()
    }
  }

  // Handle select dropdowns
  const selects = modal.querySelectorAll('select')
  for (const select of selects) {
    if (!select.value || select.value === '') {
      const label = getInputLabel(select)
      const answer = getAnswerForField(label, application)
      if (answer) {
        select.value = answer
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
    const label = document.querySelector(`label[for="${id}"]`)
    if (label) return label.textContent.trim()
  }

  const parentLabel = input.closest('label')
  if (parentLabel) return parentLabel.textContent.trim()

  const container = input.closest('.fb-dash-form-element, .jobs-easy-apply-form-element')
  if (container) {
    const label = container.querySelector('label, .fb-form-element-label')
    if (label) return label.textContent.trim()
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
  const url = window.location.href
  if (!url.includes('/apply/') && !url.includes('openSDUIApplyFlow')) return

  console.log('JobAgent: on apply flow page')
  await sleep(2000) // wait for page to render

  const stored = await chrome.storage.local.get(['pendingApplyData'])
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
if (window.location.href.includes('/apply/') || window.location.href.includes('openSDUIApplyFlow')) {
  handleApplyFlowPage()
} else {
  // checkPendingApplication has its own 2s-per-attempt retry loop
  checkPendingApplication()
}
