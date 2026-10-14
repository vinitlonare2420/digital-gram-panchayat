/* ==========================================================================
   POST /api/documents/cleanup-upload

   Best-effort deletion of a Supabase object that was uploaded but never
   made it into an application document (e.g. the Firestore write in
   createApplication() failed right after a successful upload). This is
   called by the frontend as a "fire and forget, don't let this cause a
   second error" cleanup step.

   Because the application document doesn't exist at this point in the
   flow, ownership can only be checked by folder convention: the path must
   fall under this user's own `applications/{uid}/` prefix. That's exactly
   the guarantee create-upload-url already gave when it built the path, so
   this is a defense-in-depth check, not the primary authorization.

   Request:  { path }
   Response: always 200 { ok: true } — failures are logged server-side
             only, and never surfaced to the client as a second error on
             top of whatever caused the cleanup to be needed in the first
             place.
   ========================================================================== */

const { getCaller } = require("../_lib/authz");
const { getFirestore } = require("../_lib/firebaseAdmin");
const { getSupabaseAdmin, getBucket } = require("../_lib/supabaseAdmin");
const { isValidApplicationDocId, isStoragePathFor, readJsonBody } = require("../_lib/validation");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  let uid;
  try {
    uid = (await getCaller(req)).uid;
  } catch (error) {
    // Best-effort endpoint — even an auth failure resolves 200 so the
    // caller never has to handle a second error state for a cleanup call.
    return res.status(200).json({ ok: true });
  }

  // Only  applications/{this user}/{applicationDocId}/{file}  — exactly four
  // segments, so no ".." traversal and no other user's folder.
  const { path } = readJsonBody(req) || {};
  const applicationDocId = typeof path === "string" ? path.split("/")[2] : undefined;
  if (!isValidApplicationDocId(applicationDocId) || !isStoragePathFor(path, uid, applicationDocId)) {
    return res.status(200).json({ ok: true });
  }

  // Never delete a file that is already attached to an application: after a
  // successful submission the document is evidence, and a citizen must not be
  // able to remove it. If the lookup fails we fail closed (delete nothing).
  try {
    const snapshot = await getFirestore().collection("applications").doc(applicationDocId).get();
    const attached = snapshot.exists && Array.isArray(snapshot.data().documents)
      && snapshot.data().documents.some((d) => d && d.path === path);
    if (attached) return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("[cleanup-upload] could not check attachment, skipping delete:", error.message);
    return res.status(200).json({ ok: true });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.storage.from(getBucket()).remove([path]);
    if (error) {
      console.error("[cleanup-upload] Supabase remove failed:", error);
    }
  } catch (error) {
    console.error("[cleanup-upload] unexpected failure:", error);
  }

  return res.status(200).json({ ok: true });
};
