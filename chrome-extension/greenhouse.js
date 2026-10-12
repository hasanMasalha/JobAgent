// Fills in and submits a Greenhouse application form (stage 3 of moving ATS
// applying into the extension). background.js injects this into the tab it
// opened for one application; on any other tab it does nothing.
//
// The server decides every answer (/api/apply/form-answers: the form's
// questions from Greenhouse's job board API, each answered from the user's own
// data or listed as missing). This file only puts those answers into the page:
//   - a field is found by the id Greenhouse gives it, which is the question's
//     name in the board API ("first_name", "question_68278135");
//   - a choice is made only when the page has exactly the option the server
//     chose — never the first option, never "close enough";
//   - a required question with no answer, a required field the board API
//     doesn't list (Stripe's School / Degree), or a field it couldn't set
//     stops it before Submit: nothing is sent, the tab is left open for the
//     user, and the credit comes back.
// Submitted only on Greenhouse's own confirmation (a /confirmation page or its
// "thank you for applying" text); anything else is reported unconfirmed.

// Stops at the Submit button instead of clicking it, for testing an unpacked
// build on a real job. Must be false in a release —
// __tests__/extension/greenhouse.test.ts checks.
const GH_DRY_RUN = false

const GH_SUBMIT_WATCH_MS = 30 * 1000
// An attached file is uploaded to Greenhouse's storage before the form counts
// it; a large CV on a slow connection can take a while.
const GH_UPLOAD_WAIT_MS = 60 * 1000
// Greenhouse emails an 8-character code when its bot check scores the browser
// low; the user types it into this tab, and that can take a while.
const GH_CODE_WATCH_MS = 30 * 60 * 1000

function ghClean(v) {
  return (v || '').replace(/\s+/g, ' ').trim()
}

function ghNorm(v) {
  return ghClean(v).toLowerCase()
}

// The page element's id for a board API question name. Multi-selects are
// named "question_1[]" in the API; their checkboxes keep that name, a
// react-select keeps the id without "[]". Demographic questions come back as
// "demographic_<id>" (form_questions.py) and the page uses the bare id.
// The location question is "location" in the API, #candidate-location here.
function ghDomId(questionId) {
  const id = String(questionId || '')
  if (id === 'location') return 'candidate-location'
  if (id.startsWith('demographic_')) return id.slice('demographic_'.length)
  return id.replace(/\[\]$/, '')
}

// The index of the option whose text is exactly `wanted` (ignoring case and
// spacing), or -1.
function ghExactOption(texts, wanted) {
  const w = ghNorm(wanted)
  if (!w) return -1
  return texts.findIndex(t => ghNorm(t) === w)
}

// Greenhouse's city picker suggests places for what was typed ("London" →
// "London, England, United Kingdom", "London, Ontario, Canada"…). The user's
// city is a single place name, so a suggestion is taken only when it is the
// only one whose place name is that city. Several Londons → none.
function ghLocationOption(texts, city) {
  const c = ghNorm(city)
  if (!c) return -1
  const exact = texts.findIndex(t => ghNorm(t) === c)
  if (exact !== -1) return exact
  const named = texts
    .map((t, i) => [ghNorm(t.split(',')[0]), i])
    .filter(([name]) => name === c)
  return named.length === 1 ? named[0][1] : -1
}

// Greenhouse's own confirmation: its /confirmation page, or the text it shows
// in place of the form. `before` is the page text from before Submit, so a job
// description that happens to say "thank you for applying" doesn't count.
const GH_CONFIRMATION_TEXT = [
  /thank you for applying/i,
  /your application has been (submitted|received)/i,
]

function ghIsConfirmation(url, text, before) {
  let path = ''
  try { path = new URL(url).pathname } catch {}
  if (/\/confirmation\/?$/.test(path)) return true
  return GH_CONFIRMATION_TEXT.some(re => re.test(text || '') && !re.test(before || ''))
}

// ── Reading the page ───────────────────────────────────────────────────────

