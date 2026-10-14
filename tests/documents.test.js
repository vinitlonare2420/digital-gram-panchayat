/* ==========================================================================
   tests/documents.test.js — per-service "Required Documents" checklists.

   Run with:  npm test

   PART 1  The nine application forms, run in a small fake browser: every form
           shows its checklist (Required / Optional + the "not official" notice),
           has one upload field per document, refuses to submit while a required
           document is missing, uploads each document with its type, and cleans up
           after a failed upload or a failed save.
   PART 2  The citizen's application page: a staff request for more documents
           appears with one upload field per outstanding document, and the upload
           flow reports success and failure correctly.
   PART 3  The staff application page: checklist status, labelled document links,
           and the "request missing documents" form.
   PART 4  Static wiring: scripts, rules limit, no secrets in browser code.

   The API side (upload URLs, staff requests, attaching documents, access control)
   is tested in tests/api-security.test.js.
   ========================================================================== */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const DC = require(path.join(root, "js/document-checklists.js"));

const ALL = ["birth", "death", "income", "caste", "marriage", "bpl", "nodues", "property", "other"];
const GOOD = { name: "proof.pdf", type: "application/pdf", size: 120000 };
const plain = (x) => JSON.parse(JSON.stringify(x));      // objects built inside the fake browser have another Object prototype
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r)); };

/* ----------------------------- fake browser ----------------------------- */

function makeEl(id) {
  const classes = new Set();
  return {
    id, value: "", checked: false, innerHTML: "", textContent: "", disabled: false, dataset: {}, attrs: {}, listeners: {}, children: [],
    classList: {
      add: (...c) => c.forEach((x) => classes.add(x)),
      remove: (...c) => c.forEach((x) => classes.delete(x)),
      contains: (c) => classes.has(c),
      toggle(c, force) { const on = force === undefined ? !classes.has(c) : !!force; on ? classes.add(c) : classes.delete(c); return on; },
    },
    setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; }, removeAttribute(k) { delete this.attrs[k]; },
    focus() {}, scrollIntoView() {}, appendChild(c) { this.children.push(c); },
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    querySelector(sel) {
      if (/^\[data-(prepared|doc-state)="[^"]+"\]$|^\[data-checklist-(progress|files|summary)\]$/.test(sel)) {
        this._q = this._q || {};
        return (this._q[sel] = this._q[sel] || makeEl(sel));
      }
      return this._submit || null;
    },
    querySelectorAll() { return []; },
    async fire(type) { for (const fn of this.listeners[type] || []) await fn({ preventDefault() {} }); },
    hidden() { return classes.has("hidden"); },
  };
}

/** Real project scripts + the page's own inline script, in a fake browser. */
function loadPage(file, { scripts = [], stubs = {}, querySelectorAll, search = "" } = {}) {
  const html = read(file);
  const registry = {};
  const errors = {};
  for (const m of html.matchAll(/\bid="([^"]+)"/g)) registry[m[1]] = registry[m[1]] || makeEl(m[1]);
  const document = {
    getElementById: (id) => registry[id] || null,
    querySelector(sel) {
      const m = /data-error-for="([^"]+)"/.exec(sel);
      return m ? (errors[m[1]] = errors[m[1]] || makeEl("err-" + m[1])) : null;
    },
    querySelectorAll: (sel) => (querySelectorAll ? querySelectorAll(sel, registry) : []),
    createElement: (tag) => makeEl(tag),
    addEventListener() {},
    body: { appendChild() {} },
  };
  const calls = { toasts: [], reloads: 0 };
  const sandbox = { document, console, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}, URLSearchParams, encodeURIComponent };
  sandbox.window = sandbox;
  sandbox.location = { href: "", search, reload() { calls.reloads++; } };
  sandbox.SITE_BASE = "../";
  const ctx = vm.createContext(sandbox);
  for (const f of ["js/utils.js", "js/validation.js", "js/document-checklists.js", ...scripts]) vm.runInContext(read(f), ctx, { filename: f });
  Object.assign(ctx, {
    showToast: (message, type) => calls.toasts.push([type, message]),
    initPublicLayout() {}, renderBreadcrumb() {}, initDashboardShell() {}, hideAuthCheckingOverlay() {},
    openModal() {}, closeModal() {}, renderApplicationTimeline() {}, renderApplicationSuccess: (el, opts) => (calls.success = opts),
    whenUploadsReady: (cb) => cb(), whenAppsReady: (cb) => cb(), whenStaffReady: (cb) => cb(), whenAuthReady: (cb) => cb(),
    GPAuth: { protectPage: async () => {} },
    ...stubs,
  });
  const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  return { ctx, registry, errors, calls, html, run: () => vm.runInContext(inline[inline.length - 1], ctx, { filename: file }), errorFor: (id) => (errors[id] ? errors[id].textContent : "") };
}

/* ============================ PART 1: the forms ============================ */

