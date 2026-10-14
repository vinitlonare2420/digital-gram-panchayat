/* ==========================================================================
   availability-ui.js — screens for the staff + admin "I Am Here" feature.

   Classic script (needs utils.js, validation.js, and — for toasts — components.js
   loaded first; the data calls come from the js/availability.js module via
   window.GPAvailability). Used by:
     citizen/availability.html + citizen/dashboard.html -> initCitizenAvailability()
     staff/dashboard.html + admin/dashboard.html        -> initStaffAvailabilityControl()  (own presence)
     admin/dashboard.html                               -> initAdminAvailabilitySettings()

   Safety rules this file keeps:
   - The UI only ever shows staff as present when the SERVER said so. A failed,
     slow, malformed or unexpected response is always "Availability Unavailable".
   - Availability is staff/admin-reported; every citizen view says so.
   - Names and labels are inserted with escapeHtml()/textContent only.
   ========================================================================== */

const AVAILABILITY_TIMEOUT_MS = 10000;
const AVAILABILITY_REFRESH_MS = 60000;

/** Rejects if `promise` takes longer than `ms` — a hung request must read as "unavailable". */
function availabilityWithTimeout(promise, ms = AVAILABILITY_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** "14 Oct 2026, 10:30 am" for a valid date; '' otherwise (never "Invalid Date"). */
function formatDateTime(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/**
 * What to show for a /api/availability "status" response. Pass null when the
 * request failed. Anything that is not a well-formed response is the
 * "Availability Unavailable" view — never "available".
 */
function availabilityView(status) {
  const unavailable = (message) => ({ key: 'unavailable', title: 'Availability Unavailable', tone: 'neutral', message, showMeta: false, lastUpdated: '', officeLabel: '' });
  if (!status || typeof status !== 'object') {
    return unavailable('We could not check staff availability right now. Please try again later.');
  }
  if (status.state === 'disabled') {
    return { key: 'disabled', title: 'Availability Disabled', tone: 'neutral', message: 'Office availability reporting is currently switched off by the Panchayat office.', showMeta: false, lastUpdated: '', officeLabel: '' };
  }
  if (status.state !== 'available' && status.state !== 'none') {
    return unavailable('We could not check staff availability right now. Please try again later.');
  }
  const base = {
    showMeta: true,
    lastUpdated: formatDateTime(status.lastUpdated),
    officeLabel: typeof status.officeLabel === 'string' ? status.officeLabel : '',
  };
  return status.state === 'available'
    ? { ...base, key: 'available', title: 'Office Available', tone: 'good', message: 'At least one staff or admin member has confirmed that they are at the office.' }
    : { ...base, key: 'none', title: 'No Staff or Admin Currently Available', tone: 'warn', message: 'No staff or admin member has confirmed that they are at the office right now.' };
}

const AVAILABILITY_TONES = { good: 'approved', warn: 'review', neutral: 'submitted' };

function availabilityBadge(tone, text) {
  const css = AVAILABILITY_TONES[tone] || 'submitted';
  return `<span class="status-badge" style="background:var(--status-${css}-bg);color:var(--status-${css}-fg);"><span class="dot" style="background:var(--status-${css}-dot);" aria-hidden="true"></span>${escapeHtml(text)}</span>`;
}

/** Citizen-facing panel. Only the minimum is shown: state, office name, last-updated time, and the staff/admin-reported notice. */
function renderAvailabilityPanel(containerEl, status, { compact = false } = {}) {
  if (!containerEl) return;
  const view = availabilityView(status);
  const minutes = view.showMeta && Number.isInteger(status.staleAfterMinutes) ? status.staleAfterMinutes : null;

  const notice = compact
    ? 'Reported by staff/admin themselves — not independently verified.'
    : `Availability is reported by staff/admin themselves and is not independently verified.${minutes ? ` It expires automatically after ${minutes} minutes without a new confirmation.` : ''}`;

  containerEl.innerHTML = `
    ${availabilityBadge(view.tone, view.title)}
    <p class="mt-3 text-sm text-[var(--color-text)]">${escapeHtml(view.message)}</p>
    ${view.showMeta && view.officeLabel ? `<p class="mt-1 text-sm text-[var(--color-text-muted)]">Location: ${escapeHtml(view.officeLabel)}</p>` : ''}
    ${view.showMeta ? `<p class="mt-1 text-xs text-[var(--color-text-muted)]">${view.lastUpdated ? `Last updated: ${escapeHtml(view.lastUpdated)}` : 'No staff or admin update has been recorded yet.'}</p>` : ''}
    <p class="mt-3 text-xs text-[var(--color-text-muted)]">${escapeHtml(notice)}</p>`;
}

/* ------------------------------ citizen ------------------------------ */

/** Loads and shows availability in `containerEl`; `refreshBtn` (optional) reloads it. */
function initCitizenAvailability(containerEl, { compact = false, refreshBtn = null } = {}) {
  async function load() {
    containerEl.innerHTML = '<p class="text-sm text-[var(--color-text-muted)]">Checking availability…</p>';
    if (refreshBtn) refreshBtn.disabled = true;
    let status = null;
    try {
      status = await availabilityWithTimeout(GPAvailability.getStatus());
    } catch (error) {
      status = null;                       // unreachable / slow / refused -> "Availability Unavailable"
    }
    renderAvailabilityPanel(containerEl, status, { compact });
    if (refreshBtn) refreshBtn.disabled = false;
  }
  if (refreshBtn) refreshBtn.addEventListener('click', load);
  whenAvailabilityReady(load);
}

/* -------------------------------- staff -------------------------------- */

/** The "I Am Here" card on the staff AND admin dashboards (each person controls only their own presence). Needs the ids used in staff/dashboard.html. */
function initStaffAvailabilityControl() {
  const stateEl = document.getElementById('iah-state');
  const detailEl = document.getElementById('iah-detail');
  const toggle = document.getElementById('iah-toggle');
  const renew = document.getElementById('iah-renew');
  const noteEl = document.getElementById('iah-note');

  let busy = false;
  let current = { usable: false, available: false };

  function show({ tone, badge, detail, toggleText, usable, available, canRenew }) {
    stateEl.innerHTML = availabilityBadge(tone, badge);
    detailEl.textContent = detail;
    toggle.textContent = toggleText;
    toggle.disabled = !usable;
    renew.classList.toggle('hidden', !canRenew);
    renew.disabled = !usable;
    current = { usable, available };
  }

  function render(status) {
    noteEl.textContent = 'This is your own confirmation — your location is not tracked or checked. Citizens only see whether at least one staff or admin member is available.';
    const wellFormed = status && typeof status === 'object' && ['available', 'none', 'disabled'].includes(status.state)
      && status.mine && typeof status.mine === 'object';
    if (!wellFormed) {
      return show({ tone: 'neutral', badge: 'Status unavailable', detail: 'We could not load your availability status. Please refresh the page.', toggleText: 'I Am Here', usable: false, available: false, canRenew: false });
    }
    if (status.enabled !== true) {
      return show({ tone: 'neutral', badge: 'Feature switched off', detail: 'The I Am Here feature is switched off, so availability cannot be changed right now.', toggleText: 'I Am Here', usable: false, available: false, canRenew: false });
    }
    const mine = status.mine;
    if (mine.available === true) {
      const until = formatDateTime(mine.expiresAt);
      return show({
        tone: 'good', badge: 'You are marked as available',
        detail: `Confirmed ${formatDateTime(mine.updatedAt) || 'just now'}.${until ? ` This expires at ${until} unless you confirm again.` : ''}`,
        toggleText: 'Mark me unavailable', usable: true, available: true, canRenew: true,
      });
    }
    const expired = mine.reported === true;
    return show({
      tone: 'warn', badge: 'You are marked as unavailable',
      detail: expired
        ? `Your last confirmation${formatDateTime(mine.updatedAt) ? ` (${formatDateTime(mine.updatedAt)})` : ''} has expired. Press "I Am Here" when you are at the Gram Panchayat office.`
        : 'Press "I Am Here" when you are at the Gram Panchayat office.',
      toggleText: 'I Am Here', usable: true, available: false, canRenew: false,
    });
  }

  async function load() {
    let status = null;
    try {
      status = await availabilityWithTimeout(GPAvailability.getStatus());
    } catch (error) {
      status = null;
    }
    render(status);
  }

  async function change(available) {
    if (busy || !current.usable) return;
    busy = true;
    toggle.disabled = true;
    renew.disabled = true;
    try {
      await GPAvailability.setMine(available);
      showToast(available ? 'You are now marked as available.' : 'You are now marked as unavailable.', 'success');
    } catch (error) {
      showToast(error.message || 'Could not update your status. Please try again.', 'error');
    }
    busy = false;
    await load();                        // always re-read the server's view of the truth
  }

  toggle.addEventListener('click', () => change(!current.available));
  renew.addEventListener('click', () => change(true));

  whenAvailabilityReady(() => {
    load();
    setInterval(() => { if (!busy) load(); }, AVAILABILITY_REFRESH_MS);   // so an expiry shows up without a reload
  });
}

/* -------------------------------- admin -------------------------------- */

const AVAILABILITY_STAFF_TEXT = {
  available: ['good', 'Available'],
  expired: ['warn', 'Expired — needs to confirm again'],
  unavailable: ['neutral', 'Not available'],
  never: ['neutral', 'Never confirmed'],
};

/** The "Staff Availability / I Am Here Settings" section on the admin dashboard. */
function initAdminAvailabilitySettings() {
  const statusEl = document.getElementById('iah-status');
  const enableBtn = document.getElementById('iah-enable');
  const disableBtn = document.getElementById('iah-disable');
  const form = document.getElementById('iah-config-form');
  const staleInput = document.getElementById('iah-stale');
  const labelInput = document.getElementById('iah-label');
  const bodyEl = document.getElementById('iah-staff-body');
  const emptyEl = document.getElementById('iah-staff-empty');

  function lock(disabled) { enableBtn.disabled = disabled; disableBtn.disabled = disabled; }

  function render(data) {
    const settings = data && data.settings;
    if (!settings || typeof settings.enabled !== 'boolean' || !Array.isArray(data.staff)) {
      throw new Error('Unexpected response');
    }
    statusEl.innerHTML = availabilityBadge(settings.enabled ? 'good' : 'neutral', settings.enabled ? 'Enabled' : 'Disabled');
    enableBtn.disabled = settings.enabled;
    disableBtn.disabled = !settings.enabled;
    staleInput.value = String(settings.staleAfterMinutes);
    labelInput.value = settings.officeLabel;

    bodyEl.innerHTML = data.staff.map((s) => {
      const [tone, text] = AVAILABILITY_STAFF_TEXT[s.state] || AVAILABILITY_STAFF_TEXT.unavailable;
      return `
        <tr>
          <td data-label="Staff / admin" class="px-4 py-3 font-medium text-[var(--color-text)]">${escapeHtml(s.name || '—')}${s.role === 'admin' ? ' <span class="text-xs font-normal text-[var(--color-text-muted)]">(Admin)</span>' : ''}</td>
          <td data-label="Availability" class="px-4 py-3">${availabilityBadge(tone, text)}</td>
          <td data-label="Last confirmed" class="px-4 py-3">${escapeHtml(formatDateTime(s.updatedAt) || '—')}</td>
        </tr>`;
    }).join('');
    emptyEl.classList.toggle('hidden', data.staff.length > 0);
  }

  async function load() {
    try {
      render(await availabilityWithTimeout(GPAvailability.overview()));
    } catch (error) {
      statusEl.innerHTML = availabilityBadge('neutral', 'Status unavailable');
      lock(true);
      bodyEl.innerHTML = '';
      emptyEl.classList.remove('hidden');
      emptyEl.textContent = 'Could not load availability settings. Please refresh the page.';
    }
  }

  async function setEnabled(enabled) {
    if (!enabled && !window.confirm('Switch off I Am Here? Citizens will see "Availability Unavailable" and staff and admins will not be able to confirm their presence.')) return;
    lock(true);
    try {
      await GPAvailability.configure({ enabled });
      showToast(enabled ? 'I Am Here is now enabled.' : 'I Am Here is now disabled.', 'success');
    } catch (error) {
      showToast(error.message || 'Could not change the setting. Please try again.', 'error');
    }
    await load();
  }

  enableBtn.addEventListener('click', () => setEnabled(true));
  disableBtn.addEventListener('click', () => setEnabled(false));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const valid = validateFields({
      'iah-stale': [Validators.required, (v) => Validators.integerBetween(v, 5, 1440)],
      'iah-label': [Validators.required, (v) => Validators.maxLength(v, 80)],
    });
    if (!valid) return;
    const submitBtn = form.querySelector('button[type="submit"]');
    setButtonLoading(submitBtn, true, 'Saving…');
    try {
      await GPAvailability.configure({ staleAfterMinutes: Number(staleInput.value.trim()), officeLabel: labelInput.value.trim() });
      showToast('Settings saved.', 'success');
      await load();
    } catch (error) {
      showToast(error.message || 'Could not save the settings. Please try again.', 'error');
    } finally {
      setButtonLoading(submitBtn, false);
    }
  });

  whenAvailabilityReady(load);
}
