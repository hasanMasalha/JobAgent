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
async function checkPendingApplication() {
  console.log('JobAgent: checking pending application for:', window.location.href)
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_PENDING_APPLICATION' })
    console.log('JobAgent: GET_PENDING_APPLICATION response:', response)
    if (response?.application) {
      await startEasyApply(response.application)
    } else {
      console.log('JobAgent: no pending application in storage')
    }
  } catch (e) {
    console.error('JobAgent: Error checking pending application', e)
  }
}

async function startEasyApply(application) {
  console.log('JobAgent: starting Easy Apply for application:', application.id)

  // Wait for the job detail panel to render (LinkedIn uses <a> tags, not buttons)
  console.log('JobAgent: waiting for Easy Apply element...')
  await waitForElement(
    '.jobs-apply-button, button[aria-label*="Easy Apply"], a[href*="/apply/"]',
    20000
  )

  const easyApplyEl = findEasyApplyElement()
  console.log('JobAgent: Easy Apply element found:', !!easyApplyEl, easyApplyEl?.tagName)
  if (!easyApplyEl) {
    console.log('JobAgent: No Easy Apply element found — reporting manual')
    await reportResult(application.id, 'manual')
    return
  }

  console.log('JobAgent: clicking Easy Apply element:', easyApplyEl.tagName)
  easyApplyEl.click()

  // Wait for the apply modal — <a> tags open it asynchronously
  const modal = await waitForElement(
    '.jobs-easy-apply-modal, [data-test-modal], .artdeco-modal',
    10000
  )
  console.log('JobAgent: modal appeared:', !!modal)

  await fillApplicationForm(application)
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

async function fillApplicationForm(application) {
  let step = 0
  const maxSteps = 10

  while (step < maxSteps) {
    await sleep(1500)

    // Check if modal is open
    const modal = document.querySelector(
      '.jobs-easy-apply-modal, [data-test-modal]'
    )
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

// Wait for LinkedIn's React app to render before checking — the job detail
// panel (and the Easy Apply button) loads asynchronously after document_idle
sleep(3000).then(() => checkPendingApplication())