function ghLabelFor(doc, el) {
  if (!el) return ''
  const own = el.id ? doc.querySelector(`label[for="${CSS.escape(el.id)}"]`) || doc.getElementById(`${el.id}-label`) : null
  const legend = el.closest('fieldset')?.querySelector('legend')
  const text = ghClean((own || legend || {}).textContent || el.getAttribute('aria-label') || el.id || el.name)
  return text.replace(/\s*\*$/, '')
}

function ghIsCombobox(el) {
  return !!el && el.getAttribute('role') === 'combobox'
}

function ghControl(el) {
  return el.closest('.select__control') || el.closest('[class*="control"]') || el.parentElement
}

// What a react-select shows as chosen ([] when nothing is).
function ghChosen(el) {
  const control = ghControl(el)
  if (!control) return []
  return [...control.querySelectorAll('[class*="single-value"], [class*="multi-value__label"]')].map(n => ghClean(n.textContent))
}

function ghIsEmpty(doc, el) {
  if (ghIsCombobox(el)) return ghChosen(el).length === 0
  if (el.type === 'checkbox' || el.type === 'radio') {
    return ![...doc.getElementsByName(el.name)].some(e => e.checked)
  }
  return !ghClean(el.value)
}

// Required fields still empty, other than the ones in `skip` (ids handled
// already, or reported already). Greenhouse marks required fields with
// aria-required="true"; checkbox groups are a fieldset with it. The hidden
// unnamed "requiredInput" mirrors next to each combobox are skipped.
function ghRequiredEmpty(doc, skip) {
  const out = []
  const seen = new Set(skip)
  const fields = doc.querySelectorAll('input[aria-required="true"], select[aria-required="true"], textarea[aria-required="true"], input[required][id], select[required][id], textarea[required][id]')
  for (const el of fields) {
    if (el.type === 'hidden' || el.type === 'file' || !el.id || seen.has(el.id)) continue
    if (el.type === 'checkbox' || el.type === 'radio') continue
    seen.add(el.id)
    if (ghIsEmpty(doc, el)) out.push({ id: el.id, question: ghLabelFor(doc, el) })
  }
  for (const fs of doc.querySelectorAll('fieldset[aria-required="true"]')) {
    const boxes = [...fs.querySelectorAll('input[type="checkbox"], input[type="radio"]')]
    const name = boxes[0]?.name
    if (!name || seen.has(name) || seen.has(ghDomId(name))) continue
    seen.add(name)
    if (!boxes.some(b => b.checked)) {
      out.push({ id: name, question: ghClean(fs.querySelector('legend')?.textContent).replace(/\s*\*$/, '') })
    }
  }
  // A required résumé that isn't attached: the file's name shows once it is
  // (not just the input gone — that's also the case while it's uploading).
  const resumeGroup = ghUploadGroup(doc, 'resume')
  const attached = resumeGroup ? !!resumeGroup.querySelector('.file-upload__filename') : !doc.getElementById('resume')
  const resumeLabel = doc.getElementById('upload-label-resume')
  if (!attached && !seen.has('resume') && /\*\s*$/.test(ghClean(resumeLabel?.textContent))) {
    out.push({ id: 'resume', question: 'Resume/CV' })
  }
  return out
}

// ── Putting answers in ─────────────────────────────────────────────────────

function ghSleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

async function ghWaitFor(fn, timeoutMs = 3000, stepMs = 100) {
  const end = Date.now() + timeoutMs
  for (;;) {
    const v = fn()
    if (v) return v
    if (Date.now() >= end) return null
    await ghSleep(stepMs)
  }
}

// Text put in the way a paste is: the element's own value setter (React
// tracks the last value it set), then input; on leaving the field, change and
// a real blur — React 17+ listens for focusout, which a dispatched "blur"
// event never was. `leave: false` stays in the field (typing to filter a
// react-select's menu, which leaving would close).
function ghSetText(el, value, { leave = true } = {}) {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
  el.focus()
  setter.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  if (leave) {
    el.dispatchEvent(new Event('change', { bubbles: true }))
    el.blur()
  }
  // The phone field formats the number as it's typed ("07400 123456").
  if (el.type === 'tel') return el.value.replace(/\D/g, '') === String(value).replace(/\D/g, '')
  return ghClean(el.value) === ghClean(value)
}

