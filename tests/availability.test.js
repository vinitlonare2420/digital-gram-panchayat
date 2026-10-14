/* ==========================================================================
   tests/availability.test.js — staff "I Am Here" availability.

   Run with:  npm test

   PART 1  The REAL api/availability.js (+ api/_lib/*) against in-memory fakes of
           Firebase Admin / Firestore — nothing here touches the real project:
           admin-only settings, staff changing only THEIR OWN state, the minimal
           citizen view, automatic expiry, deactivated staff, safe failures.
   PART 2  The REAL js/availability-ui.js and js/components.js in a small fake
           browser: what citizens / staff / admin actually see and can click.
   PART 3  Static wiring: pages, sidebar link on every citizen page, rules.

   Firestore rules are not executed here (no emulator) — they only need to deny
   everything for these two collections, which Part 3 checks in the rules text.
   ========================================================================== */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const resolveFrom = (dir, id) => createRequire(path.join(root, dir, "x.js")).resolve(id);

/* =========================== PART 1: the API =========================== */

let store = {};
let failReadsOf = null;                         // e.g. "settings/" -> reads under that prefix throw
const stamp = (d) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v && v.__serverTimestamp ? Date.now() : v]));

function fakeRef(p) {
  return {
    async get() {
      if (failReadsOf && p.startsWith(failReadsOf)) throw new Error("boom");
      return { exists: p in store, data: () => store[p], id: p.split("/").pop() };
    },
    async set(d) { store[p] = stamp(d); },
  };
}
const fakeDb = {
  collection(name) {
    return {
      doc: (id) => fakeRef(`${name}/${id}`),
      limit: () => ({
        async get() {
          if (failReadsOf && `${name}/`.startsWith(failReadsOf)) throw new Error("boom");
          const keys = Object.keys(store).filter((k) => k.startsWith(name + "/") && k.split("/").length === 2);
          return { docs: keys.map((k) => ({ id: k.split("/")[1], data: () => store[k] })) };
        },
      }),
    };
  },
};
function install(id, exports) { require.cache[id] = { id, filename: id, loaded: true, exports }; }
install(resolveFrom("api/_lib", "./firebaseAdmin"), {
  getFirestore: () => fakeDb,
  getFirebaseAdmin: () => ({}),
  async verifyIdToken(req) {
    const m = /^Bearer t-(\w+)$/.exec(req.headers.authorization || "");
    if (!m) { const e = new Error("x"); e.statusCode = 401; throw e; }
    return { uid: m[1] };
  },
});
install(resolveFrom("api", "firebase-admin/firestore"), { FieldValue: { serverTimestamp: () => ({ __serverTimestamp: true }) } });

const MIN = 60 * 1000;
const SETTINGS = "settings/availability";

function seed() {
  failReadsOf = null;
  store = {
    "users/cit1": { role: "citizen", name: "Cit One", email: "cit1@example.test", active: true },
    "users/cit2": { role: "citizen", name: "Cit Two" },                      // legacy profile: no `active` field
    "users/staff1": { role: "staff", name: "Sam Staff", email: "sam@example.test", active: true },
    "users/staff2": { role: "staff", name: "Priya Clerk", active: true },
    "users/staff3": { role: "staff", name: "Off Staff", active: false },
    "users/admin1": { role: "admin", name: "Ada Admin", active: true },
  };
}
async function call(uid, body, method = "POST") {
  const req = { method, headers: uid ? { authorization: `Bearer t-${uid}` } : {}, body };
  const out = {};
  const res = { setHeader() {}, status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; } };
  await require(path.join(root, "api/availability.js"))(req, res);
  return out;
}
const configure = (uid, changes) => call(uid, { action: "configure", ...changes });
const status = (uid) => call(uid, { action: "status" });
const setMine = (uid, available, extra = {}) => call(uid, { action: "set", available, ...extra });
const enable = (minutes) => configure("admin1", { enabled: true, ...(minutes ? { staleAfterMinutes: minutes } : {}) });

test("[avail] status needs a login; every active role can read it; a deactivated account cannot", async () => {
  seed();
  assert.equal((await status(null)).status, 401);
  for (const uid of ["cit1", "cit2", "staff1", "admin1"]) assert.equal((await status(uid)).status, 200, uid);
  assert.equal((await status("staff3")).status, 403, "deactivated staff");
  assert.equal((await status("nobody")).status, 403, "no profile");
});

test("[avail] the feature is OFF until an admin switches it on, and then reports 'disabled' with no staff data", async () => {
  seed();
  store["staffAvailability/staff1"] = { available: true, updatedAt: Date.now() };       // would count if the feature were on
  const r = await status("cit1");
  assert.equal(r.body.state, "disabled");
  assert.equal(r.body.enabled, false);
  assert.equal(r.body.lastUpdated, null, "nothing about staff is revealed while disabled");
  assert.ok(!("mine" in r.body));
});

test("[avail] only an ADMIN can change the settings; citizens, staff and logged-out callers cannot", async () => {
  seed();
  assert.equal((await configure(null, { enabled: true })).status, 401);
  assert.equal((await configure("cit1", { enabled: true })).status, 403);
  assert.equal((await configure("staff1", { enabled: true })).status, 403);
  assert.equal((await configure("staff3", { enabled: true })).status, 403, "deactivated");
  assert.ok(!(SETTINGS in store), "nothing was written by any refused call");
  // role claims in the request are ignored
  assert.equal((await configure("cit1", { enabled: true, role: "admin", isAdmin: true, uid: "admin1" })).status, 403);
  assert.equal((await call("staff1", { action: "overview", role: "admin" })).status, 403);

  const ok = await configure("admin1", { enabled: true, staleAfterMinutes: 45, officeLabel: "  Gram Panchayat Office, Rampur  " });
  assert.equal(ok.status, 200);
  assert.deepEqual({ ...store[SETTINGS], updatedAt: undefined }, { enabled: true, staleAfterMinutes: 45, officeLabel: "Gram Panchayat Office, Rampur", updatedAt: undefined, updatedBy: "admin1" });
  assert.equal(typeof store[SETTINGS].updatedAt, "number", "stamped with the server clock");
});

