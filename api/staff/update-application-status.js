/* ==========================================================================
   POST /api/staff/update-application-status      (active staff or admin)

   The ONLY way an application's status changes after submission. Firestore
   rules forbid client updates, so a citizen cannot touch a decision, and a
   staff browser cannot skip the workflow below.

   Request:  { applicationDocId, status, remarks? }
   Response: { ok: true, status }

   Allowed transitions (anything else is rejected with 409):
       submitted    -> under_review      (staff accepts it for review)
       under_review -> approved
       under_review -> rejected          (a reason is REQUIRED)

   In one Firestore transaction this updates the application (status,
   remarks, reviewer, timestamps) AND appends a statusHistory entry, so the
   citizen's timeline can never disagree with the application.
   ========================================================================== */

const { FieldValue } = require("firebase-admin/firestore");
const { requireRole, sendAuthzError } = require("../_lib/authz");
const { getFirestore } = require("../_lib/firebaseAdmin");
const { isValidApplicationDocId, readJsonBody } = require("../_lib/validation");
const { approvalBlockers } = require("../_lib/documents");

const TRANSITIONS = {
  submitted: ["under_review"],
  under_review: ["approved", "rejected"],
};

const MAX_REMARKS = 1000;
const MIN_REJECT_REASON = 5;

class ConflictError extends Error {}
class NotFoundError extends Error {}
class SelfReviewError extends Error {}
class BlockedError extends Error {}

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
  const { applicationDocId, status, remarks } = body;
  if (!isValidApplicationDocId(applicationDocId)) return res.status(400).json({ error: "Invalid request." });
  if (!["under_review", "approved", "rejected"].includes(status)) return res.status(400).json({ error: "Invalid status." });
  if (remarks !== undefined && typeof remarks !== "string") return res.status(400).json({ error: "Invalid request." });

  const note = (remarks || "").trim();
  if (note.length > MAX_REMARKS) return res.status(400).json({ error: `Remarks must be ${MAX_REMARKS} characters or fewer.` });
  if (status === "rejected" && note.length < MIN_REJECT_REASON) {
    return res.status(400).json({ error: "Please give a reason for rejecting this application." });
  }

  const db = getFirestore();
  const appRef = db.collection("applications").doc(applicationDocId);

  try {
    await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(appRef);
      if (!snapshot.exists) throw new NotFoundError();

      // Conflict of interest: a staff member who is also an applicant (for
      // example a citizen later promoted to staff) must not decide their own case.
      if (snapshot.data().userId === caller.uid) throw new SelfReviewError();

      // Approval needs every required document on file and nothing waiting for a replacement.
      if (status === "approved") {
        const blockers = approvalBlockers(snapshot.data());
        if (blockers.length) { const e = new BlockedError(); e.blockers = blockers; throw e; }
      }

      const current = snapshot.data().status;
      if (!(TRANSITIONS[current] || []).includes(status)) throw new ConflictError();

      const update = {
        status,
        updatedAt: FieldValue.serverTimestamp(),
        reviewedBy: caller.uid,
        reviewedByName: caller.profile.name || "",
      };
      if (note) update.remarks = note;
      // A decision ends any outstanding "please upload more documents" request.
      const request = snapshot.data().documentRequest;
      if ((status === "approved" || status === "rejected") && request && request.open === true) {
        update.documentRequest = { ...request, open: false };
      }
      tx.update(appRef, update);

      tx.set(appRef.collection("statusHistory").doc(), {
        status,
        remarks: note,
        timestamp: FieldValue.serverTimestamp(),
        updatedBy: caller.uid,
        updatedByName: caller.profile.name || "",
      });
    });
  } catch (error) {
    if (error instanceof NotFoundError) return res.status(404).json({ error: "Application not found." });
    if (error instanceof SelfReviewError) return res.status(403).json({ error: "You cannot review your own application." });
    if (error instanceof BlockedError) {
      return res.status(409).json({ error: `This application cannot be approved yet: ${error.blockers.join("; ")}.` });
    }
    if (error instanceof ConflictError) {
      return res.status(409).json({ error: "This application can't be moved to that status right now. Please refresh the page." });
    }
    console.error("[update-application-status] failed:", error.message);
    return res.status(500).json({ error: "Could not update the application. Please try again." });
  }

  return res.status(200).json({ ok: true, status });
};
