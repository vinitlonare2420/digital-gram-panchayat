/* ==========================================================================
   utils.js — small, generic helpers shared across every page.
   No backend calls live here. Pure DOM / formatting utilities only.
   ========================================================================== */

/** Shorthand query selectors */
function $(selector, scope) { return (scope || document).querySelector(selector); }
function $all(selector, scope) { return Array.from((scope || document).querySelectorAll(selector)); }

/** Read a query-string parameter from the current URL */
function getQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

/** Format an ISO date string (or Date) as "12 Aug 2026" */
function formatDate(value) {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Format bytes as a human-readable file size */
function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Debounce a function call */
function debounce(fn, wait = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

/**
 * Central status metadata used by track.html, citizen/applications.html,
 * staff/applications.html and the application-details pages.
 * Keeping this in one place means every page renders statuses identically.
 */
const STATUS_META = {
  submitted:            { label: 'Submitted',             css: 'submitted' },
  under_verification:   { label: 'Under Verification',    css: 'verification' },
  under_review:         { label: 'Under Review',          css: 'review' },
  correction_required:  { label: 'Correction Required',   css: 'correction' },
  approved:             { label: 'Approved',               css: 'approved' },
  rejected:             { label: 'Rejected',                css: 'rejected' },
  certificate_available:{ label: 'Certificate Available',  css: 'certificate' },
};

/**
 * Every certificate / service the portal accepts: serviceType key -> official
 * display name. This list is the single source for the page filters and the
 * names stored on applications. KEEP IN SYNC with:
 *   - ALLOWED_SERVICE_TYPES in api/_lib/validation.js
 *   - the serviceType / serviceName allow-list in firestore.rules
 * (tests/services.test.js fails if they drift apart.)
 */
const SERVICE_TYPES = {
  birth:    'Birth Certificate',
  death:    'Death Certificate',
  income:   'Income Certificate',
  caste:    'Caste Certificate',
  marriage: 'Marriage Registration',
  bpl:      'BPL Certificate',
  nodues:   'No Dues Certificate',
  property: 'Property Assessment Certificate',
  other:    'Other Certificate / Service Request',
};

/**
 * Text label for an application's service. "Other" requests also show what the
 * citizen asked for. Returns PLAIN TEXT — escape it (escapeHtml) before putting
 * it into innerHTML; the requested name is citizen-entered.
 */
function serviceLabel(app) {
  const base = (app && app.serviceName) || SERVICE_TYPES[app && app.serviceType] || 'Unknown service';
  const requested = app && app.serviceType === 'other' && app.formData && typeof app.formData.requestedService === 'string'
    ? app.formData.requestedService.trim() : '';
  return requested ? `${base}: ${requested}` : base;
}

/** <option> list for service filters (static, trusted text). */
function serviceOptionsHTML() {
  return Object.entries(SERVICE_TYPES).map(([key, name]) => `<option value="${key}">${name}</option>`).join('');
}

/** { birth: n, …, other: n, unknown: n } — unknown covers any type not in the catalog. */
function countByService(applications) {
  const counts = Object.fromEntries(Object.keys(SERVICE_TYPES).map((key) => [key, 0]));
  counts.unknown = 0;
  (applications || []).forEach((app) => {
    const type = app && app.serviceType;
    if (Object.prototype.hasOwnProperty.call(SERVICE_TYPES, type)) counts[type] += 1;
    else counts.unknown += 1;
  });
  return counts;
}

/** Build the HTML for a status badge given a status key */
function statusBadgeHTML(statusKey) {
  const meta = STATUS_META[statusKey] || { label: statusKey || 'Unknown', css: 'submitted' };
  return `<span class="status-badge" style="background:var(--status-${meta.css}-bg); color:var(--status-${meta.css}-fg);">
    <span class="dot" style="background:var(--status-${meta.css}-dot);" aria-hidden="true"></span>${meta.label}
  </span>`;
}

/** Set the current year in any element with [data-current-year] */
function initCurrentYear() {
  $all('[data-current-year]').forEach(el => { el.textContent = new Date().getFullYear(); });
}

/** Turn a camelCase form-data key into a readable label, e.g. "dateOfBirth" -> "Date Of Birth". */
function humanizeFieldKey(key) {
  const spaced = key.replace(/([A-Z])/g, ' $1');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * auth.js is loaded as an ES module (<script type="module">), so it always
 * finishes evaluating *after* ordinary classic scripts on the page — even
 * ones placed below it in the HTML. Any classic inline script that needs
 * `window.GPAuth` must go through this helper instead of calling it
 * directly, so it works whether auth.js has already finished or not.
 */
function whenAuthReady(callback) {
  if (window.GPAuth) { callback(); return; }
  window.addEventListener('gpauth-ready', callback, { once: true });
}

/**
 * Same idea as whenAuthReady, for js/applications.js (also an ES module,
 * also evaluated after classic scripts).
 */
function whenAppsReady(callback) {
  if (window.GPApplications) { callback(); return; }
  window.addEventListener('gpapplications-ready', callback, { once: true });
}

/**
 * Same idea as whenAuthReady, for js/uploads.js (also an ES module, also
 * evaluated after classic scripts). Added in Phase 4.
 */
function whenUploadsReady(callback) {
  if (window.GPUploads) { callback(); return; }
  window.addEventListener('gpuploads-ready', callback, { once: true });
}

/** Same pattern for js/availability.js (staff "I Am Here"). */
function whenAvailabilityReady(callback) {
  if (window.GPAvailability) { callback(); return; }
  window.addEventListener('gpavailability-ready', callback, { once: true });
}

/** Same pattern for js/admin.js and js/staff.js (Phase 5). */
function whenAdminReady(callback) {
  if (window.GPAdmin) { callback(); return; }
  window.addEventListener('gpadmin-ready', callback, { once: true });
}

function whenStaffReady(callback) {
  if (window.GPStaff) { callback(); return; }
  window.addEventListener('gpstaff-ready', callback, { once: true });
}

/**
 * Escapes text for safe insertion into innerHTML. Applicant-entered values
 * (names, addresses, form fields, file names) are later viewed by staff and
 * admins, so every such value MUST go through this before being rendered —
 * otherwise a malicious applicant could run script in a staff session.
 */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Remove the full-page "Checking your session…" overlay shown on protected pages. */
function hideAuthCheckingOverlay() {
  const el = document.getElementById('auth-checking-overlay');
  if (el) el.remove();
}

/** Toggle a submit button into/out of a disabled "loading" state. */
function setButtonLoading(button, isLoading, loadingText) {
  if (!button) return;
  if (isLoading) {
    if (!button.dataset.originalText) button.dataset.originalText = button.textContent;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.textContent = loadingText || 'Please wait…';
    button.classList.add('opacity-70', 'cursor-not-allowed');
  } else {
    button.disabled = false;
    button.removeAttribute('aria-busy');
    if (button.dataset.originalText) button.textContent = button.dataset.originalText;
    button.classList.remove('opacity-70', 'cursor-not-allowed');
  }
}

document.addEventListener('DOMContentLoaded', initCurrentYear);
