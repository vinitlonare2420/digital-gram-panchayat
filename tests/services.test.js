/* ==========================================================================
   tests/services.test.js — the nine certificate / service types.

   Run with:  npm test

   Two kinds of checks:
   1. STATIC  — the service catalog (js/utils.js), the API allow-list
      (api/_lib/validation.js) and the Firestore rules (firestore.rules) must
      agree; the Services page, filters and lists must cover every type and
      escape user-entered text.
   2. BEHAVIOUR — the REAL inline script of each new form (marriage, bpl,
      nodues, property, other) plus js/service-form.js, js/validation.js and
      js/utils.js run inside a small fake browser. GPApplications / GPUploads
      are fakes, so nothing touches Firebase or Supabase. This proves field
      validation, document rules, the submitted application, failure handling
      and orphan-upload cleanup.

   Firestore rules and real browser rendering are NOT executed here (no
   emulator / browser) — see the manual checks in the project report.
   ========================================================================== */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const exists = (p) => fs.existsSync(path.join(root, p));

const EXPECTED = {
  birth: "Birth Certificate",
  death: "Death Certificate",
  income: "Income Certificate",
  caste: "Caste Certificate",
  marriage: "Marriage Registration",
  bpl: "BPL Certificate",
  nodues: "No Dues Certificate",
  property: "Property Assessment Certificate",
  other: "Other Certificate / Service Request",
};
const OLD_FOUR = ["birth", "death", "income", "caste"];
const NEW_FIVE = ["marriage", "bpl", "nodues", "property", "other"];

/* ----------------------------- fake browser ----------------------------- */

function makeEl(id) {
  return {
    id, value: "", textContent: "", disabled: false, dataset: {}, attrs: {}, listeners: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute(k, v) { this.attrs[k] = v; },
    removeAttribute(k) { delete this.attrs[k]; },
    focus() {}, scrollIntoView() {}, appendChild() {},
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    querySelector() { return this._submit || null; },
  };
}

/** Real utils.js + validation.js (+ service-form.js) inside a fake browser. */
function loadBrowserScripts(withServiceForm = true) {
  const registry = {};
  const errors = {};
  const document = {
    getElementById: (id) => registry[id] || null,
    querySelector(sel) {
      const m = /data-error-for="([^"]+)"/.exec(sel);
      return m ? (errors[m[1]] = errors[m[1]] || makeEl("err-" + m[1])) : null;
    },
    querySelectorAll: () => [],
    createElement: (tag) => makeEl(tag),
    addEventListener() {},
  };
  const sandbox = { document, console, setTimeout, clearTimeout, URLSearchParams, encodeURIComponent };
  sandbox.window = sandbox;
  sandbox.location = { href: "", search: "" };
  const ctx = vm.createContext(sandbox);
  const files = ["js/utils.js", "js/validation.js", "js/document-checklists.js"].concat(withServiceForm ? ["js/checklist-ui.js", "js/service-form.js"] : []);
  for (const f of files) vm.runInContext(read(f), ctx, { filename: f });
  return { ctx, registry, errors };
}

const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r)); };
const GOOD_FILE = { name: "proof.pdf", type: "application/pdf", size: 120000 };

