/* ==========================================================================
   POST /api/documents/create-download-url

   Mints a short-lived Supabase signed download URL for one document that
   was already uploaded and recorded on an application. Before issuing it,
   this verifies (in order):
     1. the Firebase ID token is valid and the account is active -> uid, role
     2. the application document exists in Firestore
     3. application.userId === uid (citizens), OR the caller is active
        staff/admin (reviewers)                             (authorization)
     4. the requested `path` actually appears in that
        application's documents[] array                     (not a probe)

   Request:  { applicationDocId, path }
   Response: { url, expiresIn }

   No Supabase key of any kind is ever returned to the client here — this
   call is entirely server-to-server (Admin SDK -> Firestore, service-role
   key -> Supabase), and the resulting signed URL is directly usable by
   the browser with no extra headers.
   ========================================================================== */

const { getCaller, sendAuthzError } = require("../_lib/authz");
const { getFirestore } = require("../_lib/firebaseAdmin");
const { getSupabaseAdmin, getBucket } = require("../_lib/supabaseAdmin");
const { isValidApplicationDocId, isStoragePathFor, readJsonBody } = require("../_lib/validation");

const DOWNLOAD_EXPIRES_SECONDS = 90;

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  // Authenticated + active account required (deactivated users are refused).
  let caller;
  try {
    caller = await getCaller(req);
  } catch (error) {
    return sendAuthzError(res, error);
  }
  const uid = caller.uid;
  const isReviewer = caller.role === "staff" || caller.role === "admin";

  const body = readJsonBody(req);
  if (body === null) return res.status(400).json({ error: "Invalid request." });
  const { applicationDocId, path } = body;
  if (!isValidApplicationDocId(applicationDocId) || typeof path !== "string" || !path) {
    return res.status(400).json({ error: "Invalid request." });
  }

  let appData;
  try {
    const snapshot = await getFirestore().collection("applications").doc(applicationDocId).get();
    if (!snapshot.exists) {
      return res.status(404).json({ error: "Application not found." });
    }
    appData = snapshot.data();
  } catch (error) {
    console.error("[create-download-url] Firestore lookup failed:", error);
    return res.status(500).json({ error: "Could not verify this document. Please try again." });
  }

  // Staff/admin may open documents on any application; a citizen only their own.
  if (!isReviewer && appData.userId !== uid) {
    return res.status(403).json({ error: "You are not authorized to access this document." });
  }

  const knownPaths = Array.isArray(appData.documents)
    ? appData.documents.map((d) => d && d.path).filter(Boolean)
    : [];
  if (!knownPaths.includes(path)) {
    return res.status(403).json({ error: "You are not authorized to access this document." });
  }

  // documents[] is written by the citizen, so being listed there is not proof
  // of ownership. Only serve files from THIS application's own folder under the
  // applicant's uid — never another user's file or a traversal path.
  if (!isStoragePathFor(path, appData.userId, applicationDocId)) {
    return res.status(403).json({ error: "You are not authorized to access this document." });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.storage
      .from(getBucket())
      .createSignedUrl(path, DOWNLOAD_EXPIRES_SECONDS);
    if (error || !data) throw error || new Error("No data returned from Supabase.");

    return res.status(200).json({ url: data.signedUrl, expiresIn: DOWNLOAD_EXPIRES_SECONDS });
  } catch (error) {
    console.error("[create-download-url] failed:", error);
    return res.status(500).json({ error: "Could not prepare the download. Please try again." });
  }
};
