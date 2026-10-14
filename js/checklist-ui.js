/* ==========================================================================
   checklist-ui.js — the document checklist widget used by every service form
   and by the citizen's "additional documents requested" box.

   For every document it shows:
     - a checkbox        "I have this document ready" — a personal REMINDER only
     - Required / Optional badge
     - a state           Missing | Prepared | File selected | Not added
     - the real upload field (initFileUpload) for that document type

   THE CHECKBOX IS NOT AN UPLOAD. Ticking it changes nothing but the on-screen
   state and the "n of N documents prepared" counter. It is never sent anywhere,
   never stored, and never counted by getSelections() or validate(): only a file
   that was actually chosen can be uploaded, and only a chosen, acceptable file
   satisfies a required document.

   Classic script. Needs: escapeHtml (utils.js), validateFile / showFieldError /
   clearFieldError (validation.js), initFileUpload (components.js).
   ========================================================================== */

const DOCUMENT_STATES = {
  missing:  { text: 'Missing',            cls: 'bg-red-50 text-red-700' },
  prepared: { text: 'Prepared — no file added yet', cls: 'bg-amber-50 text-amber-800' },
  file:     { text: 'File selected',      cls: 'bg-green-50 text-green-700' },
  none:     { text: 'Not added',          cls: 'bg-gray-100 text-gray-600' },
};

/**
 * State of one document row.
 *   hasFile  a file has been chosen for it (the ONLY thing that counts as a document)
 *   ticked   the citizen ticked "I have this ready" (a reminder, nothing more)
 */
function documentState(item, hasFile, ticked) {
  if (hasFile) return 'file';
  if (ticked) return 'prepared';
  return item.required ? 'missing' : 'none';
}

/**
 * items:   [{ key, label, required }]
 * options: idPrefix          prefix of the upload field ids (doc-<key>, req-<key>)
 *          heading           title of the checklist box
 *          notes             plain-text paragraphs shown under the list
 *          validateRequired  true (default): every required document needs a file
 *                            false: only the files that were chosen are checked
 *
 * Returns { items: [{ key, label, required, uploader }], getSelections(), validate(), refresh() }.
 */
function buildDocumentChecklist(containerEl, items, options = {}) {
  const { idPrefix = 'doc', heading = 'Required documents checklist', notes = [], validateRequired = true } = options;
  const total = items.length;
  const requiredTotal = items.filter((i) => i.required).length;

  const badge = (required) => required
    ? '<span class="ml-2 inline-block rounded px-1.5 py-0.5 text-xs font-medium bg-red-50 text-red-700">Required</span>'
    : '<span class="ml-2 inline-block rounded px-1.5 py-0.5 text-xs font-medium bg-gray-100 text-gray-600">Optional</span>';

  containerEl.innerHTML = `
    <div class="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-4 mb-5" role="note">
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <p class="text-sm font-medium text-[var(--color-text)]">${escapeHtml(heading)}</p>
        <p data-checklist-progress class="text-sm font-medium text-[var(--color-primary)]" aria-live="polite"></p>
      </div>
      <p class="mt-1 text-xs text-[var(--color-text-muted)]">Tick a box when you have the document ready. Ticking is only a reminder — the file itself must still be added below.</p>
      <ul class="mt-3 space-y-2 text-sm text-[var(--color-text)]">
        ${items.map((i) => `
          <li class="flex flex-wrap items-start gap-x-2 gap-y-1">
            <input type="checkbox" id="prepared-${idPrefix}-${escapeHtml(i.key)}" data-prepared="${escapeHtml(i.key)}" class="mt-1 h-4 w-4 shrink-0" />
            <label for="prepared-${idPrefix}-${escapeHtml(i.key)}" class="min-w-0 cursor-pointer">${escapeHtml(i.label)}${badge(i.required)}</label>
            <span data-doc-state="${escapeHtml(i.key)}" class="rounded px-1.5 py-0.5 text-xs font-medium"></span>
          </li>`).join('')}
      </ul>
      <p data-checklist-files class="mt-3 text-xs text-[var(--color-text-muted)]"></p>
      ${notes.map((n) => `<p class="mt-2 text-xs text-[var(--color-text-muted)]">${escapeHtml(n)}</p>`).join('')}
    </div>
    <p data-checklist-summary class="hidden mb-4 text-sm text-red-600" role="alert"></p>
    <div data-doc-fields class="space-y-5"></div>`;

  const pick = (selector) => containerEl.querySelector(selector);
  const fieldsEl = pick('[data-doc-fields]') || containerEl;
  const summaryEl = pick('[data-checklist-summary]');

  const rows = [];

  function refresh() {
    let prepared = 0;
    let requiredWithFile = 0;
    rows.forEach((row) => {
      const hasFile = !!row.uploader && !!row.uploader.getFile();
      const ticked = !!(row.box && row.box.checked);
      if (hasFile || ticked) prepared += 1;
      if (hasFile && row.item.required) requiredWithFile += 1;
      const state = DOCUMENT_STATES[documentState(row.item, hasFile, ticked)];
      if (row.stateEl) {
        row.stateEl.textContent = state.text;
        row.stateEl.className = `rounded px-1.5 py-0.5 text-xs font-medium ${state.cls}`;
      }
    });
    const progressEl = pick('[data-checklist-progress]');
    if (progressEl) progressEl.textContent = `${prepared} of ${total} documents prepared`;
    const filesEl = pick('[data-checklist-files]');
    if (filesEl) {
      filesEl.textContent = requiredTotal
        ? `Files added for required documents: ${requiredWithFile} of ${requiredTotal}.`
        : 'No document is strictly required for this service.';
    }
  }

  const uploaded = items.map((item) => {
    const row = {
      item,
      box: pick(`[data-prepared="${item.key}"]`),
      stateEl: pick(`[data-doc-state="${item.key}"]`),
      uploader: null,
    };
    if (row.box) row.box.addEventListener('change', refresh);
    rows.push(row);

    const holder = document.createElement('div');
    fieldsEl.appendChild(holder);
    row.uploader = initFileUpload(holder, {
      label: escapeHtml(item.label),
      fieldId: `${idPrefix}-${item.key}`,
      optional: !item.required,
      onChange: refresh,
    });
    return { key: item.key, label: item.label, required: item.required, uploader: row.uploader };
  });

  function setSummary(text) {
    if (!summaryEl) return;
    summaryEl.textContent = text;
    summaryEl.classList.toggle('hidden', !text);
  }

  refresh();

  return {
    items: uploaded,
    refresh,
    /** Only documents with a chosen FILE. A ticked checkbox is never included. */
    getSelections() {
      return uploaded.map((item) => ({ item, file: item.uploader.getFile() })).filter((s) => s.file);
    },
    /** true when every required document has an acceptable file and every chosen file is acceptable. */
    validate() {
      const missing = [];
      let ok = true;
      uploaded.forEach((item) => {
        const file = item.uploader.getFile();
        const fieldId = item.uploader.fieldId;
        let error = null;
        if (!file) {
          if (item.required && validateRequired) { error = `${item.label} is required — please add the file.`; missing.push(item.label); }
        } else {
          error = validateFile(file);
        }
        if (error) { showFieldError(fieldId, error); ok = false; } else clearFieldError(fieldId);
      });
      setSummary(missing.length ? `Please add a file for the required document${missing.length > 1 ? 's' : ''}: ${missing.join('; ')}. A ticked box does not count as a file.` : '');
      refresh();
      return ok;
    },
  };
}
