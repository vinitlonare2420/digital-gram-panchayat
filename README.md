# Digital Gram Panchayat — Citizen Service Portal

A college project: a citizen service portal for Gram Panchayat services. It is **not** an officially authorised government website.

## What it does

- **Citizens** register, log in, apply for nine services — Birth, Death, Income, Caste, Marriage Registration, BPL, No Dues, Property Assessment, and Other Certificate / Service Request — upload the documents on each service's checklist, follow the status of their applications, and answer staff requests for more or replacement documents.
- **Staff** review applications: mark under review, approve, or reject with a reason; open each uploaded document under its checklist item; accept, reject or ask for a replacement of individual documents; request missing documents; and confirm "I Am Here" at the office.
- **Admins** see real account and application counts, create and manage staff accounts, activate/deactivate users, switch the office-availability feature on or off, and confirm their own presence.
- **Office availability:** citizens see whether at least one staff member or admin has confirmed they are at the office. It is self-reported and expires automatically.

## Technology

- Static HTML + Tailwind CSS (CDN) + vanilla JavaScript (ES modules); Google Fonts.
- **Firebase Authentication** and **Cloud Firestore** for accounts, roles and applications.
- **Supabase Storage** (private bucket `gp-documents`) for uploaded documents, reached only through short-lived signed URLs.
- **Vercel serverless functions** in `/api` (Node) for everything that must be trusted: roles, application creation, document verification, reviews, availability.

## How documents are checked

Each service has a checklist in `js/document-checklists.js` (the single source for the forms, the API and staff review). Each checklist item has its own document type; an upload is tied to one item, one application and one applicant. On submission the **server** checks that every required item has a stored file of an allowed type (PDF/JPG/JPEG/PNG) and size (5 MB) in the applicant's private folder, that no item has two files, and that one stored file does not fill several items. It does **not** read the contents of a file — **staff must open each document and check it**. If a submission fails after files were uploaded, the browser asks the server to delete them; if that clean-up request itself fails (it is logged, never shown as a second error), the unreferenced files stay in the private bucket until removed in the Supabase dashboard. The checklists are suggested lists, not official rules, and are marked as needing confirmation from the responsible authority.

## Folder structure