/** Loads a service page, runs its own inline script, returns helpers to drive the form. */
function openPage(file, { upload, create } = {}) {
  const html = read(file);
  const { ctx, registry, errors } = loadBrowserScripts();
  for (const m of html.matchAll(/\bid="([^"]+)"/g)) registry[m[1]] = registry[m[1]] || makeEl(m[1]);
  const submitBtn = makeEl("submit-btn");
  registry["service-form"]._submit = submitBtn;

  const calls = { upload: [], create: [], cleanup: [], toasts: [], success: [] };
  const chosen = {};                                   // fieldId -> File, one entry per document type
  ctx.__uploadOpts = {};
  ctx.GPApplications = {
    generateApplicationDocId: () => "NewAppDocId1234567890",
    async createApplication(a) {
      calls.create.push(a);
      return create ? create(a) : { docId: a.applicationDocId, applicationId: "GP-2026-TEST0001" };
    },
  };
  ctx.GPUploads = {
    async uploadDocument(a) {
      calls.upload.push(a);
      return upload ? upload(a) : { name: a.file.name, type: a.file.type, size: a.file.size, path: `applications/user1/${a.applicationDocId}/uuid-${a.docType}__${a.file.name}` };
    },
    async cleanupUpload(a) { calls.cleanup.push(a); },
  };
  ctx.showToast = (message, type) => calls.toasts.push([type, message]);
  ctx.renderApplicationSuccess = (el, opts) => calls.success.push(opts);
  ctx.initPublicLayout = () => {};
  ctx.renderBreadcrumb = () => {};
  ctx.initFileUpload = (el, opts) => { ctx.__uploadOpts[opts.fieldId] = opts; return { fieldId: opts.fieldId, getFile: () => chosen[opts.fieldId] || null }; };

  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  vm.runInContext(scripts[scripts.length - 1], ctx, { filename: file });   // the page's own script
  const checklist = JSON.parse(vm.runInContext(`JSON.stringify(DocumentChecklists.getChecklist('${file.match(/(\w+)\.html$/)[1]}').items)`, ctx));

  return {
    ctx, registry, errors, calls, submitBtn, html,
    fill(values) { for (const [id, v] of Object.entries(values)) registry[id].value = v; },
    checklist,
    /** attach `f` to every REQUIRED document */
    setFile(f) { checklist.filter((i) => i.required).forEach((i) => { chosen["doc-" + i.key] = f; }); },
    /** attach `f` to EVERY document, optional ones included */
    setAllFiles(f) { checklist.forEach((i) => { chosen["doc-" + i.key] = f; }); },
    setDoc(key, f) { if (f) chosen["doc-" + key] = f; else delete chosen["doc-" + key]; },
    async submit() {
      registry["service-form"].listeners.submit[0]({ preventDefault() {} });
      await settle();
    },
    anyError: () => Object.values(errors).some((e) => e.textContent),
    errorFor: (id) => (errors[id] ? errors[id].textContent : ""),
  };
}

/* One fully valid submission per new page. Optional fields are left blank on purpose. */
const VALID = {
  marriage: { "applicant-name": "Asha Patil", "mobile-number": "9876543210", "applicant-role": "Wife / bride", "groom-name": "Ravi Patil", "groom-dob": "1995-04-12", "groom-father": "Mohan Patil", "bride-name": "Asha Deshmukh", "bride-dob": "1997-08-20", "bride-father": "Suresh Deshmukh", "marriage-date": "2023-02-14", "marriage-place": "Community hall, Rampur", "couple-address": "12 Main Road, Rampur", "witness1-name": "Anil Kale", "witness2-name": "Sunita Rao" },
  bpl: { "applicant-name": "Ganesh Pawar", "mobile-number": "9123456780", "relation-to-head": "Self (head of family)", "head-name": "Ganesh Pawar", "family-members": "5", "annual-income": "48000", occupation: "Farm labourer", address: "Ward 3, Rampur", purpose: "Scholarship / education" },
  nodues: { "applicant-name": "Meena Joshi", "mobile-number": "9988776655", "relation-to-property": "Owner", "dues-type": "House / property tax", "property-ref": "H-12", "property-address": "Ward 2, Rampur", purpose: "Bank loan" },
  property: { "applicant-name": "Vijay More", "mobile-number": "9090909090", "relation-to-owner": "Owner", "owner-name": "Vijay More", "property-type": "Residential house", "property-ref": "S-44/2", "property-address": "Survey 44, Rampur", purpose: "Sale or transfer" },
  other: { "applicant-name": "Kiran Shinde", "mobile-number": "9811122233", "requested-service": "Land use certificate", description: "I need a land use certificate to apply for an agricultural loan." },
};
/** Each entry makes an otherwise valid form INVALID. */
const INVALID = {
  marriage: [{ "mobile-number": "12345" }, { "groom-dob": "2999-01-01" }, { "marriage-date": "2999-01-01" }, { "marriage-date": "1990-01-01" }, { "groom-name": "x".repeat(101) }],
  bpl: [{ "family-members": "0" }, { "family-members": "31" }, { "family-members": "2.5" }, { "annual-income": "lots" }, { "purpose-details": "x".repeat(301) }],
  nodues: [{ "mobile-number": "abc" }, { "additional-notes": "x".repeat(301) }],
  property: [{ "year-built": "1700" }, { "year-built": String(new Date().getFullYear() + 1) }, { "built-up-area": "big" }],
  other: [{ description: "too short" }, { description: "x".repeat(1001) }, { "requested-service": "x".repeat(101) }],
};
const PAGE = (type) => `services/${type}.html`;