function ghBytes(base64) {
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

// A file field's group: <div role="group" class="file-upload"
// aria-labelledby="upload-label-<id>">, which stays while its contents change.
function ghUploadGroup(doc, inputId) {
  return doc.getElementById(`upload-label-${inputId}`)?.closest('.file-upload') || null
}

// Greenhouse takes an attached file in three steps (seen on job-boards,
// 2026-10-12): the input is replaced by a progress bar while the file is
// uploaded to its storage, then by .file-upload__filename with the file's name.
// Only that last step means the form has the file — Submit during the upload
// fails with "Resume/CV is required." A failed upload stays on the bar.
function ghUploadDone(doc, inputId, filename) {
  const group = ghUploadGroup(doc, inputId)
  if (!group || group.querySelector('[role="progressbar"]')) return false
  const shown = group.querySelector('.file-upload__filename')
  return !!shown && ghClean(shown.textContent).includes(ghClean(filename))
}

// Any file still uploading anywhere on the form.
function ghUploading(doc) {
  return !!doc.querySelector('.file-upload [role="progressbar"]')
}

// Attaches a file to Greenhouse's file input and waits until the form shows it
// as uploaded.
async function ghSetFile(doc, inputId, file, timeoutMs = GH_UPLOAD_WAIT_MS) {
  const input = doc.getElementById(inputId)
  if (!input) return false
  const started = Date.now()
  const dt = new DataTransfer()
  dt.items.add(file)
  input.files = dt.files
  // A file picked in the browser's dialog fires input, then change.
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
  const done = !!(await ghWaitFor(() => ghUploadDone(doc, inputId, file.name), timeoutMs, 200))
  console.log(`JobAgent [greenhouse] upload ${inputId}: ${done ? 'done' : 'not finished'} after ${Date.now() - started} ms`)
  return done
}

// The errors Greenhouse shows on the form: <p id="<field>-error"
// class="helper-text helper-text--error">Resume/CV is required.</p> under a
// field, plus fields marked aria-invalid without such a line. The résumé's
// error has no aria-invalid anywhere, so both are needed.
function ghFormErrors(doc) {
  const out = []
  const withText = new Set()
  for (const el of doc.querySelectorAll('.helper-text--error')) {
    const text = ghClean(el.textContent)
    if (!text) continue
    out.push(text)
    if (el.id) withText.add(el.id.replace(/-error$/, ''))
  }
  for (const el of doc.querySelectorAll('[aria-invalid="true"]')) {
    if (el.id && withText.has(el.id)) continue
    const label = ghLabelFor(doc, el)
    if (label) out.push(label)
  }
  return [...new Set(out)]
}

// What the page shows, for the console when an outcome isn't recognised.
function ghDescribePage(doc) {
  const texts = sel => [...doc.querySelectorAll(sel)].map(e => ghClean(e.textContent)).filter(Boolean).slice(0, 8)
  return {
    url: location.href,
    title: doc.title,
    headings: texts('h1, h2, h3'),
    alerts: texts('[role="alert"], [aria-live]'),
    errors: ghFormErrors(doc),
    uploading: ghUploading(doc),
    formStillThere: !!ghSubmitButton(doc),
    securityCode: ghLooksBlocked(doc),
  }
}

function ghPress(el, key) {
  for (const type of ['keydown', 'keyup']) {
    el.dispatchEvent(new KeyboardEvent(type, { key, code: key, bubbles: true, cancelable: true }))
  }
}

function ghClick(el) {
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
    const Ctor = type.startsWith('pointer') && typeof PointerEvent !== 'undefined' ? PointerEvent : MouseEvent
    el.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, view: el.ownerDocument.defaultView }))
  }
}

