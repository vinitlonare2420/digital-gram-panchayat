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

    const sep = i > 0
      ? '<svg class="h-3.5 w-3.5 text-[var(--color-text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5"/></svg>'
      : '';

    const content = isLast
      ? `<span class="text-[var(--color-text)] font-medium" aria-current="page">${item.label}</span>`
      : `<a href="${item.href}" class="text-[var(--color-text-muted)] hover:text-[var(--color-primary)]">${item.label}</a>`;

    return `${sep}${content}`;
  }).join('');

  containerEl.innerHTML = `
    <nav class="flex items-center gap-2 text-sm flex-wrap" aria-label="Breadcrumb">
      ${parts}
    </nav>`;
}


/**
 * Render the "application submitted successfully" success screen used by
 * all four certificate forms after a real Firestore write succeeds.
 *
 * opts: { applicationId, viewHref, dashboardHref }
 */
function renderApplicationSuccess(
  containerEl,
  { applicationId, viewHref, dashboardHref }
) {
  if (!containerEl) return;

  containerEl.innerHTML = `
    <div class="mx-auto h-14 w-14 rounded-full bg-[var(--color-primary-light)] flex items-center justify-center text-[var(--color-primary)]">
      <svg class="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
      </svg>
    </div>

    <h2 class="mt-4 font-display font-semibold text-xl text-[var(--color-text)]">
      Application submitted successfully
    </h2>

    <p class="mt-2 text-sm text-[var(--color-text-muted)] max-w-sm mx-auto">
      Keep this Application ID — you'll need it to track your application.
    </p>

    <p class="mt-5 inline-block px-5 py-2.5 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] font-display font-semibold text-lg tracking-wide text-[var(--color-primary-dark)]">
      ${applicationId}
    </p>

    <div class="mt-7 flex flex-col sm:flex-row gap-3 justify-center">
      <a
        href="${viewHref}"
        class="px-5 py-2.5 rounded-md bg-[var(--color-primary)] text-white text-sm font-medium hover:bg-[var(--color-primary-dark)]"
      >
        View Application
      </a>

      <a
        href="${dashboardHref}"
        class="px-5 py-2.5 rounded-md border border-[var(--color-border)] text-sm font-medium text-[var(--color-text)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
      >
        Go to Dashboard
      </a>
    </div>
  `;
}


/**
 * Render the certificate-application status timeline.
 *
 * The real workflow: Submitted → Under Review → Approved, or Rejected instead of
 * Approved. (Older applications may carry the retired statuses under_verification /
 * correction_required; they are shown as "Under Review" / on their own.)
 */
const APPLICATION_TIMELINE_STEPS = [
  'submitted',
  'under_review',
  'approved'
];
const REJECTED_TIMELINE_STEPS = ['submitted', 'under_review', 'rejected'];

function renderApplicationTimeline(containerEl, currentStatus) {
  if (!containerEl) return;

  if (currentStatus === 'correction_required') {
    const meta = STATUS_META[currentStatus];

    containerEl.innerHTML = `
      <li class="timeline-step is-current">
        <span class="timeline-dot"></span>
        <p class="font-medium text-sm text-[var(--color-text)]">
          ${meta.label}
        </p>
      </li>`;

    return;
  }

  const status = currentStatus === 'under_verification' ? 'under_review' : currentStatus;
  const steps = status === 'rejected' ? REJECTED_TIMELINE_STEPS : APPLICATION_TIMELINE_STEPS;
  const currentIndex = steps.indexOf(status);

  const checkIcon = `
    <svg
      class="h-3 w-3 text-white"
      fill="currentColor"
      viewBox="0 0 20 20"
      aria-hidden="true"
    >
      <path
        fill-rule="evenodd"
        d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z"
        clip-rule="evenodd"
      />
    </svg>`;

  containerEl.innerHTML =
    steps.map((stepKey, i) => {
      const meta = STATUS_META[stepKey];

      let stepClass = '';
      let dotContent = '';

      if (currentIndex >= 0 && i < currentIndex) {
        stepClass = 'is-complete';
        dotContent = checkIcon;
      } else if (i === currentIndex) {
        stepClass = 'is-current';
      }

      const textClass =
        currentIndex >= 0 && i <= currentIndex
          ? 'text-[var(--color-text)]'
          : 'text-[var(--color-text-muted)]';

      return `
        <li class="timeline-step ${stepClass}">
          <span class="timeline-dot">${dotContent}</span>
          <p class="font-medium text-sm ${textClass}">
            ${meta.label}
          </p>
        </li>`;
    }).join('');
}


/**
 * Render a standard empty state.
 *
 * opts:
 * {
 *   icon(optional svg path string),
 *   title,
 *   message,
 *   actionLabel,
 *   actionHref
 * }
 */
function renderEmptyState(containerEl, opts = {}) {
  if (!containerEl) return;

  const {
    title = 'Nothing here yet',
    message = '',
    actionLabel,
    actionHref
  } = opts;

  containerEl.innerHTML = `
    <div class="text-center py-14 px-6 border border-dashed border-[var(--color-border)] rounded-xl bg-white">

      <svg
        class="mx-auto h-12 w-12 text-[var(--color-text-muted)]"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        stroke-width="1.4"
        aria-hidden="true"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M9 13.5h6m-6-3h6m2.25 9H6.75A2.25 2.25 0 0 1 4.5 17.25V6.75A2.25 2.25 0 0 1 6.75 4.5h6.879a1.5 1.5 0 0 1 1.06.44l3.622 3.621a1.5 1.5 0 0 1 .439 1.061v7.628A2.25 2.25 0 0 1 17.25 19.5Z"
        />
      </svg>

      <h3 class="mt-3 font-display font-semibold text-[var(--color-text)]">
        ${title}
      </h3>

      <p class="mt-1.5 text-sm text-[var(--color-text-muted)] max-w-sm mx-auto">
        ${message}
      </p>

      ${
        actionLabel && actionHref
          ? `<a
              href="${actionHref}"
              class="mt-5 inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium text-white bg-[var(--color-primary)] rounded-md hover:bg-[var(--color-primary-dark)]"
            >
              ${actionLabel}
            </a>`
          : ''
      }
    </div>`;
}


/* ==========================================================================
   Global functions used by classic inline scripts in the HTML pages.
   ========================================================================== */

window.renderBreadcrumb = renderBreadcrumb;
window.renderApplicationSuccess = renderApplicationSuccess;
window.renderApplicationTimeline = renderApplicationTimeline;
window.renderEmptyState = renderEmptyState;