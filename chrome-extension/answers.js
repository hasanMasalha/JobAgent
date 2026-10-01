// Answers for Easy Apply questions. Loaded before content.js (see manifest).
//
// One rule: a question is answered only with something the user gave us —
// a Profile field they saved, or an answer they typed for that exact question
// before. Everything here returns null when there is no such answer, and the
// caller then leaves the question blank and stops. Nothing is guessed: this
// file used to answer "2" years, salary "1", "Tel Aviv", "Israel", a
// Bachelor's degree, Yes to any yes/no question it didn't recognise and the
// first option of any dropdown, on real applications.
//
// A Profile field is also only used for the question it was asked as. Profile
// asks "Authorized to work in Israel?" and "Expected salary (monthly, NIS)",
// so those answer an Israel work-authorisation question and a monthly / NIS
// salary question — not "authorized to work in the US" or an annual USD one.

function jaText(v) {
  return v === null || v === undefined ? '' : String(v).trim()
}

function jaNormalize(label) {
  return (label || '').toLowerCase().trim()
}

function jaHasAny(l, words) {
  return words.some(w => l.includes(w))
}

// The user's saved answer for this exact question, or null.
function jaSavedAnswer(label, application) {
  const saved = application && application.savedAnswers
  if (!saved) return null
  const answer = jaText(saved[jaNormalize(label)])
  return answer || null
}

// Text, number, URL, email and dropdown questions.
//   string — the user's answer
//   ''     — a field we recognise and deliberately leave empty (no prompt)
//   null   — no answer from the user; the caller checks saved answers, may
//            ask, and otherwise leaves it blank
function jaAnswerForLabel(label, application) {
  if (!label) return null
  const l = jaNormalize(label)
  const a = application || {}
  const or = v => jaText(v) || null

  // ── Personal ──────────────────────────────────
  if (l.includes('first name')) return or(a.first_name)
  if (jaHasAny(l, ['last name', 'family name', 'surname'])) return or(a.last_name)
  if (l.includes('full name') || l === 'name') {
    return jaText(a.first_name) && jaText(a.last_name) ? `${jaText(a.first_name)} ${jaText(a.last_name)}` : null
  }
  if (jaHasAny(l, ['phone', 'mobile', 'telephone'])) return or(a.phone)
  if (l.includes('email')) return or(a.email)
  if (jaHasAny(l, ['zip', 'postal'])) return ''
  if (/\bcity\b/.test(l) || l === 'location' || l.includes('current location')) return or(a.city)

  // ── URLs (usually optional: left empty rather than asked for) ──
  if (l.includes('linkedin')) return jaText(a.linkedin_url)
  if (l.includes('github')) return jaText(a.github_url)
  if (jaHasAny(l, ['portfolio', 'website', 'personal site'])) return jaText(a.portfolio_url)

  // ── Salary: Profile stores a monthly figure in NIS ──
  if (jaHasAny(l, ['salary', 'compensation', 'wage', 'ctc', 'שכר'])) {
    const monthlyNis = jaHasAny(l, ['month', 'nis', 'ils', '₪', 'שכר', 'חודשי'])
    const otherBasis = jaHasAny(l, ['annual', 'year', 'hour', 'usd', '$', 'eur', '€', 'gbp', '£'])
    return monthlyNis && !otherBasis ? or(a.expected_salary) : null
  }

  // ── Notice period (Profile stores days) ──
  if (jaHasAny(l, ['notice period', 'הודעה מוקדמת'])) return or(a.notice_period)

  // ── Total experience only. "Years of experience with React" is a different
  //    question: the total is not the answer to it. ──
  if (
    jaHasAny(l, [
      'years of work experience', 'years of professional experience', 'total years of experience',
      'total experience', 'overall experience', 'שנות ניסיון',
    ]) &&
    !/\b(with|in|using)\b/.test(l.replace(/years? of (work|professional) experience/, ''))
  ) {
    return or(a.years_of_experience)
  }

  // ── Education ─────────────────────────────────
  if (jaHasAny(l, ['highest level of education', 'highest education', 'level of education', 'השכלה'])) {
    return or(a.highest_education)
  }

  // ── Cover letter: JobAgent doesn't send one on LinkedIn ──
  if (jaHasAny(l, ['cover letter', 'מכתב מוטיבציה'])) return ''

  return null
}

// Yes/no questions. true / false from the user's Profile, or null.
function jaBooleanAnswer(label, application) {
  if (!label) return null
  const l = jaNormalize(label)
  const a = application || {}
  const bool = v => (v === true || v === false ? v : null)

  // "Do you require sponsorship?" — Yes means they need it.
  if (jaHasAny(l, ['sponsor', 'ויזה', 'חסות']) || (l.includes('visa') && !l.includes('authoriz'))) {
    return bool(a.requires_sponsorship)
  }

  // Profile asks about Israel only.
  if (
    jaHasAny(l, ['authorized', 'authorised', 'authorization', 'eligible to work', 'right to work', 'legally', 'work permit', 'מורשה', 'רשאי']) &&
    jaHasAny(l, ['israel', 'ישראל'])
  ) {
    return bool(a.work_authorized)
  }

  if (jaHasAny(l, ['relocat', 'willing to move', 'מעבר דירה'])) return bool(a.willing_to_relocate)

  return null
}

// Which of a question's options is the user's answer? Index, or -1.
// `options` are the visible option texts.
function jaMatchOption(options, answer) {
  const want = jaNormalize(answer)
  if (!want) return -1
  const texts = options.map(jaNormalize)
  const exact = texts.indexOf(want)
  if (exact !== -1) return exact
  const partial = texts.map((t, i) => (t && (t.includes(want) || want.includes(t)) ? i : -1)).filter(i => i !== -1)
  // Ambiguous ("no" also matches "not sure") → no answer.
  return partial.length === 1 ? partial[0] : -1
}

// Index of the Yes or No option, or -1 when the options aren't a yes/no pair.
function jaYesNoOption(options, wantYes) {
  const yes = ['yes', 'כן']
  const no = ['no', 'לא']
  const texts = options.map(jaNormalize)
  const idx = words => texts.findIndex(t => words.includes(t))
  const yesIdx = idx(yes)
  const noIdx = idx(no)
  if (yesIdx === -1 || noIdx === -1) return -1
  return wantYes ? yesIdx : noIdx
}

if (typeof module !== 'undefined') {
  module.exports = { jaAnswerForLabel, jaBooleanAnswer, jaSavedAnswer, jaMatchOption, jaYesNoOption }
}
