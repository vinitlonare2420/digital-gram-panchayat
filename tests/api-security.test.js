/* ==========================================================================
   tests/api-security.test.js — authorization & input-safety tests for /api.

   Run with:  npm test      (Node's built-in test runner, no extra packages)

   The REAL api/*.js handlers are loaded, but Firebase Admin, Firestore and
   Supabase are replaced with small in-memory fakes, so these tests:
     - never touch the real Firebase / Supabase projects,
     - need no credentials or network.

   The number in each test name ([#4] etc.) is the item in the security audit
   checklist. What this file CANNOT cover is Firestore security rules (they
   need the Firestore emulator) and the browser pages — those are covered by
   the manual steps in the security audit report.
   ========================================================================== */

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createRequire } = require("node:module");
const { spawnSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const resolveFrom = (dir, id) => createRequire(path.join(root, dir, "x.js")).resolve(id);

/* ---------------------------- in-memory fakes ---------------------------- */

let store = {};            // "collection/id" or "collection/id/sub/id" -> data
let autoId = 0;
let failProfileWrite = false;
const authCalls = [];      // record of firebase-admin Auth calls
const authUsers = new Set();
const removedFiles = [];   // paths passed to storage.remove()
const signedUploadPaths = [];
const storedFiles = new Map();   // path -> { size, mimetype, eTag }: what the fake private bucket really holds
let failStorageList = false;

function fakeRef(p) {
  return {
    path: p,
    async get() { return { exists: p in store, data: () => store[p], id: p.split("/").pop() }; },
    async set(d) { if (failProfileWrite && p.startsWith("users/")) throw new Error("boom"); store[p] = d; },
    async update(d) { store[p] = { ...store[p], ...d }; },
    collection(sub) { return { doc: (id) => fakeRef(`${p}/${sub}/${id || "auto" + ++autoId}`) }; },
  };
}
const fakeDb = {
  collection(name) {
    return {
      doc: (id) => fakeRef(`${name}/${id}`),
      limit: () => ({
        get: async () => ({
          docs: Object.keys(store).filter((k) => k.startsWith(name + "/") && k.split("/").length === 2)
            .map((k) => ({ id: k.split("/")[1], data: () => store[k] })),
        }),
      }),
    };
  },
  async runTransaction(fn) {
    return fn({
      get: (ref) => ref.get(),
      update: (ref, d) => { store[ref.path] = { ...store[ref.path], ...d }; },
      set: (ref, d) => { store[ref.path] = d; },
    });
  },
};

const fakeAuth = {
  async createUser({ email }) {
    if (authUsers.has(email)) { const e = new Error("dup"); e.code = "auth/email-already-exists"; throw e; }
    authUsers.add(email);
    authCalls.push(["createUser", email]);
    return { uid: "newuser" + (++autoId) };
  },
  async deleteUser(uid) { authCalls.push(["deleteUser", uid]); },
  async updateUser(uid, props) { authCalls.push(["updateUser", uid, props]); },
  async revokeRefreshTokens(uid) { authCalls.push(["revokeRefreshTokens", uid]); },
};

function install(id, exports) {
  require.cache[id] = { id, filename: id, loaded: true, exports };
}
install(resolveFrom("api/_lib", "./firebaseAdmin"), {
  getFirestore: () => fakeDb,
  getFirebaseAdmin: () => ({}),
  async verifyIdToken(req) {
    const m = /^Bearer t-(\w+)$/.exec(req.headers.authorization || "");
    if (!m) { const e = new Error("x"); e.statusCode = 401; throw e; }
    return { uid: m[1] };
  },
});
install(resolveFrom("api/admin", "firebase-admin/auth"), { getAuth: () => fakeAuth });
install(resolveFrom("api/_lib", "./supabaseAdmin"), {
  getBucket: () => "gp-documents",
  getSupabaseAdmin: () => ({
    storage: {
      from: () => ({
        async createSignedUploadUrl(p) { signedUploadPaths.push(p); return { data: { path: p, signedUrl: "https://example.test/up/" + p, token: "tok" }, error: null }; },
        async createSignedUrl(p) { return { data: { signedUrl: "https://example.test/dl/" + p }, error: null }; },
        async remove(list) { removedFiles.push(...list); return { error: null }; },
        async list(folder) {
          if (failStorageList) return { data: null, error: new Error("storage down") };
          const prefix = folder + "/";
          const data = [...storedFiles].filter(([p]) => p.startsWith(prefix) && !p.slice(prefix.length).includes("/"))
            .map(([p, m]) => ({ name: p.slice(prefix.length), metadata: m }));
          return { data, error: null };
        },
      }),
    },
  }),
});

/* -------------------------------- helpers -------------------------------- */

const APP = "AbCdEfGhIjKlMnOp1234";          // cit1's application
const OWN_PATH = `applications/cit1/${APP}/11111111-aaaa-4aaa-8aaa-111111111111-id.pdf`;
const VICTIM_PATH = `applications/cit2/ZzZzZzZzZzZzZzZz9999/22222222-bbbb-4bbb-8bbb-222222222222-secret.pdf`;

function seed() {
  store = {
    "users/cit1": { role: "citizen", name: "Cit One", active: true },
    "users/cit2": { role: "citizen", name: "Cit Two" },              // legacy profile, no `active` field
    "users/staff1": { role: "staff", name: "Sam Staff", active: true },
    "users/staff2": { role: "staff", name: "Off Staff", active: false },
    "users/admin1": { role: "admin", name: "Ada Admin", active: true },
    [`applications/${APP}`]: { userId: "cit1", status: "submitted", documents: [{ name: "id.pdf", path: OWN_PATH }] },
  };
  authCalls.length = 0; authUsers.clear(); removedFiles.length = 0; signedUploadPaths.length = 0; storedFiles.clear(); failStorageList = false;
  failProfileWrite = false;
}

async function call(file, uid, body, method = "POST") {
  const req = { method, headers: uid ? { authorization: `Bearer t-${uid}` } : {}, body };
  const out = {};
  const res = { setHeader() {}, status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; } };
  await require(path.join(root, file))(req, res);
  return out;
}

const STATUS = "api/staff/update-application-status.js";
const DOWNLOAD = "api/documents/create-download-url.js";
const UPLOAD = "api/documents/create-upload-url.js";
const NEW_APP = "NewApp1234567890ABCD";   // an application id that does not exist yet (uploads come BEFORE the application is written)
const CLEANUP = "api/documents/cleanup-upload.js";
const LIST = "api/admin/list-users.js";
const CREATE_STAFF = "api/admin/create-staff.js";
const UPDATE_USER = "api/admin/update-user.js";
const statusBody = (status, remarks) => ({ applicationDocId: APP, status, remarks });

/* ============ [#1] citizens cannot call Admin APIs ============ */

test("[#1] citizen is refused by every admin API and nothing changes", async () => {
  seed();
  const before = JSON.stringify(store);
  for (const f of [LIST, CREATE_STAFF, UPDATE_USER]) {
    assert.equal((await call(f, "cit1", { uid: "cit2", role: "staff", name: "Mallory", email: "m@x.io", password: "a-long-password-123" })).status, 403, f);
  }
  assert.equal(JSON.stringify(store), before, "store must be untouched");
  assert.deepEqual(authCalls, [], "no Firebase Auth calls");
});

test("[#1] admin APIs reject missing / invalid sessions with 401", async () => {
  seed();
  for (const f of [LIST, CREATE_STAFF, UPDATE_USER]) {
    assert.equal((await call(f, null, {})).status, 401, f + " no token");
  }
  const bad = await call(LIST, "x", {}); // token 't-x' is valid-format but user has no profile
  assert.equal(bad.status, 403);
});

/* ============ [#2] staff cannot do admin-only operations ============ */

test("[#2] staff cannot create staff, change roles, deactivate users or list users", async () => {
  seed();
  const before = JSON.stringify(store);
  assert.equal((await call(LIST, "staff1", {})).status, 403);
  assert.equal((await call(CREATE_STAFF, "staff1", { name: "New Guy", email: "n@x.io", password: "a-long-password-123" })).status, 403);
  assert.equal((await call(UPDATE_USER, "staff1", { uid: "cit1", role: "staff" })).status, 403);
  assert.equal((await call(UPDATE_USER, "staff1", { uid: "cit1", active: false })).status, 403);
  assert.equal((await call(UPDATE_USER, "staff1", { uid: "admin1", active: false })).status, 403);
  assert.equal(JSON.stringify(store), before);
  assert.deepEqual(authCalls, []);
});

test("[#2] a deactivated admin-API caller is refused (role is re-read every request)", async () => {
  seed();
  store["users/admin1"].active = false;
  assert.equal((await call(LIST, "admin1", {})).status, 403);
});

/* ============ [#4] document download authorization ============ */

