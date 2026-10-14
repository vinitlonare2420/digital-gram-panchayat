/* ==========================================================================
   POST /api/documents/create-upload-url

   Mints a short-lived Supabase signed upload URL for one supporting
   document on one certificate application. The browser never talks to
   Supabase with any long-lived credential — this is the only thing that
   authorizes the upload, and it authorizes exactly one object path.

   Everything that matters for security is decided HERE, not trusted from
   the request body:
     - uid            comes ONLY from the verified Firebase ID token
     - serviceType    checked against a fixed allow-list
     - fileType/size  checked against a fixed allow-list / 5MB cap
     - docType        must be a document on that service's checklist (new
                      application) or one staff asked for (existing application)
     - filename       sanitized before use
     - uuid           generated server-side (crypto.randomUUID)
     - storage path   built server-side as
                       applications/{uid}/{applicationDocId}/{uuid}-{docType}__{name}

   Request:  { applicationDocId, serviceType, docType, fileName, fileType, fileSize }
   Response: { path, signedUrl, token, apikey }

   `apikey` is the Supabase anon/publishable key (safe to expose — it does
   not grant Storage access on its own since this bucket has no public
   policies; the one-time `token` embedded in `signedUrl` is what actually
   authorizes this specific upload). It is returned here, not shipped in
   any frontend bundle, because Supabase's API gateway requires an `apikey`
   header on every Storage request even when a signed upload token is
   present — see the note in the Phase 4 implementation plan for why this
   is technically required despite the "no anon key in the frontend" rule.
   ========================================================================== */

const crypto = require("crypto");
const { getCaller, sendAuthzError } = require("../_lib/authz");
const { getSupabaseAdmin, getBucket } = require("../_lib/supabaseAdmin");
const { getFirestore } = require("../_lib/firebaseAdmin");
const DocumentChecklists = require("../_lib/documentChecklists");
const {
  isValidDocType,
  isValidApplicationDocId,
  isAllowedServiceType,
  isAllowedMimeType,
  isAllowedFileSize,
  sanitizeFilename,
  readJsonBody,
} = require("../_lib/validation");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  // Authenticated + active account required (a deactivated account is refused
  // immediately, even while its last ID token is still technically valid).
  let uid;
  try {
    uid = (await getCaller(req)).uid;
  } catch (error) {
    return sendAuthzError(res, error);
  }

  const body = readJsonBody(req);
  if (body === null) return res.status(400).json({ error: "Invalid request." });
  const { applicationDocId, serviceType, docType, fileName, fileType, fileSize } = body;

  if (!isValidApplicationDocId(applicationDocId)) {
    return res.status(400).json({ error: "Invalid request." });
  }
  if (!isAllowedServiceType(serviceType)) {
    return res.status(400).json({ error: "Invalid request." });
  }
  if (!isValidDocType(docType)) {
    return res.status(400).json({ error: "Invalid request." });
  }

  // Which document is this allowed to be?
  //   - the application does not exist yet (first submission): it must be on the checklist
  //     of the service being applied for;
  //   - the application exists (adding documents later): it must be the caller's own, and
  //     staff must have asked for exactly this document and it must still be outstanding.
  let existing;
  try {
    const snapshot = await getFirestore().collection("applications").doc(applicationDocId).get();
    existing = snapshot.exists ? snapshot.data() : null;
  } catch (error) {
    console.error("[create-upload-url] Firestore lookup failed:", error.message);
    return res.status(500).json({ error: "Could not prepare the upload. Please try again." });
  }
  if (existing) {
    if (existing.userId !== uid) return res.status(403).json({ error: "You do not have permission to do this." });
    const request = existing.documentRequest;
    const wanted = request && request.open === true && Array.isArray(request.items)
      && request.items.some((i) => i && i.key === docType && i.done !== true);
    if (!wanted) return res.status(400).json({ error: "That document has not been requested for this application." });
  } else if (!DocumentChecklists.findItem(serviceType, docType)) {
    return res.status(400).json({ error: "That document is not part of this service's checklist." });
  }

  if (!isAllowedMimeType(fileType)) {
    return res.status(400).json({ error: "Only PDF, JPG, JPEG or PNG files are allowed." });
  }
  if (!isAllowedFileSize(fileSize)) {
    return res.status(400).json({ error: "File must be smaller than 5 MB." });
  }

  const safeName = sanitizeFilename(fileName);
  const uuid = crypto.randomUUID();
  const path = `applications/${uid}/${applicationDocId}/${uuid}-${docType}__${safeName}`;

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.storage.from(getBucket()).createSignedUploadUrl(path);
    if (error || !data) throw error || new Error("No data returned from Supabase.");

    return res.status(200).json({
      path: data.path,
      signedUrl: data.signedUrl,
      token: data.token,
      apikey: process.env.SUPABASE_ANON_KEY || "",
    });
  } catch (error) {
    console.error("[create-upload-url] failed:", error);
    return res.status(500).json({ error: "Could not prepare the upload. Please try again." });
  }
};