const VALID = {
  birth: { "applicant-name": "Asha Patil", "mobile-number": "9876543210", "child-name": "Baby Patil", dob: "2024-01-05", gender: "female", "place-of-birth": "Rampur", "father-name": "Ravi Patil", "mother-name": "Asha Patil", address: "12 Main Road" },
  death: { "applicant-name": "Asha Patil", relationship: "Daughter", "mobile-number": "9876543210", "deceased-name": "Mohan Patil", dod: "2024-01-05", age: "80", gender: "male", "place-of-death": "Rampur", "guardian-name": "Ravi Patil", address: "12 Main Road" },
  income: { "applicant-name": "Asha Patil", "guardian-name": "Ravi Patil", address: "12 Main Road", "mobile-number": "9876543210", occupation: "Farmer", "annual-income": "48000", "income-source": "agriculture", "family-details": "4 members", purpose: "Scholarship" },
  caste: { "applicant-name": "Asha Patil", "guardian-name": "Ravi Patil", dob: "1999-03-04", "mobile-number": "9876543210", address: "12 Main Road", caste: "Kunbi", category: "obc", "family-info": "4 members", purpose: "Admission" },
  marriage: { "applicant-name": "Asha Patil", "mobile-number": "9876543210", "applicant-role": "Wife / bride", "groom-name": "Ravi Patil", "groom-dob": "1995-04-12", "groom-father": "Mohan Patil", "bride-name": "Asha Deshmukh", "bride-dob": "1997-08-20", "bride-father": "Suresh Deshmukh", "marriage-date": "2023-02-14", "marriage-place": "Community hall", "couple-address": "12 Main Road", "witness1-name": "Anil Kale", "witness2-name": "Sunita Rao" },
  bpl: { "applicant-name": "Ganesh Pawar", "mobile-number": "9123456780", "relation-to-head": "Self", "head-name": "Ganesh Pawar", "family-members": "5", "annual-income": "48000", occupation: "Labourer", address: "Ward 3", purpose: "Scholarship / education" },
  nodues: { "applicant-name": "Meena Joshi", "mobile-number": "9988776655", "relation-to-property": "Owner", "dues-type": "House / property tax", "property-ref": "H-12", "property-address": "Ward 2", purpose: "Bank loan" },
  property: { "applicant-name": "Vijay More", "mobile-number": "9090909090", "relation-to-owner": "Owner", "owner-name": "Vijay More", "property-type": "Residential house", "property-ref": "S-44/2", "property-address": "Survey 44", purpose: "Sale or transfer" },
  other: { "applicant-name": "Kiran Shinde", "mobile-number": "9811122233", "requested-service": "Land use certificate", description: "I need a land use certificate to apply for an agricultural loan." },
};

function openForm(type, { upload, create } = {}) {
  const chosen = {};
  const opts = {};
  const calls = { upload: [], create: [], cleanup: [] };
  const page = loadPage(`services/${type}.html`, {
    scripts: ["js/checklist-ui.js", "js/service-form.js"],
    stubs: {
      GPApplications: {
        generateApplicationDocId: () => "NewAppDocId1234567890",
        async createApplication(a) { calls.create.push(a); return create ? create(a) : { docId: a.applicationDocId, applicationId: "GP-2026-TEST0001" }; },
      },
      GPUploads: {
        async uploadDocument(a) {
          calls.upload.push(a);
          if (upload) return upload(a, calls.upload.length);
          return { name: a.file.name, type: a.file.type, size: a.file.size, path: `applications/user1/${a.applicationDocId}/uuid-${a.docType}__${a.file.name}` };
        },
        async cleanupUpload(a) { calls.cleanup.push(a); },
      },
      initFileUpload: (el, o) => { opts[o.fieldId] = o; return { fieldId: o.fieldId, getFile: () => chosen[o.fieldId] || null }; },
    },
  });
  Object.assign(page.calls, calls);               // one calls object: toasts/success from the page + upload/create/cleanup
  page.run();
  const checklist = DC.getChecklist(type).items;
  const form = page.registry[type === "birth" || type === "death" || type === "income" || type === "caste" ? `${type}-form` : "service-form"];
  form._submit = makeEl("submit");
  return {
    ...page, opts, checklist, form,
    fill(values) { for (const [id, v] of Object.entries(values)) page.registry[id].value = v; },
    attach(keys, file = GOOD) { keys.forEach((k) => { chosen["doc-" + k] = file; opts["doc-" + k].onChange(); }); },
    tick(key, on = true) { const box = this.container()._q[`[data-prepared="${key}"]`]; box.checked = on; for (const fn of box.listeners.change || []) fn(); },
    container() { return page.registry["upload-container"]; },
    stateOf(key) { return this.container()._q[`[data-doc-state="${key}"]`].textContent; },
    progress() { return this.container()._q["[data-checklist-progress]"].textContent; },
    filesLine() { return this.container()._q["[data-checklist-files]"].textContent; },
    attachRequired(file = GOOD) { this.attach(checklist.filter((i) => i.required).map((i) => i.key), file); },
    attachAll(file = GOOD) { this.attach(checklist.map((i) => i.key), file); },
    detach(key) { delete chosen["doc-" + key]; opts["doc-" + key].onChange(); },
    async submit() { await form.fire("submit"); await settle(); },
  };
}

