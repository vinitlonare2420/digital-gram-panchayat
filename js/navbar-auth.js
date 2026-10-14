/* ==========================================================================
   navbar-auth.js — makes the shared public navbar react to Firebase Auth.

   components.js always renders Login/Register (it is plain HTML-in-JS with
   no Firebase). This module is loaded by renderPublicHeader() and, once
   Firebase reports a signed-in user, replaces those buttons with a
   Dashboard link (citizen or staff, based on users/{uid}.role) and Logout.
   Signed-out visitors keep the default Login/Register buttons untouched.

   Uses the same `auth`/`db` instances as every other page (js/firebase.js).
   ========================================================================== */

import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const base = window.SITE_BASE || "";

async function getDashboardHref(uid) {
  try {
    const snap = await getDoc(doc(db, "users", uid));
    const role = snap.exists() ? snap.data().role : null;
    const area = role === "admin" ? "admin" : role === "staff" ? "staff" : "citizen";
    return `${base}${area}/dashboard.html`;
  } catch (error) {
    return `${base}citizen/dashboard.html`;
  }
}

function renderLoggedIn(container, dashboardHref) {
  const isMobile = container.dataset.navAuth === "mobile";
  const dashClass = isMobile
    ? "text-center px-4 py-2.5 text-sm font-medium text-[var(--color-primary)] rounded-md border border-[var(--color-primary)]"
    : "px-4 py-2 text-sm font-medium text-[var(--color-primary)] rounded-md border border-[var(--color-primary)] hover:bg-[var(--color-primary-light)] transition-colors";
  const logoutClass = isMobile
    ? "text-center px-4 py-2.5 text-sm font-medium text-white bg-[var(--color-primary)] rounded-md"
    : "px-4 py-2 text-sm font-medium text-white bg-[var(--color-primary)] rounded-md hover:bg-[var(--color-primary-dark)] transition-colors";

  container.innerHTML = `
    <a href="${dashboardHref}" class="${dashClass}">Dashboard</a>
    <button type="button" data-nav-logout class="${logoutClass}">Logout</button>
  `;
  container.querySelector("[data-nav-logout]").addEventListener("click", async () => {
    try {
      await signOut(auth);
    } finally {
      window.location.href = `${base}index.html`;
    }
  });
}

const containers = document.querySelectorAll("[data-nav-auth]");
const loggedOutHtml = new Map();
containers.forEach((c) => loggedOutHtml.set(c, c.innerHTML));

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    // Restore the default Login/Register buttons (e.g. after logout in another tab).
    containers.forEach((c) => { c.innerHTML = loggedOutHtml.get(c); });
    return;
  }
  const dashboardHref = await getDashboardHref(user.uid);
  containers.forEach((c) => renderLoggedIn(c, dashboardHref));
});
