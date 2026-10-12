# JobAgent Chrome Extension — Privacy Policy

**Version 1.6.0 — Last updated: 12 October 2026**

The published policy is https://jobagent.uk/privacy (`app/privacy/page.tsx`);
this file is a summary of it and must say the same thing.

## What the extension does

It fills in and submits LinkedIn Easy Apply forms and Greenhouse application
forms for applications you start in JobAgent.

## Stored on your device (`chrome.storage.local`)

| Data | Purpose |
|---|---|
| A JobAgent sign-in token (expires after 14 days) | Make requests for your account |
| Your JobAgent user ID and email | Show your account in the popup |
| The LinkedIn applications you queued and how far through them it is | Fill them one at a time |
| A Greenhouse application in progress: its ID, the tab, how far it got and, after Submit, the form page's text from just before | Tell Greenhouse's confirmation from text already on the page; deleted when it finishes |

`chrome.storage.session` (memory only) holds a marker that Easy Apply was
clicked in a tab, and when — nothing about you or the job — for the
extension's own error logs. The popup reads LinkedIn's `li_at` cookie on your
device to show whether you're signed in to LinkedIn; it is never sent anywhere.

## Sent to jobagent.uk

- Answers you give to questions it doesn't recognise (question and answer), saved to your account.
- The outcome of an application and its ID; when it stopped, why: a short reason and, for Greenhouse, the names of the fields involved, the error messages the form showed, or the address and headings of the page it was on (not your answers); when it stopped at questions you haven't answered, those questions and their options.
- The list of countries a Greenhouse form's phone picker offers, so JobAgent can pick your phone number's country from it.
- The extension's version number, with every request.

## Received from jobagent.uk, for one application at a time

- Your account email, Profile → Application details, your CV's skills and your saved answers.
- For Greenhouse: the form's questions with JobAgent's answer to each, your CV file (tailored for the job, or the file you uploaded) and the cover letter, which it attaches to the employer's form.

Nothing received is kept after the application. It answers only with what
you have given; if a form requires something you haven't, it stops without
submitting.

## Permissions

- linkedin.com and jobagent.uk: fill Easy Apply forms; pick up your sign-in.
- greenhouse.io (optional): asked the first time you apply to a Greenhouse job, used only in the tab opened for that application.
- Cookies, storage, notifications, active tab and scripting: as above.

## What it does not do

It doesn't read your browsing history or other pages, doesn't use analytics,
and doesn't sell or share your data. Apart from the applications you submit to
employers through LinkedIn or Greenhouse, it sends data only to jobagent.uk.

## Contact

support@jobagent.uk
