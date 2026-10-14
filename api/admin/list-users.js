/* ==========================================================================
   POST /api/admin/list-users            (admin only)

   Returns every user profile (up to 500) for the admin Users / Staff pages.
   Search and role filtering happen in the browser on this list — the
   project is small, and this keeps the endpoint trivial to reason about.

   Response: { users: [{ uid, name, email, mobile, role, active, createdAt }] }
   ========================================================================== */

const { requireRole, sendAuthzError } = require("../_lib/authz");
const { getFirestore } = require("../_lib/firebaseAdmin");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    await requireRole(req, ["admin"]);
  } catch (error) {
    return sendAuthzError(res, error);
  }

  try {
    const snapshot = await getFirestore().collection("users").limit(500).get();
    const users = snapshot.docs.map((d) => {
      const data = d.data();
      return {
        uid: d.id,
        name: data.name || "",
        email: data.email || "",
        mobile: data.mobile || "",
        role: data.role || "",
        active: data.active !== false,
        createdAt: data.createdAt && data.createdAt.toMillis ? data.createdAt.toMillis() : null,
      };
    });
    return res.status(200).json({ users });
  } catch (error) {
    console.error("[list-users] failed:", error.message);
    return res.status(500).json({ error: "Could not load users. Please try again." });
  }
};