function ghListbox(doc, input) {
  return doc.getElementById(input.getAttribute('aria-controls') || `react-select-${input.id}-listbox`)
}

function ghMenuOptions(doc, input) {
  const lb = ghListbox(doc, input)
  return lb ? [...lb.querySelectorAll('[role="option"]')] : []
}

async function ghOpenMenu(doc, input) {
  input.focus()
  ghPress(input, 'ArrowDown')
  return ghWaitFor(() => ghMenuOptions(doc, input).length > 0, 3000)
}

function ghCloseMenu(input) {
  ghPress(input, 'Escape')
  input.blur()
}

// All the options a react-select offers (opens and closes its menu).
async function ghReadOptions(doc, input) {
  const opened = await ghOpenMenu(doc, input)
  const texts = opened ? ghMenuOptions(doc, input).map(o => ghClean(o.textContent)) : []
  ghCloseMenu(input)
  return texts
}

// Chooses `wanted` in a react-select, only if it's exactly one of its
// options. Typing narrows a long list (countries) to it first.
async function ghChooseOption(doc, input, wanted, pick = ghExactOption) {
  await ghOpenMenu(doc, input)
  let options = ghMenuOptions(doc, input)
  let idx = pick(options.map(o => o.textContent), wanted)
  if (idx === -1) {
    ghSetText(input, wanted, { leave: false })
    await ghWaitFor(() => pick(ghMenuOptions(doc, input).map(o => o.textContent), wanted) !== -1, 4000)
    options = ghMenuOptions(doc, input)
    idx = pick(options.map(o => o.textContent), wanted)
  }
  if (idx === -1) {
    ghCloseMenu(input)
    return false
  }
  const label = ghClean(options[idx].textContent)
  ghClick(options[idx])
  let ok = await ghWaitFor(() => ghChosen(input).some(t => ghNorm(t) === ghNorm(label)), 2000)
  if (!ok && ghChosen(input).length) {
    // Some pickers show less than the option (the phone country shows "+44"
    // for "United Kingdom +44"): ask the menu which option is selected.
    await ghOpenMenu(doc, input)
    ok = ghMenuOptions(doc, input).some(o => o.getAttribute('aria-selected') === 'true' && ghNorm(o.textContent) === ghNorm(label))
    ghCloseMenu(input)
  }
  input.blur()
  return !!ok
}

// Ticks exactly these checkboxes of a group (by their label text).
function ghTickBoxes(doc, name, labels) {
  const boxes = [...doc.getElementsByName(name)].filter(b => b.type === 'checkbox')
  if (!boxes.length) return false
  const wanted = labels.map(ghNorm)
  const targets = boxes.filter(b => wanted.includes(ghNorm(ghLabelFor(doc, b))))
  if (targets.length !== new Set(wanted).size) return false
  for (const b of targets) if (!b.checked) b.click()
  return targets.every(b => b.checked)
}

function ghLooksBlocked(doc) {
  return !!doc.querySelector('#security-input-0')
}

// What a filled field holds now, read fresh from the page (React may have
// replaced the element since): a file field's shown name, a checkbox group's
// ticked boxes, a react-select's chosen chips, a <select>'s option, a text
// field's text (a phone number's digits — the field formats it).
function ghReadField(doc, domId, name) {
  const group = ghUploadGroup(doc, domId)
  if (group) {
    if (group.querySelector('[role="progressbar"]')) return ''
    return ghClean(group.querySelector('.file-upload__filename')?.textContent)
  }
  const boxes = name ? [...doc.getElementsByName(name)].filter(b => b.type === 'checkbox') : []
  if (boxes.length) return boxes.filter(b => b.checked).map(b => b.id).join('|')
  const el = doc.getElementById(domId)
  if (!el) return ''
  if (ghIsCombobox(el)) return ghChosen(el).join('|')
  if (el.tagName === 'SELECT') return ghClean(el.options[el.selectedIndex]?.textContent)
  if (el.type === 'tel') return el.value.replace(/\D/g, '')
  return ghClean(el.value)
}

