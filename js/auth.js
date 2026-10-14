/* ==========================================================================
   auth.js — Firebase Authentication + Firestore user-profile helpers.

   This is a native ES module (loaded with <script type="module">), so it
   can `import` Firebase directly. Every existing page script is a classic
   (non-module) script, so this file exposes everything it needs through a
   single `window.GPAuth` namespace instead of ES exports.

   Responsibilities:
   - Citizen registration (Auth account + Firestore profile, role forced
     to "citizen" — never taken from the form).
   - Login (Auth sign-in + Firestore role lookup).
   - Logout.
   - Password reset email.
   - Route protection for citizen/staff pages based on Firestore role.
   - Mapping raw Firebase error codes to friendly messages.

   No application/certificate data is touched here — that is Phase 3+.
   ========================================================================== */

import { auth, db } from "./firebase.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

/* ------------------------------------------------------------------------
   Where each role lands after login (relative to the site root). The role
   comes from the Firestore profile; the browser can't choose it, and the
   backend APIs + Firestore rules enforce it independently of this redirect.
   ------------------------------------------------------------------------ */
const ROLE_HOME = {
  citizen: "citizen/dashboard.html",
  staff: "staff/dashboard.html",
  admin: "admin/dashboard.html",
};

function roleHomePath(role) {
  return ROLE_HOME[role] || null;
}

/* ------------------------------------------------------------------------
   Friendly error messages — never show a raw Firebase error code to a user.
   ------------------------------------------------------------------------ */
function friendlyAuthError(error) {
  const code = error && error.code ? error.code : "";
  const map = {
    "auth/invalid-email": "Please enter a valid email address.",
    "auth/missing-password": "Please enter your email and password.",
    "auth/user-not-found": "Invalid email or password.",
    "auth/wrong-password": "Invalid email or password.",
    "auth/invalid-credential": "Invalid email or password.",
    "auth/invalid-login-credentials": "Invalid email or password.",
    "auth/too-many-requests": "Too many attempts. Please wait a moment and try again.",
    "auth/email-already-in-use": "An account with this email already exists.",
    "auth/weak-password": "Password must be at least 8 characters.",
    "auth/network-request-failed": "Network error. Please check your connection and try again.",
    "auth/user-disabled": "This account has been disabled. Please contact the Panchayat office.",
  };
  return map[code] || "Something went wrong. Please try again.";
}

/* ------------------------------------------------------------------------
   Registration — citizens only. Role is always forced to "citizen" here;
   it is never read from the registration form. Firestore security rules
   (see firestore.rules) additionally reject any client attempt to write a
   different role, so this is enforced on both sides.
   ------------------------------------------------------------------------ */