for (const type of ALL) {
  const list = DC.getChecklist(type).items;
  const required = list.filter((i) => i.required);

  test(`[form:${type}] shows its checklist with Required / Optional labels, one upload field per document, and the 'not official' notice`, () => {
    const p = openForm(type);
    const html = p.registry["upload-container"].innerHTML;
    for (const item of list) {
      assert.ok(html.includes(p.ctx.escapeHtml(item.label)), `${type}: checklist lists "${item.label}"`);
      assert.ok(p.opts["doc-" + item.key], `${type}: upload field for ${item.key}`);
      assert.equal(p.opts["doc-" + item.key].optional, !item.required, `${type}.${item.key} Required/Optional flag on the upload field`);
    }
    assert.equal(Object.keys(p.opts).length, list.length, "exactly one upload field per document type");
    assert.equal((html.match(/>Required</g) || []).length, required.length, "Required badges");
    assert.equal((html.match(/>Optional</g) || []).length, list.length - required.length, "Optional badges");
    assert.match(html, /not official government rules/i);
    assert.match(html, /confirm the requirements with the responsible authority/i);
    assert.match(html, /needs confirmation from the responsible authority/i, "unconfirmed lists say so");
    assert.ok(!/maharashtra government rule|as per government/i.test(html), "never presents the list as official");
    if (type === "other") assert.match(html, /staff may ask you for more/i, "'Other' explains that staff define the documents");
  });

  test(`[form:${type}] a valid form submits once: each chosen document is uploaded with its own type and stored with the application id`, async () => {
    const p = openForm(type);
    p.fill(VALID[type]); p.attachAll();
    await p.submit();
    assert.equal(p.calls.create.length, 1, "application created once");
    assert.deepEqual(p.calls.upload.map((u) => u.docType), list.map((i) => i.key), "one upload per document, tagged with its type");
    assert.ok(p.calls.upload.every((u) => u.serviceType === type && u.applicationDocId === "NewAppDocId1234567890"));
    const docs = p.calls.create[0].documents;
    assert.equal(docs.length, list.length);
    docs.forEach((d, i) => {
      assert.equal(d.docType, list[i].key);
      assert.equal(d.docLabel, list[i].label);
      assert.ok(d.path.startsWith("applications/user1/NewAppDocId1234567890/") && d.path.includes(`-${d.docType}__`));
      assert.ok(!("signedUrl" in d) && !("token" in d), "no upload secrets are stored");
    });
    assert.equal(p.calls.cleanup.length, 0);
    assert.ok(p.calls.success, "success screen shown");
  });

  test(`[form:${type}] missing required documents block submission (each one on its own); optional ones never do`, async () => {
    const none = openForm(type);
    none.fill(VALID[type]);
    await none.submit();
    if (required.length) {
      assert.equal(none.calls.create.length, 0, "submitted without the required documents");
      assert.equal(none.calls.upload.length, 0, "nothing is uploaded");
      for (const item of required) assert.match(none.errorFor("doc-" + item.key), /is required/i, item.key);
      for (const item of list.filter((i) => !i.required)) assert.equal(none.errorFor("doc-" + item.key), "", `${item.key} is optional`);
    } else {
      assert.equal(none.calls.create.length, 1, "no required document: the form submits without files");
      assert.equal(none.calls.create[0].documents.length, 0);
    }
    for (const item of required) {
      const p = openForm(type);
      p.fill(VALID[type]); p.attachRequired(); p.detach(item.key);
      await p.submit();
      assert.equal(p.calls.create.length, 0, `submitted without ${item.key}`);
      assert.equal(p.calls.upload.length, 0);
      assert.match(p.errorFor("doc-" + item.key), /is required/i);
    }
    const ok = openForm(type);
    ok.fill(VALID[type]); ok.attachRequired();
    await ok.submit();
    assert.equal(ok.calls.create.length, 1, "required documents alone are enough");
    assert.equal(ok.calls.create[0].documents.length, required.length);
  });

  test(`[form:${type}] a file of the wrong type or over 5 MB is refused on that document, and nothing is uploaded`, async () => {
    for (const bad of [{ name: "run.exe", type: "application/x-msdownload", size: 1000 }, { name: "page.html", type: "text/html", size: 1000 }, { name: "big.pdf", type: "application/pdf", size: 5 * 1024 * 1024 + 1 }]) {
      const p = openForm(type);
      p.fill(VALID[type]); p.attachRequired(); p.attach([list[0].key], bad);
      await p.submit();
      assert.equal(p.calls.create.length, 0, bad.name);
      assert.equal(p.calls.upload.length, 0, bad.name);
      assert.ok(p.errorFor("doc-" + list[0].key), `${bad.name}: error shown on the document`);
    }
    for (const okFile of [{ name: "a.pdf", type: "application/pdf", size: 5 * 1024 * 1024 }, { name: "a.jpg", type: "image/jpeg", size: 10 }, { name: "a.png", type: "image/png", size: 10 }]) {
      const p = openForm(type);
      p.fill(VALID[type]); p.attachAll(okFile);
      await p.submit();
      assert.equal(p.calls.create.length, 1, okFile.name);
    }
  });

  test(`[form:${type}] a failed upload creates no application and removes files already uploaded; a failed save removes all of them`, async () => {
    if (list.length >= 2) {
      // the SECOND document fails: the first one must be removed again
      const p = openForm(type, { upload: async (a, n) => { if (n === 2) throw new Error("Your document could not be uploaded. Please try again."); return { name: a.file.name, type: a.file.type, size: a.file.size, path: `applications/user1/${a.applicationDocId}/uuid-${a.docType}__${a.file.name}` }; } });
      p.fill(VALID[type]); p.attachAll();
      await p.submit();
      assert.equal(p.calls.create.length, 0, "no application after a failed upload");
      assert.equal(p.calls.upload.length, 2, "stops at the failure");
      assert.deepEqual(p.calls.cleanup.map((c) => c.path), [`applications/user1/NewAppDocId1234567890/uuid-${list[0].key}__proof.pdf`], "the first file is cleaned up");
      assert.match(p.errorFor("doc-" + list[1].key), /could not be uploaded/);
      assert.ok(p.calls.toasts.some(([t, m]) => t === "error" && m.includes(list[1].label)), "the toast names the document");
      assert.equal(p.form._submit.disabled, false, "the form can be submitted again");
    }
    const save = openForm(type, { create: async () => { throw new Error("Your application could not be submitted. Please try again."); } });
    save.fill(VALID[type]); save.attachAll();
    await save.submit();
    assert.deepEqual(save.calls.cleanup.map((c) => c.path).sort(), save.calls.upload.map((u) => `applications/user1/${u.applicationDocId}/uuid-${u.docType}__proof.pdf`).sort(), "every orphan is removed");
    assert.equal(save.calls.success, undefined);
  });
}

test("[form] a logged-out visitor is sent to the login page and the uploads are removed; double clicks submit once", async () => {
  const out = openForm("income", { create: async () => { throw new Error("Please log in to submit your application."); } });
  out.fill(VALID.income); out.attachAll();
  await out.submit();
  assert.equal(out.calls.cleanup.length, DC.getChecklist("income").items.length);
  assert.ok(out.ctx.window.location.href.startsWith(`../login.html?redirect=${encodeURIComponent("services/income.html")}`), out.ctx.window.location.href);

  let release;
  const gate = new Promise((r) => { release = r; });
  const dbl = openForm("birth", { create: async (a) => { await gate; return { docId: a.applicationDocId, applicationId: "GP-2026-DBL00001" }; } });
  dbl.fill(VALID.birth); dbl.attachAll();
  dbl.form.fire("submit"); await settle();
  dbl.form.fire("submit"); await settle();
  release(); await settle();
  assert.equal(dbl.calls.create.length, 1);
});

test("[form] the original four forms keep their fields and formData keys", async () => {
  const expected = {
    birth: ["childName", "dateOfBirth", "placeOfBirth", "gender", "fatherName", "motherName", "address", "applicantContactName", "applicantContactMobile"],
    death: ["deceasedName", "dateOfDeath", "age", "gender", "placeOfDeath", "guardianName", "address", "relation", "applicantContactName", "applicantContactMobile"],
  };
  for (const type of ["birth", "death"]) {
    const p = openForm(type);
    p.fill(VALID[type]); p.attachRequired();
    await p.submit();
    assert.equal(p.calls.create.length, 1, type);
    for (const key of expected[type]) assert.ok(key in p.calls.create[0].formData, `${type}.formData.${key}`);
  }
  for (const type of ["income", "caste"]) {
    const p = openForm(type);
    p.fill(VALID[type]); p.attachRequired();
    await p.submit();
    assert.equal(p.calls.create.length, 1, type);
    assert.equal(p.calls.create[0].serviceName, { income: "Income Certificate", caste: "Caste Certificate" }[type]);
    assert.ok(Object.keys(p.calls.create[0].formData).length >= 8, type);
  }
});

