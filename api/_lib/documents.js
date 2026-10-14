/* ==========================================================================
   api/_lib/documents.js — server-side checks shared by the endpoints that put
   documents on an application (submit, add-documents) and review them.

   What "verified" means here — and what it does NOT mean:
   - Each document is tied to ONE checklist item (its docType). The docType must
     belong to the application's service, and the storage path itself must carry
     that docType (create-upload-url builds it), so a file uploaded for one item
     cannot be presented as another.
   - Each file must really EXIST in the private bucket, in this applicant's folder
     for this application, with an allowed MIME type and within the 5 MB limit.
     Type and size are taken from STORAGE, not from what the browser claimed.
   - The same stored file cannot be attached to two different checklist items.
   It does NOT inspect what is inside a file. Filenames and labels are not proof
   of authenticity; staff must open each document and check its contents.
   ========================================================================== */

const crypto = require("crypto");
const DocumentChecklists = require("./documentChecklists");
const { getSupabaseAdmin, getBucket } = require("./supabaseAdmin");
const {
  isValidDocType, docTypeOfPath, isStoragePathFor, isAllowedMimeType, isAllowedFileSize,
} = require("./validation");

class DocumentError extends Error {
  constructor(message) { super(message); this.userMessage = message; }
}

/** All files in applications/{uid}/{appId}/ -> Map(path -> { size, mimetype, etag }). Throws on storage failure. */
async function listStoredFiles(uid, applicationDocId) {
  const folder = `applications/${uid}/${applicationDocId}`;
  const { data, error } = await getSupabaseAdmin().storage.from(getBucket()).list(folder, { limit: 100 });
  if (error) throw error;
  const found = new Map();
  (data || []).forEach((o) => {
    if (!o || typeof o.name !== "string") return;
    const m = o.metadata || {};
    found.set(`${folder}/${o.name}`, {
      size: Number.isFinite(m.size) ? m.size : (Number.isFinite(m.contentLength) ? m.contentLength : NaN),
      mimetype: typeof m.mimetype === "string" ? m.mimetype : "",
      etag: typeof m.eTag === "string" ? m.eTag : "",
    });
  });
  return found;
}

/**
 * Validates documents the browser says it uploaded and returns the entries to store.
 *   documents  [{ docType, name, path, ... }] from the request (nothing else is trusted)
 *   resolveItem(docType) -> { key, label } | null     which document types are acceptable here
 * Throws DocumentError with a message that is safe to show.
 */
