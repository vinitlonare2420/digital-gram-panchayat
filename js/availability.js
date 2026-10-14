/* ==========================================================================
   availability.js — browser-side calls for the staff "I Am Here" feature.

   ES module exposing window.GPAvailability. Every call goes to ONE endpoint,
   /api/availability, which decides what the signed-in user may do (staff set
   their own state, admins change settings, everyone reads a minimal summary).
   Nothing here grants any permission, and the browser never writes these
   Firestore collections directly (firestore.rules deny it).
   ========================================================================== */

import { apiPost } from "./api.js";

const call = (action, fields = {}) => apiPost("/api/availability", { action, ...fields });

window.GPAvailability = {
  /** Minimal summary: { enabled, state: "available" | "none" | "disabled", lastUpdated, staleAfterMinutes, officeLabel, mine? } */
  getStatus: () => call("status"),
  /** Staff only: confirm / withdraw "I am at the office" for yourself. */
  setMine: (available) => call("set", { available }),
  /** Admin only: { enabled?, staleAfterMinutes?, officeLabel? } */
  configure: (changes) => call("configure", changes),
  /** Admin only: settings + each staff member's current state. */
  overview: () => call("overview"),
};
window.dispatchEvent(new Event("gpavailability-ready"));
