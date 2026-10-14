/* ==========================================================================
   POST /api/admin/update-user           (admin only)

   Changes one user's active status or role.

   Request:  { uid, active?: boolean, role?: "staff" | "citizen" }
   Response: { ok: true }

   Guardrails (server-side, not just hidden buttons):
   - an admin can never change their own account
   - admin accounts cannot be changed here at all (and "admin" is not an
     assignable role), so this endpoint cannot create, demote or lock out
     an admin
   - deactivating also disables the Firebase Auth account and revokes the
     user's refresh tokens, so existing sessions stop working
   ========================================================================== */

const { getAuth } = require("firebase-admin/auth");
const { FieldValue } = require("firebase-admin/firestore");
const { requireRole, sendAuthzError } = require("../_lib/authz");
const { getFirebaseAdmin, getFirestore } = require("../_lib/firebaseAdmin");
const { isValidUid, readJsonBody } = require("../_lib/validation");

const ASSIGNABLE_ROLES = ["staff", "citizen"];

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  let caller;
  try {
    caller = await requireRole(req, ["admin"]);
  } catch (error) {
    return sendAuthzError(res, error);
  }

  const body = readJsonBody(req);
  if (body === null) return res.status(400).json({ error: "Invalid request." });
  const { uid, active, role } = body;
  if (!isValidUid(uid)) return res.status(400).json({ error: "Invalid request." });
  if (active === undefined && role === undefined) return res.status(400).json({ error: "Nothing to change." });
  if (active !== undefined && typeof active !== "boolean") return res.status(400).json({ error: "Invalid request." });
  if (role !== undefined && !ASSIGNABLE_ROLES.includes(role)) return res.status(400).json({ error: "Invalid role." });

  if (uid === caller.uid) {
    return res.status(403).json({ error: "You cannot change your own account." });
  }

  const ref = getFirestore().collection("users").doc(uid);
  let target;
  try {
    const snapshot = await ref.get();
    if (!snapshot.exists) return res.status(404).json({ error: "User not found." });
    target = snapshot.data();
  } catch (error) {
    console.error("[update-user] lookup failed:", error.message);
    return res.status(500).json({ error: "Could not update the user. Please try again." });
  }

  if (target.role === "admin") {
    return res.status(403).json({ error: "Admin accounts cannot be changed here." });
  }

  const update = { updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid };
  if (role !== undefined) update.role = role;
  if (active !== undefined) update.active = active;

  const auth = getAuth(getFirebaseAdmin());
  try {
    if (active !== undefined) {
      await auth.updateUser(uid, { disabled: !active });
      if (!active) await auth.revokeRefreshTokens(uid);
    }
    await ref.update(update);
  } catch (error) {
    console.error("[update-user] failed:", error.code || error.message);
    return res.status(500).json({ error: "Could not update the user. Please try again." });
  }

  return res.status(200).json({ ok: true });
};
