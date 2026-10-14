/* ==========================================================================
   api/_lib/firebaseAdmin.js — Firebase Admin SDK, server-side only.

   Used by the /api/documents/* functions to:
   - verify the Firebase ID token sent by the browser (Authorization: Bearer)
   - read Firestore `applications/{id}` documents to check ownership

   Never imported by any frontend file. Requires FIREBASE_SERVICE_ACCOUNT_KEY
   (a JSON service-account key, stored as a single-line string) to be set as
   a Vercel environment variable.
   ========================================================================== */

const { initializeApp, getApps, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore: getAdminFirestore } = require("firebase-admin/firestore");

let cachedApp = null;

function getServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_KEY is not configured.");
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_KEY is not valid JSON.");
  }
}

/** Cached across warm Lambda invocations — avoids re-initializing on every request. */
function getFirebaseAdmin() {
  if (!cachedApp) {
    cachedApp = getApps()[0] || initializeApp({ credential: cert(getServiceAccount()) });
  }
  return cachedApp;
}

/**
 * Verifies the Authorization: Bearer <idToken> header on an incoming request.
 * Returns the decoded token (includes `.uid`) on success.
 * Throws an Error with `.statusCode` set on failure — callers should catch
 * this and respond with a generic, friendly message (never leak Firebase's
 * raw error text to the client).
 */
async function verifyIdToken(req) {
  const header = req.headers["authorization"] || req.headers["Authorization"];
  if (!header) {
    throw authError("missing-header", 401);
  }
  if (typeof header !== "string" || !header.startsWith("Bearer ")) {
    throw authError("malformed-header", 401);
  }
  const idToken = header.slice("Bearer ".length).trim();
  if (!idToken) {
    throw authError("empty-token", 401);
  }

  // Server misconfiguration (bad/missing service account) is NOT the user's
  // fault, so it must surface as a 500, not a misleading 401.
  let adminAuth;
  try {
    adminAuth = getAuth(getFirebaseAdmin());
  } catch (error) {
    console.error("[auth] Firebase Admin init failed:", error.message);
    throw authError("admin-init-failed", 500);
  }

  try {
    return await adminAuth.verifyIdToken(idToken);
  } catch (error) {
    // error.code is a safe short string like "auth/id-token-expired"; the
    // message can echo token details, so it is never logged.
    const code = error && error.code ? error.code : "unknown";
    console.warn("[auth] ID token rejected:", code);
    throw authError(code, 401);
  }
}

function authError(reason, statusCode) {
  const err = new Error(reason);
  err.reason = reason;
  err.statusCode = statusCode;
  return err;
}

function getFirestore() {
  return getAdminFirestore(getFirebaseAdmin());
}

module.exports = { getFirebaseAdmin, verifyIdToken, getFirestore };
