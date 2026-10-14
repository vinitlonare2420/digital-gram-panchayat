/* ==========================================================================
   POST /api/staff/request-documents      (active staff or admin)

   Staff ask the applicant for missing documents. The request is stored on the
   application (documentRequest) and appended to its status history, so the
   citizen sees it on their application page and can upload the documents there.
   The application's STATUS does not change.

   Also: { action: "review", applicationDocId, path, decision, reason? } — staff accept,
   reject, or ask for a replacement of ONE uploaded document (decision: "accepted" |
   "rejected" | "replacement_requested"; a reason is required unless accepted). A
   rejection / replacement request re-opens that document type for the citizen.

   Request:  { applicationDocId, items: [ { key } | { label } ... ], message? }
     { key }    a document from that service's checklist (js/document-checklists.js)
     { label }  a document staff describe themselves (e.g. for "Other" requests);
                stored under a server-made key  extra-1, extra-2, ...
   Response: { ok: true, documentRequest }

   Rules enforced here (the browser can't skip them):
     - only active staff/admin; never on their own application
     - only while the application is still open (submitted / under_review)
     - checklist keys must exist for the application's service
     - labels are trimmed, 3-80 characters, no control characters or < >
     - an earlier request that is still outstanding is kept and merged
   ========================================================================== */

const { FieldValue } = require("firebase-admin/firestore");
const { requireRole, sendAuthzError } = require("../_lib/authz");
const { getFirestore } = require("../_lib/firebaseAdmin");
const DocumentChecklists = require("../_lib/documentChecklists");
const { isValidApplicationDocId, isValidDocType, cleanDocumentLabel, readJsonBody } = require("../_lib/validation");

const MAX_ITEMS_PER_REQUEST = 5;
const MAX_OUTSTANDING = 10;
const MAX_MESSAGE = 500;

class ConflictError extends Error {}
class NotFoundError extends Error {}
class SelfReviewError extends Error {}
class BadItemError extends Error {}

const DECISIONS = ["accepted", "rejected", "replacement_requested"];
const MAX_REASON = 500;
const MIN_REASON = 5;
const DECISION_WORDS = { accepted: "accepted", rejected: "rejected", replacement_requested: "needs a replacement" };

class MissingDocumentError extends Error {}
class NotItemisedError extends Error {}

/**
 * action "review": staff accept a document, reject it, or ask for a replacement.
 * A rejection / replacement needs a reason and re-opens that document type for the
 * citizen (they upload the replacement through the normal requested-documents box).
 */