// The filled fields that no longer hold what was put in (labels). Checked
// just before Submit: each field is checked as it's set, but the page can
// change one afterwards — a re-render after a later choice, React taking
// over server-rendered fields, a field reformatting itself.
function ghChangedFields(doc, checks) {
  return (checks || []).filter(c => ghReadField(doc, c.domId, c.name) !== c.value).map(c => c.label)
}

// Fills the form. Returns:
//   filled    the fields it set;
//   missing   questions the user hasn't answered — the server's list. Saving
//             an answer on the Applications page answers these next time;
//   userFill  required fields the user has to fill in on the form itself: the
//             phone country or city when they can't be placed, and required
//             fields the board API doesn't list (School, Degree). A saved
//             answer wouldn't be used for these, so they aren't offered;
//   failed    fields it had an answer for but couldn't set;
//   checks    what each filled field held once set, for ghChangedFields.
//   data: { questions, answers, missing, cv: {base64, filename, mimeType} }
//   resolvePhoneCountry(question) → the phone_country answer or null
async function ghFill(doc, data, resolvePhoneCountry) {
  const byId = new Map((data.questions || []).map(q => [q.id, q]))
  const filled = []
  const failed = []
  const userFill = []
  const checks = []
  const remember = (domId, label, name) => checks.push({ domId, label, name, value: ghReadField(doc, domId, name) })
  const missingAll = (data.missing || []).map(m => ({
    id: m.id,
    question: m.label || byId.get(m.id)?.label || m.id,
    options: byId.get(m.id)?.options || [],
    // The server says whether an answer saved for it would be used
    // (saved_answer_used); one that wouldn't (a field from Profile, a file)
    // isn't offered as a question to answer — the user fills it in here.
    saveable: m.saveable !== false,
  }))
  const missing = missingAll.filter(m => m.saveable).map(({ saveable: _s, ...m }) => m)
  for (const m of missingAll) if (!m.saveable) userFill.push(m.question)
  const handled = new Set(missingAll.flatMap(m => [m.id, ghDomId(m.id)]))
  const answers = data.answers || []
  const phoneAnswer = answers.find(a => byId.get(a.id)?.role === 'phone')

  // Phone country first: the number is typed after it, in national format.
  let phoneValue = phoneAnswer?.value
  const country = doc.getElementById('country')
  if (country && ghIsCombobox(country) && phoneAnswer) {
    const required = country.getAttribute('aria-required') === 'true'
    const options = await ghReadOptions(doc, country)
    const answer = options.length ? await resolvePhoneCountry({
      id: 'country', label: 'Phone country', kind: 'phone_country', required, options,
    }) : null
    if (answer?.option && await ghChooseOption(doc, country, answer.option)) {
      filled.push('country')
      remember('country', 'Phone country')
      if (answer.value) phoneValue = answer.value
    } else if (answer?.option) {
      failed.push('Phone country')
    } else if (required) {
      userFill.push('Phone country')
    }
    handled.add('country')
  }

  for (const a of answers) {
    const q = byId.get(a.id) || { id: a.id, label: a.id }
    const domId = ghDomId(a.id)
    handled.add(domId)
    handled.add(a.id)
    const label = q.label || a.id
    let ok = false
    try {
      if (q.role === 'resume' || a.source === 'resume') {
        const cv = data.cv
        ok = !!cv && await ghSetFile(doc, 'resume', new File([ghBytes(cv.base64)], cv.filename, { type: cv.mimeType }))
      } else if (q.role === 'cover_letter') {
        // The letter is attached as a text file, like an upload.
        ok = await ghSetFile(doc, 'cover_letter', new File([a.value || ''], 'Cover_Letter.txt', { type: 'text/plain' }))
      } else if (q.kind === 'location') {
        const input = doc.getElementById(domId)
        ok = !!input && await ghChooseOption(doc, input, a.value, ghLocationOption)
        if (!ok && input) {
          ghSetText(input, '')
          // Several places of that name, or none: the user's to pick. Not a
          // filler failure — but it stops the application if it's required.
          if (q.required || input.getAttribute('aria-required') === 'true') userFill.push(label)
          continue
        }
      } else if (a.options && a.options.length) {
        const input = doc.getElementById(domId)
        if (doc.getElementsByName(a.id).length) ok = ghTickBoxes(doc, a.id, a.options)
        else if (ghIsCombobox(input)) {
          ok = true
          for (const o of a.options) ok = ok && await ghChooseOption(doc, input, o)
        }
      } else if (a.option != null) {
        const input = doc.getElementById(domId)
        if (ghIsCombobox(input)) ok = await ghChooseOption(doc, input, a.option)
        else if (input && input.tagName === 'SELECT') {
          const idx = ghExactOption([...input.options].map(o => o.textContent), a.option)
          if (idx !== -1) {
            input.selectedIndex = idx
            input.dispatchEvent(new Event('input', { bubbles: true }))
            input.dispatchEvent(new Event('change', { bubbles: true }))
            ok = true
          }
        } else if (doc.getElementsByName(a.id).length) ok = ghTickBoxes(doc, a.id, [a.option])
      } else if (a.value != null) {
        const input = doc.getElementById(domId)
        const value = q.role === 'phone' ? phoneValue : a.value
        ok = !!input && !ghIsCombobox(input) && ghSetText(input, value)
      }
    } catch (e) {
      console.warn('JobAgent [greenhouse] could not fill', label, e)
      ok = false
    }
    if (ok) {
      filled.push(domId)
      remember(domId, label, a.id)
    } else if ((q.role === 'resume' || a.source === 'resume') && !data.cv) {
      failed.push(`${label} (JobAgent couldn't provide the CV file${data.cvStatus ? `, ${data.cvStatus}` : ''})`)
    } else failed.push(label)
  }

  for (const extra of ghRequiredEmpty(doc, handled)) userFill.push(extra.question)
  return { filled, missing, userFill, failed, checks }
}

