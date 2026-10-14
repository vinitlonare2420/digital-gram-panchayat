#!/usr/bin/env node
/* ==========================================================================
   scripts/build-static-backup.js — builds the GitHub Pages STATIC BACKUP.

   The real application runs on Vercel (static pages + the /api serverless
   functions). GitHub Pages can only serve files, so the backup is deliberately
   NOT a copy of the application. It is an information-only site:

     - the public information pages (home, services, about, contact, track),
       each with a visible "static backup" banner;
     - a notice page at the address of every other page (login, register, the
       service forms, citizen / staff / admin pages), so no link is broken and
       nothing pretends to work: the notice says the feature needs the main
       application and links to it;
     - only the browser scripts and CSS those public pages use. The scripts that
       talk to Firebase or to /api, the api/ folder, scripts/, tests/, rules,
       package files and every .env* file are never copied.

   Usage:   node scripts/build-static-backup.js [--out dist-static]
   Env:     PRIMARY_APP_URL   optional, https address of the main (Vercel)
                              application, e.g. https://digital-gram-panchayat.vercel.app
                              (set it as a GitHub repository VARIABLE — it is not a secret)

   After building, the output is VERIFIED and the build fails (exit 1) if it
   contains anything that must not be public (secrets, server files, /api calls,
   Firebase scripts, root-absolute links that would break on a project site, or
   a link that does not resolve).

   Uses only Node built-ins. Never reads or writes .env files.
   ========================================================================== */

const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

/** The ONLY real pages published. Every other .html file becomes a notice page. */
const PUBLIC_PAGES = ["index.html", "about.html", "contact.html", "track.html", "services.html"];

/** Folders that are never searched for pages or assets. */
const SKIP_DIRS = new Set(["node_modules", ".git", ".github", ".vercel", ".vscode", ".agents", "graphify-out", "tests", "scripts", "api", "dist-static"]);

/** Browser scripts that use Firebase or /api: never published. (navbar-auth.js is replaced by an inert stub.) */
const BACKEND_SCRIPTS = new Set([
  "firebase.js", "auth.js", "api.js", "applications.js", "uploads.js", "admin.js", "staff.js",
  "availability.js", "availability-ui.js", "navbar-auth.js", "service-form.js", "checklist-ui.js",
]);

const ASSET_EXTENSIONS = new Set([".js", ".css", ".png", ".jpg", ".jpeg", ".svg", ".ico", ".webp", ".woff", ".woff2"]);
const ALLOWED_OUTPUT_EXTENSIONS = new Set([".html", ".css", ".js", ".png", ".jpg", ".jpeg", ".svg", ".ico", ".webp", ".woff", ".woff2"]);
const ALLOWED_OUTPUT_DOTFILES = new Set([".nojekyll"]);

const NAVBAR_STUB = `/* Static backup copy: there is no sign-in here, so the navbar keeps its default
   Login / Register buttons (which open a notice pointing to the main application). */
export {};
`;

/* ------------------------------------------------------------------ helpers */

const toPosix = (p) => p.split(path.sep).join("/");
const escapeHtml = (v) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** null when not configured; otherwise a clean https origin+path. Throws on anything suspicious. */
function normalizePrimaryUrl(value) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  let url;
  try { url = new URL(String(value).trim()); } catch (_) { throw new Error("PRIMARY_APP_URL is not a valid URL."); }
  if (url.protocol !== "https:") throw new Error("PRIMARY_APP_URL must start with https://");
  if (url.username || url.password) throw new Error("PRIMARY_APP_URL must not contain credentials.");
  if (url.search || url.hash) throw new Error("PRIMARY_APP_URL must not contain a query string or fragment.");
  if (!/^[a-z0-9.-]+$/i.test(url.hostname)) throw new Error("PRIMARY_APP_URL has an unusual host name.");
  if (!/^[A-Za-z0-9._~\-/]*$/.test(url.pathname)) throw new Error("PRIMARY_APP_URL has unusual characters in its path.");
  return url.origin + url.pathname.replace(/\/+$/, "");
}

/** The output folder may be (re)created only if it is clearly a build folder: dist-static*, or inside the OS temp dir. */
function assertSafeOutDir(outDir) {
  const resolved = path.resolve(outDir);
  const inTemp = resolved.startsWith(path.resolve(os.tmpdir()) + path.sep);
  const named = path.basename(resolved).startsWith("dist-static");
  if (resolved === ROOT || ROOT.startsWith(resolved + path.sep) || resolved === path.parse(resolved).root) throw new Error(`Refusing to use ${resolved} as the output folder.`);
  if (!named && !inTemp) throw new Error(`The output folder must be named dist-static* (or be inside the temp folder): ${resolved}`);
  return resolved;
}