/* ---- checkboxes: a reminder, never a file ---- */

for (const type of ALL) {
  const list = DC.getChecklist(type).items;
  const required = list.filter((i) => i.required);

  test(`[checkbox:${type}] every document has a checkbox, a Required/Optional label and a state; progress starts at 0`, () => {
    const p = openForm(type);
    const html = p.container().innerHTML;
    for (const item of list) {
      assert.ok(html.includes(`data-prepared="${item.key}"`), `${item.key}: checkbox`);
      assert.match(html, new RegExp(`for="prepared-doc-${item.key}"`), `${item.key}: label bound to its checkbox`);
      assert.equal(p.stateOf(item.key), item.required ? "Missing" : "Not added", item.key);
      assert.ok(p.opts["doc-" + item.key], "the individual upload field is still there");
    }
    assert.equal((html.match(/type="checkbox"/g) || []).length, list.length);
    assert.equal(p.progress(), `0 of ${list.length} documents prepared`);
    assert.equal(p.filesLine(), required.length ? `Files added for required documents: 0 of ${required.length}.` : "No document is strictly required for this service.");
    assert.match(html, /only a reminder/i, "explains that ticking is not uploading");
  });

  test(`[checkbox:${type}] ticking shows 'Prepared' and updates the progress, but is NOT a file`, async () => {
    const p = openForm(type);
    p.fill(VALID[type]);
    list.forEach((item, i) => {
      p.tick(item.key);
      assert.match(p.stateOf(item.key), /^Prepared/);
      assert.equal(p.progress(), `${i + 1} of ${list.length} documents prepared`);
    });
    assert.equal(p.filesLine(), required.length ? `Files added for required documents: 0 of ${required.length}.` : "No document is strictly required for this service.", "ticks do not count as files");
    p.tick(list[0].key, false);
    assert.equal(p.stateOf(list[0].key), list[0].required ? "Missing" : "Not added");
    assert.equal(p.progress(), `${list.length - 1} of ${list.length} documents prepared`);
    p.tick(list[0].key);

    await p.submit();
    if (required.length) {
      assert.equal(p.calls.create.length, 0, "everything ticked, no files: the form must NOT submit");
      assert.equal(p.calls.upload.length, 0, "a tick is never uploaded");
      for (const item of required) assert.match(p.errorFor("doc-" + item.key), /is required/i, item.key);
      assert.match(p.container()._q["[data-checklist-summary]"].textContent, /does not count as a file/i);
    } else {
      assert.equal(p.calls.create[0].documents.length, 0, "ticked boxes never become documents");
    }
  });

  test(`[checkbox:${type}] a chosen file shows 'File selected' whatever the checkbox says; removing it falls back to the checkbox`, () => {
    const p = openForm(type);
    const key = list[0].key;
    p.attach([key]);
    assert.equal(p.stateOf(key), "File selected");
    assert.equal(p.progress(), `1 of ${list.length} documents prepared`);
    p.tick(key);
    assert.equal(p.stateOf(key), "File selected", "ticked + file is still just a file");
    assert.equal(p.progress(), `1 of ${list.length} documents prepared`, "one document is counted once");
    p.detach(key);
    assert.match(p.stateOf(key), /^Prepared/, "file removed, box still ticked");
    p.tick(key, false);
    assert.equal(p.stateOf(key), list[0].required ? "Missing" : "Not added");
    assert.equal(p.progress(), `0 of ${list.length} documents prepared`);
  });

  test(`[checkbox:${type}] progress follows files and ticks together, and a submission carries files only`, async () => {
    const p = openForm(type);
    p.fill(VALID[type]);
    const keys = list.map((i) => i.key);
    p.attachRequired();
    p.tick(keys[keys.length - 1]);                                   // an extra, ticked but not attached
    const expected = new Set([...required.map((i) => i.key), keys[keys.length - 1]]).size;
    assert.equal(p.progress(), `${expected} of ${list.length} documents prepared`);
    await p.submit();
    assert.equal(p.calls.create.length, 1);
    const sent = p.calls.create[0];
    assert.deepEqual(plain(sent.documents.map((d) => d.docType)), required.map((i) => i.key), "only the attached files are submitted");
    assert.deepEqual(plain(p.calls.upload.map((u) => u.docType)), required.map((i) => i.key));
    assert.ok(!/prepared|ticked|checked/i.test(JSON.stringify(sent)), "checkbox state is never stored with the application");
  });
}

test("[checkbox] the checklist widget never lets a checkbox satisfy validation or reach an upload", () => {
  const src = read("js/checklist-ui.js");
  const afterRefresh = src.slice(src.indexOf("  const uploaded = items.map"));
  assert.ok(!/\.checked/.test(afterRefresh), "getSelections / validate must not read checkbox state");
  const form = read("js/service-form.js");
  assert.ok(!/checked|prepared/i.test(form.slice(form.indexOf("function initServiceForm"))), "the submit flow knows nothing about checkboxes");
  assert.ok(/documentState/.test(src) && /hasFile/.test(src));
});

/* ============================ PART 2: citizen page ============================ */

const REQ_APP = "ReqApp1234567890ABCDE";

function citizenApp(over = {}) {
  return {
    docId: REQ_APP, applicationId: "GP-2026-AAAA1111", userId: "cit1", status: "under_review",
    serviceType: "income", serviceName: "Income Certificate", applicantName: "Cit One", applicantEmail: "c@example.test", applicantMobile: "9876543210",
    formData: { occupation: "Farmer" },
    documents: [
      { docType: "applicant-id", docLabel: "x", name: "id.pdf", size: 10, path: "p1" },
      { name: "<img src=x onerror=alert(1)>.pdf", size: 5, path: "p0" },           // an older upload with no document type
    ],
    documentRequest: {
      open: true, message: "Please upload clear scans.",
      items: [
        { key: "address-proof", label: "Address proof", done: false },
        { key: "extra-1", label: "<b>Land</b> record", done: false },
        { key: "income-proof", label: "Income proof", done: true },
      ],
    },
    ...over,
  };
}

