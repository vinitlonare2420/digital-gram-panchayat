/* ==========================================================================
   api.js — tiny helper for calling our own /api functions as the signed-in
   user (Phase 5). ES module, shared by admin.js and staff.js.

   Sends the Firebase ID token as `Authorization: Bearer …`. The server
   decides what that user may do (api/_lib/authz.js) — nothing here grants
   any permission.
   ========================================================================== */

import { auth } from "./firebase.js";

/**
 * POSTs JSON to `path` and returns the parsed JSON body.
 * Throws an Error whose message is safe to show to the user.
 */
export async function apiPost(path, body = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error("Please log in again.");
  const idToken = await user.getIdToken();

  let response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new Error("Could not reach the server. Please check your connection and try again.");
  }

  let data = null;
  try { data = await response.json(); } catch (_) { /* non-JSON error page */ }

  if (!response.ok) {
    throw new Error((data && typeof data.error === "string" && data.error) || "Something went wrong. Please try again.");
  }
  return data;
}
