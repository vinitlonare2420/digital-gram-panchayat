/* ==========================================================================
   components.js — reusable UI built with vanilla JS.
   Every page sets `window.SITE_BASE` (relative path back to the project
   root, e.g. "" at the root or "../" inside /services, /citizen, /staff)
   before this file runs, then calls the relevant `init*` function.
   ========================================================================== */

const SITE_BASE = window.SITE_BASE || '';

/* ----------------------------- Public navbar ----------------------------- */

const PUBLIC_NAV_LINKS = [
  { key: 'home', label: 'Home', href: 'index.html' },
  { key: 'services', label: 'Services', href: 'services.html' },
  { key: 'track', label: 'Track Application', href: 'track.html' },
  { key: 'about', label: 'About', href: 'about.html' },
  { key: 'contact', label: 'Contact', href: 'contact.html' },
];

function renderPublicHeader(activeKey) {
  const mount = document.getElementById('site-header');
  if (!mount) return;

  const navItems = PUBLIC_NAV_LINKS.map(link => `
    <a href="${SITE_BASE}${link.href}"
       class="px-3 py-2 rounded-md text-sm font-medium transition-colors ${activeKey === link.key
         ? 'text-[var(--color-primary)] bg-[var(--color-primary-light)]'
         : 'text-[var(--color-text)] hover:bg-[var(--color-primary-light)] hover:text-[var(--color-primary)]'}"
       ${activeKey === link.key ? 'aria-current="page"' : ''}>${link.label}</a>
  `).join('');

  const mobileNavItems = PUBLIC_NAV_LINKS.map(link => `
    <a href="${SITE_BASE}${link.href}"
       class="block px-4 py-3 rounded-md text-base font-medium ${activeKey === link.key
         ? 'text-[var(--color-primary)] bg-[var(--color-primary-light)]'
         : 'text-[var(--color-text)] hover:bg-[var(--color-primary-light)]'}">${link.label}</a>
  `).join('');

  mount.innerHTML = `
    <div class="gov-hairline"></div>
    <header class="bg-white border-b border-[var(--color-border)] sticky top-0 z-40">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="flex items-center justify-between h-18 py-3">
          <a href="${SITE_BASE}index.html" class="flex items-center gap-3 shrink-0">
            <span class="gp-seal">GP</span>
            <span class="leading-tight">
              <span class="block font-display font-semibold text-[15px] sm:text-base text-[var(--color-text)]">Digital Gram Panchayat</span>
              <span class="block text-xs text-[var(--color-text-muted)]">Citizen Service Portal</span>
            </span>
          </a>

          <nav class="hidden lg:flex items-center gap-1" aria-label="Primary">
            ${navItems}
          </nav>

          <div class="hidden lg:flex items-center gap-2">
            <a href="${SITE_BASE}login.html" class="px-4 py-2 text-sm font-medium text-[var(--color-primary)] rounded-md border border-[var(--color-primary)] hover:bg-[var(--color-primary-light)] transition-colors">Login</a>
            <a href="${SITE_BASE}register.html" class="px-4 py-2 text-sm font-medium text-white bg-[var(--color-primary)] rounded-md hover:bg-[var(--color-primary-dark)] transition-colors">Register</a>
          </div>

          <button id="mobile-menu-btn" type="button"
                  class="lg:hidden inline-flex items-center justify-center p-2 rounded-md text-[var(--color-text)] hover:bg-[var(--color-primary-light)]"
                  aria-controls="mobile-menu" aria-expanded="false" aria-label="Open main menu">
            <svg id="icon-menu" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
            </svg>
            <svg id="icon-close" class="h-6 w-6 hidden" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <div id="mobile-menu" class="lg:hidden hidden border-t border-[var(--color-border)] bg-white">
        <nav class="px-3 py-3 space-y-1" aria-label="Mobile">
          ${mobileNavItems}
          <div class="pt-3 mt-2 border-t border-[var(--color-border)] flex flex-col gap-2">
            <a href="${SITE_BASE}login.html" class="text-center px-4 py-2.5 text-sm font-medium text-[var(--color-primary)] rounded-md border border-[var(--color-primary)]">Login</a>
            <a href="${SITE_BASE}register.html" class="text-center px-4 py-2.5 text-sm font-medium text-white bg-[var(--color-primary)] rounded-md">Register</a>
          </div>
        </nav>
      </div>
    </header>
  `;

  const btn = document.getElementById('mobile-menu-btn');
  const menu = document.getElementById('mobile-menu');
  const iconMenu = document.getElementById('icon-menu');
  const iconClose = document.getElementById('icon-close');
  btn.addEventListener('click', () => {
    const isOpen = !menu.classList.contains('hidden');
    menu.classList.toggle('hidden');
    iconMenu.classList.toggle('hidden');
    iconClose.classList.toggle('hidden');
    btn.setAttribute('aria-expanded', String(!isOpen));
  });
}