test("[avail] settings input is validated (types, ranges, lengths)", async () => {
  seed();
  const bad = [
    { enabled: "yes" }, { enabled: 1 }, { enabled: null },
    { staleAfterMinutes: 4 }, { staleAfterMinutes: 1441 }, { staleAfterMinutes: 0 }, { staleAfterMinutes: -5 }, { staleAfterMinutes: 12.5 }, { staleAfterMinutes: "60" }, { staleAfterMinutes: NaN },
    { officeLabel: "" }, { officeLabel: "   " }, { officeLabel: "x".repeat(81) }, { officeLabel: 42 }, { officeLabel: { a: 1 } }, { officeLabel: "line\nbreak" },
    {},                                                    // nothing to change
  ];
  for (const b of bad) assert.equal((await configure("admin1", b)).status, 400, JSON.stringify(b));
  assert.ok(!(SETTINGS in store), "invalid input must never be stored");
  for (const good of [{ staleAfterMinutes: 5 }, { staleAfterMinutes: 1440 }, { officeLabel: "x".repeat(80) }, { enabled: false }]) {
    assert.equal((await configure("admin1", good)).status, 200, JSON.stringify(good));
  }
});

test("[avail] an admin can enable and disable the feature globally, and the setting persists", async () => {
  seed();
  assert.equal((await enable()).status, 200);
  assert.equal(store[SETTINGS].enabled, true);
  assert.equal((await status("cit1")).body.state, "none", "enabled, nobody confirmed yet");

  assert.equal((await setMine("staff1", true)).status, 200);
  assert.equal((await status("cit1")).body.state, "available");

  assert.equal((await configure("admin1", { enabled: false })).status, 200);
  assert.equal(store[SETTINGS].enabled, false, "persisted in Firestore");
  const hidden = await status("cit1");
  assert.equal(hidden.body.state, "disabled", "citizens see nothing while it is off");
  assert.equal(hidden.body.lastUpdated, null);
  assert.equal((await setMine("staff1", true)).status, 409, "staff cannot change availability while it is off");
  assert.equal((await setMine("staff1", false)).status, 409);

  assert.equal((await enable()).status, 200);                        // switched back on: the (fresh) confirmation counts again
  assert.equal((await status("cit1")).body.state, "available");
});

test("[avail] staff and admins change ONLY their own availability; citizens and logged-out callers cannot", async () => {
  seed();
  await enable();
  assert.equal((await setMine(null, true)).status, 401);
  assert.equal((await setMine("cit1", true)).status, 403, "citizen");
  assert.equal((await setMine("staff3", true)).status, 403, "deactivated staff");
  assert.ok(!Object.keys(store).some((k) => k.startsWith("staffAvailability/")), "nothing written by the refused calls");

  // cannot point the change at somebody else, or choose the timestamp
  const r = await setMine("staff1", true, { uid: "staff2", staffId: "staff2", userId: "staff2", id: "staff2", updatedAt: 1, name: "Someone Else" });
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(store).filter((k) => k.startsWith("staffAvailability/")), ["staffAvailability/staff1"]);
  const written = store["staffAvailability/staff1"];
  assert.deepEqual(Object.keys(written).sort(), ["available", "updatedAt"], "only the two expected fields are stored");
  assert.ok(Math.abs(written.updatedAt - Date.now()) < 5000, "timestamp comes from the SERVER, not the request (sent updatedAt: 1)");

  for (const bad of ["true", 1, null, undefined, [true], {}]) assert.equal((await setMine("staff1", bad)).status, 400, String(bad));
  assert.equal(written.available, true, "bad requests changed nothing");
  assert.equal((await setMine("staff1", false)).status, 200);
  assert.equal(store["staffAvailability/staff1"].available, false);
});

test("[avail] citizens get the MINIMUM: state, time, expiry and office name — no names, ids, emails or counts", async () => {
  seed();
  await enable(60);
  await setMine("staff1", true);
  await setMine("staff2", true);
  const r = await status("cit1");
  assert.deepEqual(Object.keys(r.body).sort(), ["enabled", "lastUpdated", "officeLabel", "serverTime", "staleAfterMinutes", "state"], "exactly these fields, nothing else");
  const text = JSON.stringify(r.body);
  for (const secret of ["staff1", "staff2", "Sam Staff", "Priya", "sam@example", "cit1", "admin1", "uid", "count"]) {
    assert.ok(!text.includes(secret), `public status leaks "${secret}"`);
  }
  assert.equal(r.body.state, "available");
  assert.ok(!("mine" in r.body), "citizens never receive a per-person block");
  assert.ok(Math.abs(Date.parse(r.body.lastUpdated) - Date.now()) < 5000);
  assert.ok(Math.abs(Date.parse(r.body.serverTime) - Date.now()) < 5000);
  // staff additionally see their OWN state, still without anyone else's
  const mine = await status("staff1");
  assert.equal(mine.body.mine.available, true);
  assert.ok(!JSON.stringify(mine.body).includes("Priya"));
});

test("[avail] availability expires by itself: stale confirmations stop counting, renewing brings them back", async () => {
  seed();
  await enable(30);
  store["staffAvailability/staff1"] = { available: true, updatedAt: Date.now() - 29 * MIN - 55 * 1000 };
  assert.equal((await status("cit1")).body.state, "available", "29m55s old with a 30 min limit is still current");

  store["staffAvailability/staff1"].updatedAt = Date.now() - 30 * MIN - 5 * 1000;
  const stale = await status("cit1");
  assert.equal(stale.body.state, "none", "30m05s old is expired");
  assert.ok(Math.abs(Date.parse(stale.body.lastUpdated) - (Date.now() - 30 * MIN)) < 30 * 1000, "still reports when staff last updated");
  const mine = await status("staff1");
  assert.equal(mine.body.mine.available, false);
  assert.equal(mine.body.mine.reported, true, "staff can see their confirmation expired");

  assert.equal((await setMine("staff1", true)).status, 200);               // renew
  assert.equal((await status("cit1")).body.state, "available");

  // shortening the limit applies immediately to existing confirmations
  store["staffAvailability/staff1"].updatedAt = Date.now() - 10 * MIN;
  assert.equal((await status("cit1")).body.state, "available");
  await configure("admin1", { staleAfterMinutes: 5 });
  assert.equal((await status("cit1")).body.state, "none");
});