```
index.html, about.html, contact.html, track.html, services.html, login.html, register.html
services/        the nine application forms
citizen/         dashboard, my applications, application details, availability, profile
staff/           login, dashboard, applications, application details
admin/           login, dashboard, users, staff
js/              browser code (auth, applications, uploads, checklists, staff/admin/availability clients, shared UI)
api/             Vercel functions (admin/, applications/, documents/, staff/, availability.js) + _lib/ shared server code
scripts/         create-first-admin.js, dev-api.js, build-static-backup.js (GitHub Pages backup builder)
tests/           automated tests (npm test)
firestore.rules  Firestore security rules (publish in the Firebase Console)
vercel.json, .vercelignore, 404.html, .env.example   Vercel configuration (see Hosting)
.github/workflows/static.yml   publishes the static backup to GitHub Pages (see Hosting)
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

> Publish `firestore.rules` again whenever it changes. Applications, status history and document reviews are written only by the API (Admin SDK); the rules allow reads, never client-side creates or updates of applications.

1. In the Firebase Console, open **Build → Firestore Database**.
2. Click **Create database**. Choose **Start in production mode** (the rules below define access; do not leave it in the wide-open "test mode" default).
3. Pick a location close to your users and confirm.
4. Go to the **Rules** tab and replace the default rules with the contents of **`firestore.rules`** from this project, then click **Publish**.
5. No manual document creation is needed — `users/{uid}` documents are created automatically the first time someone registers.

## Supabase setup steps

1. Create a project at [supabase.com](https://supabase.com) (the free tier is sufficient).
2. In **Storage**, create a bucket named `gp-documents` and leave it **private** (do not toggle "Public").
3. In the bucket's settings, set `file_size_limit` to 5MB and restrict `allowed_mime_types` to `application/pdf`, `image/jpeg`, `image/jpg`, `image/png`. This is a second line of defense — the backend also enforces these limits independently before ever asking Supabase for a signed upload URL.
4. Do **not** add any Storage RLS/access policies granting public or anon access — every upload and download goes through a short-lived signed URL minted server-side with the `service_role` key, so the bucket can (and should) stay fully locked down.
5. From **Project Settings → API**, copy the **Project URL**, the **anon/publishable key**, and the **service_role key** (keep this one secret) — you'll need all three as Vercel environment variables (see **Hosting** below).

## Hosting

The application is hosted on **Vercel (primary)**. **GitHub Pages (static backup)** is a separate, information-only copy — it is not the application and it does not replace Vercel.

| | Vercel (primary) | GitHub Pages (static backup) |
|---|---|---|
| What it serves | every page **and** the `/api` serverless functions | public information pages + a notice at every other address |
| Login, applications, uploads, staff/admin | works | **not available** — notice pages point to the primary site |
| Configuration | `vercel.json`, `.vercelignore`, `404.html`, environment variables | `.github/workflows/static.yml`, `scripts/build-static-backup.js`, one repository variable |
| Secrets needed | 5 server-side variables (below) | none |

### Vercel (primary)

**What is deployed.** The static pages and the functions in `api/` (11 functions; the Hobby plan allows 12; `api/_lib` is shared code, not a route). The frontend calls the API with same-origin paths such as `/api/applications/submit`, so it works on whatever domain Vercel gives the project — no host names are hard-coded. `vercel.json` adds security headers, stops API responses being cached and makes sure the shared `js/document-checklists.js` is bundled with the functions. `.vercelignore` keeps `tests/`, `scripts/`, `README.md`, `firestore.rules` and every `.env*` file out of the deployment. `404.html` is the not-found page.

**Environment variables** (Vercel → Project → Settings → Environment Variables; add every one to **Production and Preview**). Names are listed in `.env.example`; **real values never go in the repository or in any page**.

| Name | Secret? | Purpose |
|---|---|---|
| `SUPABASE_URL` | no | your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | **yes — full access** | server-side signed upload/download URLs for the private bucket |
| `SUPABASE_ANON_KEY` | low | relayed once per upload as the `apikey` header of Supabase's signed upload request |
| `SUPABASE_BUCKET` | no | private bucket name (default `gp-documents`) |
| `FIREBASE_SERVICE_ACCOUNT_KEY` | **yes — full access** | the service-account JSON (paste the whole file content as the value); verifies sign-in tokens and reads/writes Firestore from the backend |

**Deploy steps** (nothing here deploys automatically — you do each step):

1. **Rotate the Firebase service-account key if it was ever exposed** (it must be, if it appeared in chat, a commit or a screenshot): Firebase Console → Project settings → Service accounts → *Generate new private key*, put it **only** into the Vercel variable above, then revoke the old key in Google Cloud Console → IAM → Service accounts → Keys.
2. Push the repository to GitHub (your decision), then in Vercel: **Add New → Project →** import it. Framework Preset **Other**; leave Build Command and Output Directory empty; Node.js **22.x** (also pinned in `package.json`).
3. Add the five environment variables, then **Deploy**.
4. Firebase Console → Authentication → Settings → **Authorized domains** → add the `*.vercel.app` domain (and any custom domain). If the Firebase web API key has an HTTP-referrer restriction in Google Cloud Console, add the domain there too.
5. Firebase Console → Firestore Database → Rules → paste `firestore.rules` → **Publish** (again whenever it changes).
6. Create the first admin locally: `npm run create-admin` (reads `.env.local`).
7. Check the deployed site by hand: the home page and all nine service forms open; `GET /api/availability` answers `405` (the function is running); `/tests/api-security.test.js`, `/firestore.rules`, `/README.md` and `/.env.example` answer `404`; sign in as citizen, staff and admin; submit an application with its documents; review it as staff.

**Local development:** `npm run dev:api` (Vercel dev with `.env.local`) at <http://localhost:3000>.

### GitHub Pages (static backup)

**What it is.** A static, information-only site: the public pages (home, services, about, contact, track) with a visible *"Static backup copy"* banner, and a **notice page at the address of every other page** (login, register, the service forms, citizen/staff/admin pages) that says the feature needs the main application and links to the same page there. Only the scripts and CSS those public pages use are included.

**What it never contains:** `api/`, `scripts/`, `tests/`, `firestore.rules`, package files, `README.md`, any `.env*` or service-account file, and every browser script that talks to Firebase or `/api`. The workflow builds into `dist-static/` with `node scripts/build-static-backup.js` and uploads **only that folder**; the build **fails** if its output contains a secret-like string, a server file, an `/api` call, Firebase client code, a root-absolute link (which would break on a `…github.io/<repository>/` project site) or a link that does not resolve. `tests/hosting.test.js` plants each of those problems to prove the check catches them.

**Limits — stated, not hidden.** The backup has no server, so it cannot sign anyone in, take an application, accept an upload or show staff/admin pages. It does **not** call the Vercel API: the API sends no CORS headers, and calling it from another origin would need CORS (including the preflight for the `Authorization` header) on every function, the `github.io` origin added to Firebase's authorized domains, and live testing. None of that is configured or claimed.

**Enable it:**

1. Push the repository to GitHub (your decision).
2. Repository → **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Repository → **Settings → Secrets and variables → Actions → Variables → New repository variable**: name `PRIMARY_APP_URL`, value `https://<your-vercel-domain>` (a public address, not a secret). Without it the backup still builds, but its notice pages say the main application's address is not configured.
4. **Actions → "Static backup (GitHub Pages)" → Run workflow** (it also runs on every push to `main`).
5. Open `https://<your-user>.github.io/<repository>/` and check: the banner, a notice page such as `login.html`, and that nothing 404s.

