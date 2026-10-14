/* ==========================================================================
   POST /api/applications/submit        (any active signed-in account)

   Creates an application. This is the ONLY way an application is created:
   firestore.rules refuse client-side creates, so the checks below cannot be
   skipped by editing the browser code.

   Request:  { applicationDocId, serviceType, formData, documents: [ { docType, name, path, ... } ] }
   Response: { docId, applicationId }

   Verified on the server:
     - the caller (from the ID token) becomes the applicant; name / mobile / e-mail
       come from their profile, status is always "submitted"
     - the service is known; its display name comes from the server's catalog
     - formData is a flat object of short answers
     - EVERY REQUIRED document type of that service has a file, each document is tied
       to one checklist item (docType), the stored path matches that item, no item has
       two files, one stored file never fills two items, and every file exists in
       private storage with an allowed type and <= 5 MB (see api/_lib/documents.js)
   Not verified: what is INSIDE a file — staff must check the contents.
   ========================================================================== */

const { FieldValue } = require("firebase-admin/firestore");
const { getCaller, sendAuthzError } = require("../_lib/authz");
const { getFirestore } = require("../_lib/firebaseAdmin");
const DocumentChecklists = require("../_lib/documentChecklists");
const { verifyUploadedDocuments, generateApplicationCode, validateFormData, DocumentError } = require("../_lib/documents");
const { SERVICE_NAMES, isValidApplicationDocId, isAllowedServiceType, readJsonBody } = require("../_lib/validation");

class ExistsError extends Error {}

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
  const { applicationDocId, serviceType, documents } = body;
  if (!isValidApplicationDocId(applicationDocId) || !isAllowedServiceType(serviceType)) {
    return res.status(400).json({ error: "Invalid request." });
  }
  const formData = validateFormData(body.formData);
  if (!formData) return res.status(400).json({ error: "The form details are not valid." });
  if (!Array.isArray(documents) || documents.length > 10) return res.status(400).json({ error: "Invalid request." });

  const checklist = DocumentChecklists.getChecklist(serviceType);
  const missing = DocumentChecklists.missingRequired(serviceType, documents.map((d) => (d && typeof d.docType === "string" ? d.docType : "")));
  if (missing.length) {
    return res.status(400).json({ error: `Missing required document${missing.length > 1 ? "s" : ""}: ${missing.map((m) => m.label).join("; ")}.` });
  }

  let stored;
  try {
    stored = await verifyUploadedDocuments({
      uid: caller.uid,
      applicationDocId,
      serviceType,
      documents,
      resolveItem: (docType) => checklist.items.find((i) => i.key === docType) || null,
    });
  } catch (error) {
    if (error instanceof DocumentError) return res.status(error.statusCode || 400).json({ error: error.userMessage });
    console.error("[submit] verification failed:", error && error.message);
    return res.status(500).json({ error: "Your application could not be submitted. Please try again." });
  }

  const db = getFirestore();
  const ref = db.collection("applications").doc(applicationDocId);
  const applicationId = generateApplicationCode();

  try {
    await db.runTransaction(async (tx) => {
      const existing = await tx.get(ref);
      if (existing.exists) throw new ExistsError();
      tx.set(ref, {
        applicationId,
        userId: caller.uid,                                  // from the verified token
        applicantName: caller.profile.name || "",
        applicantEmail: caller.email || "",
        applicantMobile: caller.profile.mobile || "",
        serviceType,
        serviceName: SERVICE_NAMES[serviceType],
        status: "submitted",
        submittedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        remarks: "",
        formData,
        documents: stored,
      });
      tx.set(ref.collection("statusHistory").doc(), { status: "submitted", remarks: "", timestamp: FieldValue.serverTimestamp() });
    });
  } catch (error) {
    if (error instanceof ExistsError) return res.status(409).json({ error: "This application was already submitted." });
    console.error("[submit] write failed:", error && error.message);
    return res.status(500).json({ error: "Your application could not be submitted. Please try again." });
  }

  return res.status(200).json({ docId: applicationDocId, applicationId });
};