function walk(dir, visit, base = dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (dir === base && SKIP_DIRS.has(entry.name)) continue;      // only the top level is skipped
      walk(full, visit, base);
    } else visit(full, toPosix(path.relative(base, full)));
  }
}

function writeFile(outDir, rel, content) {
  const target = path.join(outDir, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

/** Local (relative, same-site) references in an HTML/JS/CSS text. */
function localRefs(text, kind) {
  const refs = [];
  const add = (r) => {
    if (!r || /^([a-z][a-z0-9+.-]*:|\/\/|#|\$\{)/i.test(r)) return;      // http:, mailto:, data:, //cdn, #anchor, template
    refs.push(r);
  };
  if (kind === "html") {
    for (const m of text.matchAll(/\b(?:src|href)\s*=\s*"([^"]*)"/g)) add(m[1]);
  } else if (kind === "js") {
    for (const m of text.matchAll(/\bimport\s*(?:[\w*{}\s,]+from\s*)?["'`](\.{1,2}\/[^"'`]+)["'`]/g)) add(m[1]);
    for (const m of text.matchAll(/\bimport\(\s*["'`](\.{1,2}\/[^"'`]+)["'`]\s*\)/g)) add(m[1]);
  } else if (kind === "css") {
    for (const m of text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) add(m[1]);
    for (const m of text.matchAll(/@import\s+["']([^"']+)["']/g)) add(m[1]);
  }
  return refs;
}
const stripQueryAndHash = (r) => r.split("#")[0].split("?")[0];

/* ------------------------------------------------------------------ page builders */

function bannerHtml(primaryUrl) {
  const link = primaryUrl
    ? ` <a href="${escapeHtml(primaryUrl)}" style="color:#7c2d12;font-weight:600;text-decoration:underline">Open the main application</a>.`
    : " The address of the main application has not been configured for this backup copy.";
  return `
  <div id="static-backup-banner" role="alert" style="background:#fff7ed;border-bottom:1px solid #fdba74;color:#7c2d12;padding:10px 16px;font:14px/1.45 system-ui,-apple-system,'Segoe UI',sans-serif;text-align:center">
    <strong>Static backup copy.</strong> Login, applications, document uploads and the staff and admin workflows work only on the main application (which runs on Vercel together with its server functions).${link}
  </div>`;
}

function injectBanner(html, primaryUrl) {
  const match = /<body[^>]*>/i.exec(html);
  if (!match) throw new Error("A public page has no <body> tag to place the backup banner in.");
  const at = match.index + match[0].length;
  return html.slice(0, at) + bannerHtml(primaryUrl) + html.slice(at);
}

const NOTICE_STYLE = `body{margin:0;background:#faf9f5;color:#1f2a24;font:16px/1.55 system-ui,-apple-system,'Segoe UI',sans-serif}
main{max-width:640px;margin:0 auto;padding:48px 20px}
.card{background:#fff;border:1px solid #e3e1d8;border-radius:12px;padding:28px}
h1{font-size:22px;margin:0 0 12px}
p{margin:0 0 14px}
code{background:#f1efe7;border-radius:4px;padding:1px 6px;font-size:14px}
.btn{display:inline-block;background:#1f6f4a;color:#fff;text-decoration:none;border-radius:8px;padding:11px 18px;font-weight:600}
.muted{color:#5b665f;font-size:14px}
.warn{background:#fff7ed;border:1px solid #fdba74;color:#7c2d12;border-radius:8px;padding:12px 14px}`;

function noticePage(rel, primaryUrl) {
  const depth = rel.split("/").length - 1;
  const home = "../".repeat(depth) + "index.html";
  const target = primaryUrl ? `${primaryUrl}/${rel}` : null;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex" />
  <title>Main application required — Digital Gram Panchayat</title>
  <style>${NOTICE_STYLE}</style>
</head>
<body>
  <main>
    <div class="card">
      <h1>This part of the portal is on the main application</h1>
      <p>You opened <code>${escapeHtml(rel)}</code> on the <strong>static backup copy</strong> of Digital Gram Panchayat. The backup only shows information pages. Login, applications, document uploads and the staff and admin workflows need the server functions of the main application, which this copy does not have.</p>
      ${target
        ? `<p><a class="btn" href="${escapeHtml(target)}">Open this page on the main application</a></p>`
        : `<p class="warn">The address of the main application has not been configured for this backup copy, so there is no link to it here.</p>`}
      <p class="muted"><a href="${escapeHtml(home)}">Back to the backup home page</a></p>
    </div>
  </main>
</body>
</html>
`;
}

function notFoundPage(primaryUrl) {
  // GitHub Pages serves this file for ANY unknown address at ANY depth, so it uses no relative links.
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex" />
  <title>Page not found — Digital Gram Panchayat (static backup)</title>
  <style>${NOTICE_STYLE}</style>
</head>
<body>
  <main>
    <div class="card">
      <h1>Page not found</h1>
      <p>This is the <strong>static backup copy</strong> of Digital Gram Panchayat, and it has no page at this address.</p>
      ${primaryUrl
        ? `<p><a class="btn" href="${escapeHtml(primaryUrl)}">Open the main application</a></p>`
        : `<p class="warn">The address of the main application has not been configured for this backup copy.</p>`}
    </div>
  </main>
</body>
</html>
`;
}

/* ------------------------------------------------------------------ verification */

const FORBIDDEN_PATHS = [
  [/(^|\/)\.env/i, "an environment file"],
  [/service-?account/i, "a service-account file"],
  [/adminsdk/i, "a Firebase Admin credential file"],
  [/\.(pem|key|p12|pfx|crt)$/i, "a key or certificate file"],
  [/^api\//, "the server-function folder"],
  [/^(scripts|tests|node_modules)\//, "a developer-only folder"],
  [/(^|\/)firestore\.rules$/, "the Firestore rules file"],
  [/(^|\/)package(-lock)?\.json$/, "a package file"],
  [/\.(md|log|test\.js)$/i, "documentation, logs or tests"],
];
const FORBIDDEN_CONTENT = [
  [/BEGIN [A-Z ]*PRIVATE KEY/, "a private key"],
  [/"private_key"\s*:/, "a service-account private_key field"],
  [/SUPABASE_SERVICE_ROLE_KEY|service_role/i, "a Supabase service-role reference"],
  [/FIREBASE_SERVICE_ACCOUNT_KEY/, "the Firebase service-account variable"],
  [/eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/, "a JWT-like token"],
  [/\/api\/(documents|admin|staff|applications|availability)\b/, "a call to the /api functions"],
  [/firebasejs|initializeApp\s*\(|firebaseConfig/, "Firebase client code"],
];

/** Returns a list of problems (empty = safe to publish). */
function verifyOutput(outDir) {
  const problems = [];
  const files = [];
  (function collect(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) collect(full); else files.push(toPosix(path.relative(outDir, full)));
    }
  })(outDir);

  for (const rel of files) {
    const base = path.posix.basename(rel);
    const ext = path.posix.extname(rel).toLowerCase();
    for (const [re, what] of FORBIDDEN_PATHS) if (re.test(rel)) problems.push(`${rel}: ${what} must not be published`);
    if (!ALLOWED_OUTPUT_EXTENSIONS.has(ext) && !ALLOWED_OUTPUT_DOTFILES.has(base)) problems.push(`${rel}: file type ${ext || base} is not on the allowed list`);
    if (BACKEND_SCRIPTS.has(base) && base !== "navbar-auth.js") problems.push(`${rel}: a Firebase / API script must not be published`);

    if ([".html", ".js", ".css"].includes(ext)) {
      const text = fs.readFileSync(path.join(outDir, rel), "utf8");
      for (const [re, what] of FORBIDDEN_CONTENT) if (re.test(text)) problems.push(`${rel}: contains ${what}`);
      const kind = ext.slice(1);
      if (kind === "js") {
        for (const m of text.matchAll(/\$\{SITE_BASE\}([A-Za-z0-9_\/-]+\.html)/g)) {
          if (!fs.existsSync(path.join(outDir, m[1]))) problems.push(`${rel}: the shared navigation links to "${m[1]}", which does not exist in the backup`);
        }
      }
      for (const ref of localRefs(text, kind)) {
        if (ref.startsWith("/")) { problems.push(`${rel}: root-absolute link "${ref}" would break on a GitHub project site`); continue; }
        const clean = stripQueryAndHash(ref);
        if (!clean) continue;
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), clean));
        if (target.startsWith("../") || !fs.existsSync(path.join(outDir, target))) problems.push(`${rel}: link "${ref}" does not resolve inside the backup`);
      }
    }
  }
  return problems;
}

/* ------------------------------------------------------------------ build */

function buildStaticBackup({ root = ROOT, outDir = path.join(ROOT, "dist-static"), primaryUrl: rawPrimary = process.env.PRIMARY_APP_URL } = {}) {
  const primaryUrl = normalizePrimaryUrl(rawPrimary);
  const out = assertSafeOutDir(outDir);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  // 1) every page in the repository
  const allPages = [];
  walk(root, (full, rel) => { if (rel.endsWith(".html") && rel !== "404.html") allPages.push(rel); });
  for (const rel of PUBLIC_PAGES) if (!allPages.includes(rel)) throw new Error(`Public page ${rel} is missing from the repository.`);

  // 2) public pages: copied with the backup banner; collect the assets they use
  const assets = new Set();
  const queue = [];
  const queueAsset = (fromRel, ref) => {
    const clean = stripQueryAndHash(ref);
    if (!clean || clean.startsWith("/")) return;
    const rel = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), clean));
    const ext = path.posix.extname(rel).toLowerCase();
    if (!ASSET_EXTENSIONS.has(ext) || rel.startsWith("../")) return;
    if (!assets.has(rel)) { assets.add(rel); queue.push(rel); }
  };

  for (const rel of PUBLIC_PAGES) {
    const html = fs.readFileSync(path.join(root, rel), "utf8");
    writeFile(out, rel, injectBanner(html, primaryUrl));
    for (const ref of localRefs(html, "html")) queueAsset(rel, ref);
  }

  // 3) assets, following imports inside scripts and styles
  while (queue.length) {
    const rel = queue.shift();
    const base = path.posix.basename(rel);
    if (base === "navbar-auth.js") { writeFile(out, rel, NAVBAR_STUB); continue; }
    if (BACKEND_SCRIPTS.has(base)) throw new Error(`A public page needs ${rel}, which talks to Firebase or /api and must not be published.`);
    const source = path.join(root, rel);
    if (!fs.existsSync(source)) throw new Error(`A public page references ${rel}, which does not exist.`);
    const ext = path.posix.extname(rel).toLowerCase();
    if (ext === ".js" || ext === ".css") {
      const text = fs.readFileSync(source, "utf8");
      writeFile(out, rel, text);
      for (const ref of localRefs(text, ext.slice(1))) queueAsset(rel, ref);
    } else {
      writeFile(out, rel, fs.readFileSync(source));
    }
  }

  // 4) every other page becomes a notice at the same address (no broken links, nothing pretends to work)
  const stubs = allPages.filter((rel) => !PUBLIC_PAGES.includes(rel));
  for (const rel of stubs) writeFile(out, rel, noticePage(rel, primaryUrl));

  // 5) housekeeping files
  writeFile(out, "404.html", notFoundPage(primaryUrl));
  writeFile(out, ".nojekyll", "");

  const problems = verifyOutput(out);
  if (problems.length) throw new Error("The static backup is not safe to publish:\n  - " + problems.join("\n  - "));

  return { outDir: out, primaryUrl, published: [...PUBLIC_PAGES], stubs, assets: [...assets].sort() };
}

module.exports = { buildStaticBackup, verifyOutput, normalizePrimaryUrl, assertSafeOutDir, PUBLIC_PAGES, BACKEND_SCRIPTS, FORBIDDEN_PATHS, FORBIDDEN_CONTENT };

/* ------------------------------------------------------------------ CLI */

if (require.main === module) {
  const argIndex = process.argv.indexOf("--out");
  const outDir = argIndex > -1 ? process.argv[argIndex + 1] : path.join(ROOT, "dist-static");
  try {
    const report = buildStaticBackup({ outDir });
    console.log(`Static backup built in ${path.relative(process.cwd(), report.outDir) || "."}`);
    console.log(`  public pages:  ${report.published.length}  (${report.published.join(", ")})`);
    console.log(`  notice pages:  ${report.stubs.length}`);
    console.log(`  assets:        ${report.assets.length}  (${report.assets.join(", ")})`);
    if (report.primaryUrl) console.log(`  main application link: ${report.primaryUrl}`);
    else {
      console.log("  main application link: NOT CONFIGURED (set the PRIMARY_APP_URL repository variable)");
      if (process.env.GITHUB_ACTIONS) console.log("::warning::PRIMARY_APP_URL is not set, so the static backup has no link to the main application.");
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