function ghSubmitButton(doc) {
  return [...doc.querySelectorAll('button[type="submit"], input[type="submit"]')]
    .find(b => ghNorm(b.textContent || b.value) === 'submit application') || null
}

// ── Talking to background.js ───────────────────────────────────────────────

function ghSend(message) {
  return new Promise(resolve => {
    try {
      chrome.runtime.sendMessage(message, r => resolve(chrome.runtime.lastError ? null : r))
    } catch {
      resolve(null)
    }
  })
}

function ghBanner(doc, text) {
  let el = doc.getElementById('jobagent-greenhouse-banner')
  if (!el) {
    el = doc.createElement('div')
    el.id = 'jobagent-greenhouse-banner'
    el.style.cssText = 'position:fixed;left:16px;right:16px;bottom:16px;z-index:2147483647;padding:14px 16px;' +
      'border-radius:10px;background:#1B3A5C;color:#fff;font:14px/1.45 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.25);white-space:pre-line'
    doc.body.appendChild(el)
  }
  el.textContent = `JobAgent: ${text}`
}

// `detail` says why, for the application's record on JobAgent (field labels,
// Greenhouse's error lines, what the page showed): a short line, no answers.
async function ghReport(status, reason, extra = {}) {
  const detail = extra.detail == null ? undefined : String(extra.detail).slice(0, 500)
  await ghSend({ type: 'ATS_RESULT', status, reason, ...extra, detail })
}

const ghList = items => items.filter(Boolean).slice(0, 8).join('; ')

// What the page showed when an outcome wasn't recognised, as one line.
function ghPageSummary(doc) {
  const p = ghDescribePage(doc)
  let path = p.url
  try { const u = new URL(p.url); path = u.host + u.pathname } catch {}
  return [
    `page ${path}`,
    p.headings.length ? `headings: ${ghList(p.headings.slice(0, 3))}` : '',
    p.alerts.length ? `alerts: ${ghList(p.alerts.slice(0, 3))}` : '',
    p.formStillThere ? 'form still showing' : 'form gone',
    p.securityCode ? 'security code step' : '',
    p.uploading ? 'upload in progress' : '',
  ].filter(Boolean).join(' | ')
}

