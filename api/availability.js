/* ==========================================================================
   POST /api/availability        — staff + admin "I Am Here" availability

   Request:  { action, ...fields }      (JSON, Authorization: Bearer <ID token>)

   action        who may call it                 what it does
   ------------  ------------------------------  -----------------------------
   "status"      any signed-in, active account   minimal summary for the UI
   "set"         active STAFF or ADMIN, for     { available: boolean }
                 THEMSELVES only
   "configure"   active ADMIN                    { enabled?, staleAfterMinutes?, officeLabel? }
   "overview"    active ADMIN                    settings + each staff member's state

   Why this is an API and not direct Firestore access:
   - the caller's role is read from Firestore here, never from the request;
   - timestamps are written with the SERVER clock and staleness is judged with
     the SERVER clock, so a wrong device clock cannot fake presence;
   - citizens get only a minimal summary (no names, ids or counts);
   - firestore.rules deny every direct client read/write of these collections.

   Data:  settings/availability        { enabled, staleAfterMinutes, officeLabel, updatedAt, updatedBy }
          staffAvailability/{uid}      { available, updatedAt }   (uid of a staff OR admin account)

   The office is "available" when AT LEAST ONE active staff or admin account has a
   current (not expired) confirmation — see summarize() in _lib/availability.js.

   Availability is STAFF-REPORTED. No location is requested, stored or checked.
   ========================================================================== */

const { FieldValue } = require("firebase-admin/firestore");
const { getCaller, sendAuthzError } = require("./_lib/authz");
const { getFirestore } = require("./_lib/firebaseAdmin");
const { readJsonBody } = require("./_lib/validation");
const {
  toMillis, toIso, normalizeSettings, validateConfig, summarize, describeMine, staffState,
} = require("./_lib/availability");

const SETTINGS_COLLECTION = "settings";
const SETTINGS_DOC = "availability";
const STAFF_COLLECTION = "staffAvailability";

const isPresenceRole = (role) => role === "staff" || role === "admin";
const denied = (res) => res.status(403).json({ error: "You do not have permission to do this." });

async function loadSettings(db) {
  const snapshot = await db.collection(SETTINGS_COLLECTION).doc(SETTINGS_DOC).get();
  return { settings: normalizeSettings(snapshot.exists ? snapshot.data() : null), raw: snapshot.exists ? snapshot.data() : null };
}

/** Every availability entry, joined with the owner's profile so only ACTIVE staff / admin accounts count. */
async function loadEntries(db) {
  const snapshot = await db.collection(STAFF_COLLECTION).limit(200).get();
  const profiles = await Promise.all(snapshot.docs.map((d) => db.collection("users").doc(d.id).get()));
  return snapshot.docs.map((d, i) => {
    const data = d.data() || {};
    const profile = profiles[i].exists ? profiles[i].data() : null;
    return {
      uid: d.id,
      eligible: !!profile && isPresenceRole(profile.role) && profile.active !== false,
      role: profile ? profile.role : null,
      name: profile && typeof profile.name === "string" ? profile.name : "",
      available: data.available === true,
      updatedMs: toMillis(data.updatedAt),
    };
  });
}

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
  if (body === null || typeof body.action !== "string") return res.status(400).json({ error: "Invalid request." });

  try {
    const db = getFirestore();

    /* ---------------- status: everyone ---------------- */
    if (body.action === "status") {
      const { settings } = await loadSettings(db);
      const nowMs = Date.now();
      const entries = settings.enabled ? await loadEntries(db) : [];
      const summary = summarize({ settings, entries, nowMs });

      if (isPresenceRole(caller.role)) {
        const own = entries.find((e) => e.uid === caller.uid) || null;
        summary.mine = describeMine(own, settings, nowMs);
      }
      return res.status(200).json(summary);
    }

    /* ---------------- set: a staff member or admin, for themselves only ---------------- */
    if (body.action === "set") {
      if (!isPresenceRole(caller.role)) return denied(res);
      if (typeof body.available !== "boolean") return res.status(400).json({ error: "Invalid request." });

      const { settings } = await loadSettings(db);
      if (!settings.enabled) {
        return res.status(409).json({ error: "Availability is switched off by the administrator." });
      }

      // The document id is the CALLER's uid — nothing in the request can point at another person,
      // and the timestamp is the server's, whatever the request says.
      const ref = db.collection(STAFF_COLLECTION).doc(caller.uid);
      await ref.set({ available: body.available, updatedAt: FieldValue.serverTimestamp() });

      const stored = await ref.get();
      const nowMs = Date.now();
      const own = stored.exists ? { available: stored.data().available === true, updatedMs: toMillis(stored.data().updatedAt) } : null;
      return res.status(200).json({ ok: true, mine: describeMine(own, settings, nowMs) });
    }

    /* ---------------- configure / overview: admin only ---------------- */
    if (body.action === "configure" || body.action === "overview") {
      if (caller.role !== "admin") return denied(res);
    }

    if (body.action === "configure") {
      const { changes, error } = validateConfig(body);
      if (error) return res.status(400).json({ error });

      const { settings } = await loadSettings(db);
      const next = { ...settings, ...changes };
      await db.collection(SETTINGS_COLLECTION).doc(SETTINGS_DOC).set({
        ...next,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: caller.uid,
      });
      return res.status(200).json({ ok: true, settings: next });
    }

    if (body.action === "overview") {
      const { settings, raw } = await loadSettings(db);
      const nowMs = Date.now();
      const entries = await loadEntries(db);
      const byUid = new Map(entries.map((e) => [e.uid, e]));

      const users = await db.collection("users").limit(500).get();
      const staff = users.docs
        .filter((d) => isPresenceRole(d.data().role) && d.data().active !== false)
        .map((d) => {
          const entry = byUid.get(d.id) || null;
          return {
            name: typeof d.data().name === "string" ? d.data().name : "",
            role: d.data().role,
            state: staffState(entry, settings, nowMs),
            updatedAt: entry && Number.isFinite(entry.updatedMs) ? toIso(entry.updatedMs) : null,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));

      return res.status(200).json({
        settings: { ...settings, updatedAt: raw ? toIso(toMillis(raw.updatedAt)) : null },
        staff,
        serverTime: toIso(nowMs),
      });
    }

    return res.status(400).json({ error: "Invalid request." });
  } catch (error) {
    // Never show internals, and never pretend someone is available when we could not check.
    console.error("[availability] failed:", error.message);
    return res.status(500).json({ error: "Availability is not available right now. Please try again later." });
  }
};