async function registerCitizen({ name, mobile, email, password }) {
  let credential;
  try {
    credential = await createUserWithEmailAndPassword(auth, email, password);
  } catch (error) {
    throw new Error(friendlyAuthError(error));
  }

  try {
    await setDoc(doc(db, "users", credential.user.uid), {
      name,
      mobile,
      email,
      role: "citizen",
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    // The Auth account was created but the profile write failed (e.g. rules
    // rejected it, or the network dropped). Roll back so the person isn't
    // left with a half-created account they can't fully use, and surface a
    // message that won't leak Firestore internals.
    try { await credential.user.delete(); } catch (_) { /* best effort */ }
    throw new Error("Could not finish creating your account. Please try again.");
  }

  return credential.user;
}

/* ------------------------------------------------------------------------
   Fetch a user's Firestore profile (name, mobile, email, role, createdAt).
   ------------------------------------------------------------------------ */
async function getUserProfile(uid) {
  const snapshot = await getDoc(doc(db, "users", uid));
  return snapshot.exists() ? snapshot.data() : null;
}

/* ------------------------------------------------------------------------
   Save the signed-in user's own name and mobile number. firestore.rules let a
   user update their own profile but never its role or active flag.
   ------------------------------------------------------------------------ */
async function updateOwnProfile({ name, mobile }) {
  const user = auth.currentUser;
  if (!user) throw new Error("Please log in again.");
  try {
    await updateDoc(doc(db, "users", user.uid), { name: String(name).trim(), mobile: String(mobile).trim() });
  } catch (error) {
    console.error("[auth] updateOwnProfile failed:", error);
    throw new Error("Your profile could not be saved. Please try again.");
  }
}

/* ------------------------------------------------------------------------
   Login — signs in, then loads the Firestore role. Does NOT redirect;
   the calling page decides where to send the person based on the
   returned role, per its own layout (citizen login vs staff login).
   ------------------------------------------------------------------------ */
async function loginWithEmail(email, password) {
  let credential;
  try {
    credential = await signInWithEmailAndPassword(auth, email, password);
  } catch (error) {
    throw new Error(friendlyAuthError(error));
  }

  let profile;
  try {
    profile = await getUserProfile(credential.user.uid);
  } catch (error) {
    profile = null;
  }

  if (!profile) {
    // No Firestore profile exists for this account — treat as an
    // unusable login rather than guessing a role.
    await signOut(auth);
    throw new Error("Your account profile could not be found. Please contact the Panchayat office.");
  }

  if (profile.active === false) {
    await signOut(auth);
    throw new Error("This account has been deactivated. Please contact the Panchayat office.");
  }
  if (!ROLE_HOME[profile.role]) {
    await signOut(auth);
    throw new Error("Your account is not set up correctly. Please contact the Panchayat office.");
  }

  return { user: credential.user, profile };
}

/* ------------------------------------------------------------------------
   Logout — signs out, then sends the browser to `redirectUrl`.
   ------------------------------------------------------------------------ */
async function logout(redirectUrl) {
  try {
    await signOut(auth);
  } finally {
    window.location.href = redirectUrl;
  }
}

/* ------------------------------------------------------------------------
   Sign out without navigating anywhere — used when a login attempt
   succeeds against Firebase Auth but fails a role check (e.g. a citizen
   using the staff login), so the person is left signed out but still on
   the same form to see the error message.
   ------------------------------------------------------------------------ */
async function signOutOnly() {
  await signOut(auth);
}

/* ------------------------------------------------------------------------
   Password reset.
   ------------------------------------------------------------------------ */
async function sendPasswordReset(email) {
  try {
    await sendPasswordResetEmail(auth, email);
  } catch (error) {
    throw new Error(friendlyAuthError(error));
  }
}

/* ------------------------------------------------------------------------
   Resolve the current auth state exactly once (used to redirect an
   already-logged-in person away from login/register pages, and as the
   basis for protectPage below).
   ------------------------------------------------------------------------ */
function onceAuthState() {
  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      resolve(user);
    });
  });
}

/* ------------------------------------------------------------------------
   Route protection for citizen/staff pages.

   requiredRole: "citizen" | "staff"
   options.loginUrl: where to send an unauthenticated visitor
   options.otherRoleUrl: where to send an authenticated visitor whose role
                          does not match requiredRole (their own dashboard)

   Resolves with { user, profile } only when the visitor is authenticated
   AND holds the required role. Otherwise it redirects and the returned
   promise never resolves (the page is navigating away).
   ------------------------------------------------------------------------ */
async function protectPage(requiredRole, { loginUrl, otherRoleUrl }) {
  // If the person arrives here via the back/forward cache after logging
  // out, force a fresh reload so this guard runs again against the real
  // (signed-out) auth state instead of showing a cached protected page.
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) window.location.reload();
  });

  const user = await onceAuthState();
  if (!user) {
    window.location.href = loginUrl;
    return new Promise(() => {}); // never resolves — page is navigating away
  }

  let profile;
  try {
    profile = await getUserProfile(user.uid);
  } catch (error) {
    profile = null;
  }

  if (profile && profile.active === false) {
    await signOut(auth);
    window.location.href = loginUrl;
    return new Promise(() => {});
  }

  if (!profile || profile.role !== requiredRole) {
    window.location.href = profile && profile.role && otherRoleUrl ? otherRoleUrl : loginUrl;
    return new Promise(() => {});
  }

  return { user, profile };
}

/* ------------------------------------------------------------------------
   If someone who is already logged in lands on a login/register page,
   send them straight to the right dashboard instead of showing the form.
   ------------------------------------------------------------------------ */
async function redirectIfAlreadyLoggedIn({ citizenUrl, staffUrl, adminUrl }) {
  const user = await onceAuthState();
  if (!user) return;
  const profile = await getUserProfile(user.uid).catch(() => null);
  if (!profile) return;
  if (profile.active === false) { await signOut(auth); return; }
  if (profile.role === "citizen" && citizenUrl) window.location.href = citizenUrl;
  if (profile.role === "staff" && staffUrl) window.location.href = staffUrl;
  if (profile.role === "admin" && adminUrl) window.location.href = adminUrl;
}

window.GPAuth = {
  registerCitizen,
  loginWithEmail,
  logout,
  signOutOnly,
  sendPasswordReset,
  getUserProfile,
  updateOwnProfile,
  protectPage,
  redirectIfAlreadyLoggedIn,
  roleHomePath,
  friendlyAuthError,
};

// Signal to classic scripts (which load before this module finishes
// evaluating) that window.GPAuth is now ready to use.
window.dispatchEvent(new Event("gpauth-ready"));