async function reviewDocument(res, caller, body) {
  const { applicationDocId, path, decision } = body;
  if (!isValidApplicationDocId(applicationDocId) || typeof path !== "string" || !path || path.length > 400) return res.status(400).json({ error: "Invalid request." });
  if (!DECISIONS.includes(decision)) return res.status(400).json({ error: "Invalid request." });
  if (body.reason !== undefined && typeof body.reason !== "string") return res.status(400).json({ error: "Invalid request." });
  const reason = (body.reason || "").trim();
  if (reason.length > MAX_REASON) return res.status(400).json({ error: `The reason must be ${MAX_REASON} characters or fewer.` });
  if (decision !== "accepted" && reason.length < MIN_REASON) return res.status(400).json({ error: "Please give a reason the applicant can act on." });

  const db = getFirestore();
  const appRef = db.collection("applications").doc(applicationDocId);
  let saved;
  try {
    await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(appRef);
      if (!snapshot.exists) throw new NotFoundError();
      const app = snapshot.data();
      if (app.userId === caller.uid) throw new SelfReviewError();
      if (app.status !== "submitted" && app.status !== "under_review") throw new ConflictError();

      const documents = Array.isArray(app.documents) ? app.documents : [];
      const index = documents.findIndex((d) => d && d.path === path && d.superseded !== true);
      if (index < 0) throw new MissingDocumentError();
      const doc = documents[index];
      if (decision !== "accepted" && typeof doc.docType !== "string") throw new NotItemisedError();

      const review = { status: decision, reason, reviewedBy: caller.uid, reviewedByName: caller.profile.name || "", reviewedAt: new Date().toISOString() };
      const nextDocs = documents.map((d, i) => (i === index ? { ...d, review } : d));
      const update = { documents: nextDocs, updatedAt: FieldValue.serverTimestamp() };

      const label = doc.docLabel || doc.docType || "Document";
      if (decision !== "accepted") {
        const openItems = app.documentRequest && app.documentRequest.open === true && Array.isArray(app.documentRequest.items) ? app.documentRequest.items : [];
        const items = openItems.filter((i) => i && i.key !== doc.docType && i.done !== true)
          .concat([{ key: doc.docType, label, done: false, replacement: true, reason }]);
        update.documentRequest = {
          open: true, items, message: (app.documentRequest && app.documentRequest.message) || "",
          requestedAt: FieldValue.serverTimestamp(), requestedBy: caller.uid, requestedByName: caller.profile.name || "",
        };
      }
      tx.update(appRef, update);
      tx.set(appRef.collection("statusHistory").doc(), {
        status: app.status,
        remarks: `${label} ${DECISION_WORDS[decision]}${reason ? `: ${reason}` : "."}`,
        timestamp: FieldValue.serverTimestamp(),
        updatedBy: caller.uid,
        updatedByName: caller.profile.name || "",
        kind: "document_reviewed",
      });
      saved = { path, review };
    });
  } catch (error) {
    if (error instanceof NotFoundError) return res.status(404).json({ error: "Application not found." });
    if (error instanceof SelfReviewError) return res.status(403).json({ error: "You cannot review your own application." });
    if (error instanceof ConflictError) return res.status(409).json({ error: "Documents can only be reviewed while the application is open. Please refresh the page." });
    if (error instanceof MissingDocumentError) return res.status(404).json({ error: "That document is no longer current. Please refresh the page." });
    if (error instanceof NotItemisedError) return res.status(409).json({ error: "This older document is not itemised, so a replacement cannot be requested for it. Request a new document instead." });
    console.error("[review-document] failed:", error.message);
    return res.status(500).json({ error: "Could not save the review. Please try again." });
  }
  return res.status(200).json({ ok: true, ...saved });
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  let caller;
  try {
    caller = await requireRole(req, ["staff", "admin"]);
  } catch (error) {
    return sendAuthzError(res, error);
  }

  const body = readJsonBody(req);
  if (body === null) return res.status(400).json({ error: "Invalid request." });
  if (body.action === "review") return reviewDocument(res, caller, body);
  const { applicationDocId, items, message } = body;
  if (!isValidApplicationDocId(applicationDocId)) return res.status(400).json({ error: "Invalid request." });
  if (!Array.isArray(items) || items.length < 1 || items.length > MAX_ITEMS_PER_REQUEST) {
    return res.status(400).json({ error: `Choose between 1 and ${MAX_ITEMS_PER_REQUEST} documents to request.` });
  }
  if (message !== undefined && typeof message !== "string") return res.status(400).json({ error: "Invalid request." });
  const note = (message || "").trim();
  if (note.length > MAX_MESSAGE) return res.status(400).json({ error: `The message must be ${MAX_MESSAGE} characters or fewer.` });

  // Shape-check every item before touching the database.
  const wanted = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return res.status(400).json({ error: "Invalid request." });
    if (raw.key !== undefined) {
      if (!isValidDocType(raw.key)) return res.status(400).json({ error: "Invalid request." });
      wanted.push({ key: raw.key });
    } else {
      const label = cleanDocumentLabel(raw.label);
      if (!label) return res.status(400).json({ error: "Describe each extra document in 3–80 characters." });
      wanted.push({ label });
    }
  }

  const db = getFirestore();
  const appRef = db.collection("applications").doc(applicationDocId);
  let saved;

  try {
    await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(appRef);
      if (!snapshot.exists) throw new NotFoundError();
      const app = snapshot.data();

      if (app.userId === caller.uid) throw new SelfReviewError();
      if (app.status !== "submitted" && app.status !== "under_review") throw new ConflictError();

      const previous = app.documentRequest && app.documentRequest.open === true && Array.isArray(app.documentRequest.items)
        ? app.documentRequest.items.filter((i) => i && i.done !== true)
        : [];
      const merged = previous.map((i) => ({ ...i, done: false }));

      // extra-N numbering continues after anything already requested or uploaded
      let nextExtra = 1;
      const used = [
        ...(Array.isArray(app.documentRequest && app.documentRequest.items) ? app.documentRequest.items.map((i) => i && i.key) : []),
        ...(Array.isArray(app.documents) ? app.documents.map((d) => d && d.docType) : []),
      ];
      used.forEach((k) => {
        const m = typeof k === "string" ? /^extra-(\d+)$/.exec(k) : null;
        if (m) nextExtra = Math.max(nextExtra, Number(m[1]) + 1);
      });

      const added = [];
      for (const w of wanted) {
        if (w.key !== undefined) {
          const found = DocumentChecklists.findItem(app.serviceType, w.key);
          if (!found) throw new BadItemError();
          if (!merged.some((m) => m.key === found.key) && !added.some((m) => m.key === found.key)) {
            added.push({ key: found.key, label: found.label, done: false });
          }
        } else {
          if (nextExtra > 99) throw new BadItemError();
          added.push({ key: `extra-${nextExtra++}`, label: w.label, done: false });
        }
      }
      const all = [...merged, ...added];
      if (all.length > MAX_OUTSTANDING) throw new BadItemError();

      const documentRequest = {
        open: true,
        items: all,
        message: note,
        requestedAt: FieldValue.serverTimestamp(),
        requestedBy: caller.uid,
        requestedByName: caller.profile.name || "",
      };

      tx.update(appRef, { documentRequest, updatedAt: FieldValue.serverTimestamp() });

      const names = added.map((i) => i.label).join("; ");
      tx.set(appRef.collection("statusHistory").doc(), {
        status: app.status,
        remarks: `Additional documents requested: ${names}.${note ? ` ${note}` : ""}`,
        timestamp: FieldValue.serverTimestamp(),
        updatedBy: caller.uid,
        updatedByName: caller.profile.name || "",
        kind: "documents_requested",
      });

      saved = { open: true, items: all, message: note };
    });
  } catch (error) {
    if (error instanceof NotFoundError) return res.status(404).json({ error: "Application not found." });
    if (error instanceof SelfReviewError) return res.status(403).json({ error: "You cannot review your own application." });
    if (error instanceof ConflictError) {
      return res.status(409).json({ error: "Documents can only be requested while the application is open. Please refresh the page." });
    }
    if (error instanceof BadItemError) return res.status(400).json({ error: "One of the requested documents is not valid for this application." });
    console.error("[request-documents] failed:", error.message);
    return res.status(500).json({ error: "Could not send the request. Please try again." });
  }

  return res.status(200).json({ ok: true, documentRequest: saved });
};
