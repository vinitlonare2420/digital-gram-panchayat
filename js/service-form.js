/* ==========================================================================
   service-form.js — shared submit flow for ALL nine service application forms.

   Flow:
     1. validate the fields AND the document checklist (every REQUIRED document
        must be chosen; every chosen file must be PDF/JPG/JPEG/PNG and <= 5 MB)
     2. upload each chosen document, one by one, through GPUploads (private
        Supabase bucket, signed upload URL minted by /api/documents/create-upload-url
        for that application and that document type)
     3. create the application through GPApplications.createApplication
        (Firestore; ownership + status are enforced by firestore.rules)
     4. if any upload fails, or step 3 fails, ask the server to delete the files
        already uploaded for this attempt

   Every stored document is { docType, docLabel, name, type, size, path } — docType
   is the checklist key (js/document-checklists.js), and the path already contains
   the application's id.

   Classic script. Needs these globals from the other scripts on the page:
   DocumentChecklists (document-checklists.js), buildDocumentChecklist (checklist-ui.js), validateFields / validateFile /
   showFieldError / clearFieldError (validation.js), SERVICE_TYPES / escapeHtml /
   whenAppsReady / whenUploadsReady / setButtonLoading (utils.js), initFileUpload /
   showToast (components.js), renderApplicationSuccess (app.js),
   GPApplications, GPUploads (modules).
   ========================================================================== */

/**
 * Renders the "Required Documents" checklist for a service into `containerEl`
 * (checkbox + Required/Optional + state + one upload field per document type — see
 * js/checklist-ui.js) and returns the handle initServiceForm uses:
 *   items / getSelections() / validate()
 * Ticking a checkbox is only a reminder; ONLY chosen files are uploaded or validated.
 */
function initDocumentChecklist(containerEl, serviceType) {
  const list = DocumentChecklists.getChecklist(serviceType);
  if (!list) throw new Error(`No document checklist for service: ${serviceType}`);

  const notes = [DocumentChecklists.NOTICE];
  if (!list.confirmed) notes.push('This list still needs confirmation from the responsible authority.');
  if (list.staffDefined) notes.push('For this service the office decides which documents are needed. After you apply, staff may ask you for more — you will see the request on your application page, where you can upload them.');

  // the short list at the top of the page comes from the same single source as the checklist below
  const summaryList = document.getElementById('requirements-list');
  if (summaryList) {
    summaryList.innerHTML = list.items.map((i) => `<li>${escapeHtml(i.label)} — ${i.required ? 'required' : 'optional'}</li>`).join('');
  }

  return buildDocumentChecklist(containerEl, list.items, { idPrefix: 'doc', notes });
}

/**
 * options:
 *   formId        id of the <form>
 *   serviceType   key from SERVICE_TYPES, e.g. 'bpl' (the stored serviceName
 *                 is always SERVICE_TYPES[serviceType], never typed by the user)
 *   pagePath      this page's path from the site root, for the login redirect
 *   documents     the handle returned by initDocumentChecklist()
 *   getRules()    returns the validateFields() rule map
 *   buildFormData() returns the plain object stored as application.formData
 */
function initServiceForm({ formId, serviceType, pagePath, documents, getRules, buildFormData }) {
  const serviceName = SERVICE_TYPES[serviceType];
  if (!serviceName) throw new Error(`Unknown service type: ${serviceType}`);

  const form = document.getElementById(formId);
  let isSubmitting = false;

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (isSubmitting) return;

    const fieldsValid = validateFields(getRules());
    const documentsValid = documents.validate();
    if (!fieldsValid || !documentsValid) return;

    const formData = buildFormData();
    const selections = documents.getSelections();
    const submitBtn = form.querySelector('button[type="submit"]');
    isSubmitting = true;

    whenAppsReady(() => {
      whenUploadsReady(async () => {
        setButtonLoading(submitBtn, true, 'Submitting application…');

        // Generated up front (no network call) so every document can be uploaded
        // to a path scoped to this exact application before it is written.
        const applicationDocId = GPApplications.generateApplicationDocId();
        const uploaded = [];

        const discardUploads = () => uploaded.forEach((d) => GPUploads.cleanupUpload({ path: d.path }));

        for (const { item, file } of selections) {
          try {
            const meta = await GPUploads.uploadDocument({ applicationDocId, serviceType, docType: item.key, file });
            uploaded.push({ docType: item.key, docLabel: item.label, ...meta });
          } catch (error) {
            discardUploads();                       // nothing is submitted, so nothing should stay in storage
            showFieldError(item.uploader.fieldId, error.message || 'This document could not be uploaded. Please try again.');
            showToast(`${item.label}: ${error.message || 'could not be uploaded. Please try again.'}`, 'error');
            isSubmitting = false;
            setButtonLoading(submitBtn, false);
            return;
          }
        }

        try {
          const { docId, applicationId } = await GPApplications.createApplication({
            applicationDocId,
            serviceType,
            serviceName,
            formData,
            documents: uploaded,
          });

          document.getElementById('application-form-wrapper').classList.add('hidden');
          const successEl = document.getElementById('success-screen');
          successEl.classList.remove('hidden');
          renderApplicationSuccess(successEl, {
            applicationId,
            viewHref: `../citizen/application-details.html?id=${docId}`,
            dashboardHref: '../citizen/dashboard.html',
          });
          successEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (error) {
          discardUploads();
          if (error.message === 'Please log in to submit your application.') {
            showToast(error.message, 'error');
            window.location.href = `../login.html?redirect=${encodeURIComponent(pagePath)}`;
            return;
          }
          showToast(error.message, 'error');
        } finally {
          isSubmitting = false;
          setButtonLoading(submitBtn, false);
        }
      });
    });
  });
}
