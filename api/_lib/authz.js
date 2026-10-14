/* ==========================================================================
   api/_lib/authz.js — role-based authorization for the /api functions.

   Authentication (who are you?) is verifyIdToken() in firebaseAdmin.js.
   This file adds authorization (what may you do?):

     1. verify the Firebase ID token            -> uid
     2. load users/{uid} from Firestore          -> role, active
     3. reject unless the account is active and holds an allowed role

   The role is read from Firestore on EVERY request (not from the token), so
   deactivating or demoting someone takes effect immediately instead of when
   their current ID token expires. Roles are never taken from the request.
   ========================================================================== */

const { verifyIdToken, getFirestore } = require("./firebaseAdmin");

const ROLES = ["citizen", "staff", "admin"];

function authzError(reason, statusCode) {
  const err = new Error(reason);
  err.reason = reason;
  err.statusCode = statusCode;
  return err;
}

/**
 * Returns { uid, email, role, profile } for an authenticated, active user.
 * Throws an error with .statusCode: 401 (not logged in), 403 (no profile or
 * deactivated), 500 (Firestore unavailable).
 */
async function getCaller(req) {
  const decoded = await verifyIdToken(req);

  let snapshot;
  try {
    snapshot = await getFirestore().collection("users").doc(decoded.uid).get();
  } catch (error) {
    console.error("[authz] profile lookup failed:", error.message);
    throw authzError("profile-lookup-failed", 500);
  }

  if (!snapshot.exists) throw authzError("no-profile", 403);
  const profile = snapshot.data();
  if (profile.active === false) throw authzError("inactive", 403);
  if (!ROLES.includes(profile.role)) throw authzError("unknown-role", 403);

  return { uid: decoded.uid, email: decoded.email || profile.email || "", role: profile.role, profile };
}

/** Like getCaller, but also requires the role to be one of `allowedRoles`. */
async function requireRole(req, allowedRoles) {
  const caller = await getCaller(req);
  if (!allowedRoles.includes(caller.role)) {
    console.warn("[authz] role", caller.role, "denied");
    throw authzError("forbidden", 403);
  }
  return caller;
}

/** Sends a safe, generic response for an error thrown by getCaller/requireRole. */
function sendAuthzError(res, error) {
  const status = error && error.statusCode ? error.statusCode : 500;
  const messages = {
    401: "Please log in again.",
    403: "You do not have permission to do this.",
  };
  return res.status(status).json({ error: messages[status] || "Service is not available. Please try again later." });
}

module.exports = { ROLES, getCaller, requireRole, sendAuthzError };