function renderPublicFooter() {
  const mount = document.getElementById('site-footer');
  if (!mount) return;
  mount.innerHTML = `
    <footer class="bg-[var(--color-text)] text-gray-200 mt-16">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
        <div>
          <div class="flex items-center gap-3 mb-3">
            <span class="gp-seal">GP</span>
            <span class="font-display font-semibold text-white">Digital Gram Panchayat</span>
          </div>
          <p class="text-sm text-gray-400 leading-relaxed">A digital services portal for applying to and tracking essential Gram Panchayat administrative certificates online.</p>
        </div>
        <div>
          <h3 class="text-white font-display font-medium text-sm mb-3 tracking-wide uppercase">Quick Links</h3>
          <ul class="space-y-2 text-sm text-gray-400">
            <li><a class="hover:text-white" href="${SITE_BASE}services.html">Services</a></li>
            <li><a class="hover:text-white" href="${SITE_BASE}track.html">Track Application</a></li>
            <li><a class="hover:text-white" href="${SITE_BASE}about.html">About</a></li>
            <li><a class="hover:text-white" href="${SITE_BASE}contact.html">Contact</a></li>
          </ul>
        </div>
        <div>
          <h3 class="text-white font-display font-medium text-sm mb-3 tracking-wide uppercase">Certificates</h3>
          <ul class="space-y-2 text-sm text-gray-400">
            <li><a class="hover:text-white" href="${SITE_BASE}services/birth.html">Birth Certificate</a></li>
            <li><a class="hover:text-white" href="${SITE_BASE}services/death.html">Death Certificate</a></li>
            <li><a class="hover:text-white" href="${SITE_BASE}services/income.html">Income Certificate</a></li>
            <li><a class="hover:text-white" href="${SITE_BASE}services/caste.html">Caste Certificate</a></li>
          </ul>
        </div>
        <div>
          <h3 class="text-white font-display font-medium text-sm mb-3 tracking-wide uppercase">Office</h3>
          <ul class="space-y-2 text-sm text-gray-400">
            <li>Gram Panchayat Office, Village Road</li>
            <li>Mon–Sat, 10:00 AM – 5:00 PM</li>
            <li>help@gramseva.example.in</li>
            <li>+91 00000 00000</li>
          </ul>
        </div>
      </div>
      <div class="border-t border-white/10">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-gray-500">
          <p>&copy; <span data-current-year></span> Digital Gram Panchayat Citizen Service Portal. Academic project — not an officially authorised government website.</p>
          <p>Staff login: <a class="text-gray-300 hover:text-white underline" href="${SITE_BASE}staff/login.html">Panchayat Staff Portal</a></p>
        </div>
      </div>
    </footer>
  `;
}

function initPublicLayout(activeKey) {
  renderPublicHeader(activeKey);
  renderPublicFooter();
  ensureToastContainer();
}

/* ------------------------------ Toasts ------------------------------ */

