/* ==========================================================================
   staff.js — browser-side data layer for the staff pages (Phase 5).

   ES module exposing window.GPStaff.

   READS (list/open applications, status history) go straight to Firestore —
   the security rules let active staff and admins read every application.
   WRITES and document access go through the backend:
     - status changes     -> /api/staff/update-application-status
     - supporting PDFs    -> /api/documents/create-download-url
   so the rules ("workflow", reviewer identity, history entry) are enforced
   on the server regardless of what this file does.
   ========================================================================== */

import { db } from "./firebase.js";
import { apiPost } from "./api.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  orderBy,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

/** Every application, newest first. */
async function listApplications() {
  let snapshot;
  try {
    snapshot = await getDocs(query(collection(db, "applications"), orderBy("submittedAt", "desc")));
  } catch (error) {
    console.error("[staff] listApplications failed:", error);
    throw new Error("Could not load applications. Please try again.");
  }
  return snapshot.docs.map((d) => ({ docId: d.id, ...d.data() }));
}

/** One application. Throws NOT_FOUND / LOAD_FAILED tokens like GPApplications. */
async function getApplication(docId) {
  let snapshot;
  try {
    snapshot = await getDoc(doc(db, "applications", docId));
  } catch (error) {
    console.error("[staff] getApplication failed:", error);
    throw new Error("LOAD_FAILED");
  }
  if (!snapshot.exists()) throw new Error("NOT_FOUND");
  return { docId: snapshot.id, ...snapshot.data() };
}

/** Status history, oldest first (empty list if it cannot be read). */
async function getHistory(docId) {
  try {
    const snapshot = await getDocs(query(collection(db, "applications", docId, "statusHistory"), orderBy("timestamp", "asc")));
    return snapshot.docs.map((d) => d.data());
  } catch (error) {
    console.error("[staff] getHistory failed:", error);
    return [];
  }
}

/** status: "under_review" | "approved" | "rejected". remarks required for rejected. */
async function updateStatus(applicationDocId, status, remarks) {
  return apiPost("/api/staff/update-application-status", { applicationDocId, status, remarks });
}

/**
 * Ask the applicant for more documents. items: [{ key } | { label }] — a checklist
 * document, or one the staff member describes. The status does not change.
 */
async function requestDocuments(applicationDocId, items, message) {
  return apiPost("/api/staff/request-documents", { applicationDocId, items, message });
}

/**
 * Review ONE uploaded document: decision is "accepted" | "rejected" | "replacement_requested".
 * A reason is required for the last two; the applicant is then asked to upload a replacement.
 */
async function reviewDocument(applicationDocId, path, decision, reason) {
  return apiPost("/api/staff/request-documents", { action: "review", applicationDocId, path, decision, reason });
}

/** Short-lived signed URL for one uploaded document of any application. */
async function getDocumentUrl(applicationDocId, path) {
  const data = await apiPost("/api/documents/create-download-url", { applicationDocId, path });
  return data.url;
}

/** Counts used by the staff dashboard (computed from an already-loaded list). */
function getStats(applications) {
  const stats = { total: applications.length, submitted: 0, under_review: 0, approved: 0, rejected: 0 };
  applications.forEach((a) => {
    if (Object.prototype.hasOwnProperty.call(stats, a.status)) stats[a.status] += 1;
  });
  return stats;
}

// Logging out marks the staff member unavailable (best effort; the dashboard shell
// in components.js waits at most 2.5 s for this). If it cannot run — feature off,
// offline, tab closed — the "I Am Here" confirmation simply expires on its own.
window.GPBeforeLogout = async () => {
  try {
    await apiPost("/api/availability", { action: "set", available: false });
  } catch (_) { /* nothing useful to do on failure */ }
};

window.GPStaff = { listApplications, getApplication, getHistory, updateStatus, requestDocuments, reviewDocument, getDocumentUrl, getStats };
window.dispatchEvent(new Event("gpstaff-ready"));