/* ============================ STATIC CHECKS ============================ */

test("[services] the catalog, the API allow-list and the Firestore rules agree on the nine services", () => {
  const { ctx } = loadBrowserScripts(false);
  const catalog = JSON.parse(vm.runInContext("JSON.stringify(SERVICE_TYPES)", ctx));
  assert.deepEqual(catalog, EXPECTED, "js/utils.js SERVICE_TYPES");

  const api = require(path.join(root, "api/_lib/validation.js")).ALLOWED_SERVICE_TYPES;
  assert.deepEqual([...api].sort(), Object.keys(EXPECTED).sort(), "api/_lib/validation.js ALLOWED_SERVICE_TYPES");

  assert.deepEqual(require(path.join(root, "api/_lib/validation.js")).SERVICE_NAMES, EXPECTED, "api/_lib/validation.js SERVICE_NAMES (written to every application by the server)");
  const rules = read("firestore.rules");
  assert.match(rules, /match \/applications\/\{applicationId\}\s*\{\s*[^]*?allow create: if false;/, "applications are created by /api/applications/submit only");
});

test("[services] every service has a form page, a Services-page card with working links, and the authority notice", () => {
  const services = read("services.html");
  assert.equal((services.match(/<article/g) || []).length, 9, "services.html should show nine cards");
  for (const [type, name] of Object.entries(EXPECTED)) {
    assert.ok(exists(PAGE(type)), `${PAGE(type)} is missing`);
    assert.ok(services.includes(`href="services/${type}.html"`), `Apply link for ${type}`);
    assert.ok(services.includes(`href="services/${type}.html#requirements"`), `Requirements link for ${type}`);
    assert.ok(services.includes(`>${name}</h2>`), `card title for ${name}`);
    assert.match(read(PAGE(type)), /id="requirements"/, `${PAGE(type)} needs the #requirements anchor`);
  }
  assert.match(services, /does not guarantee that a certificate will be issued/i, "authority / accuracy notice");
  for (const type of NEW_FIVE) assert.match(read(PAGE(type)), /subject to the powers and procedures of the relevant local authority/i, `${type} form notice`);
});

test("[services] each form submits the right serviceType; the original four forms are unchanged in shape", () => {
  for (const type of OLD_FOUR) {
    const html = read(PAGE(type));
    assert.ok(html.includes(`serviceType: '${type}'`), `${type} form`);
    assert.ok(html.includes("initServiceForm(") && html.includes(`formId: '${type}-form'`), `${type} submits through the shared flow with its original form`);
  }
  for (const type of NEW_FIVE) {
    const html = read(PAGE(type));
    assert.ok(html.includes(`serviceType: '${type}'`), `${type} form`);
    assert.ok(!/serviceName:/.test(html), `${type}: serviceName must come from the catalog, not be typed on the page`);
    assert.ok(html.includes('<script src="../js/service-form.js"></script>'), `${type} loads the shared submit helper`);
  }
});

test("[services] citizen and staff filters are built from the catalog (all nine), not hard-coded", () => {
  for (const file of ["citizen/applications.html", "staff/applications.html"]) {
    const html = read(file);
    assert.ok(html.includes("serviceOptionsHTML()"), file);
    assert.ok(!/<option value="(birth|death|income|caste)">/.test(html), `${file} still has hard-coded service options`);
  }
});

test("[services] lists, dashboards and detail pages show the service via serviceLabel() and never inject raw service text", () => {
  const files = ["citizen/applications.html", "citizen/dashboard.html", "citizen/application-details.html", "staff/applications.html", "staff/dashboard.html", "staff/application-details.html", "admin/dashboard.html"];
  for (const file of files) {
    const html = read(file);
    assert.ok(html.includes("serviceLabel("), `${file} should use serviceLabel`);
    assert.ok(!/\$\{\s*(app|a)\.serviceName\s*\}/.test(html), `${file} injects serviceName unescaped`);
  }
  // innerHTML templates must escape; the detail pages use textContent
  assert.match(read("citizen/applications.html"), /escapeHtml\(serviceLabel\(app\)\)/);
  assert.match(read("staff/applications.html"), /escapeHtml\(serviceLabel\(a\)\)/);
  assert.match(read("admin/dashboard.html"), /service-stats/, "admin dashboard has per-service counts");
});

test("[services] staff can redirect a request to another department using the existing reject-with-reason flow", () => {
  const html = read("staff/application-details.html");
  assert.match(html, /reject-template-btn/);
  assert.match(html, /another department/i);
  assert.match(html, /replace the text in \[brackets\]/i, "an unedited template must not be sendable");
  assert.ok(!/under_verification|correction_required/.test(read("api/staff/update-application-status.js").split("TRANSITIONS")[1].slice(0, 200)), "no new statuses were introduced");
});

/* ============================ HELPERS ============================ */

test("[services] serviceLabel, serviceOptionsHTML, countByService and escapeHtml behave", () => {
  const { ctx } = loadBrowserScripts(false);
  const run = (code) => vm.runInContext(code, ctx);
  assert.equal(run("serviceLabel({ serviceType: 'death', serviceName: 'Death Certificate' })"), "Death Certificate");
  assert.equal(run("serviceLabel({ serviceType: 'other', serviceName: 'Other Certificate / Service Request', formData: { requestedService: '  Land use certificate ' } })"),
    "Other Certificate / Service Request: Land use certificate");
  assert.equal(run("serviceLabel({ serviceType: 'other', serviceName: 'Other Certificate / Service Request', formData: {} })"), "Other Certificate / Service Request");
  assert.equal(run("serviceLabel({ serviceType: 'bpl' })"), "BPL Certificate", "falls back to the catalog name");
  assert.equal(run("serviceLabel({})"), "Unknown service");
  assert.equal((run("serviceOptionsHTML()").match(/<option /g) || []).length, 9);
  const counts = JSON.parse(run("JSON.stringify(countByService([{serviceType:'bpl'},{serviceType:'bpl'},{serviceType:'other'},{serviceType:'birth'},{serviceType:'mystery'},{}, null]))"));
  assert.deepEqual({ bpl: counts.bpl, other: counts.other, birth: counts.birth, death: counts.death, unknown: counts.unknown }, { bpl: 2, other: 1, birth: 1, death: 0, unknown: 3 });
  assert.equal(Object.keys(counts).length, 10, "nine services + unknown");
  // citizen-entered text is escaped before it reaches innerHTML
  const label = run(`serviceLabel({ serviceType: 'other', formData: { requestedService: '<img src=x onerror=alert(1)>' } })`);
  const safe = run(`escapeHtml(${JSON.stringify(label)})`);
  assert.ok(label.includes("<img") && !safe.includes("<img") && safe.includes("&lt;img"));
});

/* ============================ BEHAVIOUR: new forms ============================ */

for (const type of NEW_FIVE) {
  const page = PAGE(type);
  const needsFile = type !== "other";
  const requiredCount = (p) => p.checklist.filter((i) => i.required).length;

  test(`[${type}] a valid application is submitted once, with the canonical service name, trimmed form data and the uploaded document`, async () => {
    const p = openPage(page);
    p.fill(Object.fromEntries(Object.entries(VALID[type]).map(([id, v]) => [id, `  ${v}  `])));   // stray spaces must be trimmed
    p.setAllFiles(GOOD_FILE);
    await p.submit();

    assert.equal(p.calls.upload.length, p.checklist.length, "one upload per document type");
    assert.equal(p.calls.upload[0].serviceType, type);
    assert.deepEqual(p.calls.upload.map((u) => u.docType), p.checklist.map((i) => i.key), "each upload is tagged with its document type");
    assert.equal(p.calls.create.length, 1, "application created");
    const app = p.calls.create[0];
    assert.equal(app.serviceType, type);
    assert.equal(app.serviceName, EXPECTED[type], "name comes from the catalog");
    assert.equal(app.applicationDocId, p.calls.upload[0].applicationDocId, "upload and application share one id");
    assert.equal(app.documents.length, p.checklist.length);
    assert.match(app.documents[0].path, /^applications\/user1\/NewAppDocId1234567890\//);
    app.documents.forEach((d, i) => {
      assert.equal(d.docType, p.checklist[i].key);
      assert.equal(d.docLabel, p.checklist[i].label);
      assert.ok(d.path.includes("-" + d.docType + "__"), "the stored path records the document type");
    });
    assert.ok(!("userId" in app) && !("status" in app) && !("role" in app), "identity/status are never supplied by the form");

    // every form field is stored, trimmed, under the key the page declares
    const keyFor = Object.fromEntries([...p.html.matchAll(/(\w+): document\.getElementById\('([\w-]+)'\)\.value\.trim\(\)/g)].map((m) => [m[2], m[1]]));
    for (const [id, v] of Object.entries(VALID[type])) {
      assert.ok(keyFor[id], `no formData key for #${id}`);
      assert.equal(app.formData[keyFor[id]], v, `formData.${keyFor[id]}`);
    }
    assert.equal(p.calls.success.length, 1, "success screen shown");
    assert.match(p.calls.success[0].viewHref, /^\.\.\/citizen\/application-details\.html\?id=NewAppDocId1234567890$/);
    assert.equal(p.calls.cleanup.length, 0);
    assert.equal(p.submitBtn.disabled, false);
  });

  test(`[${type}] every required field blocks submission when empty, and optional fields do not`, async () => {
    const required = [...read(page).matchAll(/^\s*'([\w-]+)':\s*(\[.*\]),$/gm)].filter((m) => m[2].includes("Validators.required")).map((m) => m[1]);
    assert.ok(required.length >= 4, "found the required-field rules");
    for (const id of required) {
      const p = openPage(page);
      p.fill({ ...VALID[type], [id]: "   " });
      p.setFile(GOOD_FILE);
      await p.submit();
      assert.equal(p.calls.create.length, 0, `#${id} is required but the form was submitted`);
      assert.equal(p.calls.upload.length, 0, `#${id}: nothing may be uploaded when the form is invalid`);
      assert.ok(p.errorFor(id), `#${id} shows no error message`);
    }
    // the VALID map leaves every optional field blank and still submits (previous test) — double-check explicitly
    const ok = openPage(page);
    ok.fill(VALID[type]); ok.setFile(GOOD_FILE);
    await ok.submit();
    assert.equal(ok.calls.create.length, 1);
  });

  test(`[${type}] invalid values (formats, ranges, dates, lengths) are rejected before anything is uploaded`, async () => {
    for (const bad of INVALID[type]) {
      const p = openPage(page);
      p.fill({ ...VALID[type], ...bad });
      p.setFile(GOOD_FILE);
      await p.submit();
      assert.equal(p.calls.create.length, 0, `accepted ${JSON.stringify(bad).slice(0, 60)}`);
      assert.equal(p.calls.upload.length, 0);
      assert.ok(p.anyError(), `no error shown for ${JSON.stringify(bad).slice(0, 60)}`);
    }
  });

  test(`[${type}] document rules: ${needsFile ? "every required document must be attached" : "no document is required"}; wrong type or size is always refused`, async () => {
    // nothing attached
    const none = openPage(page);
    none.fill(VALID[type]);
    await none.submit();
    if (needsFile) {
      assert.equal(none.calls.create.length, 0, "submitted without the required documents");
      assert.equal(none.calls.upload.length, 0, "nothing is uploaded when a required document is missing");
      for (const item of none.checklist.filter((i) => i.required)) assert.match(none.errorFor("doc-" + item.key), /is required/i, item.key);
      for (const item of none.checklist.filter((i) => !i.required)) assert.equal(none.errorFor("doc-" + item.key), "", "optional documents are not flagged");
    } else {
      assert.equal(none.calls.upload.length, 0, "nothing to upload");
      assert.equal(none.calls.create.length, 1, "optional documents: submits without any");
      assert.equal(none.calls.create[0].documents.length, 0, "no document attached");
      assert.equal(none.ctx.__uploadOpts["doc-supporting-document"].optional, true, "upload widget is labelled optional");
    }
    // each required document, left out on its own, blocks the submission
    for (const item of none.checklist.filter((i) => i.required)) {
      const p = openPage(page);
      p.fill(VALID[type]); p.setFile(GOOD_FILE); p.setDoc(item.key, null);
      await p.submit();
      assert.equal(p.calls.create.length, 0, `submitted without ${item.key}`);
      assert.equal(p.calls.upload.length, 0);
      assert.match(p.errorFor("doc-" + item.key), /is required/i);
    }
    // optional documents may be left out
    const req = openPage(page);
    req.fill(VALID[type]); req.setFile(GOOD_FILE);
    await req.submit();
    assert.equal(req.calls.create.length, 1, "required documents alone are enough");
    assert.equal(req.calls.create[0].documents.length, requiredCount(req));
    // a bad file is refused whether or not the document is required
    const target = none.checklist[0];
    for (const bad of [{ name: "run.exe", type: "application/x-msdownload", size: 1000 }, { name: "page.html", type: "text/html", size: 1000 }, { name: "big.pdf", type: "application/pdf", size: 5 * 1024 * 1024 + 1 }]) {
      const p = openPage(page);
      p.fill(VALID[type]); p.setFile(GOOD_FILE); p.setDoc(target.key, bad);
      await p.submit();
      assert.equal(p.calls.create.length, 0, `accepted ${bad.name}`);
      assert.equal(p.calls.upload.length, 0, `uploaded ${bad.name}`);
      assert.ok(p.errorFor("doc-" + target.key), `no file error for ${bad.name}`);
    }
    // the allowed formats pass
    for (const ok of [{ name: "a.pdf", type: "application/pdf", size: 5 * 1024 * 1024 }, { name: "a.jpg", type: "image/jpeg", size: 10 }, { name: "a.png", type: "image/png", size: 10 }]) {
      const p = openPage(page);
      p.fill(VALID[type]); p.setAllFiles(ok);
      await p.submit();
      assert.equal(p.calls.create.length, 1, ok.name);
    }
  });

  test(`[${type}] failures: upload error creates nothing; save error removes the orphan upload; logged-out users are sent to login; double-clicks submit once`, async () => {
    // upload fails -> no application, button re-enabled, error toast
    const up = openPage(page, { upload: async () => { throw new Error("Your document could not be uploaded. Please try again."); } });
    up.fill(VALID[type]); up.setAllFiles(GOOD_FILE);
    await up.submit();
    assert.equal(up.calls.create.length, 0);
    assert.equal(up.submitBtn.disabled, false);
    assert.ok(up.calls.toasts.some(([t, m]) => t === "error" && /could not be uploaded/.test(m)));

    // application save fails after a good upload -> orphan deleted
    const save = openPage(page, { create: async () => { throw new Error("Your application could not be submitted. Please try again."); } });
    save.fill(VALID[type]); save.setAllFiles(GOOD_FILE);
    await save.submit();
    assert.equal(save.calls.upload.length, save.checklist.length);
    assert.deepEqual(save.calls.cleanup.map((c) => c.path).sort(), save.calls.upload.map((u) => `applications/user1/${u.applicationDocId}/uuid-${u.docType}__proof.pdf`).sort(), "every orphaned upload must be cleaned up");
    assert.equal(save.calls.success.length, 0);
    assert.equal(save.submitBtn.disabled, false);

    // logged out -> redirected to login with a way back, orphan still cleaned
    const out = openPage(page, { create: async () => { throw new Error("Please log in to submit your application."); } });
    out.fill(VALID[type]); out.setAllFiles(GOOD_FILE);
    await out.submit();
    assert.equal(out.calls.cleanup.length, out.checklist.length);
    assert.ok(out.ctx.window.location.href.startsWith(`../login.html?redirect=${encodeURIComponent(page)}`), out.ctx.window.location.href);

    // double click while the first request is still running
    let release;
    const gate = new Promise((r) => { release = r; });
    const dbl = openPage(page, { create: async (a) => { await gate; return { docId: a.applicationDocId, applicationId: "GP-2026-DBL00001" }; } });
    dbl.fill(VALID[type]); dbl.setFile(GOOD_FILE);
    dbl.registry["service-form"].listeners.submit[0]({ preventDefault() {} });
    await settle();
    dbl.registry["service-form"].listeners.submit[0]({ preventDefault() {} });
    await settle();
    release();
    await settle();
    assert.equal(dbl.calls.create.length, 1, "second click must be ignored");
  });
}

test("[other] the request name and description are stored as plain text — HTML is escaped when shown, not altered when stored", async () => {
  const p = openPage(PAGE("other"));
  p.fill({ ...VALID.other, "requested-service": "<b>Lease</b> certificate", description: "<script>alert('x')</script> need it for court." });
  await p.submit();
  const app = p.calls.create[0];
  assert.equal(app.formData.requestedService, "<b>Lease</b> certificate");
  assert.ok(app.formData.descriptionAndPurpose.startsWith("<script>"));
  const label = vm.runInContext(`serviceLabel(${JSON.stringify(app)})`, p.ctx);
  assert.ok(!vm.runInContext(`escapeHtml(${JSON.stringify(label)})`, p.ctx).includes("<b>"));
});

test("[marriage] the date-of-birth / marriage-date check names the person at fault", async () => {
  const p = openPage(PAGE("marriage"));
  p.fill({ ...VALID.marriage, "marriage-date": "1996-01-01" });   // after the groom (1995) but before the bride (1997)
  p.setFile(GOOD_FILE);
  await p.submit();
  assert.match(p.errorFor("marriage-date"), /Bride's date of birth must be before the marriage date/);
  assert.equal(p.calls.create.length, 0);
});

/* ======================= existing forms keep working ======================= */

test("[services] the original four forms still load their scripts and submit through GPApplications / GPUploads", () => {
  for (const type of OLD_FOUR) {
    const html = read(PAGE(type));
    for (const needle of ["../js/applications.js", "../js/uploads.js", "../js/service-form.js", "../js/document-checklists.js", "initDocumentChecklist(", "initServiceForm("]) {
      assert.ok(html.includes(needle), `${type}: lost ${needle}`);
    }
  }
  const shared = read("js/service-form.js");
  for (const needle of ["GPApplications.createApplication", "GPUploads.uploadDocument", "GPUploads.cleanupUpload", "renderApplicationSuccess"]) {
    assert.ok(shared.includes(needle), `service-form.js: lost ${needle}`);
  }
});
