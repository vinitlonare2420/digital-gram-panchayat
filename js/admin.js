/* ==========================================================================
   admin.js — browser-side data layer for the admin pages (Phase 5).

   ES module exposing window.GPAdmin. All user/staff changes go through the
   /api/admin/* functions (which re-check that the caller is an active
   admin); application counts for the dashboard are read straight from
   Firestore, which the security rules allow for admins.
   ========================================================================== */

import { auth, db } from "./firebase.js";
import { apiPost } from "./api.js";
import {
  collection,
  getDocs,
  query,
  orderBy,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

async function listUsers() {
  const { users } = await apiPost("/api/admin/list-users");
  return users;
}

async function createStaff({ name, email, mobile, password }) {
  return apiPost("/api/admin/create-staff", { name, email, mobile, password });
}

async function setUserActive(uid, active) {
  return apiPost("/api/admin/update-user", { uid, active });
}

async function setUserRole(uid, role) {
  return apiPost("/api/admin/update-user", { uid, role });
}

/** Real counts for the admin dashboard: users by role + applications by status. */
async function getDashboardStats() {
  const [users, appSnapshot] = await Promise.all([
    listUsers(),
    getDocs(query(collection(db, "applications"), orderBy("submittedAt", "desc"))),
  ]);

  const stats = {
    users: { total: users.length, citizen: 0, staff: 0, admin: 0, inactive: 0 },
    applications: {
      total: appSnapshot.size,
      submitted: 0, under_review: 0, approved: 0, rejected: 0, other: 0,
    },
    byService: {},
    recentApplications: [],
  };

  users.forEach((u) => {
    if (stats.users[u.role] !== undefined) stats.users[u.role] += 1;
    if (!u.active) stats.users.inactive += 1;
  });

  // countByService() lives in utils.js (a classic script loaded on every page).
  stats.byService = countByService(appSnapshot.docs.map((d) => d.data()));

  appSnapshot.docs.forEach((d, index) => {
    const data = d.data();
    if (Object.prototype.hasOwnProperty.call(stats.applications, data.status)) {
      stats.applications[data.status] += 1;
    } else {
      stats.applications.other += 1;
    }
    if (index < 5) stats.recentApplications.push({ docId: d.id, ...data });
  });

  return stats;
}

function currentUid() {
  return auth.currentUser ? auth.currentUser.uid : null;
}

// Logging out marks this admin as not present (best effort; components.js waits at most 2.5 s).
window.GPBeforeLogout = async () => {
  try {
    await apiPost("/api/availability", { action: "set", available: false });
  } catch (_) { /* feature off / offline: the confirmation just expires on its own */ }
};

window.GPAdmin = { currentUid, listUsers, createStaff, setUserActive, setUserRole, getDashboardStats };
window.dispatchEvent(new Event("gpadmin-ready"));