test("[#4] download: no login 401, bad input 400, unknown application 404", async () => {
  seed();
  assert.equal((await call(DOWNLOAD, null, { applicationDocId: APP, path: OWN_PATH })).status, 401);
  assert.equal((await call(DOWNLOAD, "cit1", { applicationDocId: "", path: OWN_PATH })).status, 400);
  assert.equal((await call(DOWNLOAD, "cit1", { applicationDocId: APP })).status, 400);
  assert.equal((await call(DOWNLOAD, "cit1", { applicationDocId: "NoSuchApp123456789", path: OWN_PATH })).status, 404);
});

test("[#4] download: owner, staff and admin are allowed; other citizens and deactivated staff are not", async () => {
  seed();
  assert.equal((await call(DOWNLOAD, "cit1", { applicationDocId: APP, path: OWN_PATH })).status, 200, "owner");
  assert.equal((await call(DOWNLOAD, "staff1", { applicationDocId: APP, path: OWN_PATH })).status, 200, "staff");
  assert.equal((await call(DOWNLOAD, "admin1", { applicationDocId: APP, path: OWN_PATH })).status, 200, "admin");
  assert.equal((await call(DOWNLOAD, "cit2", { applicationDocId: APP, path: OWN_PATH })).status, 403, "other citizen");
  assert.equal((await call(DOWNLOAD, "staff2", { applicationDocId: APP, path: OWN_PATH })).status, 403, "deactivated staff");
});

test("[#4] download: a path that is not listed on the application is refused", async () => {
  seed();
  assert.equal((await call(DOWNLOAD, "cit1", { applicationDocId: APP, path: VICTIM_PATH })).status, 403);
  assert.equal((await call(DOWNLOAD, "staff1", { applicationDocId: APP, path: "applications/cit1/x/other.pdf" })).status, 403);
});

test("[#4] download: documents[] is written by the citizen, so a crafted entry pointing at ANOTHER user's file must still be refused", async () => {
  seed();
  // cit1 creates their own application but lists cit2's private file in documents[].
  store["applications/EvilApp1234567890AB"] = { userId: "cit1", status: "submitted", documents: [{ name: "x", path: VICTIM_PATH }] };
  const r = await call(DOWNLOAD, "cit1", { applicationDocId: "EvilApp1234567890AB", path: VICTIM_PATH });
  assert.equal(r.status, 403, "got a signed URL for someone else's file");
  // ...and a path traversal attempt inside the owner's own folder is refused too
  store["applications/EvilApp1234567890AB"].documents.push({ path: "applications/cit1/EvilApp1234567890AB/../../cit2/x.pdf" });
  assert.equal((await call(DOWNLOAD, "cit1", { applicationDocId: "EvilApp1234567890AB", path: "applications/cit1/EvilApp1234567890AB/../../cit2/x.pdf" })).status, 403);
});

/* ============ [#5] citizens cannot approve / reject by tampering ============ */

test("[#5] a citizen cannot change status even by sending a staff role or user id in the request", async () => {
  seed();
  for (const status of ["under_review", "approved", "rejected"]) {
    const r = await call(STATUS, "cit1", { ...statusBody(status, "please approve"), role: "staff", userId: "staff1", uid: "staff1" });
    assert.equal(r.status, 403, status);
  }
  assert.equal(store[`applications/${APP}`].status, "submitted");
  assert.equal(Object.keys(store).filter((k) => k.includes("/statusHistory/")).length, 0, "no history written");
});

test("[#5] role/uid in the request body or headers never changes who the caller is", async () => {
  seed();
  const req = { method: "POST", headers: { authorization: "Bearer t-cit1", "x-role": "admin", "x-user-id": "admin1" }, body: { ...statusBody("under_review"), role: "admin" } };
  const out = {};
  await require(path.join(root, STATUS))(req, { setHeader() {}, status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; } });
  assert.equal(out.status, 403);
});

/* ============ [#6] transitions + history validated server-side ============ */

test("[#6] only submitted->under_review->approved|rejected is allowed", async () => {
  seed();
  assert.equal((await call(STATUS, "staff1", statusBody("approved"))).status, 409, "skip review");
  assert.equal((await call(STATUS, "staff1", statusBody("rejected", "no good reason here"))).status, 409, "skip review (reject)");
  assert.equal((await call(STATUS, "staff1", statusBody("under_review"))).status, 200);
  assert.equal((await call(STATUS, "staff1", statusBody("under_review"))).status, 409, "repeat");
  assert.equal((await call(STATUS, "staff1", statusBody("rejected", "ab"))).status, 400, "reason too short");
  assert.equal((await call(STATUS, "staff1", statusBody("rejected"))).status, 400, "reason missing");
  assert.equal((await call(STATUS, "staff1", statusBody("certificate_available"))).status, 400, "unknown status");
  assert.equal((await call(STATUS, "staff1", statusBody("approved", "x".repeat(1001)))).status, 400, "reason too long");
  assert.equal((await call(STATUS, "staff1", statusBody("approved", "Verified"))).status, 200);
  assert.equal((await call(STATUS, "staff1", statusBody("under_review"))).status, 409, "no going back");
  assert.equal((await call(STATUS, "admin1", statusBody("rejected", "changing my mind now"))).status, 409, "decision is final");
});

test("[#6] each valid change writes exactly one history entry with the reviewer; invalid ones write none", async () => {
  seed();
  await call(STATUS, "staff1", statusBody("approved"));                    // invalid -> nothing
  await call(STATUS, "staff1", statusBody("under_review"));
  await call(STATUS, "staff1", statusBody("approved", "Documents verified"));
  const history = Object.entries(store).filter(([k]) => k.includes("/statusHistory/")).map(([, v]) => v);
  assert.deepEqual(history.map((h) => h.status), ["under_review", "approved"]);
  assert.equal(history[1].remarks, "Documents verified");
  assert.equal(history[1].updatedBy, "staff1");
  const app = store[`applications/${APP}`];
  assert.equal(app.status, "approved");
  assert.equal(app.reviewedBy, "staff1");
});

test("[#6] unknown / malformed application ids are rejected without side effects", async () => {
  seed();
  assert.equal((await call(STATUS, "staff1", { applicationDocId: "ZzZzZzZzZzZzZzZz9999", status: "under_review" })).status, 404);
  assert.equal((await call(STATUS, "staff1", { applicationDocId: "../users/admin1", status: "under_review" })).status, 400);
  assert.equal((await call(STATUS, "staff1", { applicationDocId: { $ne: 1 }, status: "under_review" })).status, 400);
});

test("[#6] staff cannot review their own application (conflict of interest)", async () => {
  seed();
  store["applications/StaffOwnApp1234567890"] = { userId: "staff1", status: "submitted", documents: [] };
  const r = await call(STATUS, "staff1", { applicationDocId: "StaffOwnApp1234567890", status: "under_review" });
  assert.equal(r.status, 403, "reviewer approved/advanced their own application");
  assert.equal(store["applications/StaffOwnApp1234567890"].status, "submitted");
});

/* ============ [#7] admin accounts cannot be created through the portal ============ */

test("[#7] create-staff always creates role 'staff' — a role in the request body is ignored", async () => {
  seed();
  const r = await call(CREATE_STAFF, "admin1", { name: "Sneaky Admin", email: "sneaky@x.io", password: "a-long-password-123", role: "admin", active: false });
  assert.equal(r.status, 200);
  const created = store[`users/${r.body.uid}`];
  assert.equal(created.role, "staff");
  assert.equal(created.active, true);
});

test("[#7] create-staff: duplicate email 409, bad input 400, profile-write failure rolls the Auth user back", async () => {
  seed();
  assert.equal((await call(CREATE_STAFF, "admin1", { name: "A B", email: "dup@x.io", password: "a-long-password-123" })).status, 200);
  assert.equal((await call(CREATE_STAFF, "admin1", { name: "A B", email: "dup@x.io", password: "a-long-password-123" })).status, 409);
  assert.equal((await call(CREATE_STAFF, "admin1", { name: "A B", email: "not-an-email", password: "a-long-password-123" })).status, 400);
  assert.equal((await call(CREATE_STAFF, "admin1", { name: "A B", email: "ok@x.io", password: "short" })).status, 400);
  assert.equal((await call(CREATE_STAFF, "admin1", { name: "A B", email: "ok@x.io", mobile: "123", password: "a-long-password-123" })).status, 400);
  failProfileWrite = true;
  authCalls.length = 0;
  assert.equal((await call(CREATE_STAFF, "admin1", { name: "A B", email: "rollback@x.io", password: "a-long-password-123" })).status, 500);
  assert.ok(authCalls.some((c) => c[0] === "deleteUser"), "orphan Auth user must be deleted");
});

test("[#7] update-user can never grant the admin role", async () => {
  seed();
  assert.equal((await call(UPDATE_USER, "admin1", { uid: "cit1", role: "admin" })).status, 400);
  assert.equal(store["users/cit1"].role, "citizen");
});

test("[#7] the first-admin script refuses to run without an interactive terminal", () => {
  const r = spawnSync(process.execPath, [path.join(root, "scripts/create-first-admin.js")], { input: "", encoding: "utf8", env: { ...process.env, FIREBASE_SERVICE_ACCOUNT_KEY: "" } });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /interactive terminal/);
});

