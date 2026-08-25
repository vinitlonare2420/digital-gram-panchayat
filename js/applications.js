/* ==========================================================================
   applications.js — Cloud Firestore helpers for citizen certificate
   applications (Phase 3).

   Native ES module (loaded with <script type="module">), imports Firebase
   directly from ./firebase.js (no duplicate initialization — see that file
   and js/auth.js, which already own Firebase App/Auth/Firestore setup).
   Exposes everything through window.GPApplications for the existing
   classic <script> blocks on each page, same pattern as js/auth.js's
   window.GPAuth.

   Responsibilities:
   - Generate a human-friendly, high-entropy Application ID.
   - Create an application document (+ its first statusHistory entry).
   - List the signed-in citizen's own applications.
   - Fetch a single application, enforcing ownership.
   - Compute dashboard stats from a list of applications.
   - Read an application's status history.

   Nothing here trusts identity fields from a form. userId always comes
   from `auth.currentUser.uid`; applicantName/email/mobile come from the
   user's own Firestore profile (users/{uid}) and Firebase Auth, never
   from form input. Status is always hardcoded to "submitted" — there is
   no code path here that lets a citizen write any other status.

   Staff processing (approve/reject/correction/certificate upload) is
   Phase 5 and does not exist in this file.
   ========================================================================== */

