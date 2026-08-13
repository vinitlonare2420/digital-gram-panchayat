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

**Phase 2 — Real Firebase Authentication.**

- Phase 1 frontend (all pages, Tailwind styling, validation, layout) is unchanged.
- Citizen registration and login, staff login, logout, and password reset are now wired to **real Firebase Authentication** — no mock/demo auth, no hardcoded users, no passwords stored anywhere in this codebase.
- Every new Firebase Auth account gets a matching `users/{uid}` document in Firestore with a `role` field. Public registration always writes `role: "citizen"` — there is no UI path to register as staff, and Firestore security rules reject a client attempt to write any other role.
- `citizen/*.html` and `staff/*.html` pages are protected: unauthenticated visitors are redirected to the correct login page, and a signed-in user whose role doesn't match the page is redirected to their own dashboard instead.
- Document upload fields (on the certificate forms) still validate file type and size in the browser only — nothing is uploaded anywhere yet. Application tracking and staff review actions (approve/reject/correction/certificate upload) are still UI-only, since Firestore application data belongs to Phase 3+.

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
│   ├── utils.js                   Generic helpers (formatting, status metadata, query params, whenAuthReady)
│   ├── validation.js              Reusable validators + inline error rendering
│   ├── components.js              Navbar, footer, mobile menu, toasts, modals, dashboard shell, file upload widget
│   ├── app.js                     Breadcrumbs, empty-state rendering
│   ├── firebase.js                Firebase App/Auth/Firestore init — YOUR CONFIG GOES HERE (Phase 2)
│   └── auth.js                    Register/login/logout/reset + route protection, exposed as window.GPAuth (Phase 2)
│
├── components/                    Reserved for future extraction if the component library grows
├── assets/
│   ├── images/
│   └── icons/
│
├── firestore.rules                Firestore security rules for the `users` collection (Phase 2)
├── package.json
└── README.md
```

## Firebase Console setup steps

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and click **Add project**. Name it anything (e.g. `digital-gram-panchayat`); Google Analytics is not needed for this project.
2. Once the project is created, click the **Web** icon (`</>`) on the project overview page to register a web app. Give it a nickname (e.g. "Citizen Portal Web") — you do **not** need Firebase Hosting for this step.
3. Firebase will show a `firebaseConfig` object. Copy it into **`js/firebase.js`**, replacing every `REPLACE_WITH_...` placeholder. That is the only file that needs editing to connect your project.

## Authentication setup steps

1. In the Firebase Console, open **Build → Authentication**.
2. Click **Get started**.
3. Under the **Sign-in method** tab, enable **Email/Password** (the basic toggle — you do not need the "Email link" passwordless option).
4. Save. No further configuration is required — `js/auth.js` handles registration, login, logout, and password reset against this provider.

## Firestore setup steps

1. In the Firebase Console, open **Build → Firestore Database**.
2. Click **Create database**. Choose **Start in production mode** (the rules below define access; do not leave it in the wide-open "test mode" default).
3. Pick a location close to your users and confirm.
4. Go to the **Rules** tab and replace the default rules with the contents of **`firestore.rules`** from this project, then click **Publish**.
5. No manual document creation is needed — `users/{uid}` documents are created automatically the first time someone registers.

## Security rules

See **`firestore.rules`** for the full, commented rules. Summary of what they enforce:

- A signed-in user can read only their own `users/{uid}` document (not anyone else's).
- A user can create their own profile document only, and only with `role: "citizen"` — Firestore rejects any other value even if the client-side JavaScript is bypassed or edited.
- A user can update their own profile, but the `role` field must stay unchanged — no self-promotion to staff, and no self-editing of role by staff either.
- No client-side deletes.
- All of the above require `request.auth != null` — signed-out requests are rejected outright.

These rules are a reasonable starting point for a college project's evaluation, not a claim of production-grade security. A real deployment would also want rate limiting, App Check, and email verification enforcement.

## How to create a staff account

There is intentionally no staff self-registration UI. To create one:

1. Firebase Console → **Authentication → Users → Add user**. Enter the staff member's email and a temporary password.
2. Firebase Console → **Firestore Database → Start collection** (or add to the existing `users` collection) → create a document with the **Document ID set to that user's UID** (copy it from the Authentication user list).
3. Add these fields to the document:
   ```
   name:      "Panchayat Staff Name"      (string)
   email:     "staff@example.in"          (string — match the Auth email)
   mobile:    "9800000000"                (string)
   role:      "staff"                      (string — exactly "staff")
   createdAt: (timestamp — use the Firestore console's timestamp picker)
   ```
4. That account can now sign in at `staff/login.html` and will land on `staff/dashboard.html`.

## How to test citizen registration/login

1. Open `register.html`, submit with empty fields → confirm inline validation errors appear (no network call happens).
2. Register with a valid name, 10-digit mobile, email, and 8+ character password → confirm redirect to `citizen/dashboard.html`, and confirm in the Firebase Console that a new Authentication user and a matching `users/{uid}` document with `role: "citizen"` now exist.
3. Log out (dashboard topbar → **Logout**) → confirm redirect to `login.html`.
4. Try registering the same email again → confirm the friendly "An account with this email already exists." message (not a raw Firebase error).
5. Log in with the account you just created → confirm redirect to `citizen/dashboard.html`.
6. Log in with the wrong password → confirm "Invalid email or password." (not a raw error code).
7. On `login.html`, click **Forgot password?**, submit your email → confirm "Password reset email sent." and check your inbox.
8. While signed out, open `citizen/dashboard.html` directly by URL → confirm you're redirected to `login.html`.
9. While signed in as a citizen, refresh `citizen/applications.html` → confirm you stay on the page (session persists) instead of being kicked to login.

## How to test staff login

1. Create a staff account using the steps above.
2. Open `staff/login.html` and sign in with the staff email/password → confirm redirect to `staff/dashboard.html`.
3. While signed in as that staff account, open `citizen/dashboard.html` directly → confirm you're redirected away to `staff/dashboard.html` (staff cannot use citizen pages).
4. Log out of staff, then log in with a **citizen** account at `staff/login.html` → confirm the message "This login is for Panchayat staff only." and that you are not signed in afterward.
5. While signed in as a citizen, open `staff/dashboard.html` directly → confirm redirect to `citizen/dashboard.html`.

## How to run the frontend

No build step is required. Any static file server works:

```bash
# Option 1 — Python (already on most systems)
python3 -m http.server 5500

# Option 2 — Node (via npm scripts in this repo)
npm start
```

Then open `http://localhost:5500` in a browser.

**As of Phase 2, a local server is required, not just recommended.** `js/auth.js` and `js/firebase.js` are loaded as ES modules, and browsers block ES module imports on the `file://` protocol (CORS). Double-clicking `index.html` still works for browsing the static pages, but any page that loads `auth.js` (login, register, staff login, and every citizen/staff page) needs to be served over `http://`.

## How to test

1. **Navigation** — click through every link in the header, mobile hamburger menu, and footer; confirm none are broken.
2. **Forms** — submit each form (login, register, contact, track, all four certificate applications, staff login) empty first to confirm inline validation, then with valid data to confirm the "not yet connected" toast appears.
3. **Document upload** — try an unsupported file type and an oversized file on any certificate form to confirm the inline error; then upload a valid PDF/JPG/PNG and confirm the filename/size preview and remove button work.
4. **Responsive layout** — resize the browser (or use device toolbar) down to a small mobile width; confirm the header collapses to a hamburger menu, the dashboard sidebar becomes a slide-in drawer, and tables in `citizen/applications.html` / `staff/applications.html` remain usable.
5. **Staff actions** — open `staff/application-details.html`, and try each of Request Correction / Approve / Reject / Upload Certificate; confirm modals open, validate their inputs, and close with an informational toast (never a fake success state).
6. **Console** — open browser dev tools and confirm no JavaScript errors on any page.

## Future phases

| Phase | Scope | Status |
|---|---|---|
| 1 | Frontend foundation (pages, styling, validation, layout) | Done |
| 2 | Firebase Authentication (citizen + staff login/register, route protection) | Done |
| 3 | Cloud Firestore — citizen application submission and storage | Not started |
| 4 | Firebase Storage — document upload/download | Not started |
| 5 | Staff dashboard wired to live application data | Not started |
| 6 | Application tracking + correction/resubmission workflow | Not started |
| 7 | Certificate upload/download + notifications | Not started |
| 8 | Final security rules + final testing | Not started |

This repository intentionally stops at the end of Phase 2. No `applications` collection, document uploads, application IDs, staff processing logic, tracking, certificates, or notifications have been implemented — those remain future phases.
