/* ==========================================================================
   tests/clean-ui.test.js — the shipped pages carry no demo content, no fake
   actions and no placeholder contact details, and the data pages are honest
   when loading fails.

   Run with:  npm test
   ========================================================================== */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const SKIP = new Set(["node_modules", "graphify-out", ".agents", "tests", ".git", "api", "scripts", "css"]);
const pages = [];
(function walk(dir) {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) walk(rel); else if (e.name.endsWith(".html")) pages.push(rel);
  }
})(".");
const shipped = [...pages, ...fs.readdirSync(path.join(root, "js")).map((f) => "js/" + f)];

test("[clean] no sample records, placeholder contact details, lorem ipsum or 'later phase' promises in any page or script", () => {
  const banned = [
    [/GP-20\d\d-000\d{3}/, "sample application id"],
    [/Sample application/i, "sample application card"],
    [/lorem ipsum/i, "lorem ipsum"],
    [/\+91 00000 00000/, "placeholder phone number"],
    [/@gramseva\.example/i, "placeholder e-mail"],
    [/District — 000000/, "placeholder address"],
    [/in a later (development )?phase/i, "'later phase' promise"],
    [/not yet connected|will be connected/i, "unfinished feature notice"],
    [/Illustrative preview|design preview/i, "mock preview"],
    [/john doe|jane doe|test@test|password123|demo user|dummy/i, "dummy person / credentials"],
    [/\bTODO\b|\bFIXME\b/, "TODO marker"],
    [/console\.log\(/, "debug logging"],
  ];
  for (const file of shipped) {
    const text = read(file);
    for (const [re, what] of banned) assert.ok(!re.test(text), `${file}: ${what} (${re})`);
  }
});

test("[clean] every page's buttons and links go somewhere: no empty or '#' hrefs, no fake success toasts", () => {
  for (const file of pages) {
    const text = read(file);
    assert.ok(!/href="#"|href=""/.test(text), `${file}: dead link`);
    assert.ok(!/showToast\(['"`][^'"`]*(connected|prototype|later phase|not available yet)/i.test(text), `${file}: 'pretend' toast`);
  }
});

test("[clean] Track and Contact are honest: no fake form or preview, and no invented office details", () => {
  const track = read("track.html");
  assert.ok(!/id="track-form"|track-app-id/.test(track), "no search form that searches nothing");
  assert.match(track, /Sign in to see your applications/);
  assert.match(track, /href="login\.html\?redirect=citizen\/applications\.html"/);
  const contact = read("contact.html");
  assert.ok(!/id="contact-form"/.test(contact), "no message form that sends nothing");
  assert.match(contact, /Office hours/);
  assert.match(contact, /citizen\/availability\.html/);
});

test("[clean] the home page explains the process instead of showing a made-up application", () => {
  const index = read("index.html");
  assert.match(index, /How it works/);
  assert.ok(!/Under Verification — 05 Aug|Under Review — in progress/.test(index));
});

test("[clean] My Profile really saves (name and mobile only, through the profile rules) and says so honestly", () => {
  const profile = read("citizen/profile.html");
  assert.match(profile, /GPAuth\.updateOwnProfile\(/);
  assert.ok(!/profile-address|not yet stored/.test(profile));
  const auth = read("js/auth.js");
  assert.match(auth, /updateDoc\(doc\(db, "users", user\.uid\), \{ name: [^}]*mobile: [^}]*\}\)/, "only name and mobile are written");
  assert.ok(!/updateDoc\([^)]*role|updateDoc\([^)]*active/.test(auth), "role / active are never written from the browser");
  assert.match(read("firestore.rules"), /request\.resource\.data\.role == resource\.data\.role/, "the rules still stop role changes");
});

test("[clean] dashboards show real data only: a failed load shows an error, never a made-up count", () => {
  const citizen = read("citizen/dashboard.html");
  assert.ok(!/id="stat-[a-z-]+"[^>]*>0</.test(citizen), "no hard-coded 0 before data arrives");
  assert.match(citizen, /textContent = '—'/, "a failed load shows a dash");
  for (const file of ["staff/dashboard.html", "admin/dashboard.html"]) {
    const text = read(file);
    assert.ok(!/data-stat="[^"]+"[^>]*>\d+</.test(text), `${file}: hard-coded count`);
    assert.match(text, /stats-error/, `${file}: has an error state`);
  }
  assert.match(read("staff/dashboard.html"), /Nothing is waiting for action right now\./, "a genuine empty state is kept");
  assert.match(read("admin/dashboard.html"), /No applications yet\./);
});

test("[clean] applications are only ever created by the server, so no browser code can write fake records", () => {
  const apps = read("js/applications.js");
  assert.ok(!/setDoc\(appRef|addDoc\(collection\(db, "applications"\)/.test(apps), "no direct Firestore writes of applications");
  assert.match(apps, /\/api\/applications\/submit/);
  assert.match(read("firestore.rules"), /allow create: if false;/);
});

test("[clean] no page promises features the portal does not have (certificate download or issue, a 'Correction Required' status)", () => {
  for (const file of pages) {
    const text = read(file);
    assert.ok(!/download (your |the |approved )?certificate|upload issued certificates|get your approved certificate/i.test(text), `${file}: promises certificate download / issue`);
    assert.ok(!/Correction Required|Under Verification|Certificate Available/.test(text), `${file}: mentions a status the workflow does not use`);
  }
  assert.match(read("index.html"), /See the decision/);
});