/* ============ [#8] the last administrator cannot be removed or demoted ============ */

test("[#8] no API call can deactivate, demote or modify an admin (including the only admin)", async () => {
  seed();
  const before = JSON.stringify(store["users/admin1"]);
  assert.equal((await call(UPDATE_USER, "admin1", { uid: "admin1", active: false })).status, 403, "self deactivate");
  assert.equal((await call(UPDATE_USER, "admin1", { uid: "admin1", role: "citizen" })).status, 403, "self demote");
  assert.equal((await call(UPDATE_USER, "admin1", { uid: "admin1", role: "staff" })).status, 403, "self demote to staff");
  store["users/admin2"] = { role: "admin", name: "Second", active: true };
  assert.equal((await call(UPDATE_USER, "admin1", { uid: "admin2", active: false })).status, 403, "other admin");
  assert.equal((await call(UPDATE_USER, "staff1", { uid: "admin1", active: false })).status, 403, "staff -> admin");
  assert.equal((await call(UPDATE_USER, "cit1", { uid: "admin1", role: "citizen" })).status, 403, "citizen -> admin");
  assert.equal(JSON.stringify(store["users/admin1"]), before);
  assert.deepEqual(authCalls, [], "no Auth disable/revoke calls were made");
});

test("[#8] deactivating staff disables the Auth account and revokes sessions; reactivating restores it", async () => {
  seed();
  assert.equal((await call(UPDATE_USER, "admin1", { uid: "staff1", active: false })).status, 200);
  assert.equal(store["users/staff1"].active, false);
  assert.ok(authCalls.some((c) => c[0] === "updateUser" && c[2].disabled === true));
  assert.ok(authCalls.some((c) => c[0] === "revokeRefreshTokens"));
  assert.equal((await call(STATUS, "staff1", statusBody("under_review"))).status, 403, "deactivated staff is locked out immediately");
  assert.equal((await call(UPDATE_USER, "admin1", { uid: "staff1", active: true })).status, 200);
  assert.equal((await call(STATUS, "staff1", statusBody("under_review"))).status, 200, "reactivated staff works again");
});

/* ============ [#10] invalid input, missing auth, unauthorized -> fail safely ============ */

test("[#10] every endpoint rejects non-POST with 405", async () => {
  seed();
  for (const f of [STATUS, DOWNLOAD, UPLOAD, CLEANUP, LIST, CREATE_STAFF, UPDATE_USER]) {
    assert.equal((await call(f, "admin1", {}, "GET")).status, 405, f);
  }
});

test("[#10] malformed request bodies never crash a handler or return a 5xx", async () => {
  seed();
  const bodies = [undefined, null, "a string", 42, true, [], [1, 2], {}, { applicationDocId: {} }, { applicationDocId: [APP], status: ["approved"] },
    { uid: { a: 1 }, active: "yes" }, { name: 5, email: {}, password: [] }, { path: 5 }, { fileName: {}, fileType: [], fileSize: "100" }, { a: "x".repeat(100000) }];
  for (const f of [STATUS, DOWNLOAD, UPLOAD, CLEANUP, CREATE_STAFF, UPDATE_USER]) {
    for (const uid of ["staff1", "admin1", "cit1", null]) {
      for (const body of bodies) {
        const r = await call(f, uid, body);
        assert.ok(typeof r.status === "number" && r.status < 500, `${f} as ${uid} with ${JSON.stringify(body)?.slice(0, 40)} -> ${r.status}`);
      }
    }
  }
});

test("[#10] malformed JSON (req.body throws while parsing) returns 400, not a crash", async () => {
  seed();
  for (const [f, uid] of [[STATUS, "staff1"], [DOWNLOAD, "cit1"], [UPLOAD, "cit1"], [CREATE_STAFF, "admin1"], [UPDATE_USER, "admin1"]]) {
    const req = { method: "POST", headers: { authorization: `Bearer t-${uid}` } };
    Object.defineProperty(req, "body", { get() { throw new Error("Invalid JSON"); } });
    const out = {};
    await require(path.join(root, f))(req, { setHeader() {}, status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; } });
    assert.equal(out.status, 400, f);
  }
});

test("[#10] error responses are generic — no stack traces, keys or internal details", async () => {
  seed();
  const samples = [await call(STATUS, "cit1", statusBody("approved")), await call(DOWNLOAD, "cit2", { applicationDocId: APP, path: OWN_PATH }),
    await call(UPDATE_USER, "staff1", {}), await call(LIST, null, {})];
  for (const s of samples) {
    const text = JSON.stringify(s.body);
    assert.ok(!/at .*\.js|stack|firebase|supabase|private|token/i.test(text), text);
  }
});

test("[#10] upload URLs: type/size/service validated, path built from the TOKEN uid and a sanitized name", async () => {
  seed();
  const ok = { applicationDocId: NEW_APP, serviceType: "death", docType: "death-proof", fileName: "../../etc/passwd.pdf", fileType: "application/pdf", fileSize: 1000, uid: "cit2", userId: "cit2" };
  const r = await call(UPLOAD, "cit1", ok);
  assert.equal(r.status, 200);
  assert.match(signedUploadPaths[0], new RegExp(`^applications/cit1/${NEW_APP}/[0-9a-f-]{36}-death-proof__[A-Za-z0-9._-]+$`), signedUploadPaths[0]);
  const segments = signedUploadPaths[0].split("/");   // ".." inside a file NAME is harmless; a ".." SEGMENT is not
  assert.equal(segments.length, 4, "exactly applications/{uid}/{app}/{file}");
  assert.ok(segments.every((s) => s !== ".." && s !== "." && s !== ""), "no traversal segment in storage path");
  const bad = [
    { ...ok, fileType: "text/html" }, { ...ok, fileType: "application/x-msdownload" }, { ...ok, fileSize: 0 }, { ...ok, fileSize: 5 * 1024 * 1024 + 1 },
    { ...ok, fileSize: "1000" }, { ...ok, serviceType: "passport" }, { ...ok, docType: undefined }, { ...ok, docType: "../x" }, { ...ok, docType: "Death_Proof" }, { ...ok, docType: "not-on-the-list" }, { ...ok, docType: 5 }, { ...ok, applicationDocId: "../x" }, { ...ok, applicationDocId: "a/b" },
  ];
  for (const b of bad) assert.equal((await call(UPLOAD, "cit1", b)).status, 400, JSON.stringify(b).slice(0, 80));
  assert.equal((await call(UPLOAD, null, ok)).status, 401);
});

test("[#10] a deactivated account cannot obtain upload URLs", async () => {
  seed();
  store["users/cit1"].active = false;
  const r = await call(UPLOAD, "cit1", { applicationDocId: NEW_APP, serviceType: "death", docType: "death-proof", fileName: "a.pdf", fileType: "application/pdf", fileSize: 10 });
  assert.equal(r.status, 403);
});

test("[#10] cleanup only deletes the caller's OWN, not-yet-attached uploads", async () => {
  seed();
  const orphan = `applications/cit1/NewApp1234567890ABCD/33333333-cccc-4ccc-8ccc-333333333333-new.pdf`;
  await call(CLEANUP, "cit1", { path: VICTIM_PATH });                       // someone else's folder
  await call(CLEANUP, "cit1", { path: `applications/cit1/../cit2/x.pdf` }); // traversal
  await call(CLEANUP, "cit1", { path: OWN_PATH });                          // already attached to a submitted application
  assert.deepEqual(removedFiles, [], "deleted something it must not: " + removedFiles.join(", "));
  await call(CLEANUP, "cit1", { path: orphan });                            // genuine orphan from a failed submission
  assert.deepEqual(removedFiles, [orphan]);
  removedFiles.length = 0;
  store["users/cit1"].active = false;
  await call(CLEANUP, "cit1", { path: orphan });
  assert.deepEqual(removedFiles, [], "deactivated account must not delete files");
});

/* ============ nine services: upload, review and document access work for every type ============ */

const DocumentChecklists = require(path.join(root, "api/_lib/documentChecklists.js"));
const ALL_TYPES = ["birth", "death", "income", "caste", "marriage", "bpl", "nodues", "property", "other"];

test("[services] upload URLs are issued for all nine service types and refused for anything else", async () => {
  seed();
  for (const serviceType of ALL_TYPES) {
    const docType = DocumentChecklists.getChecklist(serviceType).items[0].key;
    const r = await call(UPLOAD, "cit1", { applicationDocId: NEW_APP, serviceType, docType, fileName: "proof.pdf", fileType: "application/pdf", fileSize: 1000 });
    assert.equal(r.status, 200, serviceType);
  }
  for (const serviceType of ["marriage ", "BPL", "Other", "", "__proto__", "birth,death", null, 5, ["bpl"], {}]) {
    const r = await call(UPLOAD, "cit1", { applicationDocId: NEW_APP, serviceType, docType: "applicant-id", fileName: "proof.pdf", fileType: "application/pdf", fileSize: 1000 });
    assert.equal(r.status, 400, `accepted serviceType ${JSON.stringify(serviceType)}`);
  }
});

