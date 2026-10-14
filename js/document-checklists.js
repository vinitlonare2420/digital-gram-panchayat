/* ==========================================================================
   document-checklists.js — the "Required Documents" checklist for each service.

   ONE file, used by the browser (classic <script>, global `DocumentChecklists`)
   AND by the API (api/_lib/documentChecklists.js requires it), so the form, the
   upload endpoint and staff review always agree on what each document type is.

   IMPORTANT — these lists are SUGGESTED requirements, NOT official rules.
   They have not been verified against Maharashtra Government / Gram Panchayat
   regulations. Every checklist carries `confirmed: false`, and every screen that
   shows one says so. To change a service's requirements, edit this file (or, per
   application, staff can ask the citizen for more documents from the review
   page). Once the responsible authority confirms a list, set `confirmed: true`
   for that service and the "needs confirmation" wording disappears for it.

   An item:  { key, label, required, hint? }
   `key` is a short, stable id (lowercase letters, digits, hyphens). It is stored
   on every uploaded document as its `docType`, so never rename a key that
   applications may already use — add a new one instead.
   ========================================================================== */
(function (root) {
  'use strict';

  var NOTICE = 'These are suggested documents, not official government rules. The Gram Panchayat office may ask for more or fewer documents — please confirm the requirements with the responsible authority.';

  var ID = { key: 'applicant-id', label: 'Applicant ID proof (e.g. Aadhaar, voter ID)', required: true };
  var ADDRESS = { key: 'address-proof', label: 'Address proof', required: true };

  function item(base, overrides) {
    var out = {};
    Object.keys(base).forEach(function (k) { out[k] = base[k]; });
    Object.keys(overrides || {}).forEach(function (k) { out[k] = overrides[k]; });
    return out;
  }

  var CHECKLISTS = {
    birth: {
      confirmed: false,
      items: [
        item(ID, { label: 'Parent / applicant ID proof (e.g. Aadhaar, voter ID)' }),
        { key: 'birth-proof', label: 'Birth proof (hospital record or discharge slip)', required: true },
        ADDRESS,
        { key: 'parents-marriage-proof', label: "Parents' marriage certificate", required: false },
      ],
    },
    death: {
      confirmed: false,
      items: [
        { key: 'death-proof', label: 'Death proof (medical certificate, cremation or burial receipt)', required: true },
        ID,
        { key: 'deceased-id', label: "Deceased person's ID proof", required: false },
        item(ADDRESS, { required: false }),
      ],
    },
    income: {
      confirmed: false,
      items: [
        ID,
        ADDRESS,
        { key: 'income-proof', label: 'Income proof (salary slip, employer certificate or self-declaration)', required: true },
        { key: 'ration-card', label: 'Ration card', required: false },
      ],
    },
    caste: {
      confirmed: false,
      items: [
        ID,
        ADDRESS,
        { key: 'caste-proof', label: "Caste evidence (e.g. a relative's caste certificate or school leaving certificate)", required: true },
        { key: 'self-declaration', label: 'Self-declaration', required: false },
      ],
    },
    marriage: {
      confirmed: false,
      items: [
        { key: 'groom-id', label: "Groom's ID proof", required: true },
        { key: 'bride-id', label: "Bride's ID proof", required: true },
        { key: 'marriage-proof', label: 'Proof of marriage (e.g. invitation card or ceremony photograph)', required: true },
        item(ADDRESS, { required: false }),
        { key: 'witness-id', label: 'Witness ID proof', required: false },
      ],
    },
    bpl: {
      confirmed: false,
      items: [
        ID,
        ADDRESS,
        { key: 'ration-card', label: 'Ration card', required: false },
        { key: 'income-proof', label: 'Income proof', required: false },
        { key: 'earlier-bpl-proof', label: 'Earlier BPL card or survey reference', required: false },
      ],
    },
    nodues: {
      confirmed: false,
      items: [
        ID,
        item(ADDRESS, { required: false }),
        { key: 'tax-receipt', label: 'Latest property tax / water bill receipt', required: true },
      ],
    },
    property: {
      confirmed: false,
      items: [
        ID,
        { key: 'ownership-proof', label: 'Property ownership proof', required: true },
        { key: 'tax-receipt', label: 'Latest property tax receipt', required: false },
        { key: 'property-sketch', label: 'Property map or sketch', required: false },
      ],
    },
    other: {
      confirmed: false,
      staffDefined: true,
      items: [
        { key: 'supporting-document', label: 'Supporting document (if you have one)', required: false },
      ],
    },
  };

  var KEY_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
  // Documents staff ask for beyond the checklist get these keys (extra-1, extra-2, ...).
  var EXTRA_KEY_RE = /^extra-[1-9][0-9]?$/;

  function getChecklist(serviceType) {
    return Object.prototype.hasOwnProperty.call(CHECKLISTS, serviceType) ? CHECKLISTS[serviceType] : null;
  }

  function findItem(serviceType, key) {
    var list = getChecklist(serviceType);
    if (!list) return null;
    for (var i = 0; i < list.items.length; i++) if (list.items[i].key === key) return list.items[i];
    return null;
  }

  /** Items the citizen must upload before the form can be submitted. */
  function requiredItems(serviceType) {
    var list = getChecklist(serviceType);
    return list ? list.items.filter(function (i) { return i.required; }) : [];
  }

  /**
   * Which required documents are missing, given the `docType`s that were chosen
   * or uploaded. Returns the items (not just keys) so callers can name them.
   */
  function missingRequired(serviceType, presentKeys) {
    var have = {};
    (presentKeys || []).forEach(function (k) { have[k] = true; });
    return requiredItems(serviceType).filter(function (i) { return !have[i.key]; });
  }

  /** Display label for a stored docType (checklist label, or the label staff gave). */
  function labelFor(serviceType, doc) {
    var found = doc && typeof doc.docType === 'string' ? findItem(serviceType, doc.docType) : null;
    if (found) return found.label;
    if (doc && typeof doc.docLabel === 'string' && doc.docLabel) return doc.docLabel;
    return '';
  }

  var api = {
    NOTICE: NOTICE,
    CHECKLISTS: CHECKLISTS,
    KEY_RE: KEY_RE,
    EXTRA_KEY_RE: EXTRA_KEY_RE,
    getChecklist: getChecklist,
    findItem: findItem,
    requiredItems: requiredItems,
    missingRequired: missingRequired,
    labelFor: labelFor,
  };

  root.DocumentChecklists = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
