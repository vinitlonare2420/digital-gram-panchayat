/* ==========================================================================
   api/_lib/availability.js — pure rules for the staff + admin "I Am Here" feature.

   No Firebase calls in here: everything takes plain values so it can be unit
   tested, and api/availability.js does the reading/writing.

   What "available" means:
   - the administrator has switched the feature ON, and
   - the staff member's own "I am here" confirmation is recent — newer than
     `staleAfterMinutes` by the SERVER clock — and
   - that person is still an ACTIVE account with the staff or admin role.
   The office is available when AT LEAST ONE such person is currently present (logical OR).
   It is self-reported presence. Nothing here knows or checks a location.
   ========================================================================== */

const DEFAULTS = Object.freeze({
  enabled: false,                       // safe default: nothing is shown until an admin switches it on
  staleAfterMinutes: 120,
  officeLabel: "Gram Panchayat Office",
});
const LIMITS = Object.freeze({ minStaleMinutes: 5, maxStaleMinutes: 1440, maxLabelLength: 80 });

// A confirmation dated this far in the FUTURE (clock skew, bad data) is not trusted.
const FUTURE_SKEW_MS = 2 * 60 * 1000;

/** Firestore Timestamp | Date | number (ms) -> number (ms), or NaN when unusable. */
function toMillis(value) {
  if (value && typeof value.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return NaN;
}

function toIso(ms) {
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** Settings as stored (or missing / damaged) -> a complete, safe settings object. */
function normalizeSettings(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const minutes = r.staleAfterMinutes;
  const label = typeof r.officeLabel === "string" ? r.officeLabel.trim() : "";
  return {
    enabled: r.enabled === true,
    staleAfterMinutes: Number.isInteger(minutes) && minutes >= LIMITS.minStaleMinutes && minutes <= LIMITS.maxStaleMinutes
      ? minutes : DEFAULTS.staleAfterMinutes,
    officeLabel: label.length > 0 && label.length <= LIMITS.maxLabelLength ? label : DEFAULTS.officeLabel,
  };
}

/** Admin input -> { changes } or { error }. Strict types; unknown fields are ignored. */
function validateConfig(body) {
  const b = body && typeof body === "object" ? body : {};
  const changes = {};

  if (b.enabled !== undefined) {
    if (typeof b.enabled !== "boolean") return { error: "Invalid request." };
    changes.enabled = b.enabled;
  }
  if (b.staleAfterMinutes !== undefined) {
    const m = b.staleAfterMinutes;
    if (!Number.isInteger(m) || m < LIMITS.minStaleMinutes || m > LIMITS.maxStaleMinutes) {
      return { error: `Expiry must be a whole number of minutes between ${LIMITS.minStaleMinutes} and ${LIMITS.maxStaleMinutes}.` };
    }
    changes.staleAfterMinutes = m;
  }
  if (b.officeLabel !== undefined) {
    const label = typeof b.officeLabel === "string" ? b.officeLabel.trim() : "";
    // eslint-disable-next-line no-control-regex
    if (!label || label.length > LIMITS.maxLabelLength || /[\u0000-\u001f\u007f]/.test(label)) {
      return { error: `The office name must be 1–${LIMITS.maxLabelLength} characters.` };
    }
    changes.officeLabel = label;
  }
  if (Object.keys(changes).length === 0) return { error: "Nothing to change." };
  return { changes };
}

/** Is a confirmation made at `updatedMs` still valid at `nowMs`? */
function isCurrent(updatedMs, nowMs, staleAfterMinutes) {
  if (!Number.isFinite(updatedMs) || !Number.isFinite(nowMs)) return false;
  const age = nowMs - updatedMs;
  if (age < -FUTURE_SKEW_MS) return false;            // dated in the future: not trusted
  return age <= staleAfterMinutes * 60 * 1000;
}

/**
 * The summary citizens (and everyone else) receive. Deliberately minimal: no
 * names, ids, counts or e-mail addresses.
 *
 * entries: [{ eligible: boolean (active staff or admin account), available: boolean, updatedMs: number }]
 */
function summarize({ settings, entries, nowMs }) {
  const base = {
    enabled: settings.enabled,
    staleAfterMinutes: settings.staleAfterMinutes,
    officeLabel: settings.officeLabel,
    serverTime: toIso(nowMs),
  };
  if (!settings.enabled) return { ...base, state: "disabled", lastUpdated: null };

  const usable = entries.filter((e) => e.eligible && Number.isFinite(e.updatedMs) && e.updatedMs - nowMs <= FUTURE_SKEW_MS);
  const someoneHere = usable.some((e) => e.available && isCurrent(e.updatedMs, nowMs, settings.staleAfterMinutes));
  const newest = usable.reduce((max, e) => Math.max(max, e.updatedMs), -Infinity);
  return { ...base, state: someoneHere ? "available" : "none", lastUpdated: Number.isFinite(newest) ? toIso(newest) : null };
}

/** One staff member's or admin's own status. `entry` is null when they have never confirmed. */
function describeMine(entry, settings, nowMs) {
  const updatedMs = entry ? entry.updatedMs : NaN;
  const trusted = Number.isFinite(updatedMs) && updatedMs - nowMs <= FUTURE_SKEW_MS;
  const reported = !!(entry && entry.available && trusted);
  const available = settings.enabled && reported && isCurrent(updatedMs, nowMs, settings.staleAfterMinutes);
  return {
    available,
    reported,                                                         // what they last said, even if it has expired
    updatedAt: trusted ? toIso(updatedMs) : null,
    expiresAt: trusted ? toIso(updatedMs + settings.staleAfterMinutes * 60 * 1000) : null,
  };
}

/** Admin overview label for one staff member or admin. */
function staffState(entry, settings, nowMs) {
  if (!entry) return "never";
  if (!Number.isFinite(entry.updatedMs) || entry.updatedMs - nowMs > FUTURE_SKEW_MS) return "unavailable";
  if (!entry.available) return "unavailable";
  return isCurrent(entry.updatedMs, nowMs, settings.staleAfterMinutes) ? "available" : "expired";
}

module.exports = {
  DEFAULTS, LIMITS, FUTURE_SKEW_MS,
  toMillis, toIso, normalizeSettings, validateConfig, isCurrent, summarize, describeMine, staffState,
};