async function openCitizen(app, { uploadRequested, files = {} } = {}) {
  const opts = {};
  const calls = { requested: [] };
  const p = loadPage("citizen/application-details.html", {
    scripts: ["js/checklist-ui.js"],
    search: `?id=${REQ_APP}`,
    stubs: {
      GPApplications: { getApplication: async () => app, getStatusHistory: async () => [] },
      GPUploads: {
        async uploadRequestedDocuments(a) { calls.requested.push(a); if (uploadRequested) return uploadRequested(a); return { ok: true }; },
        getDownloadUrl: async () => "https://example.test/x",
      },
      initFileUpload: (el, o) => { opts[o.fieldId] = o; return { fieldId: o.fieldId, getFile: () => files[o.fieldId] || null }; },
    },
  });
  Object.assign(p.calls, calls);
  p.run();
  await settle();
  return { ...p, opts, files };
}

test("[citizen] a staff request shows ONE upload field per outstanding document, with the staff message, escaped", async () => {
  const p = await openCitizen(citizenApp());
  assert.equal(p.registry["doc-request-section"].hidden(), false);
  assert.equal(p.registry["doc-request-message"].textContent, "Please upload clear scans.");
  assert.deepEqual(Object.keys(p.opts).sort(), ["req-address-proof", "req-extra-1"], "the document already received is not asked for again");
  assert.ok(p.opts["req-extra-1"].label.includes("&lt;b&gt;Land") && !p.opts["req-extra-1"].label.includes("<b>"), "labels from the database are escaped");
  assert.equal(p.registry["doc-request-fields"].children.length, 2);
});

test("[citizen] uploaded documents show their checklist label; older uploads still list; names are escaped", async () => {
  const p = await openCitizen(citizenApp());
  const html = p.registry["detail-documents"].innerHTML;
  assert.ok(html.includes("Applicant ID proof"), "typed document shows its label");
  assert.ok(html.includes("&lt;img") && !html.includes("<img"), "file names are escaped");
  assert.equal((html.match(/data-view-doc=/g) || []).length, 2, "both have a View button");
});

test("[citizen] the request box is hidden when nothing is requested, when it is already answered, or after a decision", async () => {
  for (const over of [
    { documentRequest: undefined },
    { documentRequest: { open: false, items: [{ key: "address-proof", label: "Address proof", done: true }] } },
    { documentRequest: { open: true, items: [{ key: "address-proof", label: "Address proof", done: true }] } },
    { status: "approved" }, { status: "rejected" },
  ]) {
    const p = await openCitizen(citizenApp(over));
    assert.equal(p.registry["doc-request-section"].hidden(), true, JSON.stringify(over).slice(0, 70));
  }
});

test("[citizen] uploading with no file, or a bad file, is refused before anything is sent", async () => {
  const p = await openCitizen(citizenApp());
  await p.registry["doc-request-form"].fire("submit"); await settle();
  assert.match(p.registry["doc-request-error"].textContent, /at least one file/i);
  assert.equal(p.calls.requested.length, 0);

  p.files["req-address-proof"] = { name: "a.exe", type: "application/x-msdownload", size: 10 };
  await p.registry["doc-request-form"].fire("submit"); await settle();
  assert.ok(p.errorFor("req-address-proof"), "file error shown on that document");
  assert.equal(p.calls.requested.length, 0);
  p.files["req-address-proof"] = { name: "big.pdf", type: "application/pdf", size: 5 * 1024 * 1024 + 1 };
  await p.registry["doc-request-form"].fire("submit"); await settle();
  assert.equal(p.calls.requested.length, 0, "over 5 MB");
});

test("[citizen] a successful upload sends each file with its document type, tells the citizen, and reloads the page", async () => {
  const p = await openCitizen(citizenApp(), { files: { "req-address-proof": GOOD } });
  await p.registry["doc-request-form"].fire("submit"); await settle();
  assert.equal(p.calls.requested.length, 1);
  const a = p.calls.requested[0];
  assert.equal(a.applicationDocId, REQ_APP);
  assert.equal(a.serviceType, "income");
  assert.deepEqual(plain(a.files.map((f) => [f.docType, f.file.name])), [["address-proof", "proof.pdf"]], "only the chosen document; one document type per file");
  assert.ok(p.calls.toasts.some(([t, m]) => t === "success" && /uploaded/i.test(m)));
  assert.equal(p.calls.reloads, 1);
});

test("[citizen] a failed upload shows the reason, keeps the form, and can be retried; double clicks send once", async () => {
  const p = await openCitizen(citizenApp(), {
    files: { "req-address-proof": GOOD, "req-extra-1": GOOD },
    uploadRequested: async () => { throw new Error("Your document could not be uploaded. Please try again."); },
  });
  await p.registry["doc-request-form"].fire("submit"); await settle();
  assert.equal(p.calls.reloads, 0, "stays on the page");
  assert.match(p.registry["doc-request-error"].textContent, /could not be uploaded/);
  assert.equal(p.registry["doc-request-error"].hidden(), false);
  assert.ok(p.calls.toasts.some(([t]) => t === "error"));
  assert.equal(p.registry["doc-request-submit"].disabled, false, "the button works again");
  await p.registry["doc-request-form"].fire("submit"); await settle();
  assert.equal(p.calls.requested.length, 2, "a retry is possible");

  let release;
  const gate = new Promise((r) => { release = r; });
  const dbl = await openCitizen(citizenApp(), { files: { "req-address-proof": GOOD }, uploadRequested: async () => { await gate; return { ok: true }; } });
  dbl.registry["doc-request-form"].fire("submit"); await settle();
  dbl.registry["doc-request-form"].fire("submit"); await settle();
  release(); await settle();
  assert.equal(dbl.calls.requested.length, 1, "second click ignored while uploading");
});

