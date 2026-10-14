/* ==========================================================================
   uploads.js — browser-side document upload/download (Phase 4).

   Native ES module (loaded with <script type="module">), same pattern as
   auth.js/applications.js: imports Firebase directly, exposes everything
   through window.GPUploads for the existing classic <script> blocks.

   Responsibilities:
   - Ask the backend (/api/documents/*) to authorize an upload, then PUT
     the file bytes DIRECTLY to Supabase — the file itself never passes
     through our backend.
   - Ask the backend for a short-lived signed download URL for a document
     already recorded on one of the signed-in citizen's own applications.
   - Best-effort cleanup of an orphaned upload if the following Firestore
     write fails.

   Nothing here ever touches a Supabase key directly: the backend hands
   back a one-time signed upload URL (+ the public anon key required by
   Supabase's API gateway for that single PUT — see api/documents/
   create-upload-url.js for why) and, separately, a one-time signed
   download URL. No Supabase SDK is loaded in the browser.
   ========================================================================== */

import { auth } from "./firebase.js";

async function getIdTokenOrThrow() {
  const user = auth.currentUser;
  if (!user) throw new Error("Please log in to submit your application.");
  return user.getIdToken();
}

async function readErrorMessage(response, fallback) {
  try {
    const body = await response.json();
    if (body && typeof body.error === "string") return body.error;
  } catch (_) {
    /* response wasn't JSON — fall through to the generic message */
  }
  return fallback;
}

/* ------------------------------------------------------------------------
   Step 1 of an upload: ask the backend to authorize it. Returns a
   one-time signed upload URL scoped to exactly one storage path.
   ------------------------------------------------------------------------ */
async function requestUploadUrl({ applicationDocId, serviceType, docType, file }) {
  const idToken = await getIdTokenOrThrow();

  let response;
  try {
    response = await fetch("/api/documents/create-upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({
        applicationDocId,
        serviceType,
        docType,
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
      }),
    });
  } catch (error) {
    throw new Error("Could not reach the upload service. Please check your connection and try again.");
  }

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Could not prepare the upload. Please try again."));
  }

  return response.json(); // { path, signedUrl, token, apikey }
}

/* ------------------------------------------------------------------------
   Step 2 of an upload: PUT the file bytes straight to Supabase using the
   signed URL from step 1. Replicates the current @supabase/supabase-js
   `uploadToSignedUrl()` wire format for a Blob/File body (verified against
   the storage-js source): a multipart/form-data PUT with a `cacheControl`
   field and the file under an empty field name. The browser sets the
   multipart boundary automatically — never set Content-Type manually here.
   ------------------------------------------------------------------------ */
async function putFileToSignedUrl({ signedUrl, apikey, file }) {
  const formData = new FormData();
  formData.append("cacheControl", "3600");
  formData.append("", file);

  let response;
  try {
    response = await fetch(signedUrl, {
      method: "PUT",
      headers: apikey ? { apikey } : {},
      body: formData,
    });
  } catch (error) {
    throw new Error("Your document could not be uploaded. Please try again.");
  }

  if (!response.ok) {
    throw new Error("Your document could not be uploaded. Please try again.");
  }
}

/**
 * Full upload flow for a certificate form. Returns document metadata ready
 * to store on the application — never the signed URL or token themselves.
 */
async function uploadDocument({ applicationDocId, serviceType, docType, file }) {
  const { path, signedUrl, apikey } = await requestUploadUrl({ applicationDocId, serviceType, docType, file });
  await putFileToSignedUrl({ signedUrl, apikey, file });
  return { name: file.name, type: file.type, size: file.size, path };
}

/**
 * Answer a staff request for more documents: upload each file (one per requested
 * document type), then ask the server to attach them to the EXISTING application
 * (/api/applications/add-documents — the browser may not edit applications itself).
 * files: [{ docType, file }]. If anything fails, the files uploaded so far are removed.
 */
async function uploadRequestedDocuments({ applicationDocId, serviceType, files }) {
  const uploaded = [];
  const discard = () => uploaded.forEach((d) => cleanupUpload({ path: d.path }));
  for (const { docType, file } of files) {
    try {
      const meta = await uploadDocument({ applicationDocId, serviceType, docType, file });
      uploaded.push({ docType, ...meta });
    } catch (error) {
      discard();
      error.docType = docType;
      throw error;
    }
  }

  const idToken = await getIdTokenOrThrow();
  let response;
  try {
    response = await fetch("/api/applications/add-documents", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ applicationDocId, documents: uploaded }),
    });
  } catch (error) {
    discard();
    throw new Error("Could not reach the server. Please check your connection and try again.");
  }
  if (!response.ok) {
    discard();
    throw new Error(await readErrorMessage(response, "Could not save your documents. Please try again."));
  }
  return response.json();
}

/**
 * Request a short-lived signed download URL for a document already
 * recorded on one of the signed-in citizen's own applications.
 */
async function getDownloadUrl({ applicationDocId, path }) {
  const idToken = await getIdTokenOrThrow();

  let response;
  try {
    response = await fetch("/api/documents/create-download-url", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ applicationDocId, path }),
    });
  } catch (error) {
    throw new Error("Could not reach the document service. Please check your connection and try again.");
  }

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Could not open this document. Please try again."));
  }

  const data = await response.json();
  return data.url;
}

/**
 * Best-effort cleanup of an orphaned upload (e.g. the Firestore write that
 * should have followed a successful upload failed). Never throws — a
 * cleanup failure must not surface as a second error to the user.
 */
async function cleanupUpload({ path }) {
  try {
    const idToken = await getIdTokenOrThrow();
    await fetch("/api/documents/cleanup-upload", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ path }),
    });
  } catch (error) {
    console.error("[uploads] cleanupUpload failed (non-fatal):", error);
  }
}

window.GPUploads = { uploadDocument, uploadRequestedDocuments, getDownloadUrl, cleanupUpload };

// Signal to classic scripts (which run before this module finishes
// evaluating) that window.GPUploads is now ready to use.
window.dispatchEvent(new Event("gpuploads-ready"));