test("[avail] a session that just ends cannot leave someone 'available' for ever (no logout, no heartbeat)", async () => {
  seed();
  await enable(120);
  await setMine("staff1", true);                                              // then the browser/session simply disappears
  store["staffAvailability/staff1"].updatedAt = Date.now() - 3 * 60 * MIN;    // three hours later
  assert.equal((await status("cit1")).body.state, "none");
});

test("[avail] one fresh staff member is enough; one expired and one withdrawn are ignored", async () => {
  seed();
  await enable(60);
  store["staffAvailability/staff1"] = { available: true, updatedAt: Date.now() - 2 * 60 * MIN };   // expired
  store["staffAvailability/staff2"] = { available: false, updatedAt: Date.now() - 1 * MIN };       // withdrawn
  assert.equal((await status("cit1")).body.state, "none");
  store["staffAvailability/staff2"].available = true;
  assert.equal((await status("cit1")).body.state, "available");
});

test("[avail] deactivated, demoted or deleted staff stop counting immediately", async () => {
  seed();
  await enable();
  await setMine("staff1", true);
  assert.equal((await status("cit1")).body.state, "available");
  store["users/staff1"].active = false;                       assert.equal((await status("cit1")).body.state, "none", "deactivated");
  store["users/staff1"].active = true;                        assert.equal((await status("cit1")).body.state, "available");
  store["users/staff1"].role = "citizen";                     assert.equal((await status("cit1")).body.state, "none", "no longer staff");
  store["users/staff1"].role = "staff";
  delete store["users/staff1"];                               assert.equal((await status("cit1")).body.state, "none", "account removed");
  store["users/staff3"] = { role: "staff", name: "Off Staff", active: false };
  store["staffAvailability/staff3"] = { available: true, updatedAt: Date.now() };
  assert.equal((await status("cit1")).body.state, "none", "an old entry of a deactivated account never counts");
});

test("[avail] missing, malformed or future-dated timestamps never show staff as present", async () => {
  seed();
  await enable();
  for (const updatedAt of [undefined, null, "yesterday", NaN, {}, [], true, Date.now() + 60 * 60 * 1000, Date.now() + 365 * 24 * 60 * MIN]) {
    store["staffAvailability/staff1"] = { available: true, updatedAt };
    const r = await status("cit1");
    assert.equal(r.body.state, "none", `treated ${String(updatedAt)} as present`);
    assert.equal(r.status, 200);
  }
  store["staffAvailability/staff1"] = { available: "true", updatedAt: Date.now() };   // wrong type for the flag
  assert.equal((await status("cit1")).body.state, "none");
});

test("[avail] if the data cannot be read, the API fails safely (500, generic) and never claims anyone is present", async () => {
  seed();
  await enable();
  await setMine("staff1", true);
  for (const prefix of ["settings/", "staffAvailability/"]) {
    failReadsOf = prefix;
    const r = await status("cit1");
    assert.equal(r.status, 500, prefix);
    assert.ok(!("state" in r.body), "no state is claimed when the check failed");
    assert.ok(!/boom|firestore|stack/i.test(JSON.stringify(r.body)), "no internal details");
    assert.equal((await setMine("staff1", true)).status, 500);
  }
  failReadsOf = null;
  assert.equal((await status("cit1")).body.state, "available");
});

test("[avail] admin overview lists active staff with their state — names only, no ids or e-mails — and is admin-only", async () => {
  seed();
  await configure("admin1", { enabled: true, staleAfterMinutes: 30, officeLabel: "Gram Panchayat Office" });
  store["staffAvailability/staff1"] = { available: true, updatedAt: Date.now() - 1 * MIN };
  store["staffAvailability/staff2"] = { available: true, updatedAt: Date.now() - 90 * MIN };
  assert.equal((await call("cit1", { action: "overview" })).status, 403);
  assert.equal((await call("staff1", { action: "overview" })).status, 403);
  assert.equal((await call(null, { action: "overview" })).status, 401);

  const r = await call("admin1", { action: "overview" });
  assert.equal(r.status, 200);
  assert.equal(r.body.settings.enabled, true);
  assert.equal(r.body.settings.staleAfterMinutes, 30);
  assert.deepEqual(r.body.staff.map((s) => [s.name, s.state]), [["Ada Admin", "never"], ["Priya Clerk", "expired"], ["Sam Staff", "available"]], "admins are listed too; deactivated Off Staff is not");
  const text = JSON.stringify(r.body);
  for (const secret of ["staff1", "staff2", "sam@example", "admin1"]) assert.ok(!text.includes(secret), `overview leaks "${secret}"`);

  store["staffAvailability/staff2"].available = false;
  delete store["staffAvailability/staff1"];
  const r2 = await call("admin1", { action: "overview" });
  assert.deepEqual(r2.body.staff.map((s) => [s.name, s.state]), [["Ada Admin", "never"], ["Priya Clerk", "unavailable"], ["Sam Staff", "never"]]);
});

test("[avail] bad requests fail safely: wrong method, no/garbled body, unknown or non-string action", async () => {
  seed();
  assert.equal((await call("admin1", { action: "status" }, "GET")).status, 405);
  assert.equal((await call("admin1", undefined)).status, 400);
  assert.equal((await call("admin1", null)).status, 400);
  assert.equal((await call("admin1", "status")).status, 400);
  assert.equal((await call("admin1", {})).status, 400);
  for (const action of ["delete", "STATUS", "", 5, ["status"], { a: 1 }, "set ", "__proto__"]) assert.equal((await call("admin1", { action })).status, 400, JSON.stringify(action));
  const req = { method: "POST", headers: { authorization: "Bearer t-admin1" } };
  Object.defineProperty(req, "body", { get() { throw new Error("Invalid JSON"); } });
  const out = {};
  await require(path.join(root, "api/availability.js"))(req, { setHeader() {}, status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; } });
  assert.equal(out.status, 400, "malformed JSON is a 400, not a crash");
});

test("[avail] server code never trusts request fields for identity or time", () => {
  const source = read("api/availability.js");
  assert.ok(source.includes("FieldValue.serverTimestamp()"), "writes use the server clock");
  assert.ok(!/body\.(uid|userId|staffId|updatedAt|role)\b/.test(source), "no identity / time / role is read from the request body");
  assert.ok(source.includes("caller.uid") && source.includes("isPresenceRole(caller.role)") && source.includes('caller.role !== "admin"'));
});

