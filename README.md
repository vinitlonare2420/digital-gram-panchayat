# Digital Gram Panchayat — Citizen Service Portal

## Project objective

A citizen service portal for Gram Panchayat administrative services. Citizens will be able to register, apply for certificates (Birth, Death, Income, Caste), upload supporting documents, track applications, respond to correction requests, and download approved certificates. Panchayat staff will be able to review, verify, request corrections on, approve, reject, and issue certificates for submitted applications.

This repository currently contains **Phase 1: the frontend foundation only**. No backend is connected yet.

## Technology used

- HTML5
- Tailwind CSS (via CDN — no build step required)
- Vanilla JavaScript (ES6+)
- Google Fonts: Inter (body), Poppins (headings)

No frameworks, bundlers, or backend technology (Firebase, Node.js, databases) have been introduced in this phase.

## Current phase

**Phase 1 — Frontend foundation.**

- All public, citizen, and staff pages exist as static HTML with Tailwind styling.
- All forms have complete client-side validation.
- Document upload fields validate file type and size in the browser only — nothing is uploaded anywhere yet.
- Application tracking, login, registration, and staff review actions are all wired to the UI (toasts, modals, inline errors) but intentionally **do not** simulate a backend. Every backend-dependent action shows an honest "not yet connected" message instead of fake data or fake success.
- No application data, certificates, or accounts are hardcoded anywhere in the codebase.

## Folder structure

```
digital-gram-panchayat/
│
├── index.html                     Homepage
├── services.html                  Certificate services listing
├── track.html                     Application tracking
├── about.html
├── contact.html
├── login.html                     Citizen login
├── register.html                  Citizen registration
│
├── services/
│   ├── birth.html                 Birth Certificate application form
│   ├── death.html                 Death Certificate application form
│   ├── income.html                Income Certificate application form
│   └── caste.html                 Caste Certificate application form
│
├── citizen/
│   ├── dashboard.html
│   ├── applications.html
│   ├── application-details.html
│   └── profile.html
│
├── staff/
│   ├── login.html                 Staff login (separate from citizen login)
│   ├── dashboard.html
│   ├── applications.html
│   └── application-details.html   Includes correction / approve / reject / upload-certificate UI
│
├── css/
│   └── style.css                  Design tokens (colors, type) + small components Tailwind can't express
│
├── js/
│   ├── utils.js                   Generic helpers (formatting, status metadata, query params)
│   ├── validation.js              Reusable validators + inline error rendering
│   ├── components.js              Navbar, footer, mobile menu, toasts, modals, dashboard shell, file upload widget
│   └── app.js                     Breadcrumbs, empty-state rendering
│
├── components/                    Reserved for future extraction if the component library grows
├── assets/
│   ├── images/
│   └── icons/
│
├── package.json
└── README.md
```

## How to run the frontend

No build step is required. Any static file server works:

```bash
# Option 1 — Python (already on most systems)
python3 -m http.server 5500

# Option 2 — Node (via npm scripts in this repo)
npm start
```

Then open `http://localhost:5500` in a browser. Opening `index.html` directly by double-clicking also works, but a local server is recommended so relative paths and the mobile menu behave exactly as in production.

## How to test

1. **Navigation** — click through every link in the header, mobile hamburger menu, and footer; confirm none are broken.
2. **Forms** — submit each form (login, register, contact, track, all four certificate applications, staff login) empty first to confirm inline validation, then with valid data to confirm the "not yet connected" toast appears.
3. **Document upload** — try an unsupported file type and an oversized file on any certificate form to confirm the inline error; then upload a valid PDF/JPG/PNG and confirm the filename/size preview and remove button work.
4. **Responsive layout** — resize the browser (or use device toolbar) down to a small mobile width; confirm the header collapses to a hamburger menu, the dashboard sidebar becomes a slide-in drawer, and tables in `citizen/applications.html` / `staff/applications.html` remain usable.
5. **Staff actions** — open `staff/application-details.html`, and try each of Request Correction / Approve / Reject / Upload Certificate; confirm modals open, validate their inputs, and close with an informational toast (never a fake success state).
6. **Console** — open browser dev tools and confirm no JavaScript errors on any page.

## Future phases

| Phase | Scope |
|---|---|
| 2 | Firebase Authentication (citizen + staff login/register) |
| 3 | Cloud Firestore — citizen application submission and storage |
| 4 | Firebase Storage — document upload/download |
| 5 | Staff dashboard wired to live application data |
| 6 | Application tracking + correction/resubmission workflow |
| 7 | Certificate upload/download + notifications |
| 8 | Security rules + final testing |

This repository intentionally stops at the end of Phase 1.