**Preview locally:** `npm run build:static-backup` (PowerShell: `$env:PRIMARY_APP_URL="https://<your-vercel-domain>"; npm run build:static-backup`), then serve `dist-static/` with any static server, for example `npx serve dist-static`. `dist-static/` is git-ignored.

## Firestore security rules (summary)

See **`firestore.rules`** for the full, commented rules. In short:

- Every account has a profile `users/{uid}` with a role (`citizen`, `staff`, `admin`) and an `active` flag. A user can read and update **their own** profile but can never change their own role or `active` flag; accounts are never deleted from the browser; staff and admin accounts are created only by the server.
- **Applications are created and changed only by the server** (`/api/applications/submit`, `/api/applications/add-documents`, `/api/staff/*`). The rules let an owner read their own applications and active staff/admin read all, but refuse every create, update and delete from the browser — as well as every client write to an application's status history.
- `settings` and `staffAvailability` (office availability) are closed to all browser access; only `/api/availability` reads and writes them.

These rules are a reasonable starting point for a college project, not a claim of production-grade security. A real deployment would also want rate limiting, App Check and email-verification enforcement. The rules have **not** been run against a Firestore emulator here — publish them and test the flows by hand.

## Roles, first admin and staff accounts

There are three roles, stored in `users/{uid}.role`: `citizen`, `staff` and `admin`. Everyone signs in on the one common page (`login.html`) and is sent to `citizen/`, `staff/` or `admin/` dashboards by the role in their profile. The role can never be set from the browser: Firestore rules block it, and every staff/admin action is also re-checked by the `/api` functions (`api/_lib/authz.js`). A deactivated account (`active: false`) is signed out and blocked everywhere.

**1. Publish the rules.** Paste `firestore.rules` into Firebase Console → Firestore Database → Rules → Publish. (Required before the staff and admin pages can read data.)

**2. Create the first admin (local, once).** There is deliberately no admin registration page or API. With `.env.local` in place, run in a terminal:

```powershell
npm run create-admin
```

It asks for a name, an email (use a new address, not your citizen account) and a password (typed hidden, min 12 characters), then needs you to type `CREATE ADMIN`. It refuses to run if an admin already exists. To turn an existing Firebase account into the admin instead, add `-- --promote-existing`.

**3. Create staff from the Admin dashboard.** Sign in as the admin → **Staff** → *Create staff account*. Give the new staff member the temporary password (or tick the box to email them a reset link). Admins can deactivate/reactivate staff, and can also manage any citizen or staff account on the **Users** page. Admin accounts can't be created or changed from the portal.

**4. Staff workflow.** Staff open **Applications**, open one, view the applicant's details and documents, mark it *Under review*, then *Approve* or *Reject* (a reason is required to reject). Each step is written to the application's status history, which citizens see on their application page.

Run the local server with `npm run dev:api` (it passes `.env.local` to `vercel dev`).

**Security tests.** `npm test` runs `tests/api-security.test.js` — the real `/api` handlers against in-memory fakes (no network, no credentials), covering role checks, document access, the status workflow and bad input. Firestore rules need the emulator or the manual console checks; they are not covered by `npm test`.

**Services (nine).** Birth, Death, Income and Caste certificates plus Marriage Registration, BPL, No Dues, Property Assessment and "Other Certificate / Service Request". The list lives once in `SERVICE_TYPES` (`js/utils.js`) and must match `ALLOWED_SERVICE_TYPES` (`api/_lib/validation.js`) and `isKnownService()` in `firestore.rules`; `npm test` fails if they drift. New forms use the shared `js/service-form.js`. Requests are subject to the relevant authority's powers: staff can approve, or reject with a reason (the reject dialog has a "redirect to another department" template).