/* ============================ PART 2: the screens ============================ */

function makeEl(id) {
  const classes = new Set();
  return {
    id, value: "", textContent: "", innerHTML: "", disabled: false, dataset: {}, attrs: {}, listeners: {},
    classList: { add: (...c) => c.forEach((x) => classes.add(x)), remove: (...c) => c.forEach((x) => classes.delete(x)), contains: (c) => classes.has(c), toggle(c, force) { const on = force === undefined ? !classes.has(c) : !!force; on ? classes.add(c) : classes.delete(c); return on; } },
    setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; },
    focus() {}, appendChild() {},
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    click() { return Promise.all((this.listeners.click || []).map((fn) => fn({ preventDefault() {} }))); },
    querySelector() { return this._submit || null; },
  };
}
const plain = (x) => JSON.parse(JSON.stringify(x));          // objects built inside the fake browser have another Object prototype
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r)); };

/** Fake browser with the real project scripts loaded. */
function browser(files, { ids = [], extras = {} } = {}) {
  const registry = {};
  const errors = {};
  ids.forEach((id) => { registry[id] = makeEl(id); });
  const document = {
    getElementById: (id) => registry[id] || null,
    querySelector(sel) { const m = /data-error-for="([^"]+)"/.exec(sel); return m ? (errors[m[1]] = errors[m[1]] || makeEl("err-" + m[1])) : null; },
    querySelectorAll: () => [],
    createElement: (tag) => makeEl(tag),
    body: { appendChild() {} },
    addEventListener() {},
  };
  const toasts = [];
  const sandbox = { document, console, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}, URLSearchParams, encodeURIComponent, showToast: (m, t) => toasts.push([t, m]), ...extras };
  sandbox.window = sandbox;
  sandbox.SITE_BASE = "../";
  const ctx = vm.createContext(sandbox);
  for (const f of files) vm.runInContext(read(f), ctx, { filename: f });
  // the toast stub must win over components.js's own showToast when both are loaded
  ctx.showToast = (m, t) => toasts.push([t, m]);
  return { ctx, registry, errors, toasts, run: (code) => vm.runInContext(code, ctx) };
}
const UI = ["js/utils.js", "js/validation.js", "js/availability-ui.js"];
const FRESH = new Date(Date.now() - 5 * MIN).toISOString();

/* ---------- citizen ---------- */

test("[citizen] the three states: 'Office Available', 'No Staff or Admin Currently Available', 'Availability Unavailable'", async () => {
  const cases = [
    [{ state: "available", enabled: true, lastUpdated: FRESH, staleAfterMinutes: 120, officeLabel: "Gram Panchayat Office" }, "Office Available"],
    [{ state: "none", enabled: true, lastUpdated: FRESH, staleAfterMinutes: 120, officeLabel: "Gram Panchayat Office" }, "No Staff or Admin Currently Available"],
    [{ state: "disabled", enabled: false, lastUpdated: null }, "Availability Disabled"],
  ];
  for (const [response, title] of cases) {
    const b = browser(UI, { ids: ["panel"] });
    b.ctx.GPAvailability = { getStatus: async () => response };
    b.run("initCitizenAvailability(document.getElementById('panel'), {})");
    await settle();
    const html = b.registry.panel.innerHTML;
    assert.ok(html.includes(title), `${title}: ${html.slice(0, 120)}`);
    assert.match(html, /reported by staff\/admin themselves/i, "staff-reported notice is always shown");
    if (response.state !== "disabled") {
      assert.match(html, /Last updated: /, "last-updated time");
      assert.match(html, /Location: Gram Panchayat Office/);
      assert.match(html, /expires automatically after 120 minutes/);
    }
  }
});

test("[citizen] a disabled feature hides everything about staff, even if the payload carries it", async () => {
  const b = browser(UI, { ids: ["panel"] });
  b.ctx.GPAvailability = { getStatus: async () => ({ state: "disabled", enabled: false, lastUpdated: FRESH, officeLabel: "Secret Office", staleAfterMinutes: 5 }) };
  b.run("initCitizenAvailability(document.getElementById('panel'), {})");
  await settle();
  const html = b.registry.panel.innerHTML;
  assert.match(html, /Availability Disabled/);
  assert.match(html, /switched off/i, "clear disabled message");
  assert.ok(!/Last updated|Secret Office|Staff Available|No Staff or Admin Currently/.test(html));
});

test("[citizen] anything that cannot be verified shows 'Availability Unavailable' — never 'available'", async () => {
  const bad = [
    () => Promise.reject(new Error("Could not reach the server.")),      // network failure / 500
    () => new Promise(() => {}).then(() => ({})),                        // never settles (handled by the timeout test below)
    async () => null, async () => undefined, async () => "available", async () => 42, async () => [],
    async () => ({}), async () => ({ state: "maybe" }), async () => ({ state: "AVAILABLE" }), async () => ({ state: ["available"] }), async () => ({ enabled: true }),
  ];
  for (const [i, getStatus] of bad.entries()) {
    if (i === 1) continue;
    const b = browser(UI, { ids: ["panel"] });
    b.ctx.GPAvailability = { getStatus };
    b.run("initCitizenAvailability(document.getElementById('panel'), {})");
    await settle();
    const html = b.registry.panel.innerHTML;
    assert.match(html, /Availability Unavailable/, `case ${i}`);
    assert.ok(!/Office Available|No Staff or Admin Currently/.test(html), `case ${i} claimed a staff state`);
  }
  const b = browser(UI);
  await assert.rejects(b.run("availabilityWithTimeout(new Promise(() => {}), 20)"), /timeout/, "a hung request becomes 'unavailable'");
});

