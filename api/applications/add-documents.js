/* ==========================================================================
   POST /api/applications/add-documents        (the application's own citizen)

   Attaches documents the citizen uploaded in answer to a staff request — extra
   documents, or a REPLACEMENT for a document staff rejected. Firestore rules forbid
   client updates to an application, so this is the only way documents are added
   after submission.

   Request:  { applicationDocId, documents: [ { docType, name, path, ... } ] }
   Response: { ok: true, documentRequest }

   Checked here, never trusted from the browser:
     - the caller owns the application, and it has an OPEN request that is still
       waiting for each of these document types; the application is still open
     - every docType is an outstanding item of that request, once per call
     - every path is this applicant's file for THIS application AND carries the same
       docType; the file exists in private storage, is an allowed type and <= 5 MB;
       one stored file cannot fill two items (api/_lib/documents.js)
   A replacement keeps the old file for the record, marks it "superseded", and starts
   the new one as "pending" review. When every requested item has a document, the
   request closes. File CONTENTS are not inspected — staff must check them.
   ========================================================================== */

const { FieldValue } = require("firebase-admin/firestore");
const { getCaller, sendAuthzError } = require("../_lib/authz");
const { getFirestore } = require("../_lib/firebaseAdmin");
const { verifyUploadedDocuments, DocumentError } = require("../_lib/documents");
const { isValidApplicationDocId, readJsonBody } = require("../_lib/validation");

const MAX_PER_CALL = 10;
const MAX_DOCUMENTS = 30;

class ConflictError extends Error {}
class NotFoundError extends Error {}
class ForbiddenError extends Error {}

/** Throws unless `app` is the caller's, open, and has an open request. */
function assertOpenRequest(app, uid) {
  if (!app) throw new NotFoundError();
  if (app.userId !== uid) throw new ForbiddenError();
  const request = app.documentRequest;
  if (!request || request.open !== true || !Array.isArray(request.items)) throw new ConflictError();
  if (app.status !== "submitted" && app.status !== "under_review") throw new ConflictError();
  return request;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  let caller;
  try {
    caller = await getCaller(req);
  } catch (error) {
    return sendAuthzError(res, error);
  }

  const body = readJsonBody(req);
  if (body === null) return res.status(400).json({ error: "Invalid request." });
  const { applicationDocId, documents } = body;
  if (!isValidApplicationDocId(applicationDocId)) return res.status(400).json({ error: "Invalid request." });
  if (!Array.isArray(documents) || documents.length < 1 || documents.length > MAX_PER_CALL) {
    return res.status(400).json({ error: "Choose at least one document to upload." });
  }

  const db = getFirestore();
  const appRef = db.collection("applications").doc(applicationDocId);

  const refusal = (error) => {
    if (error instanceof NotFoundError) return res.status(404).json({ error: "Application not found." });
    if (error instanceof ForbiddenError) return res.status(403).json({ error: "You do not have permission to do this." });
    if (error instanceof ConflictError) return res.status(409).json({ error: "No documents are being requested for this application right now." });
    if (error instanceof DocumentError) return res.status(error.statusCode || 400).json({ error: error.userMessage });
    return null;
  };

  // 1) read + verify the files (the storage check must not run inside the transaction)
  let verified;
  try {
    const snapshot = await appRef.get();
    const app = snapshot.exists ? snapshot.data() : null;
    const request = assertOpenRequest(app, caller.uid);
    verified = await verifyUploadedDocuments({
      uid: caller.uid,
      applicationDocId,
      serviceType: app.serviceType,
      documents,
      resolveItem: (docType) => {
        const item = request.items.find((i) => i && i.key === docType && i.done !== true);
        return item ? { key: item.key, label: item.label } : null;
      },
      existingPaths: (Array.isArray(app.documents) ? app.documents : []).map((d) => d && d.path).filter(Boolean),
    });
    if ((Array.isArray(app.documents) ? app.documents.length : 0) + verified.length > MAX_DOCUMENTS) throw new DocumentError("This application has too many documents.");
  } catch (error) {
    const r = refusal(error);
    if (r) return r;
    console.error("[add-documents] failed:", error && error.message);
    return res.status(500).json({ error: "Could not save the documents. Please try again." });
  }

  // 2) write, re-checking everything against the current state
  let saved;
  try {
    await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(appRef);
      const app = snapshot.exists ? snapshot.data() : null;
      const request = assertOpenRequest(app, caller.uid);
      const existing = Array.isArray(app.documents) ? app.documents : [];
      const types = new Set(verified.map((v) => v.docType));
      if (!verified.every((v) => request.items.some((i) => i && i.key === v.docType && i.done !== true))) throw new ConflictError();

      // a replacement supersedes the earlier file(s) of the same document type, keeping them for the record
      const kept = existing.map((d) => (d && types.has(d.docType) && d.superseded !== true ? { ...d, superseded: true } : d));
      const added = verified.map((v) => ({ ...v, addedAfterRequest: true }));

      const items = request.items.map((i) => (i && types.has(i.key) ? { ...i, done: true } : i));
      const stillOpen = items.some((i) => i && i.done !== true);
      const documentRequest = { ...request, items, open: stillOpen };
      if (!stillOpen) documentRequest.fulfilledAt = FieldValue.serverTimestamp();

      tx.update(appRef, { documents: [...kept, ...added], documentRequest, updatedAt: FieldValue.serverTimestamp() });
      tx.set(appRef.collection("statusHistory").doc(), {
        status: app.status,
        remarks: `Applicant uploaded the requested documents: ${added.map((s) => s.docLabel).join("; ")}.${stillOpen ? "" : " All requested documents have been provided."}`,
        timestamp: FieldValue.serverTimestamp(),
        updatedBy: caller.uid,
        updatedByName: app.applicantName || "",
        kind: "documents_uploaded",
      });
      saved = { open: stillOpen, items };
    });
  } catch (error) {
    const r = refusal(error);
    if (r) return r;
    console.error("[add-documents] failed:", error && error.message);
    return res.status(500).json({ error: "Could not save the documents. Please try again." });
  }

  return res.status(200).json({ ok: true, documentRequest: saved });
};
