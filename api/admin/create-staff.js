/* ==========================================================================
   POST /api/admin/create-staff          (admin only)

   Provisions a new STAFF account: a Firebase Auth user plus users/{uid}
   with role "staff". The role is fixed here on the server — the request
   body has no role field, so this endpoint can never create an admin.
   Admins are created only by scripts/create-first-admin.js.

   Request:  { name, email, mobile?, password }   (password = temporary)
   Response: { uid }
   ========================================================================== */

const { getAuth } = require("firebase-admin/auth");
const { FieldValue } = require("firebase-admin/firestore");
const { requireRole, sendAuthzError } = require("../_lib/authz");
const { getFirebaseAdmin, getFirestore } = require("../_lib/firebaseAdmin");
const { validateStaffInput, readJsonBody } = require("../_lib/validation");

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
  const problem = validateStaffInput(body);
  if (problem) return res.status(400).json({ error: problem });

  const name = body.name.trim();
  const email = body.email.trim().toLowerCase();
  const mobile = body.mobile ? body.mobile.trim() : "";

  const auth = getAuth(getFirebaseAdmin());
  let created;
  try {
    created = await auth.createUser({ email, password: body.password, displayName: name });
  } catch (error) {
    if (error.code === "auth/email-already-exists") {
      return res.status(409).json({ error: "An account with this email already exists." });
    }
    if (error.code === "auth/invalid-password" || error.code === "auth/invalid-email") {
      return res.status(400).json({ error: "The email or password was not accepted." });
    }
    console.error("[create-staff] createUser failed:", error.code || error.message);
    return res.status(500).json({ error: "Could not create the staff account. Please try again." });
  }

  try {
    await getFirestore().collection("users").doc(created.uid).set({
      name,
      email,
      mobile,
      role: "staff",
      active: true,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: caller.uid,
    });
  } catch (error) {
    // Do not leave a login that has no profile behind.
    console.error("[create-staff] profile write failed:", error.message);
    try { await auth.deleteUser(created.uid); } catch (_) { /* best effort */ }
    return res.status(500).json({ error: "Could not create the staff account. Please try again." });
  }

  return res.status(200).json({ uid: created.uid });
};