async function ghWatchForConfirmation(doc, until, before) {
  for (;;) {
    if (ghIsConfirmation(location.href, doc.body.innerText || doc.body.textContent, before)) return 'confirmed'
    if (ghLooksBlocked(doc)) return 'code'
    // Greenhouse refused the form (its own validation, shown under the fields).
    // Nothing was sent.
    if (ghFormErrors(doc).length) return 'rejected'
    if (Date.now() >= until) return 'timeout'
    await ghSleep(500)
  }
}

async function ghAfterSubmit(doc, state) {
  const watchUntil = state.phase === 'awaiting_code'
    ? (state.codeAt || Date.now()) + GH_CODE_WATCH_MS
    : (state.submittedAt || Date.now()) + GH_SUBMIT_WATCH_MS
  for (;;) {
    const outcome = await ghWatchForConfirmation(doc, watchUntil, state.textBefore || '')
    if (outcome === 'confirmed') {
      ghBanner(doc, 'your application was submitted.')
      await ghReport('applied', 'confirmed')
      return
    }
    if (outcome === 'code' && state.phase !== 'awaiting_code') {
      ghBanner(doc, 'Greenhouse emailed you a security code. Enter it here and press Submit — JobAgent will notice when it goes through.')
      await ghSend({ type: 'ATS_AWAITING_CODE' })
      state = { ...state, phase: 'awaiting_code', codeAt: Date.now() }
      return ghAfterSubmit(doc, state)
    }
    if (outcome === 'code') {
      // Still waiting for the user to type the code.
      if (Date.now() < watchUntil) { await ghSleep(1000); continue }
    }
    if (outcome === 'rejected') await ghSleep(300) // let every field's error render
    const errors = ghFormErrors(doc)
    console.log(`JobAgent [greenhouse] after Submit: ${outcome}`, ghDescribePage(doc))
    ghBanner(doc, errors.length
      ? `Greenhouse didn't accept the form, so it wasn't sent:\n${errors.slice(0, 5).map(e => `• ${e}`).join('\n')}\nFix it here and press Submit application.`
      : "Submit was clicked but Greenhouse didn't confirm it. Check this tab: it may have gone in.")
    await ghReport('manual', errors.length ? 'form_error' : 'submit_unconfirmed', {
      detail: errors.length ? ghList(errors) : `${outcome}: ${ghPageSummary(doc)}`,
    })
    return
  }
}