test("[citizen] text from the server is escaped, odd dates never show 'Invalid Date', and no staff details are rendered", async () => {
  const b = browser(UI, { ids: ["panel"] });
  b.ctx.GPAvailability = { getStatus: async () => ({ state: "available", enabled: true, lastUpdated: "not-a-date", staleAfterMinutes: 60, officeLabel: "<img src=x onerror=alert(1)>", staffName: "Sam Staff", uid: "abc123", mine: { x: 1 } }) };
  b.run("initCitizenAvailability(document.getElementById('panel'), {})");
  await settle();
  const html = b.registry.panel.innerHTML;
  assert.ok(!html.includes("<img") && html.includes("&lt;img"), "label is escaped");
  assert.ok(!/Invalid Date/.test(html));
  assert.match(html, /No staff or admin update has been recorded yet/);
  for (const hidden of ["Sam Staff", "abc123", "uid", "mine"]) assert.ok(!html.includes(hidden), `rendered "${hidden}"`);
});

test("[citizen] Refresh reloads the status and is disabled while loading", async () => {
  let calls = 0;
  const b = browser(UI, { ids: ["panel", "refresh"] });
  b.ctx.GPAvailability = { getStatus: async () => { calls++; return { state: calls === 1 ? "none" : "available", enabled: true, lastUpdated: FRESH, staleAfterMinutes: 60, officeLabel: "Office" }; } };
  b.run("initCitizenAvailability(document.getElementById('panel'), { refreshBtn: document.getElementById('refresh') })");
  await settle();
  assert.match(b.registry.panel.innerHTML, /No Staff or Admin Currently Available/);
  assert.equal(b.registry.refresh.disabled, false);
  await b.registry.refresh.click();
  await settle();
  assert.equal(calls, 2);
  assert.match(b.registry.panel.innerHTML, /Office Available/);
});

/* ---------- staff ---------- */

const STAFF_IDS = ["iah-state", "iah-detail", "iah-toggle", "iah-renew", "iah-note"];
function staffStatus(over = {}, mine = {}) {
  return { state: "none", enabled: true, lastUpdated: FRESH, staleAfterMinutes: 120, officeLabel: "Office", mine: { available: false, reported: false, updatedAt: null, expiresAt: null, ...mine }, ...over };
}
function mountStaff(responses, { setMine } = {}) {
  const b = browser(UI, { ids: STAFF_IDS });
  const queue = [...responses];
  const calls = { get: 0, set: [] };
  b.ctx.GPAvailability = {
    getStatus: async () => { calls.get++; const next = queue.length > 1 ? queue.shift() : queue[0]; if (next instanceof Error) throw next; return next; },
    setMine: async (v) => { calls.set.push(v); if (setMine) return setMine(v); return { ok: true }; },
  };
  b.run("initStaffAvailabilityControl()");
  return { ...b, calls, toggle: b.registry["iah-toggle"], renew: b.registry["iah-renew"], detail: () => b.registry["iah-detail"].textContent, state: () => b.registry["iah-state"].innerHTML };
}

test("[staff] 'I Am Here' marks the staff member available, then offers 'Mark me unavailable' and a renew button", async () => {
  const s = mountStaff([staffStatus(), staffStatus({ state: "available" }, { available: true, reported: true, updatedAt: FRESH, expiresAt: new Date(Date.now() + 100 * MIN).toISOString() })]);
  await settle();
  assert.equal(s.toggle.textContent, "I Am Here");
  assert.equal(s.toggle.disabled, false);
  assert.equal(s.renew.classList.contains("hidden"), true);
  assert.match(s.state(), /unavailable/i);

  await s.toggle.click();
  await settle();
  assert.deepEqual(s.calls.set, [true]);
  assert.equal(s.toggle.textContent, "Mark me unavailable");
  assert.equal(s.renew.classList.contains("hidden"), false, "renew is offered while available");
  assert.match(s.state(), /You are marked as available/);
  assert.match(s.detail(), /Confirmed .* expires at /);
  assert.ok(s.toasts.some(([t, m]) => t === "success" && /available/.test(m)));
});

test("[staff] marking unavailable and renewing send the right request", async () => {
  const available = staffStatus({ state: "available" }, { available: true, reported: true, updatedAt: FRESH, expiresAt: FRESH });
  const s = mountStaff([available]);
  await settle();
  await s.toggle.click(); await settle();
  assert.deepEqual(s.calls.set, [false], "toggle while available withdraws");
  await s.renew.click(); await settle();
  assert.deepEqual(s.calls.set, [false, true], "renew re-confirms");
});

test("[staff] the control is DISABLED while the administrator has the feature switched off", async () => {
  const s = mountStaff([staffStatus({ enabled: false, state: "disabled", lastUpdated: null })]);
  await settle();
  assert.equal(s.toggle.disabled, true);
  assert.equal(s.renew.disabled, true);
  assert.match(s.detail(), /I Am Here feature is switched off/);
  await s.toggle.click(); await settle();
  assert.deepEqual(s.calls.set, [], "no request is sent while disabled");
});

test("[staff] an expired confirmation says so and offers 'I Am Here' again", async () => {
  const s = mountStaff([staffStatus({}, { available: false, reported: true, updatedAt: new Date(Date.now() - 5 * 60 * MIN).toISOString() })]);
  await settle();
  assert.match(s.detail(), /has expired/);
  assert.equal(s.toggle.textContent, "I Am Here");
  assert.equal(s.toggle.disabled, false);
});

test("[staff] if the status cannot be loaded the control is disabled and never claims availability", async () => {
  for (const response of [new Error("down"), null, { state: "weird" }, { state: "none", enabled: true }, "oops"]) {
    const s = mountStaff([response]);
    await settle();
    assert.equal(s.toggle.disabled, true, JSON.stringify(response));
    assert.match(s.detail(), /could not load/i);
    assert.ok(!/marked as available/.test(s.state()));
    await s.toggle.click(); await settle();
    assert.deepEqual(s.calls.set, []);
  }
});

test("[staff] a refused or failed update shows the reason and re-reads the real status", async () => {
  const s = mountStaff([staffStatus()], { setMine: async () => { throw new Error("Availability is switched off by the administrator."); } });
  await settle();
  const before = s.calls.get;
  await s.toggle.click(); await settle();
  assert.ok(s.toasts.some(([t, m]) => t === "error" && /switched off by the administrator/.test(m)));
  assert.ok(s.calls.get > before, "status was reloaded from the server");
  assert.equal(s.toggle.disabled, false, "control is usable again");
});