async function verifyUploadedDocuments({ uid, applicationDocId, serviceType, documents, resolveItem, existingPaths = [] }) {
  const seenTypes = new Set();
  const seenPaths = new Set(existingPaths);
  documents.forEach((d) => {
    if (!d || typeof d !== "object" || Array.isArray(d)) throw new DocumentError("Invalid document information.");
    if (!isValidDocType(d.docType)) throw new DocumentError("Invalid document type.");
    if (typeof d.path !== "string" || typeof d.name !== "string" || d.name.length < 1 || d.name.length > 200) {
      throw new DocumentError("Invalid document information.");
    }
    const item = resolveItem(d.docType);
    if (!item) throw new DocumentError("One of the documents is not part of this application's checklist.");
    if (seenTypes.has(d.docType)) throw new DocumentError(`"${item.label}" was attached more than once.`);
    seenTypes.add(d.docType);
    if (!isStoragePathFor(d.path, uid, applicationDocId)) throw new DocumentError("A document file is not in your folder for this application.");
    if (docTypeOfPath(d.path) !== d.docType) throw new DocumentError(`The file attached to "${item.label}" was uploaded for a different document.`);
    if (seenPaths.has(d.path)) throw new DocumentError("The same file cannot be attached twice.");
    seenPaths.add(d.path);
  });

  let stored;
  try {
    stored = await listStoredFiles(uid, applicationDocId);
  } catch (error) {
    console.error("[documents] storage listing failed:", error && error.message);
    const e = new DocumentError("Could not check your uploaded files. Please try again.");
    e.statusCode = 500;
    throw e;
  }

  const etags = new Map();
  return documents.map((d) => {
    const item = resolveItem(d.docType);
    const info = stored.get(d.path);
    if (!info) throw new DocumentError(`The file for "${item.label}" was not found. Please upload it again.`);
    // The type storage recorded wins. A generic "octet-stream" (or nothing) says nothing, so then — and only
    // then — the type the browser declared is used; either way it must be on the allow-list.
    const recorded = info.mimetype && info.mimetype !== "application/octet-stream" ? info.mimetype : "";
    const effectiveType = recorded || (typeof d.type === "string" ? d.type : "");
    if (!isAllowedMimeType(effectiveType)) throw new DocumentError(`The file for "${item.label}" is not a PDF, JPG or PNG.`);
    // The size storage recorded wins. If storage gave none, the size the browser declared is used; with neither,
    // the file cannot be checked and is refused rather than waved through.
    const knownSize = Number.isFinite(info.size) ? info.size : (typeof d.size === "number" ? d.size : NaN);
    if (!isAllowedFileSize(knownSize)) throw new DocumentError(`The file for "${item.label}" must be smaller than 5 MB (and not empty).`);
    if (info.etag) {
      // identical bytes uploaded for two different checklist items
      const other = etags.get(info.etag);
      if (other && other !== d.docType) throw new DocumentError("The same file was attached for more than one document. Please upload the correct file for each.");
      etags.set(info.etag, d.docType);
    }
    return {
      docType: d.docType,
      docLabel: item.label,                       // from the checklist / staff request, never from the browser
      name: d.name,                               // display only — not proof of what the file contains
      type: effectiveType,
      size: knownSize,
      path: d.path,
      uploadedAt: new Date().toISOString(),
      review: { status: "pending" },
    };
  });
}

/**
 * Reasons an application cannot be APPROVED yet, as short sentences (empty list = fine).
 * Only applies to itemised applications (documents with a docType); older applications
 * whose files are not itemised are never blocked by this.
 */
function approvalBlockers(app) {
  const docs = (Array.isArray(app.documents) ? app.documents : []).filter((d) => d && d.superseded !== true);
  if (!docs.some((d) => typeof d.docType === "string")) return [];
  const blockers = [];
  DocumentChecklists.requiredItems(app.serviceType).forEach((item) => {
    if (!docs.some((d) => d.docType === item.key)) blockers.push(`"${item.label}" has not been uploaded`);
  });
  docs.forEach((d) => {
    const status = d.review && d.review.status;
    if (status === "rejected" || status === "replacement_requested") blockers.push(`"${d.docLabel || d.docType}" needs a replacement`);
  });
  const request = app.documentRequest;
  if (request && request.open === true && Array.isArray(request.items)) {
    request.items.filter((i) => i && i.done !== true).forEach((i) => blockers.push(`still waiting for "${i.label || i.key}"`));
  }
  return blockers;
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** GP-<year>-<8 random characters>, like the browser used to make. */
function generateApplicationCode() {
  let suffix = "";
  for (let i = 0; i < 8; i++) suffix += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return `GP-${new Date().getFullYear()}-${suffix}`;
}

/** Plain, flat answers only: <= 30 keys, short keys, primitive values, bounded text. */
function validateFormData(formData) {
  if (!formData || typeof formData !== "object" || Array.isArray(formData)) return null;
  const out = {};
  const keys = Object.keys(formData);
  if (keys.length > 30) return null;
  for (const key of keys) {
    const v = formData[key];
    if (!/^[A-Za-z][A-Za-z0-9]{0,39}$/.test(key)) return null;
    if (typeof v === "string") {
      if (v.length > 2000) return null;
      out[key] = v;
    } else if (typeof v === "number" && Number.isFinite(v)) out[key] = v;
    else if (typeof v === "boolean") out[key] = v;
    else return null;
  }
  return out;
}

module.exports = { approvalBlockers, DocumentError, listStoredFiles, verifyUploadedDocuments, generateApplicationCode, validateFormData, DocumentChecklists };