test("[citizen] the requested-documents box uses the same checklist: checkbox, Required label, state, progress, upload field", async () => {
  const p = await openCitizen(citizenApp());
  const box = p.registry["doc-request-fields"];
  assert.match(box.innerHTML, /data-prepared="address-proof"/);
  assert.match(box.innerHTML, /data-prepared="extra-1"/);
  assert.equal((box.innerHTML.match(/>Required</g) || []).length, 2);
  assert.equal(box._q['[data-doc-state="address-proof"]'].textContent, "Missing");
  assert.equal(box._q["[data-checklist-progress]"].textContent, "0 of 2 documents prepared");
  assert.ok(p.opts["req-address-proof"] && p.opts["req-extra-1"], "individual upload fields");
  assert.ok(box.innerHTML.includes("&lt;b&gt;Land"), "labels from the database are escaped");
});

test("[citizen] ticking a requested document is only a reminder: nothing is uploaded until a file is chosen", async () => {
  const p = await openCitizen(citizenApp());
  const box = p.registry["doc-request-fields"];
  const tick = (key) => { const c = box._q[`[data-prepared="${key}"]`]; c.checked = true; (c.listeners.change || []).forEach((fn) => fn()); };
  tick("address-proof"); tick("extra-1");
  assert.match(box._q['[data-doc-state="address-proof"]'].textContent, /^Prepared/);
  assert.equal(box._q["[data-checklist-progress]"].textContent, "2 of 2 documents prepared");
  await p.registry["doc-request-form"].fire("submit"); await settle();
  assert.equal(p.calls.requested.length, 0, "ticks alone upload nothing");
  assert.match(p.registry["doc-request-error"].textContent, /does not count as a file/i);
});

/* ============================ PART 3: staff page ============================ */

function staffQuerySelectorAll(sel, registry) {
  if (sel !== "[data-request-key]") return [];
  return [...registry["request-checklist"].innerHTML.matchAll(/<input type="checkbox" data-request-key="([^"]+)"[^>]*?(checked)?\s*\/>/g)]
    .map((m) => ({ checked: !!m[2], getAttribute: () => m[1] }));
}

async function openStaff(app, { requestDocuments } = {}) {
  const calls = { requests: [] };
  const p = loadPage("staff/application-details.html", {
    search: `?id=${REQ_APP}`,
    querySelectorAll: staffQuerySelectorAll,
    stubs: {
      GPStaff: {
        getApplication: async () => app, getHistory: async () => [], updateStatus: async () => ({}), getDocumentUrl: async () => "https://example.test/x",
        async requestDocuments(id, items, message) { calls.requests.push({ id, items, message }); if (requestDocuments) return requestDocuments(items); return { ok: true }; },
      },
    },
  });
  Object.assign(p.calls, calls);
  p.run();
  await settle();
  return { ...p };
}
const staffApp = (over = {}) => citizenApp({ documentRequest: undefined, ...over });

test("[staff] the checklist shows what was received, what is missing (required) and what is optional; documents carry their labels", async () => {
  const p = await openStaff(staffApp());
  const html = p.registry["detail-checklist"].innerHTML;
  assert.match(html, /Applicant ID proof[^<]*<[^>]*>[^<]*<\/span>[\s\S]*?Received/);
  assert.equal((html.match(/Missing — required/g) || []).length, 2, "address proof and income proof are missing");
  assert.match(html, /Ration card[\s\S]*Not provided \(optional\)/);
  assert.match(p.registry["detail-checklist-note"].textContent, /not official government rules/i);
  assert.match(p.registry["detail-checklist-note"].textContent, /has not been confirmed by the authority/i);
  const docs = p.registry["detail-documents"].innerHTML;
  assert.ok(docs.includes("Applicant ID proof"), "label on the uploaded document");
  assert.ok(docs.includes("&lt;img") && !docs.includes("<img"), "file names are escaped");
  assert.equal((docs.match(/data-view-doc=/g) || []).length, 2, "every document with a file has a viewing link");
});

test("[staff] an older application with no document types is not shown as 'missing everything'", async () => {
  const p = await openStaff(staffApp({ documents: [{ name: "old.pdf", size: 10, path: "p9" }] }));
  const html = p.registry["detail-checklist"].innerHTML;
  assert.ok(!/Missing — required/.test(html));
  assert.match(html, /Not itemised \(older application\)/);
});

test("[staff] 'Request missing documents' lists the checklist, pre-ticks the missing required ones, and sends the right request", async () => {
  const p = await openStaff(staffApp());
  assert.equal(p.registry["request-docs-section"].hidden(), false);
  const boxes = staffQuerySelectorAll("[data-request-key]", p.registry);
  assert.deepEqual(plain(boxes.map((b) => [b.getAttribute(), b.checked])), [["applicant-id", false], ["address-proof", true], ["income-proof", true], ["ration-card", false]]);
  assert.match(p.registry["request-checklist"].innerHTML, /\(already received\)/);

  p.registry["request-extra-1"].value = "  Land record  ";
  p.registry["request-message"].value = " Scans must be readable. ";
  await p.registry["request-form"].fire("submit"); await settle();
  assert.equal(p.calls.requests.length, 1);
  assert.deepEqual(plain(p.calls.requests[0]), {
    id: REQ_APP,
    items: [{ key: "address-proof" }, { key: "income-proof" }, { label: "Land record" }],
    message: "Scans must be readable.",
  });
  assert.ok(p.calls.toasts.some(([t, m]) => t === "success" && /Request sent/.test(m)));
  assert.equal(p.registry["request-extra-1"].value, "", "the form is cleared after sending");
});

