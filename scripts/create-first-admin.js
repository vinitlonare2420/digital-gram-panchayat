/* ==========================================================================
   scripts/create-first-admin.js — one-time, LOCAL-ONLY first admin setup.

   Run from the project folder:   npm run create-admin

   Why a local script: there must be no web page or API that can create an
   admin (that would be public admin registration). Only someone who already
   holds the Firebase service-account key on their own machine (.env.local)
   can run this, which is exactly the trust boundary we want.

   Safety rules enforced here:
   - refuses to run if any admin already exists (more admins are not created
     from here — use a deliberate, reviewed change instead)
   - refuses to run without an interactive terminal
   - the password is typed with echo OFF and is never printed or logged
   - nothing is created until you type the confirmation phrase
   - an EXISTING Firebase account is only promoted with --promote-existing,
     and its password is left untouched
   ========================================================================== */

const readline = require("readline");
const { getAuth } = require("firebase-admin/auth");
const { FieldValue } = require("firebase-admin/firestore");
const { getFirebaseAdmin, getFirestore } = require("../api/_lib/firebaseAdmin");

const PROMOTE_EXISTING = process.argv.includes("--promote-existing");
const CONFIRM_PHRASE = "CREATE ADMIN";

function fail(message) {
  console.error("\n" + message);
  process.exit(1);
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); }));
}

/** Reads a line from the terminal without echoing the characters. */
function askHidden(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    // A pasted password arrives as one multi-character chunk, so handle it character by character.
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === "\u0003") { process.stdout.write("\n"); process.exit(1); } // Ctrl+C
        if (char === "\r" || char === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener("data", onData);
          process.stdout.write("\n");
          return resolve(value);
        }
        if (char === "\u007f" || char === "\b") { value = value.slice(0, -1); continue; }
        value += char;
      }
    };
    stdin.on("data", onData);
  });
}

async function main() {
  if (!process.stdin.isTTY) fail("This script needs an interactive terminal. Run it directly with: npm run create-admin");
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_KEY) fail("FIREBASE_SERVICE_ACCOUNT_KEY is not set. Run it with: npm run create-admin");

  const app = getFirebaseAdmin();
  const auth = getAuth(app);
  const db = getFirestore();

  const projectId = app.options.projectId || JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY).project_id;
  console.log(`\nFirebase project: ${projectId}`);

  const existing = await db.collection("users").where("role", "==", "admin").limit(1).get();
  if (!existing.empty) fail("An admin account already exists. Nothing was changed.");

  const name = await ask("Admin full name: ");
  const email = (await ask("Admin email (use a NEW address, not your citizen account): ")).toLowerCase();
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("A name and a valid email are required.");

  let existingUser = null;
  try { existingUser = await auth.getUserByEmail(email); } catch (error) {
    if (error.code !== "auth/user-not-found") throw error;
  }

  let password = null;
  if (existingUser) {
    if (!PROMOTE_EXISTING) {
      fail("That email already has a Firebase account. Re-run with --promote-existing only if you really want to turn it into the admin.");
    }
    const profileSnap = await db.collection("users").doc(existingUser.uid).get();
    if (profileSnap.exists && profileSnap.data().role === "staff") fail("That account is a staff account. Refusing to promote it.");
    console.log("\nThe existing account will be promoted to admin. Its password stays unchanged.");
  } else {
    password = await askHidden("Password (min 12 characters, typing is hidden): ");
    const again = await askHidden("Repeat password: ");
    if (password !== again) fail("Passwords did not match. Nothing was changed.");
    if (password.length < 12) fail("Password must be at least 12 characters. Nothing was changed.");
  }

  console.log(`\nAbout to ${existingUser ? "PROMOTE" : "CREATE"} an ADMIN account:\n  name:  ${name}\n  email: ${email}\n  project: ${projectId}`);
  const confirmation = await ask(`Type ${CONFIRM_PHRASE} to continue: `);
  if (confirmation !== CONFIRM_PHRASE) fail("Not confirmed. Nothing was changed.");

  let uid;
  if (existingUser) {
    uid = existingUser.uid;
    if (existingUser.disabled) await auth.updateUser(uid, { disabled: false });
  } else {
    const created = await auth.createUser({ email, password, displayName: name, emailVerified: false });
    uid = created.uid;
  }

  const ref = db.collection("users").doc(uid);
  const snap = await ref.get();
  const profile = {
    name,
    email,
    role: "admin",
    active: true,
    ...(snap.exists ? {} : { mobile: "", createdAt: FieldValue.serverTimestamp() }),
    updatedAt: FieldValue.serverTimestamp(),
  };
  await ref.set(profile, { merge: true });

  console.log("\nDone. Admin account is ready. Log in at /admin/login.html (or /login.html) — you will be sent to the admin dashboard.");
  process.exit(0);
}

main().catch((error) => {
  // Print only the safe error code/message — never credentials.
  fail(`Failed: ${error.code || error.message}`);
});
