/* ==========================================================================
   api/_lib/validation.js — server-side validation for document uploads.

   Everything here re-checks what js/validation.js already checks in the
   browser. The browser checks exist for fast user feedback; these checks
   exist because the browser checks can never be trusted — a request can
   always be replayed or edited before it reaches this function.
   ========================================================================== */

// Keep in sync with SERVICE_TYPES in js/utils.js and firestore.rules
// (tests/services.test.js checks all three agree).
const ALLOWED_SERVICE_TYPES = ["birth", "death", "income", "caste", "marriage", "bpl", "nodues", "property", "other"];
// Canonical display names; the server writes serviceName from here, never from the request.
const SERVICE_NAMES = {
  birth: "Birth Certificate",
  death: "Death Certificate",
  income: "Income Certificate",
  caste: "Caste Certificate",
  marriage: "Marriage Registration",
  bpl: "BPL Certificate",
  nodues: "No Dues Certificate",
  property: "Property Assessment Certificate",
  other: "Other Certificate / Service Request",
};
const ALLOWED_MIME_TYPES = ["application/pdf", "image/jpeg", "image/jpg", "image/png"];
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

// Firestore auto-generated document IDs are 20 characters drawn from a
// fixed base62-ish alphabet. This is intentionally a little more permissive
// than that (10-40 alphanumeric chars) to avoid coupling this check too
// tightly to an internal Firestore implementation detail, while still
// rejecting anything that clearly isn't a plausible doc ID (path traversal
// attempts, empty strings, huge payloads, etc).
const APPLICATION_DOC_ID_RE = /^[A-Za-z0-9]{10,40}$/;

function isValidApplicationDocId(id) {
  return typeof id === "string" && APPLICATION_DOC_ID_RE.test(id);
}

function isAllowedServiceType(serviceType) {
  return typeof serviceType === "string" && ALLOWED_SERVICE_TYPES.includes(serviceType);
}

function isAllowedMimeType(mimeType) {
  return typeof mimeType === "string" && ALLOWED_MIME_TYPES.includes(mimeType);
}

function isAllowedFileSize(size) {
  return typeof size === "number" && Number.isFinite(size) && size > 0 && size <= MAX_FILE_SIZE_BYTES;
}

/**
 * Strips path separators and any character outside a safe allow-list,
 * collapses repeats, and guarantees a non-empty result. Never trust a
 * client-supplied filename for constructing a storage path directly.
 */
function sanitizeFilename(name) {
  const fallback = "document";
  if (typeof name !== "string" || !name.trim()) return fallback;

  const cleaned = name
    .normalize("NFKD")
    .replace(/[\/\\]/g, "_")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 120);

  return cleaned || fallback;
}

/* ---- account / role management (Phase 5) ------------------------------ */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOBILE_RE = /^[6-9]\d{9}$/;
const UID_RE = /^[A-Za-z0-9]{1,128}$/;

function isValidEmail(email) {
  return typeof email === "string" && email.length <= 254 && EMAIL_RE.test(email);
}

function isValidUid(uid) {
  return typeof uid === "string" && UID_RE.test(uid);
}

/** Returns an error message, or null when the staff-account input is fine. */
function validateStaffInput({ name, email, mobile, password }) {
  if (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 80) {
    return "Enter the staff member's full name.";
  }
  if (!isValidEmail(typeof email === "string" ? email.trim() : email)) {
    return "Enter a valid email address.";
  }
  if (mobile && !(typeof mobile === "string" && MOBILE_RE.test(mobile.trim()))) {
    return "Enter a valid 10-digit mobile number.";
  }
  if (typeof password !== "string" || password.length < 12 || password.length > 128) {
    return "Temporary password must be 12–128 characters.";
  }
  return null;
}

/**
 * Returns the parsed JSON body as a plain object, {} when there is no usable
 * body, or null when the body is malformed JSON. (Reading req.body can THROW
 * on malformed JSON, which would otherwise surface as a 500.)
 */
function readJsonBody(req) {
  try {
    const body = req.body;
    return body && typeof body === "object" && !Array.isArray(body) ? body : {};
  } catch (_) {
    return null;
  }
}

/**
 * True only for  applications/{ownerUid}/{applicationDocId}/{file}  exactly —
 * the folder create-upload-url builds for that owner and that application.
 * Exactly four segments, so no "." / ".." / empty folder segments are possible.
 *
 * Needed because a citizen writes their own application's documents[] list,
 * so "the path is listed on the application" proves nothing about who owns the
 * file; the path itself must be bound to the applicant and the application.
 */
function isStoragePathFor(path, ownerUid, applicationDocId) {
  if (typeof path !== "string" || path.length === 0 || path.length > 400) return false;
  const parts = path.split("/");
  if (parts.length !== 4) return false;
  const [root, owner, appId, file] = parts;
  return root === "applications"
    && owner === ownerUid
    && appId === applicationDocId
    && file.length > 0
    && file !== "."
    && file !== "..";
}

/* ---- document types (see js/document-checklists.js) -------------------- */

const DOC_TYPE_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
// The server builds uploaded files as  {uuid}-{docType}__{safeName}  (sanitizeFilename never
// leaves a double underscore), so the storage path itself records which document it is.
const PATH_DOC_TYPE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-([a-z0-9]+(?:-[a-z0-9]+)*)__/;

function isValidDocType(docType) {
  return typeof docType === "string" && docType.length <= 40 && DOC_TYPE_RE.test(docType);
}

/** The docType encoded in a storage path built by create-upload-url, or null. */
function docTypeOfPath(path) {
  if (typeof path !== "string") return null;
  const file = path.split("/")[3];
  const m = typeof file === "string" ? PATH_DOC_TYPE_RE.exec(file) : null;
  return m ? m[1] : null;
}

/** A label staff type for an extra document. Returns the trimmed label or null. */
function cleanDocumentLabel(label) {
  if (typeof label !== "string") return null;
  // Reject control characters (newlines, tabs, NUL...) and angle brackets BEFORE tidying
  // spaces, so a line break can never be smoothed into an innocent-looking space.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f<>]/.test(label)) return null;
  const t = label.trim().replace(/ {2,}/g, " ");
  if (t.length < 3 || t.length > 80) return null;
  return t;
}

module.exports = {
  SERVICE_NAMES,
  isValidDocType,
  docTypeOfPath,
  cleanDocumentLabel,
  readJsonBody,
  isStoragePathFor,
  isValidEmail,
  isValidUid,
  validateStaffInput,
  ALLOWED_SERVICE_TYPES,
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE_BYTES,
  isValidApplicationDocId,
  isAllowedServiceType,
  isAllowedMimeType,
  isAllowedFileSize,
  sanitizeFilename,
};
