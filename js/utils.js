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

document.addEventListener('DOMContentLoaded', initCurrentYear);