test("[staff] an empty or invalid request is refused before anything is sent; a server refusal is shown", async () => {
  const p = await openStaff(staffApp({ documents: [{ docType: "applicant-id", name: "id.pdf", size: 1, path: "p1" }, { docType: "address-proof", name: "a.pdf", size: 1, path: "p2" }, { docType: "income-proof", name: "i.pdf", size: 1, path: "p3" }] }));
  // everything required is already there: nothing pre-ticked, nothing typed
  await p.registry["request-form"].fire("submit"); await settle();
  assert.match(p.registry["request-error"].textContent, /at least one document/i);
  assert.equal(p.calls.requests.length, 0);

  p.registry["request-extra-1"].value = "ab";
  await p.registry["request-form"].fire("submit"); await settle();
  assert.ok(p.errorFor("request-extra-1"), "too short");
  assert.equal(p.calls.requests.length, 0);

  const refused = await openStaff(staffApp(), { requestDocuments: async () => { throw new Error("You cannot review your own application."); } });
  await refused.registry["request-form"].fire("submit"); await settle();
  assert.match(refused.registry["request-error"].textContent, /cannot review your own/);
  assert.ok(refused.calls.toasts.some(([t]) => t === "error"));
  assert.equal(refused.registry["request-submit"].disabled, false);
});

test("[staff] documents already requested are shown (escaped) while the applicant has not answered; closed applications cannot be asked", async () => {
  const waiting = await openStaff(citizenApp());
  assert.match(waiting.registry["request-open"].innerHTML, /Waiting for the applicant to upload/);
  assert.ok(waiting.registry["request-open"].innerHTML.includes("&lt;b&gt;Land") && !waiting.registry["request-open"].innerHTML.includes("<b>Land"));
  assert.equal(waiting.registry["request-open"].hidden(), false);
  assert.ok(!/Income proof/.test(waiting.registry["request-open"].innerHTML), "an answered item is not listed as outstanding");

  for (const status of ["approved", "rejected"]) {
    const closed = await openStaff(staffApp({ status }));
    assert.equal(closed.registry["request-docs-section"].hidden(), true, `${status}: no request form`);
  }
});

/* ============================ PART 4: wiring ============================ */

test("[wiring] every form loads the shared checklist + submit scripts in the right order and uses them", () => {
  for (const type of ALL) {
    const html = read(`services/${type}.html`);
    const order = ["../js/utils.js", "../js/validation.js", "../js/document-checklists.js", "../js/components.js", "../js/checklist-ui.js", "../js/service-form.js"].map((s) => html.indexOf(`<script src="${s}">`));
    assert.ok(order.every((i) => i > -1) && order.every((v, i) => i === 0 || v > order[i - 1]), `${type}: script order ${order}`);
    assert.ok(html.includes(`initDocumentChecklist(document.getElementById('upload-container'), '${type}')`), type);
    assert.ok(html.includes("documents,") && !/uploader/.test(html), `${type}: no leftover single-upload code`);
  }
  for (const f of ["citizen/application-details.html", "staff/application-details.html"]) {
    const html = read(f);
    assert.ok(html.includes('<script src="../js/document-checklists.js"></script>'), f);
    if (f.startsWith("citizen")) assert.ok(html.includes('<script src="../js/checklist-ui.js"></script>'), f + " needs the checklist widget");
  }
});

test("[wiring] the browser sends the document type with every upload, and attaching later documents goes through the server", () => {
  const uploads = read("js/uploads.js");
  assert.match(uploads, /docType,\s*\n\s*fileName/, "requestUploadUrl sends docType");
  assert.ok(uploads.includes("/api/applications/add-documents"));
  assert.ok(!/SUPABASE_SERVICE|service_role|serviceRole/i.test(uploads + read("js/service-form.js") + read("js/staff.js") + read("js/document-checklists.js")), "no service-role credentials in browser code");
  assert.ok(read("js/staff.js").includes("/api/staff/request-documents"));
});

test("[wiring] Firestore rules still forbid client updates, and allow the larger document list a checklist needs", () => {
  const rules = read("firestore.rules");
  assert.match(rules, /allow update: if false;\s*\n\s*allow delete: if false;\s*\n\s*match \/statusHistory/, "applications cannot be edited from the browser");
  const apps = rules.split("match /applications/")[1];
  assert.match(apps, /allow create: if false;[^]*allow read/, "the browser cannot create applications: only the server checks the documents");
  assert.match(apps.split("match /statusHistory")[1], /allow create: if false;/, "the browser cannot write history entries");
});

/* ============================ PART 5: per-document review ============================ */

const clickTarget = (attr, value) => Object.assign(makeEl("btn"), { textContent: "View", closest(sel) { return sel === `[${attr}]` ? this : null; }, getAttribute: () => value });
const doc = (docType, over = {}) => ({ docType, docLabel: DC.findItem("income", docType) && DC.findItem("income", docType).label, name: `${docType}.pdf`, size: 1000, path: `p-${docType}`, review: { status: "pending" }, ...over });

async function openStaffReview(app) {
  const calls = { reviews: [], views: [] };
  const p = loadPage("staff/application-details.html", {
    search: `?id=${REQ_APP}`,
    querySelectorAll: staffQuerySelectorAll,
    stubs: {
      GPStaff: {
        getApplication: async () => app, getHistory: async () => [], updateStatus: async () => ({}), requestDocuments: async () => ({}),
        async getDocumentUrl(id, path) { calls.views.push([id, path]); return "https://example.test/x"; },
        async reviewDocument(id, path, decision, reason) { calls.reviews.push([id, path, decision, reason]); return { ok: true }; },
      },
    },
  });
  Object.assign(p.calls, calls);
  p.ctx.window.open = () => {};
  p.run();
  await settle();
  const click = (attr, value) => p.registry["detail-documents"].listeners.click[0]({ target: clickTarget(attr, value) });
  return { ...p, click };
}

test("[staff review] each file sits under its own checklist label with Required/Optional, review status and Accept / Reject / Request replacement", async () => {
  const app = staffApp({ documents: [doc("applicant-id"), doc("address-proof", { review: { status: "rejected", reason: "Cut off at the edges.", reviewedByName: "Sam Staff" } })] });
  const p = await openStaffReview(app);
  const html = p.registry["detail-documents"].innerHTML;
  const card = (label) => html.slice(html.indexOf(label), html.indexOf(label) + 1500);
  assert.match(card("Applicant ID proof"), /applicant-id\.pdf[\s\S]*Awaiting review/);
  assert.match(card("Address proof"), /address-proof\.pdf[\s\S]*Rejected[\s\S]*Cut off at the edges\./);
  assert.ok(!card("Applicant ID proof").split("Address proof")[0].includes("address-proof.pdf"), "a file is shown under its own item only");
  assert.match(html, /Income proof[\s\S]*Required[\s\S]*Missing — not uploaded/, "a required item with no file says so");
  assert.match(html, /Ration card[\s\S]*Optional[\s\S]*Not provided/);
  assert.equal((html.match(/data-review="\d+:accepted"/g) || []).length, 2);
  assert.equal((html.match(/data-review="\d+:rejected"/g) || []).length, 2);
  assert.equal((html.match(/data-review="\d+:replacement_requested"/g) || []).length, 2);
});