**Staff availability ("I Am Here").** Admin dashboard → *Staff Availability / I Am Here Settings* switches the feature on/off, sets how long a confirmation lasts (5–1440 min, default 120) and the office name. Both **staff and admins** have their own **I Am Here** button (on `/staff/dashboard.html` and `/admin/dashboard.html`) and can change only their own presence. The office shows as available when at least ONE active staff or admin confirmation is current; citizens see *Office Available / No Staff or Admin Currently Available / Availability Disabled / Availability Unavailable* on their dashboard and on **Staff Availability** in the citizen sidebar. It is self-reported (no location is requested or checked), expires automatically, and everything goes through `/api/availability`; `firestore.rules` deny direct client access to `settings` and `staffAvailability`.

**Lost admin access.** The portal can never create, demote or deactivate an admin, and `npm run create-admin` refuses to run while any admin profile exists. If the only admin's Firebase Auth account is deleted by hand, delete that admin's `users/{uid}` document in the Firebase Console and run `npm run create-admin` again. (`api/_lib/` starts with an underscore so Vercel does not expose the helper files as routes.)

**Required documents per service.** Each form shows a "Required documents" checklist (Required / Optional) with one upload field per document. The lists live in ONE file, `js/document-checklists.js`, shared by the forms, the upload API and staff review - edit it to change a service's requirements. They are *suggested* lists, not official Maharashtra rules, and every one is marked `confirmed: false` ("needs confirmation from the responsible authority") until the Gram Panchayat confirms it. Uploads stay private (signed URLs, 5 MB, PDF/JPG/JPEG/PNG); each stored document carries its `docType`, and its storage path contains the application id and the type. Staff see the checklist status and labelled "View" links, and can **Request missing documents** (checklist items or their own wording - this is how "Other" requirements are defined) from the application page; the citizen sees the request on their application page and uploads the documents there (`/api/staff/request-documents`, `/api/applications/add-documents`). Applications submitted before this feature keep working (their documents just have no type).

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

## How to test roles

1. Log in as the admin at `/admin/login.html` (or the Admin tab on `/login.html`) → lands on `admin/dashboard.html`; Users and Staff pages load; create a staff account.
2. Log in as that staff member at `/staff/login.html` → lands on `staff/dashboard.html`; open an application, view its PDF, mark it under review, then approve or reject (reject needs a reason).
3. Log in as the citizen who applied → the decision and reason appear under "Decision history" on their application page.
4. As staff, open `admin/dashboard.html` directly → sent away (to the staff dashboard). As a citizen, open `staff/dashboard.html` or `admin/dashboard.html` → sent to the citizen dashboard.
5. As admin, deactivate the staff account → that person is signed out and `login.html` says the account is deactivated.
6. All three login pages (`/login.html` Citizen, `/staff/login.html` Staff, `/admin/login.html` Admin) use the same sign-in and send you to the dashboard of your *actual* role, whichever page you used.

## How to run the frontend + API locally

The plain static server described further below still works for browsing pages, but the `/api` functions (and therefore real document uploads/downloads) only run under Vercel's local dev server:

```bash
npm install -g vercel   # once
vercel login
vercel link             # links this folder to your Vercel project
vercel dev              # serves the static site AND /api on one local port
```

Create a local-only `.env.local` (already covered by `.gitignore`) with the four secret values from `.env.example` filled in — never commit real values.

## How to test

Run `npm test` (automated: API handlers against in-memory fakes, the real page scripts in a fake browser, static checks). Then by hand, with `npm run dev:api` running at http://localhost:3000 and the Firestore rules published:

1. **Citizen** — register, log in, apply for a service (every required document must have a file; a ticked checkbox is only a reminder), open the application and see its status.
2. **Staff** — log in at `/staff/login.html`, open the application, view a document, accept or reject it with a reason, request a missing document, mark under review, approve or reject.
3. **Replacement** — as the citizen, upload the replacement for a rejected document from the application page; as staff, accept it.
4. **Admin** — log in at `/admin/login.html`; check the counts, create a staff account, deactivate and reactivate it.
5. **Availability** — as admin enable "I Am Here", press it as staff or admin, and check the citizen dashboard and **Staff Availability** page; disable the feature and check the wording changes.
6. **Responsive layout** — narrow the browser to phone width and open the main pages.

Things the automated tests cannot cover: Firestore rules execution (no emulator), real browser rendering, and Vercel production limits and environment variables.
