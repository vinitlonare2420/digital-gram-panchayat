/* ==========================================================================
   firebase.js — Firebase App / Authentication / Firestore initialization.

   This is the ONLY file where Firebase project configuration lives.
   Everything else (auth.js, pages) imports `auth` and `db` from here.

   ==========================================================================
   >>> PASTE YOUR FIREBASE CONFIG BELOW <<<

   Where to get it:
     1. Go to https://console.firebase.google.com and open your project
        (create one first if you haven't — see README.md "Firebase Console
        setup steps").
     2. Project settings (gear icon) → General tab → "Your apps".
     3. Add a Web app (</> icon) if you don't have one yet, name it anything
        (e.g. "Digital Gram Panchayat Web").
     4. Firebase shows a `firebaseConfig` object — copy those exact values
        into the object below, replacing every "REPLACE_WITH_..." placeholder.

   Do NOT commit real API keys to a public repository if this project is
   ever pushed to GitHub for evaluation — for a client-only web app this key
   is not a secret in the traditional sense (it identifies the project, it
   does not grant access on its own), but access is still controlled by the
   Firebase security rules in firestore.rules, not by hiding this key.
   ========================================================================== */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCrgPimRFEgp0idXRx_9aElfHxCXWsC5Qo",
  authDomain: "digital-gram-panchayat-79020.firebaseapp.com",
  projectId: "digital-gram-panchayat-79020",
  storageBucket: "digital-gram-panchayat-79020.firebasestorage.app",
  messagingSenderId: "400686037785",
  appId: "1:400686037785:web:151c5e943cbe8def656388",
};

export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);