async function ghRun() {
  const state = await ghSend({ type: 'ATS_GET_STATE' })
  if (!state || !state.applicationId) return // not a tab JobAgent opened

  const doc = document
  if (state.phase === 'submitted' || state.phase === 'awaiting_code') return ghAfterSubmit(doc, state)
  if (state.phase !== 'filling') return

  if (ghLooksBlocked(doc)) {
    ghBanner(doc, 'Greenhouse wants a security code before showing the form. Finish this application yourself.')
    return ghReport('manual', 'captcha_detected', { detail: 'security code before the form' })
  }
  const form = await ghWaitFor(() => doc.getElementById('first_name') && ghSubmitButton(doc), 20000, 250)
  if (!form) {
    ghBanner(doc, "this page doesn't have the application form JobAgent expected. Nothing was submitted.")
    return ghReport('manual', 'form_not_found', { detail: ghPageSummary(doc) })
  }

  ghBanner(doc, 'filling in your application…')
  const data = await ghSend({ type: 'ATS_GET_DATA' })
  if (!data || !data.ok) {
    ghBanner(doc, "couldn't load your answers, so nothing was submitted. Finish this application yourself.")
    return ghReport('manual', data?.reason || 'data_unavailable', { detail: data?.detail || null })
  }

  const result = await ghFill(doc, data, async question => {
    const r = await ghSend({ type: 'ATS_RESOLVE', questions: [question] })
    return r?.answers?.find(a => a.id === question.id) || null
  })
  console.log('JobAgent [greenhouse] filled', result.filled, 'missing', result.missing,
    'for the user', result.userFill, 'failed', result.failed)

  if (result.missing.length || result.userFill.length) {
    const names = [...result.missing.map(m => m.question), ...result.userFill].map(n => `• ${n}`).join('\n')
    ghBanner(doc, `stopped before submitting — these need you:\n${names}\nFill them in here and press Submit application.` +
      (result.missing.length ? ' Answers you save on your Applications page are used next time.' : ''))
    return ghReport('manual', result.missing.length ? 'missing_answers' : 'needs_user', {
      missingQuestions: result.missing.map(m => ({ question: m.question, options: m.options || [] })),
      detail: ghList([...result.missing.map(m => m.question), ...result.userFill]),
    })
  }
  if (result.failed.length) {
    ghBanner(doc, `stopped before submitting: couldn't fill ${result.failed.slice(0, 3).join(', ')}. Check the form and submit it yourself.`)
    return ghReport('manual', 'fill_failed', { detail: ghList(result.failed) })
  }

  // Each file was waited for as it was attached; this covers anything still
  // uploading, and an error Greenhouse is already showing (a field it
  // validated on blur). Submit now would only be refused.
  if (!(await ghWaitFor(() => !ghUploading(doc), GH_UPLOAD_WAIT_MS, 250))) {
    console.log('JobAgent [greenhouse] upload never finished', ghDescribePage(doc))
    ghBanner(doc, "stopped before submitting: an attached file didn't finish uploading. Attach it again here and press Submit application.")
    return ghReport('manual', 'upload_unfinished', { detail: ghPageSummary(doc) })
  }
  const shownErrors = ghFormErrors(doc)
  if (shownErrors.length) {
    console.log('JobAgent [greenhouse] form shows errors before Submit', ghDescribePage(doc))
    ghBanner(doc, `stopped before submitting — Greenhouse shows these on the form:\n${shownErrors.slice(0, 5).map(e => `• ${e}`).join('\n')}\nFix them here and press Submit application.`)
    return ghReport('manual', 'form_shows_errors', { detail: ghList(shownErrors) })
  }
  // Every field still holds what was put in.
  const changed = ghChangedFields(doc, result.checks)
  if (changed.length) {
    console.log('JobAgent [greenhouse] fields changed after filling', changed, ghDescribePage(doc))
    ghBanner(doc, `stopped before submitting — the form changed after JobAgent filled it:\n${changed.slice(0, 5).map(c => `• ${c}`).join('\n')}\nCheck them here and press Submit application.`)
    return ghReport('manual', 'fill_changed', { detail: ghList(changed) })
  }

  const submit = ghSubmitButton(doc)
  if (GH_DRY_RUN) {
    ghBanner(doc, 'dry run: everything is filled in. Submit was not clicked.')
    return ghReport('manual', 'dry_run')
  }
  const textBefore = doc.body.innerText || doc.body.textContent || ''
  await ghSend({ type: 'ATS_SUBMITTING', textBefore: textBefore.slice(0, 20000) })
  ghBanner(doc, 'submitting…')
  submit.click()
  return ghAfterSubmit(doc, { ...state, phase: 'submitted', submittedAt: Date.now(), textBefore })
}

if (typeof module !== 'undefined') {
  module.exports = {
    GH_DRY_RUN, ghDomId, ghExactOption, ghLocationOption, ghIsConfirmation, ghRequiredEmpty, ghFill,
    ghSetText, ghTickBoxes, ghSubmitButton, ghChosen, ghSetFile, ghUploadDone, ghFormErrors,
    ghChangedFields, ghReadField,
  }
} else if (!window.__jobagentGreenhouse) {
  window.__jobagentGreenhouse = true
  ghRun().catch(e => {
    console.error('JobAgent [greenhouse]', e)
    ghReport('manual', 'script_error', { detail: String(e && e.message || e) })
  })
}