test("[services] staff review works identically for every service type: under review, approve, reject with a reason, redirect", async () => {
  seed();
  ALL_TYPES.forEach((type, i) => {
    store[`applications/Svc${type.padEnd(7, "x")}App${String(i).padStart(4, "0")}`] = {
      userId: "cit1", status: "submitted", serviceType: type, documents: [],
      formData: type === "other" ? { requestedService: "Land use certificate" } : {},
    };
  });
  for (const [i, type] of ALL_TYPES.entries()) {
    const id = `Svc${type.padEnd(7, "x")}App${String(i).padStart(4, "0")}`;
    const call2 = (status, remarks) => call(STATUS, "staff1", { applicationDocId: id, status, remarks });

    assert.equal((await call2("approved")).status, 409, `${type}: cannot approve before review`);
    assert.equal((await call2("under_review")).status, 200, `${type}: accept for review`);
    assert.equal((await call(STATUS, "cit1", { applicationDocId: id, status: "approved" })).status, 403, `${type}: owner cannot decide`);
    if (i % 2 === 0) {
      assert.equal((await call2("approved", "Verified")).status, 200, `${type}: approve`);
      assert.equal(store[`applications/${id}`].status, "approved");
    } else {
      assert.equal((await call2("rejected")).status, 400, `${type}: a rejection needs a reason`);
      const reason = "This request must be handled by another department: Revenue Office. Please apply there.";
      assert.equal((await call2("rejected", reason)).status, 200, `${type}: reject / redirect with a reason`);
      assert.equal(store[`applications/${id}`].status, "rejected");
      assert.equal(store[`applications/${id}`].remarks, reason, "the citizen sees the redirect reason");
    }
    const history = Object.entries(store).filter(([k]) => k.startsWith(`applications/${id}/statusHistory/`)).map(([, v]) => v);
    assert.equal(history.length, 2, `${type}: two history entries (review + decision)`);
    assert.equal(history[0].status, "under_review");
    assert.ok(["approved", "rejected"].includes(history[1].status));
    assert.equal(history[1].updatedBy, "staff1", "history names the reviewer");
  }
});

test("[services] an optional-document request ('other') has no file to download; with a file, normal access rules apply", async () => {
  seed();
  const ID = "OtherReqNoDoc123456789";
  store[`applications/${ID}`] = { userId: "cit1", status: "submitted", serviceType: "other", documents: [] };
  assert.equal((await call(DOWNLOAD, "staff1", { applicationDocId: ID, path: OWN_PATH })).status, 403, "no document is listed, so nothing can be downloaded");
  const ID2 = "OtherReqWithDoc12345678";
  const path2 = `applications/cit1/${ID2}/44444444-dddd-4ddd-8ddd-444444444444-note.pdf`;
  store[`applications/${ID2}`] = { userId: "cit1", status: "submitted", serviceType: "other", documents: [{ name: "note.pdf", path: path2 }] };
  assert.equal((await call(DOWNLOAD, "staff1", { applicationDocId: ID2, path: path2 })).status, 200, "staff can open it");
  assert.equal((await call(DOWNLOAD, "cit1", { applicationDocId: ID2, path: path2 })).status, 200, "owner can open it");
  assert.equal((await call(DOWNLOAD, "cit2", { applicationDocId: ID2, path: path2 })).status, 403, "another citizen cannot");
});

const fs = require("node:fs");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

/* ============ document checklists: per-document uploads, staff requests, citizen follow-up ============ */

const REQUEST_DOCS = "api/staff/request-documents.js";
const ADD_DOCS = "api/applications/add-documents.js";
const REQ_APP = "ReqApp1234567890ABCDE";

const reqPath = (docType, { uid = "cit1", app = REQ_APP, uuid = "55555555-eeee-4eee-8eee-555555555555", name = "x.pdf" } = {}) =>
  `applications/${uid}/${app}/${uuid}-${docType}__${name}`;
let etagCounter = 0;
/** A document as the browser reports it. By default the file also exists in the fake private bucket. */
const docEntry = (docType, { stored = true, etag, mimetype = "application/pdf", storedSize = 1000, ...over } = {}) => {
  const entry = { docType, name: "x.pdf", type: "application/pdf", size: 1000, path: reqPath(docType), ...over };
  if (stored && typeof entry.path === "string") storedFiles.set(entry.path, { size: storedSize, mimetype, eTag: etag || "etag-" + ++etagCounter });
  return entry;
};

/** An open income-certificate application whose applicant-id was uploaded at submission. */
function seedReq(over = {}) {
  seed();
  store[`applications/${REQ_APP}`] = {
    userId: "cit1", status: "under_review", serviceType: "income", applicantName: "Cit One",
    documents: [{ docType: "applicant-id", docLabel: "x", name: "id.pdf", type: "application/pdf", size: 5, path: reqPath("applicant-id", { uuid: "66666666-ffff-4fff-8fff-666666666666" }) }],
    ...over,
  };
}
const requestDocs = (uid, body) => call(REQUEST_DOCS, uid, { applicationDocId: REQ_APP, ...body });
const addDocs = (uid, documents, extra = {}) => call(ADD_DOCS, uid, { applicationDocId: REQ_APP, documents, ...extra });
const appNow = () => store[`applications/${REQ_APP}`];
const historyOf = () => Object.entries(store).filter(([k]) => k.startsWith(`applications/${REQ_APP}/statusHistory/`)).map(([, v]) => v);

