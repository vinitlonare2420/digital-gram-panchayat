/* ==========================================================================
   app.js — small page-agnostic helpers. Page-specific logic (form
   submission, filtering, etc.) lives inline at the bottom of each HTML
   file so it stays next to the markup it controls, and calls into
   utils.js / validation.js / components.js for shared behaviour.
   ========================================================================== */

/** Render a simple breadcrumb trail. items: [{label, href?}] — last item has no href */
function renderBreadcrumb(containerEl, items) {
  if (!containerEl) return;
  const parts = items.map((item, i) => {
    const isLast = i === items.length - 1;
    const sep = i > 0 ? '<svg class="h-3.5 w-3.5 text-[var(--color-text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5"/></svg>' : '';
    const content = isLast
      ? `<span class="text-[var(--color-text)] font-medium" aria-current="page">${item.label}</span>`
      : `<a href="${item.href}" class="text-[var(--color-text-muted)] hover:text-[var(--color-primary)]">${item.label}</a>`;
    return `${sep}${content}`;
  }).join('');
  containerEl.innerHTML = `<nav class="flex items-center gap-2 text-sm flex-wrap" aria-label="Breadcrumb">${parts}</nav>`;
}

/**
 * Render a standard empty state. opts: { icon(optional svg path string), title, message, actionLabel, actionHref }
 */
function renderEmptyState(containerEl, opts = {}) {
  if (!containerEl) return;
  const { title = 'Nothing here yet', message = '', actionLabel, actionHref } = opts;
  containerEl.innerHTML = `
    <div class="text-center py-14 px-6 border border-dashed border-[var(--color-border)] rounded-xl bg-white">
      <svg class="mx-auto h-12 w-12 text-[var(--color-text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.4" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" d="M9 13.5h6m-6-3h6m2.25 9H6.75A2.25 2.25 0 0 1 4.5 17.25V6.75A2.25 2.25 0 0 1 6.75 4.5h6.879a1.5 1.5 0 0 1 1.06.44l3.622 3.621a1.5 1.5 0 0 1 .439 1.061v7.628A2.25 2.25 0 0 1 17.25 19.5Z" />
      </svg>
      <h3 class="mt-3 font-display font-semibold text-[var(--color-text)]">${title}</h3>
      <p class="mt-1.5 text-sm text-[var(--color-text-muted)] max-w-sm mx-auto">${message}</p>
      ${actionLabel && actionHref ? `<a href="${actionHref}" class="mt-5 inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium text-white bg-[var(--color-primary)] rounded-md hover:bg-[var(--color-primary-dark)]">${actionLabel}</a>` : ''}
    </div>`;
}