function ensureToastContainer() {
  if (!document.getElementById('toast-container')) {
    const div = document.createElement('div');
    div.id = 'toast-container';
    div.setAttribute('aria-live', 'polite');
    div.setAttribute('aria-atomic', 'true');
    document.body.appendChild(div);
  }
}

/** type: 'success' | 'error' | 'info' */
function showToast(message, type = 'info', duration = 4200) {
  ensureToastContainer();
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.setAttribute('role', 'status');
  toast.innerHTML = `<span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.25s ease';
    setTimeout(() => toast.remove(), 250);
  }, duration);
}

/* ------------------------------ Modals ------------------------------ */

function openModal(modalId) {
  const overlay = document.getElementById(modalId);
  if (!overlay) return;
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
  const focusable = overlay.querySelector('button, input, a');
  if (focusable) focusable.focus();
}

function closeModal(modalId) {
  const overlay = document.getElementById(modalId);
  if (!overlay) return;
  overlay.classList.remove('open');
  document.body.style.overflow = '';
}

document.addEventListener('click', (e) => {
  if (e.target.classList && e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('open');
    document.body.style.overflow = '';
  }
  if (e.target.closest('[data-close-modal]')) {
    const id = e.target.closest('[data-close-modal]').getAttribute('data-close-modal');
    closeModal(id);
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    $all('.modal-overlay.open').forEach(el => { el.classList.remove('open'); document.body.style.overflow = ''; });
  }
});

/* ------------------------- Dashboard shell (citizen / staff) ------------------------- */

const CITIZEN_NAV = [
  { key: 'dashboard', label: 'Dashboard', href: 'dashboard.html', icon: 'grid' },
  { key: 'applications', label: 'My Applications', href: 'applications.html', icon: 'doc' },
  { key: 'profile', label: 'Profile', href: 'profile.html', icon: 'user' },
];

const STAFF_NAV = [
  { key: 'dashboard', label: 'Dashboard', href: 'dashboard.html', icon: 'grid' },
  { key: 'applications', label: 'Applications', href: 'applications.html', icon: 'doc' },
];

const DASHBOARD_ICONS = {
  grid: '<path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z" />',
  doc: '<path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />',
  user: '<path stroke-linecap="round" stroke-linejoin="round" d="M17.982 18.725A7.488 7.488 0 0 0 12 15.75a7.488 7.488 0 0 0-5.982 2.975m11.963 0a9 9 0 1 0-11.963 0m11.963 0A8.966 8.966 0 0 1 12 21a8.966 8.966 0 0 1-5.982-2.275M15 9.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />',
  logout: '<path stroke-linecap="round" stroke-linejoin="round" d="M8.25 9V5.25A2.25 2.25 0 0 1 10.5 3h6a2.25 2.25 0 0 1 2.25 2.25v13.5A2.25 2.25 0 0 1 16.5 21h-6a2.25 2.25 0 0 1-2.25-2.25V15M12 9l-3 3m0 0 3 3m-3-3h12.75" />',
};

/**
 * role: 'citizen' | 'staff'
 * activeKey: matches an item.key from CITIZEN_NAV / STAFF_NAV
 * pageTitle: shown in the topbar
 */
function initDashboardShell({ role, activeKey, pageTitle }) {
  const navList = role === 'staff' ? STAFF_NAV : CITIZEN_NAV;
  const portalLabel = role === 'staff' ? 'Staff Portal' : 'Citizen Portal';
  const loginHref = role === 'staff' ? 'login.html' : `${SITE_BASE}login.html`;

  const sidebarLinks = navList.map(item => `
    <a href="${item.href}"
       class="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${activeKey === item.key
         ? 'bg-[var(--color-primary-light)] text-[var(--color-primary)]'
         : 'text-gray-200 hover:bg-white/10'}"
       ${activeKey === item.key ? 'aria-current="page"' : ''}>
      <svg class="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.6" aria-hidden="true">${DASHBOARD_ICONS[item.icon]}</svg>
      ${item.label}
    </a>`).join('');

  const header = document.getElementById('site-header');
  if (header) {
    header.innerHTML = `
      <div class="gov-hairline"></div>
      <header class="bg-white border-b border-[var(--color-border)] sticky top-0 z-40">
        <div class="px-4 sm:px-6 h-16 flex items-center justify-between">
          <div class="flex items-center gap-3">
            <button id="sidebar-toggle" type="button" class="lg:hidden p-2 -ml-2 rounded-md hover:bg-[var(--color-primary-light)]" aria-label="Open menu" aria-controls="dashboard-sidebar" aria-expanded="false">
              <svg class="h-6 w-6 text-[var(--color-text)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" /></svg>
            </button>
            <a href="${role === 'staff' ? '' : SITE_BASE}${role === 'staff' ? 'dashboard.html' : ''}${role === 'citizen' ? '' : ''}" class="flex items-center gap-2.5">
              <span class="gp-seal" style="width:2.1rem;height:2.1rem;font-size:0.8rem;">GP</span>
              <span class="hidden sm:block leading-tight">
                <span class="block font-display font-semibold text-sm">Digital Gram Panchayat</span>
                <span class="block text-[11px] text-[var(--color-text-muted)]">${portalLabel}</span>
              </span>
            </a>
          </div>
          <div class="flex items-center gap-2 sm:gap-3">
            <span class="hidden sm:block text-sm font-medium text-[var(--color-text)]">${pageTitle || ''}</span>
            <button id="logout-btn" type="button" class="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-[var(--color-text)] rounded-md border border-[var(--color-border)] hover:bg-[var(--color-primary-light)]">
              <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" aria-hidden="true">${DASHBOARD_ICONS.logout}</svg>
              <span class="hidden sm:inline">Logout</span>
            </button>
          </div>
        </div>
      </header>`;
  }

  const sidebarMount = document.getElementById('dashboard-sidebar');
  if (sidebarMount) {
    sidebarMount.innerHTML = `
      <div class="h-full flex flex-col bg-[var(--color-text)] text-white w-64 shrink-0">
        <div class="p-4 border-b border-white/10">
          <p class="text-xs uppercase tracking-wide text-gray-400">${portalLabel}</p>
        </div>
        <nav class="flex-1 p-3 space-y-1" aria-label="Dashboard">${sidebarLinks}</nav>
        <div class="p-3 border-t border-white/10 text-[11px] text-gray-500">Prototype interface — connects to Firebase in a later phase.</div>
      </div>`;
  }

  const toggle = document.getElementById('sidebar-toggle');
  if (toggle && sidebarMount) {
    let backdrop = document.getElementById('sidebar-backdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.id = 'sidebar-backdrop';
      backdrop.className = 'fixed inset-0 bg-black/40 z-40 hidden lg:hidden';
      document.body.appendChild(backdrop);
    }
    const closeSidebar = () => {
      sidebarMount.classList.add('-translate-x-full');
      backdrop.classList.add('hidden');
      toggle.setAttribute('aria-expanded', 'false');
    };
    const openSidebar = () => {
      sidebarMount.classList.remove('-translate-x-full');
      backdrop.classList.remove('hidden');
      toggle.setAttribute('aria-expanded', 'true');
    };
    toggle.addEventListener('click', () => {
      const isOpen = !sidebarMount.classList.contains('-translate-x-full');
      isOpen ? closeSidebar() : openSidebar();
    });
    backdrop.addEventListener('click', closeSidebar);
  }

  document.getElementById('logout-btn')?.addEventListener('click', () => {
    showToast('Logout will be connected once Firebase Authentication is added.', 'info');
  });

  ensureToastContainer();
}

/* ------------------------- Document upload widget ------------------------- */

/**
 * Renders a reusable "select a document" control inside `containerEl`.
 * opts: { label, fieldId, hint, accept, maxSizeMB }
 * Validation uses `validateFile()` from validation.js.
 */
function initFileUpload(containerEl, opts = {}) {
  const {
    label = 'Upload document',
    fieldId = 'file-' + Math.random().toString(36).slice(2, 8),
    hint = 'PDF, JPG, JPEG or PNG — up to 5 MB',
    accept = '.pdf,.jpg,.jpeg,.png',
    maxSizeMB = 5,
  } = opts;

  containerEl.innerHTML = `
    <label class="block text-sm font-medium text-[var(--color-text)] mb-1.5" for="${fieldId}">${label} <span class="text-[var(--color-accent)]">*</span></label>
    <div class="upload-zone rounded-lg p-4 sm:p-5 text-center" data-dropzone>
      <input type="file" id="${fieldId}" class="sr-only" accept="${accept}" />
      <div data-upload-empty>
        <svg class="mx-auto h-8 w-8 text-[var(--color-text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 8.25 12 3.75m0 0L7.5 8.25M12 3.75v12" />
        </svg>
        <p class="mt-2 text-sm text-[var(--color-text)]">
          <label for="${fieldId}" class="font-medium text-[var(--color-primary)] hover:underline cursor-pointer">Choose a file</label>
          <span class="text-[var(--color-text-muted)]"> or drag it here</span>
        </p>
        <p class="text-xs text-[var(--color-text-muted)] mt-1">${hint}</p>
      </div>
      <div data-upload-filled class="hidden flex items-center justify-between gap-3 text-left bg-white rounded-md border border-[var(--color-border)] px-3 py-2.5">
        <div class="flex items-center gap-2.5 min-w-0">
          <svg class="h-5 w-5 text-[var(--color-primary)] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25" />
            <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
          </svg>
          <div class="min-w-0">
            <p data-upload-filename class="text-sm font-medium text-[var(--color-text)] truncate"></p>
            <p data-upload-filesize class="text-xs text-[var(--color-text-muted)]"></p>
          </div>
        </div>
        <button type="button" data-upload-remove class="text-xs font-medium text-[var(--color-accent)] hover:underline shrink-0">Remove</button>
      </div>
    </div>
    <p class="mt-1.5 text-xs text-red-600 hidden" data-error-for="${fieldId}"></p>
  `;

  const input = containerEl.querySelector(`#${fieldId}`);
  const dropzone = containerEl.querySelector('[data-dropzone]');
  const emptyState = containerEl.querySelector('[data-upload-empty]');
  const filledState = containerEl.querySelector('[data-upload-filled]');
  const filenameEl = containerEl.querySelector('[data-upload-filename]');
  const filesizeEl = containerEl.querySelector('[data-upload-filesize]');
  const removeBtn = containerEl.querySelector('[data-upload-remove]');

  function setFile(file) {
    const error = validateFile(file, { maxSizeMB });
    if (error) {
      showFieldError(fieldId, error);
      input.value = '';
      return;
    }
    clearFieldError(fieldId);
    filenameEl.textContent = file.name;
    filesizeEl.textContent = formatFileSize(file.size);
    emptyState.classList.add('hidden');
    filledState.classList.remove('hidden');
    filledState.classList.add('flex');
  }

  input.addEventListener('change', () => { if (input.files[0]) setFile(input.files[0]); });

  removeBtn.addEventListener('click', () => {
    input.value = '';
    filledState.classList.add('hidden');
    filledState.classList.remove('flex');
    emptyState.classList.remove('hidden');
  });

  ['dragenter', 'dragover'].forEach(evt => dropzone.addEventListener(evt, (e) => {
    e.preventDefault(); dropzone.classList.add('is-dragover');
  }));
  ['dragleave', 'drop'].forEach(evt => dropzone.addEventListener(evt, (e) => {
    e.preventDefault(); dropzone.classList.remove('is-dragover');
  }));
  dropzone.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files[0];
    if (file) { input.files = e.dataTransfer.files; setFile(file); }
  });

  return { fieldId, getFile: () => input.files[0] || null };
}