import { auth, db } from "./firebase.js";
import {
  collection,
  addDoc,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

/* ------------------------------------------------------------------------
   Application ID generation.

   Format: GP-<year>-<8 random characters>, e.g. GP-2026-7K3M9QXD

   Alphabet excludes 0/O and 1/I to avoid visual ambiguity when an
   applicant reads the ID aloud or copies it by hand. Characters are drawn
   with the Web Crypto API (crypto.getRandomValues), not Math.random(), so
   this is a real random identifier rather than a predictable counter like
   APP001/APP002.

   Why no "is this ID already taken?" database check: our Firestore
   security rules correctly stop a citizen from reading any application
   that isn't their own (see firestore.rules), so a query across ALL
   citizens' applications to check for a collision is not something this
   client is allowed to run — and shouldn't be, that would be a privacy
   hole. Instead we rely on the ID space being large enough that a
   collision is not a practical concern: 8 characters from a 32-character
   alphabet is 32^8 ≈ 1.1 trillion combinations per year. That is treated
   as "sufficiently unique" per the brief, rather than database-guaranteed
   unique.
   ------------------------------------------------------------------------ */
function generateApplicationId() {
  const year = new Date().getFullYear();
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
  const randomValues = new Uint32Array(8);
  crypto.getRandomValues(randomValues);
  let suffix = "";
  for (let i = 0; i < 8; i++) suffix += alphabet[randomValues[i] % alphabet.length];
  return `GP-${year}-${suffix}`;
}

/* ------------------------------------------------------------------------
   Internal: load the current user's own profile (name/mobile) so
   applicantName/applicantMobile can be filled in from a trusted source
   instead of the form.
   ------------------------------------------------------------------------ */
async function getOwnProfile(uid) {
  const snapshot = await getDoc(doc(db, "users", uid));
  return snapshot.exists() ? snapshot.data() : null;
}

/* ------------------------------------------------------------------------
   Create an application.

   params:
     serviceType  — short key, e.g. "birth" | "death" | "income" | "caste"
     serviceName  — display name, e.g. "Birth Certificate"
     formData     — plain object of the service-specific fields
     documents    — array of { name, type, size } file METADATA only
                    (no file bytes — Firebase Storage is Phase 4)

   Returns { docId, applicationId } on success. Throws an Error whose
   .message is already a friendly, user-facing string — callers can show
   it directly (no raw Firebase error ever reaches the UI from here).
   ------------------------------------------------------------------------ */
async function createApplication({ serviceType, serviceName, formData, documents }) {
  const user = auth.currentUser;
  if (!user) {
    throw new Error("Please log in to submit your application.");
  }

  const profile = await getOwnProfile(user.uid).catch(() => null);
  if (!profile) {
    throw new Error("Your account profile could not be found. Please contact the Panchayat office.");
  }

  const applicationId = generateApplicationId();

  const payload = {
    applicationId,
    userId: user.uid,                    // trusted identity — never from the form
    applicantName: profile.name || "",   // trusted — from users/{uid}, never from the form
    applicantEmail: user.email || "",    // trusted — from Firebase Auth, never from the form
    applicantMobile: profile.mobile || "", // trusted — from users/{uid}, never from the form
    serviceType,
    serviceName,
    status: "submitted",                 // always this on create — never accepted from the form
    submittedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    remarks: "",
    formData: formData || {},
    documents: documents || [],
  };

  let docRef;
  try {
    docRef = await addDoc(collection(db, "applications"), payload);
  } catch (error) {
    console.error("[applications] createApplication failed:", error);
    throw new Error("Your application could not be submitted. Please try again.");
  }

  // Best-effort first status history entry. If this write fails the
  // application itself still exists and was submitted successfully — we
  // don't fail the whole submission over a history log entry.
  try {
    await addDoc(collection(db, "applications", docRef.id, "statusHistory"), {
      status: "submitted",
      remarks: "",
      timestamp: serverTimestamp(),
    });
  } catch (error) {
    console.error("[applications] initial statusHistory write failed (non-fatal):", error);
  }

  return { docId: docRef.id, applicationId };
}

/* ------------------------------------------------------------------------
   List the signed-in citizen's own applications, newest first.

   The where("userId","==", ...) clause is what lets Firestore security
   rules (resource.data.userId == request.auth.uid) approve this as a
   "list" query — the query itself proves every possible result document
   belongs to the caller. Without that clause the rules would reject the
   query outright, by design.
   ------------------------------------------------------------------------ */
async function getMyApplications() {
  const user = auth.currentUser;
  if (!user) throw new Error("Please log in to view your applications.");

  const q = query(
    collection(db, "applications"),
    where("userId", "==", user.uid),
    orderBy("submittedAt", "desc")
  );

  let snapshot;
  try {
    snapshot = await getDocs(q);
  } catch (error) {
    console.error("[applications] getMyApplications failed:", error);
    throw new Error("Could not load your applications. Please try again.");
  }

  return snapshot.docs.map((d) => ({ docId: d.id, ...d.data() }));
}

/* ------------------------------------------------------------------------
   Fetch a single application by its Firestore document ID, enforcing
   ownership. Throws an Error with one of these .message tokens so the
   calling page can show the exact copy the brief asks for:

     "UNAUTHORIZED" — exists, but belongs to someone else
     "NOT_FOUND"    — no such document
     "LOAD_FAILED"  — network/Firestore error other than the above

   (These are deliberately plain tokens rather than full sentences so
   every page can phrase the final message consistently with its own
   surrounding UI copy.)
   ------------------------------------------------------------------------ */
async function getApplication(docId) {
  const user = auth.currentUser;
  if (!user) throw new Error("UNAUTHORIZED");

  let snapshot;
  try {
    snapshot = await getDoc(doc(db, "applications", docId));
  } catch (error) {
    // Firestore rules reject reads of another user's document outright,
    // which surfaces here as a permission-denied error rather than a
    // successful read of someone else's data.
    if (error && error.code === "permission-denied") throw new Error("UNAUTHORIZED");
    console.error("[applications] getApplication failed:", error);
    throw new Error("LOAD_FAILED");
  }

  if (!snapshot.exists()) throw new Error("NOT_FOUND");

  const data = { docId: snapshot.id, ...snapshot.data() };
  if (data.userId !== user.uid) throw new Error("UNAUTHORIZED"); // defense in depth
  return data;
}

/* ------------------------------------------------------------------------
   Read an application's status history subcollection, oldest first.
   Returns an empty array on failure rather than throwing, since this is
   supplementary detail for the details page, not the main content.
   ------------------------------------------------------------------------ */
async function getStatusHistory(docId) {
  if (!auth.currentUser) return [];
  try {
    const q = query(
      collection(db, "applications", docId, "statusHistory"),
      orderBy("timestamp", "asc")
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map((d) => d.data());
  } catch (error) {
    console.error("[applications] getStatusHistory failed:", error);
    return [];
  }
}

/* ------------------------------------------------------------------------
   Compute dashboard counts from an already-fetched list of applications
   (no extra Firestore reads — reuses getMyApplications' result).
   Keys match the STATUS_META keys in utils.js so both stay in sync.
   ------------------------------------------------------------------------ */
function getApplicationStats(applications) {
  const stats = {
    total: applications.length,
    submitted: 0,
    under_verification: 0,
    under_review: 0,
    correction_required: 0,
    approved: 0,
    rejected: 0,
  };
  applications.forEach((app) => {
    if (Object.prototype.hasOwnProperty.call(stats, app.status)) {
      stats[app.status] += 1;
    }
  });
  return stats;
}

window.GPApplications = {
  generateApplicationId,
  createApplication,
  getMyApplications,
  getApplication,
  getStatusHistory,
  getApplicationStats,
};

// Signal to classic scripts (which run before this module finishes
// evaluating) that window.GPApplications is now ready to use.
window.dispatchEvent(new Event("gpapplications-ready"));