test("[docs] the checklist is one shared file: every service has one, with valid, unique keys, and none claims to be official", () => {
  const DC = require(path.join(root, "api/_lib/documentChecklists.js"));
  const { ALLOWED_SERVICE_TYPES } = require(path.join(root, "api/_lib/validation.js"));
  assert.deepEqual(Object.keys(DC.CHECKLISTS).sort(), [...ALLOWED_SERVICE_TYPES].sort());
  for (const [type, list] of Object.entries(DC.CHECKLISTS)) {
    assert.ok(list.items.length >= 1 && list.items.length <= 6, `${type}: item count`);
    const keys = list.items.map((i) => i.key);
    assert.equal(new Set(keys).size, keys.length, `${type}: duplicate keys`);
    for (const i of list.items) {
      assert.match(i.key, DC.KEY_RE, `${type}.${i.key}`);
      assert.ok(!DC.EXTRA_KEY_RE.test(i.key), `${type}.${i.key} collides with staff-requested keys`);
      assert.ok(i.label && typeof i.required === "boolean", `${type}.${i.key}`);
    }
    assert.equal(list.confirmed, false, `${type}: requirements are suggestions until the authority confirms them`);
  }
  assert.match(DC.NOTICE, /not official/i);
  assert.ok(DC.getChecklist("other").staffDefined, "'Other' is staff-defined");
  assert.deepEqual(DC.requiredItems("other"), [], "'Other' has no fixed required document");
  assert.deepEqual(DC.missingRequired("income", ["applicant-id"]).map((i) => i.key), ["address-proof", "income-proof"]);
  assert.equal(DC.getChecklist("__proto__"), null);
  assert.equal(DC.getChecklist("constructor"), null);
  assert.ok(!/maharashtra/i.test(read("js/document-checklists.js").replace(/not official[\s\S]{0,40}/gi, "").replace(/^\s*\/\*[\s\S]*?\*\//, "")), "the lists must not cite specific government rules");
});

test("[docs] upload URLs for a NEW application: the document must be on that service's checklist, and its type is part of the stored path", async () => {
  seed();
  const base = { applicationDocId: NEW_APP, fileName: "a.pdf", fileType: "application/pdf", fileSize: 1000 };
  assert.equal((await call(UPLOAD, "cit1", { ...base, serviceType: "income", docType: "income-proof" })).status, 200);
  assert.match(signedUploadPaths.at(-1), new RegExp(`^applications/cit1/${NEW_APP}/[0-9a-f-]{36}-income-proof__a\\.pdf$`));
  assert.equal((await call(UPLOAD, "cit1", { ...base, serviceType: "income", docType: "death-proof" })).status, 400, "another service's document");
  assert.equal((await call(UPLOAD, "cit1", { ...base, serviceType: "income", docType: "extra-1" })).status, 400, "staff-requested keys cannot be used for a new application");
  assert.equal((await call(UPLOAD, "cit1", { ...base, serviceType: "income" })).status, 400, "every upload must name its document type");
});

test("[docs] upload URLs for an EXISTING application only exist for documents staff asked for, and only for its owner", async () => {
  seedReq();
  const mk = (docType, over = {}) => ({ applicationDocId: REQ_APP, serviceType: "income", docType, fileName: "a.pdf", fileType: "application/pdf", fileSize: 1000, ...over });
  assert.equal((await call(UPLOAD, "cit1", mk("address-proof"))).status, 400, "nothing requested yet");
  await requestDocs("staff1", { items: [{ key: "address-proof" }, { label: "Land record" }] });
  assert.equal((await call(UPLOAD, "cit1", mk("address-proof"))).status, 200);
  assert.equal((await call(UPLOAD, "cit1", mk("extra-1"))).status, 200, "a staff-described document");
  assert.equal((await call(UPLOAD, "cit1", mk("income-proof"))).status, 400, "not requested");
  assert.equal((await call(UPLOAD, "cit2", mk("address-proof"))).status, 403, "another citizen cannot upload into this application");
  assert.equal((await call(UPLOAD, "staff1", mk("address-proof"))).status, 403, "staff upload through the citizen flow is refused too");
  await addDocs("cit1", [docEntry("address-proof")]);
  assert.equal((await call(UPLOAD, "cit1", mk("address-proof"))).status, 400, "an item that is done cannot be uploaded again");
});

test("[docs] staff request missing documents: checklist items and described extras, merged, status unchanged, history recorded", async () => {
  seedReq();
  const r = await requestDocs("staff1", { items: [{ key: "address-proof" }, { label: "  Land   record  " }], message: "Please upload clear scans." });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const a = appNow();
  assert.equal(a.status, "under_review", "the status does not change");
  assert.equal(a.documentRequest.open, true);
  assert.deepEqual(a.documentRequest.items, [
    { key: "address-proof", label: "Address proof", done: false },
    { key: "extra-1", label: "Land record", done: false },
  ]);
  assert.equal(a.documentRequest.message, "Please upload clear scans.");
  assert.equal(a.documentRequest.requestedBy, "staff1");
  const h = historyOf();
  assert.equal(h.length, 1);
  assert.match(h[0].remarks, /Additional documents requested: Address proof; Land record\. Please upload clear scans\./);
  assert.equal(h[0].status, "under_review");
  assert.equal(h[0].updatedBy, "staff1");

  // a second request keeps what is still outstanding and continues the extra-N numbering
  const r2 = await requestDocs("admin1", { items: [{ label: "Bank passbook" }, { key: "address-proof" }] });
  assert.equal(r2.status, 200);
  assert.deepEqual(appNow().documentRequest.items.map((i) => i.key), ["address-proof", "extra-1", "extra-2"]);
  assert.equal(appNow().documentRequest.items[2].label, "Bank passbook");
  assert.equal(historyOf().length, 2);
});

test("[docs] request-documents: only active staff/admin, never on your own application, only while open, only valid items", async () => {
  seedReq();
  const before = JSON.stringify(store);
  const body = { items: [{ key: "address-proof" }] };
  assert.equal((await requestDocs(null, body)).status, 401);
  assert.equal((await requestDocs("cit1", body)).status, 403, "even the applicant cannot ask for documents");
  assert.equal((await requestDocs("cit2", body)).status, 403);
  assert.equal((await requestDocs("staff2", body)).status, 403, "deactivated staff");
  assert.equal((await call(REQUEST_DOCS, "staff1", body, "GET")).status, 405);
  assert.equal(JSON.stringify(store), before, "refused calls change nothing");

  const bad = [
    {}, { items: [] }, { items: "address-proof" }, { items: [{ key: "address-proof" }].concat(Array(5).fill({ label: "Extra doc" })) },
    { items: [{ key: "nope" }] }, { items: [{ key: "death-proof" }] }, { items: [{ key: "extra-1" }] }, { items: [{ key: "../x" }] }, { items: [{ key: 5 }] },
    { items: [{ label: "ab" }] }, { items: [{ label: "x".repeat(81) }] }, { items: [{ label: "<script>alert(1)</script>" }] }, { items: [{ label: "line\nbreak" }] }, { items: [{ label: 7 }] }, { items: [null] }, { items: ["address-proof"] }, { items: [[]] },
    { items: [{ key: "address-proof" }], message: 5 }, { items: [{ key: "address-proof" }], message: "x".repeat(501) },
  ];
  for (const b of bad) assert.equal((await requestDocs("staff1", b)).status, 400, JSON.stringify(b).slice(0, 80));
  assert.equal((await call(REQUEST_DOCS, "staff1", { items: [{ key: "address-proof" }] })).status, 400, "no application id");
  assert.equal((await call(REQUEST_DOCS, "staff1", { applicationDocId: "../x", items: [{ key: "address-proof" }] })).status, 400);
  assert.equal((await call(REQUEST_DOCS, "staff1", { applicationDocId: "NoSuchApp1234567890", items: [{ key: "address-proof" }] })).status, 404);
  assert.equal(JSON.stringify(store), before, "bad requests change nothing");

  store["users/staff1"].role = "staff";
  appNow().userId = "staff1";                                   // staff reviewing their OWN application
  assert.equal((await requestDocs("staff1", body)).status, 403);
  appNow().userId = "cit1";
  for (const status of ["approved", "rejected"]) {
    appNow().status = status;
    assert.equal((await requestDocs("staff1", body)).status, 409, `a ${status} application is closed`);
  }
  appNow().status = "submitted";
  assert.equal((await requestDocs("staff1", body)).status, 200, "a submitted application can have documents requested");
});

test("[docs] the citizen uploads the requested documents: they are attached with their type and label, the request closes, history records it", async () => {
  seedReq();
  await requestDocs("staff1", { items: [{ key: "address-proof" }, { label: "Land record" }] });

  // partial answer first
  const r1 = await addDocs("cit1", [docEntry("address-proof", { name: "bill.pdf", path: reqPath("address-proof", { name: "bill.pdf" }) })]);
  assert.equal(r1.status, 200, JSON.stringify(r1.body));
  assert.equal(r1.body.documentRequest.open, true, "still waiting for the land record");
  assert.equal(appNow().documents.length, 2);
  const added = appNow().documents[1];
  assert.equal(added.docType, "address-proof");
  assert.equal(added.docLabel, "Address proof", "the label comes from the request, not from the browser");
  assert.equal(added.addedAfterRequest, true);
  assert.deepEqual(appNow().documentRequest.items.map((i) => [i.key, i.done]), [["address-proof", true], ["extra-1", false]]);

  const r2 = await addDocs("cit1", [docEntry("extra-1", { name: "land.png", type: "image/png", path: reqPath("extra-1", { uuid: "77777777-1111-4111-8111-777777777777", name: "land.png" }) })]);
  assert.equal(r2.status, 200);
  assert.equal(appNow().documentRequest.open, false, "everything requested has arrived");
  assert.ok(appNow().documentRequest.fulfilledAt);
  assert.equal(appNow().status, "under_review", "the status is untouched");
  const kinds = historyOf().map((h) => h.kind);
  assert.deepEqual(kinds.sort(), ["documents_requested", "documents_uploaded", "documents_uploaded"]);
  assert.ok(historyOf().some((h) => /All requested documents have been provided/.test(h.remarks)));

  // the new documents can be opened by staff and by the owner, nobody else
  const p = appNow().documents[1].path;
  assert.equal((await call(DOWNLOAD, "staff1", { applicationDocId: REQ_APP, path: p })).status, 200);
  assert.equal((await call(DOWNLOAD, "cit1", { applicationDocId: REQ_APP, path: p })).status, 200);
  assert.equal((await call(DOWNLOAD, "cit2", { applicationDocId: REQ_APP, path: p })).status, 403);
  assert.equal((await addDocs("cit1", [docEntry("extra-1", { path: reqPath("extra-1", { uuid: "88888888-2222-4222-8222-888888888888" }) })])).status, 409, "nothing is requested any more");
});

test("[docs] add-documents refuses: other people, no request, wrong or repeated documents, forged paths, bad files, closed applications", async () => {
  seedReq();
  assert.equal((await addDocs("cit1", [docEntry("address-proof")])).status, 409, "no open request yet");
  await requestDocs("staff1", { items: [{ key: "address-proof" }, { key: "income-proof" }] });
  const before = JSON.stringify(appNow());

  assert.equal((await addDocs(null, [docEntry("address-proof")])).status, 401);
  assert.equal((await addDocs("cit2", [docEntry("address-proof")])).status, 403, "another citizen");
  assert.equal((await addDocs("staff1", [docEntry("address-proof")])).status, 403, "staff cannot add documents for the applicant");
  assert.equal((await call(ADD_DOCS, "cit1", { applicationDocId: REQ_APP, documents: [docEntry("address-proof")] }, "GET")).status, 405);

  const bad = [
    [], "x", [null], [docEntry("address-proof"), docEntry("address-proof", { path: reqPath("address-proof", { uuid: "99999999-3333-4333-8333-999999999999" }) })],  // twice
    [docEntry("ration-card")],                                                         // not requested
    [docEntry("applicant-id")],                                                        // already provided at submission
    [docEntry("address-proof", { path: reqPath("address-proof", { uid: "cit2" }) })],  // another user's folder
    [docEntry("address-proof", { path: reqPath("address-proof", { app: "OtherApp1234567890AB" }) })],   // another application
    [docEntry("address-proof", { path: reqPath("income-proof") })],                    // path says a different document
    [docEntry("address-proof", { path: `applications/cit1/${REQ_APP}/../x.pdf` })],
    [docEntry("address-proof", { path: `applications/cit1/${REQ_APP}/plain-name.pdf` })],              // not made by create-upload-url
    [docEntry("address-proof", { mimetype: "text/html", path: reqPath("address-proof", { uuid: "aaaaaaaa-0000-4000-8000-000000000001" }) })], [docEntry("address-proof", { mimetype: "application/x-msdownload", path: reqPath("address-proof", { uuid: "aaaaaaaa-0000-4000-8000-000000000002" }) })],   // what STORAGE says counts, not what the browser claims
    [docEntry("address-proof", { storedSize: 5 * 1024 * 1024 + 1, path: reqPath("address-proof", { uuid: "aaaaaaaa-0000-4000-8000-000000000003" }) })], [docEntry("address-proof", { storedSize: 0, path: reqPath("address-proof", { uuid: "aaaaaaaa-0000-4000-8000-000000000004" }) })],
    [docEntry("address-proof", { name: "" })], [docEntry("address-proof", { name: "n".repeat(201) })], [docEntry("address-proof", { name: 5 })],
    [docEntry("Address_Proof")], [docEntry("address-proof", { path: 5 })],
  ];
  for (const b of bad) assert.equal((await addDocs("cit1", b)).status, 400, JSON.stringify(b).slice(0, 400));
  assert.equal(JSON.stringify(appNow()), before, "refused calls change nothing");

  // the same file cannot be attached twice
  assert.equal((await addDocs("cit1", [docEntry("address-proof")])).status, 200);
  assert.equal((await addDocs("cit1", [docEntry("income-proof", { path: appNow().documents[1].path })])).status, 400);

  // a decision closes the request: nothing more can be attached
  appNow().status = "approved";
  assert.equal((await addDocs("cit1", [docEntry("income-proof")])).status, 409);
});

test("[docs] a decision on the application closes any outstanding document request", async () => {
  seedReq();
  await requestDocs("staff1", { items: [{ key: "address-proof" }] });
  assert.equal(appNow().documentRequest.open, true);
  assert.equal((await call(STATUS, "staff1", { applicationDocId: REQ_APP, status: "approved", remarks: "ok" })).status, 409, "cannot approve while a document is still being waited for");
  assert.equal((await call(STATUS, "staff1", { applicationDocId: REQ_APP, status: "rejected", remarks: "Documents not provided in time." })).status, 200);
  assert.equal(appNow().documentRequest.open, false);
  assert.deepEqual(appNow().documentRequest.items.map((i) => i.key), ["address-proof"], "the record of what was asked stays");
});

test("[docs] the documents API stays within the Vercel Hobby limit of 12 functions", () => {
  const count = (dir) => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).reduce((n, e) => {
    if (e.name.startsWith("_")) return n;
    return n + (e.isDirectory() ? count(path.join(dir, e.name)) : e.name.endsWith(".js") ? 1 : 0);
  }, 0);
  assert.ok(count("api") <= 12, `api has ${count("api")} functions`);
});

/* ============ the SERVER verifies every required document: submit, review, replacement ============ */

const SUBMIT = "api/applications/submit.js";
const SUB_APP = "SubApp1234567890ABCDE";
const INCOME = ["applicant-id", "address-proof", "income-proof"];
const uuidFor = (docType, n = 0) => "bbbbbbbb-0000-4000-8000-" + (String(n) + Buffer.from(docType).toString("hex")).padEnd(12, "0").slice(0, 12);
/** A document for the NEW application SUB_APP, already present in the fake private bucket. */
const subDoc = (docType, over = {}) => docEntry(docType, { path: reqPath(docType, { app: SUB_APP, uuid: uuidFor(docType) }), ...over });
const submit = (uid, body = {}) => call(SUBMIT, uid, { applicationDocId: SUB_APP, serviceType: "income", formData: { occupation: "Farmer", annualIncome: "48000" }, documents: body.documents || INCOME.map((t) => subDoc(t)), ...body });
const subApp = () => store[`applications/${SUB_APP}`];

test("[verify] a valid submission is created by the server: identity from the token, name from the catalog, files tied to their items and measured in storage", async () => {
  seed();
  const r = await submit("cit1", { userId: "cit2", status: "approved", serviceName: "Hacked", applicantName: "Mallory", role: "admin", reviewedBy: "staff1", remarks: "pre-approved" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.docId, SUB_APP);
  assert.match(r.body.applicationId, /^GP-\d{4}-[A-HJ-NP-Z2-9]{8}$/);
  const a = subApp();
  assert.equal(a.userId, "cit1");
  assert.equal(a.applicantName, "Cit One");
  assert.equal(a.status, "submitted");
  assert.equal(a.serviceName, "Income Certificate");
  assert.equal(a.remarks, "");
  assert.ok(!("reviewedBy" in a) && !("role" in a), "nothing but the expected fields");
  assert.deepEqual(a.documents.map((d) => d.docType), INCOME);
  a.documents.forEach((d) => {
    assert.equal(d.docLabel, DC().findItem("income", d.docType).label, "label comes from the checklist");
    assert.deepEqual(d.review, { status: "pending" });
    assert.equal(d.type, "application/pdf");
    assert.equal(d.size, 1000, "size comes from storage");
    assert.ok(d.path.includes(`-${d.docType}__`));
  });
  const history = Object.entries(store).filter(([k]) => k.startsWith(`applications/${SUB_APP}/statusHistory/`)).map(([, v]) => v);
  assert.equal(history.length, 1);
  assert.equal(history[0].status, "submitted");
});
const DC = () => require(path.join(root, "api/_lib/documentChecklists.js"));

test("[verify] submit needs a signed-in, active account and a POST", async () => {
  seed();
  assert.equal((await submit(null, {})).status, 401);
  store["users/cit1"].active = false;
  assert.equal((await submit("cit1", {})).status, 403);
  store["users/cit1"].active = true;
  assert.equal((await call(SUBMIT, "cit1", {}, "GET")).status, 405);
  assert.ok(!subApp(), "nothing was created");
});

test("[verify] a missing required document type is rejected, naming the document — whatever else was uploaded", async () => {
  seed();
  for (const missing of INCOME) {
    const r = await submit("cit1", { documents: INCOME.filter((t) => t !== missing).map((t) => subDoc(t)) });
    assert.equal(r.status, 400, missing);
    assert.ok(r.body.error.includes(DC().findItem("income", missing).label), r.body.error);
  }
  assert.equal((await submit("cit1", { documents: [] })).status, 400, "no documents at all");
  // an optional document does not stand in for a required one
  assert.equal((await submit("cit1", { documents: [subDoc("ration-card"), subDoc("applicant-id")] })).status, 400);
  // one file under one item does not satisfy the others
  const one = [subDoc("applicant-id")];
  assert.equal((await submit("cit1", { documents: one })).status, 400);
  assert.ok(!subApp());
});

test("[verify] a mismatched document type is rejected: not on the checklist, another service's, or a path made for a different item", async () => {
  seed();
  const base = INCOME.map((t) => subDoc(t));
  const swap = (i, entry) => base.map((d, j) => (j === i ? entry : d));
  const cases = {
    "type from another service": [...base, subDoc("death-proof")],
    "staff-requested key on a new application": [...base, subDoc("extra-1")],
    "unknown type": [...base, subDoc("nope")],
    "claims address-proof but the file was uploaded for income-proof": swap(1, { ...subDoc("address-proof"), path: reqPath("income-proof", { app: SUB_APP, uuid: uuidFor("income-proof") }) }),
    "claims income-proof but the path says applicant-id": swap(2, { ...subDoc("income-proof"), path: base[0].path }),
    "path without a document type (not made by the upload endpoint)": swap(0, docEntry("applicant-id", { path: `applications/cit1/${SUB_APP}/cccccccc-0000-4000-8000-000000000000-plain.pdf` })),
    "invalid type value": [...base, { ...subDoc("applicant-id"), docType: "Applicant_ID" }],
    "no type": [...base, { ...subDoc("ration-card"), docType: undefined }],
  };
  for (const [name, documents] of Object.entries(cases)) assert.equal((await submit("cit1", { documents })).status, 400, name);
  assert.ok(!subApp(), "nothing was created by any of them");
});

test("[verify] duplicates: one item cannot have two files, one path cannot fill two items, and one stored file cannot satisfy several items", async () => {
  seed();
  const base = INCOME.map((t) => subDoc(t));
  assert.equal((await submit("cit1", { documents: [...base, subDoc("applicant-id", { path: reqPath("applicant-id", { app: SUB_APP, uuid: uuidFor("applicant-id", 1) }) })] })).status, 400, "two files for one item");
  assert.equal((await submit("cit1", { documents: [...base, { ...base[0] }] })).status, 400, "the same entry twice");
  const sharedPath = [base[0], { ...base[1], path: base[0].path }, base[2]];
  assert.equal((await submit("cit1", { documents: sharedPath })).status, 400, "one path under two items");
  // the same bytes uploaded under three different items (same storage eTag)
  const same = INCOME.map((t) => subDoc(t, { etag: "identical-bytes" }));
  const r = await submit("cit1", { documents: same });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /same file was attached for more than one document/i);
  assert.ok(!subApp());
  // different files for different items are fine
  assert.equal((await submit("cit1", { documents: INCOME.map((t) => subDoc(t)) })).status, 200);
});

test("[verify] every file must really be in the caller's private folder for THIS application, with an allowed type and size", async () => {
  seed();
  const ok = INCOME.map((t) => subDoc(t));
  const bad = {
    "not uploaded": [ok[0], ok[1], subDoc("income-proof", { stored: false, path: reqPath("income-proof", { app: SUB_APP, uuid: uuidFor("income-proof", 5) }) })],
    "stored as HTML": [ok[0], ok[1], subDoc("income-proof", { path: reqPath("income-proof", { app: SUB_APP, uuid: uuidFor("income-proof", 6) }), mimetype: "text/html" })],
    "stored as an executable": [ok[0], ok[1], subDoc("income-proof", { path: reqPath("income-proof", { app: SUB_APP, uuid: uuidFor("income-proof", 7) }), mimetype: "application/x-msdownload" })],
    "over 5 MB in storage": [ok[0], ok[1], subDoc("income-proof", { path: reqPath("income-proof", { app: SUB_APP, uuid: uuidFor("income-proof", 8) }), storedSize: 5 * 1024 * 1024 + 1 })],
    "empty in storage": [ok[0], ok[1], subDoc("income-proof", { path: reqPath("income-proof", { app: SUB_APP, uuid: uuidFor("income-proof", 9) }), storedSize: 0 })],
    "another user's folder": [ok[0], ok[1], subDoc("income-proof", { path: reqPath("income-proof", { uid: "cit2", app: SUB_APP, uuid: uuidFor("income-proof", 2) }) })],
    "another application's folder": [ok[0], ok[1], subDoc("income-proof", { path: reqPath("income-proof", { app: "OtherApp1234567890AB", uuid: uuidFor("income-proof", 3) }) })],
    "path traversal": [ok[0], ok[1], subDoc("income-proof", { path: `applications/cit1/${SUB_APP}/../x.pdf` })],
    "name too long": [ok[0], ok[1], subDoc("income-proof", { name: "n".repeat(201) })],
    "no name": [ok[0], ok[1], subDoc("income-proof", { name: "" })],
  };
  for (const [name, documents] of Object.entries(bad)) assert.equal((await submit("cit1", { documents })).status, 400, name);
  assert.ok(!subApp());

  // the client may LIE about type and size; storage decides
  const liar = subDoc("income-proof", { type: "image/png", size: 1, name: "totally-an-id-card.png" });
  const r = await submit("cit1", { documents: [ok[0], ok[1], liar] });
  assert.equal(r.status, 200);
  const stored = subApp().documents.find((d) => d.docType === "income-proof");
  assert.equal(stored.type, "application/pdf", "type from storage");
  assert.equal(stored.size, 1000, "size from storage");
  assert.equal(stored.name, "totally-an-id-card.png", "the name is only a display label — it proves nothing about the contents");

  seed();
  failStorageList = true;
  const down = await submit("cit1", {});
  assert.equal(down.status, 500, "if storage cannot be checked, nothing is created");
  assert.ok(!subApp());
  assert.ok(!/storage down|supabase/i.test(JSON.stringify(down.body)), "no internals");
});

test("[verify] submit also checks the form answers, refuses to overwrite an existing application, and 'Other' needs no fixed document", async () => {
  seed();
  for (const formData of [null, [], "x", { a: { nested: 1 } }, { "bad key": "x" }, { k: ["x"] }, { k: "x".repeat(2001) }, Object.fromEntries(Array.from({ length: 31 }, (_, i) => ["k" + i, "v"]))]) {
    assert.equal((await submit("cit1", { formData })).status, 400, JSON.stringify(formData).slice(0, 40));
  }
  assert.equal((await submit("cit1", { serviceType: "passport" })).status, 400);
  assert.equal((await submit("cit1", { applicationDocId: "../x" })).status, 400);
  assert.equal((await submit("cit1", { documents: "x" })).status, 400);
  assert.equal((await submit("cit1", {})).status, 200);
  assert.equal((await submit("cit1", {})).status, 409, "an existing application is never overwritten");
  assert.ok([400, 409].includes((await submit("cit2", {})).status), "…and nobody can take over someone else's id");
  assert.equal(subApp().userId, "cit1");

  const other = await call(SUBMIT, "cit1", { applicationDocId: "OtherApp1234567890ABC", serviceType: "other", formData: { requestedService: "Land use" }, documents: [] });
  assert.equal(other.status, 200, JSON.stringify(other.body));
  assert.deepEqual(store["applications/OtherApp1234567890ABC"].documents, []);
  const withBadType = await call(SUBMIT, "cit1", { applicationDocId: "OtherApp2234567890ABC", serviceType: "other", formData: {}, documents: [subDoc("applicant-id", { path: reqPath("applicant-id", { app: "OtherApp2234567890ABC", uuid: uuidFor("applicant-id", 4) }) })] });
  assert.equal(withBadType.status, 400, "'Other' only accepts its own checklist item (or later staff requests)");
});

/* ---- review, rejection and replacement ---- */

async function seedItemised() {
  seed();
  assert.equal((await submit("cit1", {})).status, 200);
  store[`applications/${SUB_APP}`].status = "under_review";
  return store[`applications/${SUB_APP}`].documents;
}
const review = (uid, body) => call(REQUEST_DOCS, uid, { action: "review", applicationDocId: SUB_APP, ...body });
const pathOf = (docType) => subApp().documents.filter((d) => d.docType === docType && d.superseded !== true)[0].path;

test("[review] staff can accept a document; the review is stored with who and when, and logged in the history", async () => {
  await seedItemised();
  const r = await review("staff1", { path: pathOf("applicant-id"), decision: "accepted" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const d = subApp().documents.find((x) => x.docType === "applicant-id");
  assert.equal(d.review.status, "accepted");
  assert.equal(d.review.reviewedBy, "staff1");
  assert.equal(d.review.reviewedByName, "Sam Staff");
  assert.ok(!Number.isNaN(Date.parse(d.review.reviewedAt)));
  assert.equal(subApp().documents.find((x) => x.docType === "address-proof").review.status, "pending", "other documents untouched");
  assert.equal(subApp().documentRequest, undefined, "an acceptance asks for nothing");
  assert.ok(Object.values(store).some((v) => v && v.kind === "document_reviewed" && /accepted/.test(v.remarks)));
});

test("[review] a rejection needs a reason, records it, and re-opens THAT document type only for the citizen", async () => {
  await seedItemised();
  assert.equal((await review("staff1", { path: pathOf("address-proof"), decision: "rejected" })).status, 400, "no reason");
  assert.equal((await review("staff1", { path: pathOf("address-proof"), decision: "rejected", reason: "bad" })).status, 400, "too short");
  assert.equal(subApp().documentRequest, undefined);

  const r = await review("staff1", { path: pathOf("address-proof"), decision: "rejected", reason: "The scan is cut off at the edges." });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const d = subApp().documents.find((x) => x.docType === "address-proof");
  assert.equal(d.review.status, "rejected");
  assert.equal(d.review.reason, "The scan is cut off at the edges.");
  assert.deepEqual(subApp().documentRequest.items.map((i) => [i.key, i.done, i.replacement, i.reason]), [["address-proof", false, true, "The scan is cut off at the edges."]]);
  assert.equal(subApp().documentRequest.open, true);
  assert.equal(subApp().status, "under_review", "the status does not change");

  const again = await review("staff1", { path: pathOf("income-proof"), decision: "replacement_requested", reason: "Please send the latest salary slip." });
  assert.equal(again.status, 200);
  assert.deepEqual(subApp().documentRequest.items.map((i) => i.key).sort(), ["address-proof", "income-proof"], "both are waiting");
});

test("[review] the citizen replaces the rejected document: same type only, the old file is kept as 'superseded', the new one starts as pending", async () => {
  await seedItemised();
  const oldPath = pathOf("address-proof");
  await review("staff1", { path: oldPath, decision: "rejected", reason: "The scan is cut off at the edges." });

  const mk = (docType, over = {}) => ({ applicationDocId: SUB_APP, serviceType: "income", docType, fileName: "new.pdf", fileType: "application/pdf", fileSize: 1000, ...over });
  assert.equal((await call(UPLOAD, "cit1", mk("address-proof"))).status, 200, "the citizen may upload a replacement for that item");
  assert.equal((await call(UPLOAD, "cit1", mk("applicant-id"))).status, 400, "…but not for an item nobody asked about");
  assert.equal((await call(UPLOAD, "cit2", mk("address-proof"))).status, 403);

  const replacement = docEntry("address-proof", { path: reqPath("address-proof", { app: SUB_APP, uuid: "dddddddd-0000-4000-8000-0000000000aa", name: "new.pdf" }), name: "new.pdf" });
  // a replacement of the WRONG type is refused
  const wrongType = docEntry("applicant-id", { path: reqPath("applicant-id", { app: SUB_APP, uuid: "dddddddd-0000-4000-8000-0000000000ab" }) });
  assert.equal((await call(ADD_DOCS, "cit1", { applicationDocId: SUB_APP, documents: [wrongType] })).status, 400);
  assert.equal((await call(ADD_DOCS, "cit1", { applicationDocId: SUB_APP, documents: [{ ...replacement, docType: "applicant-id" }] })).status, 400, "path says address-proof");
  assert.equal((await call(ADD_DOCS, "cit2", { applicationDocId: SUB_APP, documents: [replacement] })).status, 403);
  assert.equal((await call(ADD_DOCS, "staff1", { applicationDocId: SUB_APP, documents: [replacement] })).status, 403);

  const ok = await call(ADD_DOCS, "cit1", { applicationDocId: SUB_APP, documents: [replacement] });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const addressDocs = subApp().documents.filter((d) => d.docType === "address-proof");
  assert.equal(addressDocs.length, 2, "nothing is deleted");
  assert.equal(addressDocs[0].path, oldPath);
  assert.equal(addressDocs[0].superseded, true);
  assert.equal(addressDocs[0].review.status, "rejected", "the earlier decision stays on record");
  assert.equal(addressDocs[1].superseded, undefined);
  assert.deepEqual(addressDocs[1].review, { status: "pending" });
  assert.equal(subApp().documentRequest.open, false, "the request is answered");
  assert.equal((await call(DOWNLOAD, "staff1", { applicationDocId: SUB_APP, path: oldPath })).status, 200, "staff can still open the earlier version");
  assert.equal((await call(DOWNLOAD, "cit1", { applicationDocId: SUB_APP, path: replacement.path })).status, 200);
  assert.equal((await call(DOWNLOAD, "cit2", { applicationDocId: SUB_APP, path: replacement.path })).status, 403, "other citizens still cannot");

  // the replacement can be reviewed in turn, and the superseded file can no longer be
  assert.equal((await review("staff1", { path: oldPath, decision: "accepted" })).status, 404, "an earlier version is no longer current");
  assert.equal((await review("staff1", { path: replacement.path, decision: "accepted" })).status, 200);
  assert.equal(subApp().documents.find((d) => d.path === replacement.path).review.status, "accepted");
});

test("[review] approval is blocked while a required document is missing, rejected or awaiting a replacement — and allowed once all is in order", async () => {
  await seedItemised();
  const approve = () => call(STATUS, "staff1", { applicationDocId: SUB_APP, status: "approved", remarks: "ok" });
  await review("staff1", { path: pathOf("income-proof"), decision: "rejected", reason: "Salary slip is unreadable." });
  const blocked = await approve();
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.error, /cannot be approved yet/);
  assert.match(blocked.body.error, /Income proof/);
  assert.equal(subApp().status, "under_review");

  const replacement = docEntry("income-proof", { path: reqPath("income-proof", { app: SUB_APP, uuid: "dddddddd-0000-4000-8000-0000000000bb" }) });
  assert.equal((await call(ADD_DOCS, "cit1", { applicationDocId: SUB_APP, documents: [replacement] })).status, 200);
  assert.equal((await approve()).status, 200, "everything is in order now");
  assert.equal(subApp().status, "approved");

  // a required document that never arrived also blocks approval (an itemised application)
  await seedItemised();
  subApp().documents = subApp().documents.filter((d) => d.docType !== "income-proof");
  const missing = await approve();
  assert.equal(missing.status, 409);
  assert.match(missing.body.error, /has not been uploaded/);
});

test("[review] only active staff/admin can review, never their own application, only while it is open, only an existing current file", async () => {
  await seedItemised();
  const body = { path: pathOf("applicant-id"), decision: "accepted" };
  const before = JSON.stringify(store);
  assert.equal((await review(null, body)).status, 401);
  assert.equal((await review("cit1", body)).status, 403, "the applicant cannot accept their own documents");
  assert.equal((await review("cit2", body)).status, 403);
  assert.equal((await review("staff2", body)).status, 403, "deactivated staff");
  assert.equal((await call(REQUEST_DOCS, "staff1", { action: "review", applicationDocId: SUB_APP, ...body }, "GET")).status, 405);
  assert.equal(JSON.stringify(store), before, "refused calls change nothing");

  for (const bad of [{ decision: "maybe" }, { decision: undefined }, { decision: "accepted", path: 5 }, { decision: "accepted", path: "" }, { decision: "rejected", reason: 5, path: body.path }, { decision: "rejected", reason: "x".repeat(501), path: body.path }]) {
    assert.equal((await review("staff1", { ...body, ...bad })).status, 400, JSON.stringify(bad).slice(0, 60));
  }
  assert.equal((await review("staff1", { ...body, path: `applications/cit1/${SUB_APP}/nothing-here.pdf` })).status, 404, "not a document of this application");
  assert.equal((await call(REQUEST_DOCS, "staff1", { action: "review", applicationDocId: "NoSuchApp1234567890", ...body })).status, 404);

  subApp().userId = "staff1";
  assert.equal((await review("staff1", body)).status, 403, "staff cannot review their own application");
  subApp().userId = "cit1";
  for (const status of ["approved", "rejected"]) {
    subApp().status = status;
    assert.equal((await review("staff1", body)).status, 409, `a ${status} application is closed`);
  }
  assert.equal((await review("admin1", { ...body })).status, 409);
  subApp().status = "under_review";
  assert.equal((await review("admin1", body)).status, 200, "an admin may review too");
});

test("[review] older applications whose files are not itemised keep working: no blocker, viewable, acceptable, but no replacement can be requested", async () => {
  seed();                                                   // APP: one old document with no docType
  store[`applications/${APP}`].status = "under_review";
  assert.equal((await call(STATUS, "staff1", { applicationDocId: APP, status: "approved", remarks: "ok" })).status, 200, "an old application is never blocked by the checklist");

  seed();
  store[`applications/${APP}`].status = "under_review";
  const acc = await call(REQUEST_DOCS, "staff1", { action: "review", applicationDocId: APP, path: OWN_PATH, decision: "accepted" });
  assert.equal(acc.status, 200);
  assert.equal(store[`applications/${APP}`].documents[0].review.status, "accepted");
  const rej = await call(REQUEST_DOCS, "staff1", { action: "review", applicationDocId: APP, path: OWN_PATH, decision: "rejected", reason: "Not readable at all." });
  assert.equal(rej.status, 409, "an older document has no type, so no replacement slot exists");
  assert.equal((await call(DOWNLOAD, "staff1", { applicationDocId: APP, path: OWN_PATH })).status, 200);
});

test("[verify] a generic 'octet-stream' (or missing) type in storage falls back to the declared type — which must still be PDF/JPG/PNG", async () => {
  seed();
  const base = (extra) => INCOME.map((t) => subDoc(t, t === "income-proof" ? extra : {}));
  // storage recorded nothing useful, the browser declared a PDF: accepted, stored as that PDF
  for (const [n, mimetype] of [[10, "application/octet-stream"], [11, ""]]) {
    seed();
    const docs = base({ mimetype, path: reqPath("income-proof", { app: SUB_APP, uuid: uuidFor("income-proof", n) }) });
    const r = await submit("cit1", { documents: docs });
    assert.equal(r.status, 200, `stored type ${JSON.stringify(mimetype)}: ${JSON.stringify(r.body)}`);
    assert.equal(subApp().documents.find((d) => d.docType === "income-proof").type, "application/pdf");
  }
  // …but a declared type that is not allowed is refused, whatever storage says
  for (const [n, declared] of [[12, "text/html"], [13, "application/x-msdownload"], [14, undefined]]) {
    seed();
    const docs = base({ mimetype: "application/octet-stream", type: declared, path: reqPath("income-proof", { app: SUB_APP, uuid: uuidFor("income-proof", n) }) });
    assert.equal((await submit("cit1", { documents: docs })).status, 400, `declared ${declared}`);
    assert.ok(!subApp());
  }
  // and a concrete disallowed type in storage is refused even when the browser claims a PDF
  seed();
  assert.equal((await submit("cit1", { documents: base({ mimetype: "text/html", path: reqPath("income-proof", { app: SUB_APP, uuid: uuidFor("income-proof", 15) }) }) })).status, 400);
});

test("[verify] if storage reports no size, the declared size is checked instead; with neither, the file is refused", async () => {
  const withSize = (n, size) => INCOME.map((t) => (t === "income-proof"
    ? subDoc(t, { storedSize: null, size, path: reqPath(t, { app: SUB_APP, uuid: uuidFor(t, n) }) })
    : subDoc(t)));
  seed();
  assert.equal((await submit("cit1", { documents: withSize(20, 1000) })).status, 200);
  assert.equal(subApp().documents.find((d) => d.docType === "income-proof").size, 1000);
  for (const [n, size] of [[21, 5 * 1024 * 1024 + 1], [22, 0], [23, "1000"], [24, undefined], [25, -5]]) {
    seed();
    assert.equal((await submit("cit1", { documents: withSize(n, size) })).status, 400, `declared size ${size}`);
    assert.ok(!subApp());
  }
});