test("[staff review] the page says the portal does not verify what is inside a file", async () => {
  const p = await openStaffReview(staffApp({ documents: [doc("applicant-id")] }));
  assert.match(p.html, /cannot tell whether a document is genuine/i);
  assert.match(p.html, /check its contents yourself/i);
  assert.ok(!/verified automatically|auto-verified|authentic(ated)? by the portal/i.test(p.html), "no claim of automatic content verification");
});

test("[staff review] View uses the authorised download for the right file; Accept needs no reason", async () => {
  const app = staffApp({ documents: [doc("applicant-id"), doc("address-proof")] });
  const p = await openStaffReview(app);
  await p.click("data-view-doc", "1"); await settle();
  assert.deepEqual(plain(p.calls.views), [[REQ_APP, "p-address-proof"]]);
  await p.click("data-review", "0:accepted"); await settle();
  assert.deepEqual(plain(p.calls.reviews), [[REQ_APP, "p-applicant-id", "accepted", ""]]);
  assert.ok(p.calls.toasts.some(([t, m]) => t === "success" && /accepted/i.test(m)));
});

test("[staff review] Reject / Request replacement ask for a reason first, and send it with the right file and decision", async () => {
  const app = staffApp({ documents: [doc("applicant-id"), doc("address-proof")] });
  const p = await openStaffReview(app);
  await p.click("data-review", "1:rejected"); await settle();
  assert.equal(p.calls.reviews.length, 0, "nothing is sent before the reason is given");
  assert.match(p.registry["doc-review-title"].textContent, /Reject document/);
  await p.registry["doc-review-form"].fire("submit"); await settle();
  assert.ok(p.errorFor("doc-review-reason"), "a reason is required");
  assert.equal(p.calls.reviews.length, 0);

  p.registry["doc-review-reason"].value = "  The scan is cut off.  ";
  await p.registry["doc-review-form"].fire("submit"); await settle();
  assert.deepEqual(plain(p.calls.reviews), [[REQ_APP, "p-address-proof", "rejected", "The scan is cut off."]]);
  assert.ok(p.calls.toasts.some(([t, m]) => t === "success" && /replacement/i.test(m)));

  await p.click("data-review", "0:replacement_requested"); await settle();
  assert.match(p.registry["doc-review-title"].textContent, /replacement/i);
  p.registry["doc-review-reason"].value = "Please send a clearer photo.";
  await p.registry["doc-review-form"].fire("submit"); await settle();
  assert.deepEqual(plain(p.calls.reviews[1]), [REQ_APP, "p-applicant-id", "replacement_requested", "Please send a clearer photo."]);
});

test("[staff review] earlier versions are kept under 'Earlier versions' and cannot be reviewed; closed applications have no review buttons", async () => {
  const app = staffApp({ documents: [doc("address-proof", { path: "p-old", name: "old.pdf", superseded: true, review: { status: "rejected", reason: "Blurry." } }), doc("address-proof", { path: "p-new", name: "new.pdf" })] });
  const p = await openStaffReview(app);
  const html = p.registry["detail-documents"].innerHTML;
  assert.match(html, /Earlier versions \(1\)[\s\S]*old\.pdf/);
  assert.equal((html.match(/data-review="/g) || []).length, 3, "only the current file can be reviewed");
  assert.ok(html.indexOf("new.pdf") < html.indexOf("Earlier versions"), "the current file comes first");

  const closed = await openStaffReview(staffApp({ status: "approved", documents: [doc("applicant-id")] }));
  assert.ok(!closed.registry["detail-documents"].innerHTML.includes("data-review"), "no review buttons once decided");
  assert.ok(closed.registry["detail-documents"].innerHTML.includes("data-view-doc"), "…but the file can still be viewed");
});

test("[staff review] an older application (files not itemised) lists its files, offers Accept only, and does not flag missing documents", async () => {
  const p = await openStaffReview(staffApp({ documents: [{ name: "old.pdf", size: 5, path: "p-old" }] }));
  const html = p.registry["detail-documents"].innerHTML;
  assert.match(html, /Uploaded files[\s\S]*old\.pdf/);
  assert.ok(!/Missing — not uploaded/.test(html));
  assert.equal((html.match(/data-review="0:accepted"/g) || []).length, 1);
  assert.ok(!/:rejected|:replacement_requested/.test(html), "no replacement slot exists for an untyped file");
});

test("[citizen review] the citizen sees each document's review status and reason, and a replacement is asked for under the same label", async () => {
  const app = citizenApp({
    documents: [
      doc("applicant-id", { review: { status: "accepted" } }),
      doc("address-proof", { review: { status: "rejected", reason: "The scan <b>is</b> cut off." } }),
      doc("income-proof", { path: "p-old", superseded: true, review: { status: "rejected", reason: "old" } }),
    ],
    documentRequest: { open: true, message: "", items: [{ key: "address-proof", label: "Address proof", done: false, replacement: true, reason: "The scan is cut off." }] },
  });
  const p = await openCitizen(app);
  const html = p.registry["detail-documents"].innerHTML;
  assert.match(html, /Accepted/);
  assert.match(html, /Rejected — please upload a replacement/);
  assert.ok(html.includes("The scan &lt;b&gt;is&lt;/b&gt; cut off.") && !html.includes("<b>is</b>"), "the staff reason is escaped");
  assert.match(html, /Replaced by a newer upload/);
  assert.deepEqual(Object.keys(p.opts), ["req-address-proof"], "one upload slot, for that same document type");
  assert.match(p.opts["req-address-proof"].label, /Address proof \(replacement\)/);
  assert.match(p.registry["doc-request-fields"].innerHTML, /the office said: The scan is cut off\./);
});