test("[staff] a double click sends one request", async () => {
  let release; const gate = new Promise((r) => { release = r; });
  const s = mountStaff([staffStatus()], { setMine: async () => { await gate; return { ok: true }; } });
  await settle();
  s.toggle.click(); await settle();
  s.toggle.click(); await settle();
  release(); await settle();
  assert.equal(s.calls.set.length, 1);
});

/* ---------- admin ---------- */

const ADMIN_IDS = ["iah-status", "iah-enable", "iah-disable", "iah-config-form", "iah-stale", "iah-label", "iah-staff-body", "iah-staff-empty"];
function overview(over = {}) {
  return { settings: { enabled: true, staleAfterMinutes: 90, officeLabel: "Gram Panchayat Office", updatedAt: FRESH }, staff: [
    { name: "Priya Clerk", state: "expired", updatedAt: FRESH }, { name: "<b>Sam</b> Staff", state: "available", updatedAt: FRESH }, { name: "New Hire", state: "never", updatedAt: null },
  ], serverTime: FRESH, ...over };
}
function mountAdmin(responses, { confirm = true, configure } = {}) {
  const b = browser(UI, { ids: ADMIN_IDS, extras: { confirm: () => confirm } });
  b.registry["iah-config-form"]._submit = makeEl("save");
  const queue = [...responses];
  const calls = { overview: 0, configure: [] };
  b.ctx.GPAvailability = {
    overview: async () => { calls.overview++; const next = queue.length > 1 ? queue.shift() : queue[0]; if (next instanceof Error) throw next; return next; },
    configure: async (c) => { calls.configure.push(c); if (configure) return configure(c); return { ok: true }; },
  };
  b.run("initAdminAvailabilitySettings()");
  const r = b.registry;
  return { ...b, calls, enable: r["iah-enable"], disable: r["iah-disable"], form: r["iah-config-form"], stale: r["iah-stale"], label: r["iah-label"], body: () => r["iah-staff-body"].innerHTML, status: () => r["iah-status"].innerHTML, submit: async () => { await Promise.all(r["iah-config-form"].listeners.submit.map((fn) => fn({ preventDefault() {} }))); await settle(); } };
}

test("[admin] shows whether the feature is enabled, the settings, and every staff member's availability (names escaped)", async () => {
  const on = mountAdmin([overview()]);
  await settle();
  assert.match(on.status(), /Enabled/);
  assert.equal(on.enable.disabled, true, "already on");
  assert.equal(on.disable.disabled, false);
  assert.equal(on.stale.value, "90");
  assert.equal(on.label.value, "Gram Panchayat Office");
  for (const text of ["Priya Clerk", "Expired", "Available", "Never confirmed"]) assert.ok(on.body().includes(text), text);
  assert.ok(!on.body().includes("<b>Sam</b>") && on.body().includes("&lt;b&gt;Sam"), "staff names are escaped");

  const off = mountAdmin([overview({ settings: { enabled: false, staleAfterMinutes: 120, officeLabel: "Office", updatedAt: null } })]);
  await settle();
  assert.match(off.status(), /Disabled/);
  assert.equal(off.enable.disabled, false);
  assert.equal(off.disable.disabled, true);
});

test("[admin] Enable / Disable change the global setting; Disable asks for confirmation first", async () => {
  const a = mountAdmin([overview({ settings: { enabled: false, staleAfterMinutes: 120, officeLabel: "Office", updatedAt: null } }), overview()]);
  await settle();
  await a.enable.click(); await settle();
  assert.deepEqual(plain(a.calls.configure), [{ enabled: true }]);
  assert.ok(a.toasts.some(([t, m]) => t === "success" && /enabled/.test(m)));
  assert.match(a.status(), /Enabled/, "shows the server's new state");

  const declined = mountAdmin([overview()], { confirm: false });
  await settle();
  await declined.disable.click(); await settle();
  assert.deepEqual(plain(declined.calls.configure), [], "cancelled confirmation changes nothing");

  const accepted = mountAdmin([overview(), overview({ settings: { enabled: false, staleAfterMinutes: 90, officeLabel: "Office", updatedAt: null } })], { confirm: true });
  await settle();
  await accepted.disable.click(); await settle();
  assert.deepEqual(plain(accepted.calls.configure), [{ enabled: false }]);
  assert.match(accepted.status(), /Disabled/);
});

test("[admin] expiry and office-name settings are validated before anything is sent", async () => {
  const a = mountAdmin([overview()]);
  await settle();
  for (const [stale, label] of [["4", "Office"], ["1441", "Office"], ["abc", "Office"], ["", "Office"], ["12.5", "Office"], ["-3", "Office"], ["60", ""], ["60", "x".repeat(81)]]) {
    a.stale.value = stale; a.label.value = label;
    await a.submit();
    assert.deepEqual(plain(a.calls.configure), [], `sent ${stale}/${label.length}`);
  }
  a.stale.value = " 45 "; a.label.value = "  Gram Panchayat Office, Rampur  ";
  await a.submit();
  assert.deepEqual(plain(a.calls.configure), [{ staleAfterMinutes: 45, officeLabel: "Gram Panchayat Office, Rampur" }]);
  assert.ok(a.toasts.some(([t]) => t === "success"));
});

test("[admin] a server refusal is shown, and a failed overview locks the controls instead of guessing", async () => {
  const refused = mountAdmin([overview()], { configure: async () => { throw new Error("You do not have permission to do this."); } });
  await settle();
  await refused.enable.click(); await refused.disable.click(); await settle();
  assert.ok(refused.toasts.some(([t, m]) => t === "error" && /permission/.test(m)));

  for (const response of [new Error("down"), null, {}, { settings: {}, staff: [] }, { settings: { enabled: true }, staff: "x" }]) {
    const broken = mountAdmin([response]);
    await settle();
    assert.equal(broken.enable.disabled, true);
    assert.equal(broken.disable.disabled, true);
    assert.match(broken.status(), /Status unavailable/);
    assert.match(broken.registry["iah-staff-empty"].textContent, /Could not load/);
  }
});

/* ======================= PART 3: wiring, nav and rules ======================= */

