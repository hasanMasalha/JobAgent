# JobAgent Chrome Extension — Privacy Policy

**Version 1.6.1 — Last updated: 13 October 2026**

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
| The address of the JobAgent site you signed in on | Send its requests there |
| The LinkedIn applications you queued, how far through them it is and the LinkedIn tab it opened | Fill them one at a time |
| A Greenhouse application in progress: its ID, the tab, how far it got and, after Submit, the form page's text from just before | Tell Greenhouse's confirmation from text already on the page; deleted when it finishes |

`chrome.storage.session` (memory only) holds a marker that Easy Apply was
clicked in a tab, and when — nothing about you or the job — for the
extension's own error logs. The popup reads LinkedIn's `li_at` cookie on your
device to show whether you're signed in to LinkedIn; it is never sent anywhere.

## Read on the page

To fill a form it reads that form: field labels and options, which are
required, the errors it shows and the page's headings — on your device, on
LinkedIn job pages and in the Greenhouse tab it opened. For Greenhouse it also
checks that tab's address (form or confirmation?), and no other tab's. Only
what's listed below leaves your device.

## Sent to jobagent.uk

- Answers you give in its box over an Easy Apply form to questions it doesn't recognise (question and answer), saved to your account — only with "Remember this answer for future applications" ticked, which it is to start with.
- The outcome of an application and its ID; when it stopped, why: a short reason and, for Greenhouse, the names of the fields involved, the error messages the form showed, or the address and headings of the page it was on (not your answers); when it stopped at questions you haven't answered, those questions and their options.
- The list of countries a Greenhouse form's phone picker offers, so JobAgent can pick your phone number's country from it.
- The extension's version number and your JobAgent sign-in token, with every request.

## Received from jobagent.uk, for one application at a time

- Your account email, Profile → Application details (the city is the one you typed in Profile; the extension doesn't use your device's location), your CV's skills and your saved answers.
- For Greenhouse: the form's questions with JobAgent's answer to each, your CV file (tailored for the job, or the file you uploaded) and the cover letter, which it attaches to the employer's form.

Nothing received is kept after the application. It answers only with what
you have given; if a form requires something you haven't, it stops without
submitting.

## Permissions

- linkedin.com and jobagent.uk: fill Easy Apply forms; pick up your sign-in.
- greenhouse.io (optional): asked the first time you apply to a Greenhouse job, used only in the tab opened for that application.
- Scripting: runs the extension's own Greenhouse script in the tab it opened, once greenhouse.io access is allowed.
- Cookies, storage, notifications: as above.

## What it does not do

It doesn't read your browsing history or other pages, doesn't use analytics,
and doesn't sell or share your data. Apart from the applications you submit to
employers through LinkedIn or Greenhouse, it sends data only to jobagent.uk.

## Contact

support@jobagent.uk