test("[nav] 'Staff Availability' is in the citizen sidebar — on Dashboard, My Applications, Profile and the availability page itself", () => {
  const citizenPages = fs.readdirSync(path.join(root, "citizen")).filter((f) => f.endsWith(".html"));
  assert.deepEqual(citizenPages.sort(), ["application-details.html", "applications.html", "availability.html", "dashboard.html", "profile.html"]);
  for (const f of citizenPages) {
    const html = read(`citizen/${f}`);
    assert.match(html, /initDashboardShell\(\{ role: 'citizen'/, `${f} uses the shared citizen shell (which renders the sidebar)`);
    assert.ok(html.includes("../js/components.js"), f);
  }
  for (const [file, key] of [["dashboard.html", "dashboard"], ["applications.html", "applications"], ["profile.html", "profile"], ["availability.html", "availability"], ["application-details.html", "applications"]]) {
    const b = browser(["js/utils.js", "js/components.js"], { ids: ["site-header", "dashboard-sidebar", "logout-btn"] });
    b.run(`initDashboardShell({ role: 'citizen', activeKey: '${key}', pageTitle: 'x' })`);
    const nav = b.registry["dashboard-sidebar"].innerHTML;
    for (const item of ['href="dashboard.html"', 'href="applications.html"', 'href="profile.html"', 'href="availability.html"', "Staff Availability", "Dashboard", "My Applications", "Profile"]) {
      assert.ok(nav.includes(item), `${file}: sidebar is missing ${item}`);
    }
  }
  assert.ok(fs.existsSync(path.join(root, "citizen/availability.html")), "relative link target exists next to every citizen page");
});

test("[nav] the Staff and Admin sidebars did not gain a citizen-only link", () => {
  for (const role of ["staff", "admin"]) {
    const b = browser(["js/utils.js", "js/components.js"], { ids: ["site-header", "dashboard-sidebar", "logout-btn"] });
    b.run(`initDashboardShell({ role: '${role}', activeKey: 'dashboard', pageTitle: 'x' })`);
    assert.ok(!b.registry["dashboard-sidebar"].innerHTML.includes("availability.html"), role);
  }
});

test("[pages] the availability page and the three dashboards are wired to the feature", () => {
  const page = read("citizen/availability.html");
  assert.match(page, /protectPage\('citizen'/);
  assert.match(page, /activeKey: 'availability'/);
  assert.match(page, /initCitizenAvailability\(/);
  assert.match(page, /reported by|confirm their own presence/i);

  const dash = read("citizen/dashboard.html");
  assert.match(dash, /id="availability-card"/);
  assert.match(dash, /initCitizenAvailability\(document\.getElementById\('availability-card'\), \{ compact: true \}\)/);
  assert.match(dash, /href="availability\.html"/);

  const staff = read("staff/dashboard.html");
  assert.match(staff, /id="iah-toggle"[^>]*>I Am Here</);
  assert.match(staff, /initStaffAvailabilityControl\(\)/);
  const admin = read("admin/dashboard.html");
  assert.ok(admin.includes("Staff Availability / I Am Here Settings"));
  for (const id of ["iah-enable", "iah-disable", "iah-config-form", "iah-stale", "iah-label", "iah-staff-body"]) assert.ok(admin.includes(`id="${id}"`), id);
  assert.match(admin, /initAdminAvailabilitySettings\(\)/);

  for (const file of ["citizen/availability.html", "citizen/dashboard.html", "staff/dashboard.html", "admin/dashboard.html"]) {
    const html = read(file);
    const order = ["utils.js", "components.js", "availability-ui.js"].map((s) => html.indexOf(`../js/${s}`));
    assert.ok(order.every((i) => i > -1) && order[0] < order[1] && order[1] < order[2], `${file}: scripts must load utils → components → availability-ui`);
    assert.ok(html.includes('type="module" src="../js/availability.js"'), `${file} loads the data module`);
  }
});

test("[pages] staff are marked unavailable on logout (best effort, never blocks logging out)", async () => {
  assert.match(read("js/staff.js"), /GPBeforeLogout[\s\S]*\/api\/availability[\s\S]*available: false/);
  for (const [name, hook] of [["a hook that hangs", () => new Promise(() => {})], ["a hook that fails", async () => { throw new Error("offline"); }], ["no hook", undefined]]) {
    const logouts = [];
    const b = browser(["js/utils.js", "js/components.js"], {
      ids: ["site-header", "dashboard-sidebar", "logout-btn"],
      extras: { setTimeout: (fn, ms) => setTimeout(fn, ms === 2500 ? 5 : ms) },   // shrink the 2.5 s cap for the test
    });
    b.ctx.GPAuth = { logout: async (url) => { logouts.push(url); } };
    b.ctx.GPAvailability = {};
    if (hook) b.ctx.GPBeforeLogout = hook;
    b.run("initDashboardShell({ role: 'staff', activeKey: 'dashboard', pageTitle: 'x' })");
    await b.registry["logout-btn"].click();
    await new Promise((r) => setTimeout(r, 60));
    assert.deepEqual(logouts, ["../login.html"], `${name}: must still log out`);
  }
});

test("[rules] both collections are closed to every client — only /api/availability (Admin SDK) can touch them", () => {
  const rules = read("firestore.rules");
  for (const name of ["settings/{settingId}", "staffAvailability/{staffId}"]) {
    const block = new RegExp(`match /${name.replace(/[{}/]/g, (c) => "\\" + c)}\\s*\\{([^}]*)\\}`).exec(rules);
    assert.ok(block, `rules block for ${name}`);
    assert.match(block[1], /allow read, write: if false;/, name);
    assert.ok(!/allow[^;]*if (?!false)/.test(block[1]), `${name} must not allow anything`);
  }
});

/* ===================== admin + staff presence (logical OR) ===================== */

const present = (uid, ageMin = 1) => { store["staffAvailability/" + uid] = { available: true, updatedAt: Date.now() - ageMin * MIN }; };

test("[or] admin present, no staff present => office available", async () => {
  seed(); await enable(60);
  assert.equal((await setMine("admin1", true)).status, 200);
  assert.equal((await status("cit1")).body.state, "available");
});

test("[or] staff present, admin absent => office available", async () => {
  seed(); await enable(60);
  await setMine("staff1", true);
  assert.equal((await status("cit1")).body.state, "available");
});

test("[or] both present => available; neither present => unavailable", async () => {
  seed(); await enable(60);
  await setMine("staff1", true); await setMine("admin1", true);
  assert.equal((await status("cit1")).body.state, "available");
  await setMine("staff1", false); await setMine("admin1", false);
  assert.equal((await status("cit1")).body.state, "none");
});

test("[or] marking yourself not present changes only YOUR status; the other person keeps the office available", async () => {
  seed(); await enable(60);
  await setMine("staff1", true); await setMine("admin1", true);
  await setMine("staff1", false);
  assert.equal(store["staffAvailability/staff1"].available, false);
  assert.equal(store["staffAvailability/admin1"].available, true, "admin's entry untouched");
  assert.equal((await status("cit1")).body.state, "available");
  await setMine("admin1", false);
  assert.equal((await status("cit1")).body.state, "none");
});

test("[or] one person's status expires but another remains present => available; all expire => unavailable", async () => {
  seed(); await enable(60);
  present("admin1", 5); present("staff1", 90);                     // staff expired, admin fresh
  assert.equal((await status("cit1")).body.state, "available");
  present("admin1", 61);                                            // now both expired
  assert.equal((await status("cit1")).body.state, "none");
  present("staff1", 10);                                            // staff fresh, admin expired
  assert.equal((await status("cit1")).body.state, "available");
});

test("[or] a deactivated or demoted admin does not keep the office available", async () => {
  seed(); await enable(60);
  present("admin1");
  assert.equal((await status("cit1")).body.state, "available");
  store["users/admin1"].active = false;  assert.equal((await status("cit1")).body.state, "none");
  store["users/admin1"].active = true; store["users/admin1"].role = "citizen";
  assert.equal((await status("cit1")).body.state, "none", "no longer an admin or staff member");
});

test("[or] disabled => citizens see 'disabled'; re-enabling never revives an EXPIRED status", async () => {
  seed(); await enable(30);
  present("admin1", 5);
  await configure("admin1", { enabled: false });
  assert.equal((await status("cit1")).body.state, "disabled");
  assert.equal((await setMine("admin1", true)).status, 409, "admin cannot change presence while disabled");
  assert.equal((await setMine("staff1", true)).status, 409, "nor staff");
  present("admin1", 45);                                           // time passes while the feature is off
  await configure("admin1", { enabled: true });
  assert.equal((await status("cit1")).body.state, "none", "expired presence stays expired");
});

test("[or] unauthorized users cannot update presence, and nobody can update ANOTHER person's presence", async () => {
  seed(); await enable(60);
  assert.equal((await setMine(null, true)).status, 401);
  assert.equal((await setMine("cit1", true)).status, 403);
  assert.equal((await setMine("staff3", true)).status, 403, "deactivated staff");
  assert.equal((await setMine("nobody", true)).status, 403);
  assert.ok(!Object.keys(store).some((k) => k.startsWith("staffAvailability/")));
  // staff cannot write the admin's entry (or vice-versa) however the request is shaped
  await setMine("staff1", true, { uid: "admin1", staffId: "admin1", userId: "admin1" });
  assert.deepEqual(Object.keys(store).filter((k) => k.startsWith("staffAvailability/")), ["staffAvailability/staff1"]);
  await setMine("admin1", true, { uid: "staff2", staffId: "staff2" });
  assert.deepEqual(Object.keys(store).filter((k) => k.startsWith("staffAvailability/")).sort(), ["staffAvailability/admin1", "staffAvailability/staff1"]);
  // only admins change global settings
  assert.equal((await configure("staff1", { enabled: false })).status, 403);
});

test("[or] citizens see no admin/staff identity, and never receive a per-person block", async () => {
  seed(); await enable(60);
  await setMine("admin1", true);
  const r = await status("cit1");
  assert.deepEqual(Object.keys(r.body).sort(), ["enabled", "lastUpdated", "officeLabel", "serverTime", "staleAfterMinutes", "state"]);
  assert.ok(!/Ada|admin1|@/.test(JSON.stringify(r.body)));
  assert.equal((await status("admin1")).body.mine.available, true, "the admin sees their OWN state");
});

test("[or] backend failure => the API gives no state, and the citizen screen shows 'Availability Unavailable'", async () => {
  seed(); await enable(60); present("admin1");
  failReadsOf = "staffAvailability/";
  const r = await status("cit1");
  failReadsOf = null;
  assert.equal(r.status, 500);
  assert.ok(!("state" in r.body));
  const b = browser(UI, { ids: ["panel"] });
  b.ctx.GPAvailability = { getStatus: async () => { throw new Error("Availability is not available right now."); } };
  b.run("initCitizenAvailability(document.getElementById('panel'), {})");
  await settle();
  assert.match(b.registry.panel.innerHTML, /Availability Unavailable/);
  assert.ok(!/Office Available/.test(b.registry.panel.innerHTML));
});

test("[or] the admin dashboard has its own I Am Here control wired to the shared code; admin logout withdraws presence", () => {
  const page = read("admin/dashboard.html");
  for (const id of ["iah-state", "iah-detail", "iah-toggle", "iah-renew", "iah-note", "iah-enable", "iah-disable"]) assert.ok(page.includes('id="' + id + '"'), id);
  assert.ok(page.includes("initStaffAvailabilityControl()") && page.includes("initAdminAvailabilitySettings()"));
  const admin = read("js/admin.js");
  assert.match(admin, /window\.GPBeforeLogout[\s\S]*action: "set", available: false/);
});

test("[or] the admin overview marks admins as admins and escapes names", async () => {
  const b = browser(UI, { ids: ["iah-status", "iah-enable", "iah-disable", "iah-config-form", "iah-stale", "iah-label", "iah-staff-body", "iah-staff-empty"] });
  b.ctx.GPAvailability = { overview: async () => ({ settings: { enabled: true, staleAfterMinutes: 60, officeLabel: "Office" }, staff: [{ name: "<b>Ada</b>", role: "admin", state: "available", updatedAt: FRESH }] }) };
  b.run("initAdminAvailabilitySettings()");
  await settle();
  const html = b.registry["iah-staff-body"].innerHTML;
  assert.ok(html.includes("(Admin)") && html.includes("&lt;b&gt;Ada") && !html.includes("<b>Ada"));
});
