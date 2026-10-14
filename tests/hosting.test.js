/* ==========================================================================
   tests/hosting.test.js — Vercel (primary) + GitHub Pages (static backup).

   Run with:  npm test

   PART 1  The static backup builder: what it publishes, what it refuses to
           publish, how it treats the main-application link, and that it fails
           closed if something unsafe ever ends up in its output.
   PART 2  The GitHub Actions workflow publishes ONLY the built backup folder.
   PART 3  The Vercel configuration: functions, headers, ignore file, 404 page,
           and that every environment variable the server code reads is
           documented BY NAME in .env.example (never with a value).

   Nothing here deploys anything or talks to GitHub / Vercel.
   ========================================================================== */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const exists = (p) => fs.existsSync(path.join(root, p));
const builder = require(path.join(root, "scripts/build-static-backup.js"));

const PRIMARY = "https://digital-gram-panchayat.example-app.vercel.app";
const madeDirs = [];
const tmp = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gp-backup-test-")); madeDirs.push(dir); return dir; };
test.after(() => madeDirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));   // always clean up, even after a failed assertion
const listFiles = (dir) => {
  const out = [];
  (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); e.isDirectory() ? walk(f) : out.push(path.relative(dir, f).split(path.sep).join("/")); } })(dir);
  return out.sort();
};
const repoPages = () => {
  const skip = new Set(["node_modules", ".git", ".github", ".vercel", ".vscode", ".agents", "graphify-out", "tests", "scripts", "api", "dist-static"]);
  const pages = [];
  (function walk(d, top) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (top && skip.has(e.name)) continue; const f = path.join(d, e.name); if (e.isDirectory()) walk(f, false); else if (e.name.endsWith(".html")) pages.push(path.relative(root, f).split(path.sep).join("/")); } })(root, true);
  return pages.filter((p) => p !== "404.html").sort();
};

/* =========================== PART 1: the builder =========================== */

test("[backup] publishes exactly the public pages, a notice for every other page, and only the scripts and CSS those pages use", () => {
  const out = tmp();
  const report = builder.buildStaticBackup({ outDir: out, primaryUrl: PRIMARY });
  const files = listFiles(out);

  // public pages are real; everything else in the repo has a notice at the same address
  assert.deepEqual(report.published.sort(), ["about.html", "contact.html", "index.html", "services.html", "track.html"]);
  for (const page of repoPages()) assert.ok(files.includes(page), `${page} must exist in the backup (as a page or a notice)`);
  assert.equal(report.stubs.length, repoPages().length - 5);

  // no extra files: pages + 404 + .nojekyll + the assets of the public pages
  const expected = new Set([...repoPages(), "404.html", ".nojekyll", ...report.assets]);
  assert.deepEqual(files, [...expected].sort());
  assert.deepEqual(report.assets.sort(), ["css/style.css", "js/app.js", "js/components.js", "js/navbar-auth.js", "js/utils.js", "js/validation.js"]);

  // the sign-in script is a harmless stub, not the Firebase one
  assert.ok(!/firebase|onAuthStateChanged|import \{/.test(fs.readFileSync(path.join(out, "js/navbar-auth.js"), "utf8")));
  fs.rmSync(out, { recursive: true, force: true });
});

test("[backup] nothing server-side, secret or developer-only is ever copied", () => {
  const out = tmp();
  builder.buildStaticBackup({ outDir: out, primaryUrl: PRIMARY });
  const files = listFiles(out);
  const forbidden = [/^api\//, /^scripts\//, /^tests\//, /node_modules/, /\.env/, /service-?account/i, /adminsdk/i, /firestore\.rules/, /package(-lock)?\.json/, /\.md$/, /^\.github\//, /^\.vercel/, /\.test\.js$/];
  for (const f of files) for (const re of forbidden) assert.ok(!re.test(f), `${f} must not be published (${re})`);
  for (const f of ["firebase.js", "auth.js", "api.js", "applications.js", "uploads.js", "admin.js", "staff.js", "availability.js", "availability-ui.js", "service-form.js", "checklist-ui.js", "document-checklists.js"]) {
    assert.ok(!files.includes("js/" + f), `js/${f} must not be published`);
  }
  // no text file mentions a secret, a server variable or an /api call
  for (const f of files.filter((n) => /\.(html|js|css)$/.test(n))) {
    const text = fs.readFileSync(path.join(out, f), "utf8");
    assert.ok(!/service_role|SERVICE_ROLE|FIREBASE_SERVICE_ACCOUNT|PRIVATE KEY|private_key/.test(text), `${f} mentions a secret`);
    assert.ok(!/\/api\/(documents|admin|staff|applications|availability)/.test(text), `${f} calls the API`);
    assert.ok(!/firebasejs|initializeApp\(|firebaseConfig/.test(text), `${f} contains Firebase client code`);
    assert.ok(!/eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\./.test(text), `${f} contains a token-like string`);
  }
  fs.rmSync(out, { recursive: true, force: true });
});

test("[backup] every public page carries the visible backup banner; notice pages say what to do instead", () => {
  const out = tmp();
  builder.buildStaticBackup({ outDir: out, primaryUrl: PRIMARY });
  for (const page of ["index.html", "about.html", "contact.html", "services.html", "track.html"]) {
    const html = fs.readFileSync(path.join(out, page), "utf8");
    assert.match(html, /id="static-backup-banner" role="alert"/, page);
    assert.match(html, /Static backup copy\./);
    assert.match(html, /Login, applications, document uploads and the staff and admin workflows work only on the main application/);
    assert.ok(html.includes(`href="${PRIMARY}"`), `${page}: banner links to the main application`);
    assert.ok(html.indexOf("static-backup-banner") < html.indexOf("<main") || !html.includes("<main"), `${page}: the banner is at the top`);
  }
  const notice = fs.readFileSync(path.join(out, "citizen/dashboard.html"), "utf8");
  assert.match(notice, /static backup copy/i);
  assert.ok(notice.includes(`href="${PRIMARY}/citizen/dashboard.html"`), "the notice links to the same page on the main application");
  assert.ok(notice.includes('href="../index.html"'), "…and back to the backup home with a RELATIVE link");
  const deep = fs.readFileSync(path.join(out, "services/income.html"), "utf8");
  assert.ok(deep.includes(`href="${PRIMARY}/services/income.html"`));
  assert.ok(!/<form|type="password"|type="file"/.test(notice + deep), "no form that pretends to work");
  // the unknown-address page uses no relative links (it is served at any depth)
  const notFound = fs.readFileSync(path.join(out, "404.html"), "utf8");
  assert.ok(!/(?:href|src)="(?!https:)/.test(notFound), "404.html has only absolute https links");
  fs.rmSync(out, { recursive: true, force: true });
});

test("[backup] without a main-application address it still builds, says so honestly, and never links to 'undefined' or '#'", () => {
  const out = tmp();
  const report = builder.buildStaticBackup({ outDir: out, primaryUrl: undefined });
  assert.equal(report.primaryUrl, null);
  for (const f of ["index.html", "login.html", "staff/application-details.html", "404.html"]) {
    const html = fs.readFileSync(path.join(out, f), "utf8");
    assert.match(html, /has not been configured for this backup copy/);
    assert.ok(!/undefined|null\/|href="#"|href=""/.test(html), `${f} has a broken link`);
  }
  fs.rmSync(out, { recursive: true, force: true });
});

test("[backup] links work on a GitHub PROJECT site: all links are relative and every one resolves", () => {
  const out = tmp();
  builder.buildStaticBackup({ outDir: out, primaryUrl: PRIMARY });
  let checked = 0;
  for (const f of listFiles(out).filter((n) => n.endsWith(".html") && n !== "404.html")) {
    const html = fs.readFileSync(path.join(out, f), "utf8");
    for (const m of html.matchAll(/\b(?:href|src)="([^"]*)"/g)) {
      const ref = m[1];
      if (/^(https:\/\/|#|mailto:|\$\{)/.test(ref) || ref === "") continue;
      assert.ok(!ref.startsWith("/"), `${f}: "${ref}" is root-absolute and would break at /<repository-name>/`);
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(f), ref.split("#")[0].split("?")[0]));
      assert.ok(!target.startsWith("../") && fs.existsSync(path.join(out, target)), `${f}: "${ref}" does not resolve`);
      checked += 1;
    }
  }
  assert.ok(checked > 60, `the check really looked at the links (${checked})`);
  // links built at run time by the shared navigation also land on existing pages
  const components = fs.readFileSync(path.join(out, "js/components.js"), "utf8");
  for (const m of components.matchAll(/\$\{SITE_BASE\}([A-Za-z0-9_/-]+\.html)/g)) assert.ok(fs.existsSync(path.join(out, m[1])), `navigation link ${m[1]}`);
  fs.rmSync(out, { recursive: true, force: true });
});

test("[backup] the main-application address is validated: https only, no credentials, no markup, no query", () => {
  assert.equal(builder.normalizePrimaryUrl(undefined), null);
  assert.equal(builder.normalizePrimaryUrl(""), null);
  assert.equal(builder.normalizePrimaryUrl("  "), null);
  assert.equal(builder.normalizePrimaryUrl("https://app.vercel.app/"), "https://app.vercel.app");
  assert.equal(builder.normalizePrimaryUrl(" https://app.vercel.app "), "https://app.vercel.app");
  assert.equal(builder.normalizePrimaryUrl("https://gram.example.in/portal/"), "https://gram.example.in/portal");
  for (const bad of [
    "http://app.vercel.app", "ftp://app.vercel.app", "javascript:alert(1)", "//app.vercel.app", "app.vercel.app", "https://user:pass@app.vercel.app",
    "https://app.vercel.app/?x=1", "https://app.vercel.app/#x", 'https://app.vercel.app/"><script>alert(1)</script>', "https://app.vercel.app/<b>",
    "https://exa mple.com", "https://app.vercel.app/a b", "not a url", "https://",
  ]) {
    assert.throws(() => builder.normalizePrimaryUrl(bad), /PRIMARY_APP_URL/, bad);
  }
  assert.throws(() => builder.buildStaticBackup({ outDir: tmp(), primaryUrl: "http://insecure.example" }), /https/);
});

test("[backup] the builder fails closed: planted secrets, server files, API calls or broken links are caught", () => {
  const out = tmp();
  builder.buildStaticBackup({ outDir: out, primaryUrl: PRIMARY });
  assert.deepEqual(builder.verifyOutput(out), [], "a clean build has no problems");

  const plant = (rel, content) => { fs.mkdirSync(path.dirname(path.join(out, rel)), { recursive: true }); fs.writeFileSync(path.join(out, rel), content); };
  const cases = [
    [".env.local", "SUPABASE_URL=x", /environment file/],
    ["config/serviceAccount.json", "{}", /service-account/],
    ["x-firebase-adminsdk-abc.json", "{}", /Admin credential|allowed list/],
    ["api/availability.js", "x", /server-function folder/],
    ["firestore.rules", "rules", /Firestore rules/],
    ["package.json", "{}", /package file/],
    ["scripts/build-static-backup.js", "x", /developer-only/],
    ["README.md", "x", /documentation/],
    ["js/firebase.js", "export const x = 1;", /Firebase \/ API script/],
    ["js/leak.js", "const k = 'SUPABASE_SERVICE_ROLE_KEY';", /service-role/],
    ["js/leak2.js", "const k = '-----BEGIN PRIVATE KEY-----';", /private key/],
    ["js/leak3.js", "fetch('/api/documents/create-upload-url')", /\/api/],
    ["js/leak4.js", "import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js'; initializeApp({})", /Firebase client code/],
    ["js/leak5.js", "const t = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.abcdefghij';", /JWT-like/],
    ["notes.txt", "hello", /allowed list/],
    ["bad-link.html", '<a href="missing-page.html">x</a>', /does not resolve/],
    ["root-link.html", '<a href="/login.html">x</a>', /root-absolute/],
  ];
  for (const [rel, content, expected] of cases) {
    plant(rel, content);
    const problems = builder.verifyOutput(out);
    assert.ok(problems.some((p) => expected.test(p) && p.includes(path.posix.basename(rel))), `${rel} was not caught (${expected}): ${problems.join(" | ")}`);
    fs.rmSync(path.join(out, rel), { recursive: true, force: true });
  }
  assert.deepEqual(builder.verifyOutput(out), [], "clean again after removing the planted files");
  fs.rmSync(out, { recursive: true, force: true });
});

test("[backup] a public page that needs a Firebase / API script stops the build instead of publishing it", () => {
  // simulate by building from a copy of the repository's public files with one bad reference
  const fake = tmp();
  const write = (rel, content) => { fs.mkdirSync(path.dirname(path.join(fake, rel)), { recursive: true }); fs.writeFileSync(path.join(fake, rel), content); };
  for (const page of builder.PUBLIC_PAGES) write(page, `<!DOCTYPE html><html><body><a href="login.html">x</a>${page === "index.html" ? '<script type="module" src="js/auth.js"></script>' : ""}</body></html>`);
  write("login.html", "<html><body>login</body></html>");
  write("js/auth.js", "export const x = 1;");
  const out = tmp();
  assert.throws(() => builder.buildStaticBackup({ root: fake, outDir: out, primaryUrl: PRIMARY }), /talks to Firebase or \/api and must not be published/);
  fs.rmSync(fake, { recursive: true, force: true });
  fs.rmSync(out, { recursive: true, force: true });
});

test("[backup] the builder refuses to empty a folder that is not clearly a build folder", () => {
  for (const unsafe of [root, path.join(root, "js"), path.join(root, ".."), path.parse(root).root, path.join(root, "tests")]) {
    assert.throws(() => builder.assertSafeOutDir(unsafe), /Refusing|must be named/, unsafe);
  }
  assert.doesNotThrow(() => builder.assertSafeOutDir(path.join(root, "dist-static")));
  assert.doesNotThrow(() => builder.assertSafeOutDir(path.join(os.tmpdir(), "anything")));
});

/* ====================== PART 2: the GitHub Actions workflow ====================== */

test("[workflow] GitHub Pages publishes ONLY the built backup folder, never the repository", () => {
  const yml = read(".github/workflows/static.yml");
  const uses = [...yml.matchAll(/path:\s*['"]?([^\s'"]+)['"]?/g)].map((m) => m[1]);
  assert.deepEqual(uses, ["dist-static"], "the only upload path is dist-static");
  assert.ok(!/path:\s*['"]?\.['"]?\s*$/m.test(yml), "must not upload '.'");
  assert.match(yml, /node scripts\/build-static-backup\.js --out dist-static/, "the artifact is built by the verified builder");
  assert.ok(yml.indexOf("build-static-backup.js") < yml.indexOf("upload-pages-artifact"), "build runs before upload");
  assert.match(yml, /PRIMARY_APP_URL: \$\{\{ vars\.PRIMARY_APP_URL \}\}/, "the main-application address is a repository VARIABLE");
  assert.ok(!/secrets\./.test(yml), "the backup workflow uses no secrets");
  assert.ok(!/\.env|FIREBASE_|SUPABASE_/.test(yml.replace(/#.*$/gm, "")), "no server variables in the workflow");
  assert.match(yml, /on:\s*\n\s*push:\s*\n\s*branches: \["main"\]\s*\n(\s*#.*\n)?\s*workflow_dispatch:/, "runs on pushes to main and manually");
  assert.match(yml, /permissions:\s*\n\s*contents: read\s*\n\s*pages: write\s*\n\s*id-token: write/, "least-privilege permissions");
  assert.match(yml, /does NOT publish the repository/i, "documented in the file");
});

/* ============================ PART 3: Vercel ============================ */

test("[vercel] vercel.json is valid, keeps the shared checklist file in the functions, and sets safe headers", () => {
  const cfg = JSON.parse(read("vercel.json"));
  assert.equal(cfg.functions["api/**/*.js"].includeFiles, "js/document-checklists.js", "api/_lib/documentChecklists.js requires this file from outside api/");
  assert.ok(exists("js/document-checklists.js"));
  const all = cfg.headers.find((h) => h.source === "/(.*)").headers.map((h) => h.key);
  for (const key of ["X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy", "Permissions-Policy"]) assert.ok(all.includes(key), key);
  const api = cfg.headers.find((h) => h.source === "/api/(.*)");
  assert.deepEqual(api.headers, [{ key: "Cache-Control", value: "no-store" }], "API responses are never cached");
  assert.ok(!cfg.builds && !cfg.routes && !cfg.rewrites, "plain zero-config project: Vercel serves the pages and /api itself");
  assert.ok(!/Content-Security-Policy/.test(read("vercel.json")), "no CSP (it would block the Tailwind CDN and Firebase)");
});

test("[vercel] the function count stays within the Hobby plan and api/_lib is not a route", () => {
  const routes = [];
  (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name.startsWith("_")) continue; const f = path.join(d, e.name); e.isDirectory() ? walk(f) : e.name.endsWith(".js") && routes.push(path.relative(path.join(root, "api"), f)); } })(path.join(root, "api"));
  assert.ok(routes.length <= 12, `${routes.length} functions`);
  assert.ok(routes.every((r) => !r.startsWith("_lib")));
});

test("[vercel] the frontend reaches the API with same-origin, root-relative addresses (works on any Vercel domain)", () => {
  const files = fs.readdirSync(path.join(root, "js")).map((f) => "js/" + f);
  const pages = repoPages();
  const urls = new Set();
  for (const f of [...files, ...pages]) for (const m of read(f).matchAll(/["'`](https?:\/\/[^"'`\s]+|\/api\/[A-Za-z0-9/_-]+)["'`]/g)) urls.add(m[1]);
  const apiCalls = [...urls].filter((u) => u.startsWith("/api/"));
  assert.ok(apiCalls.length >= 8, `found ${apiCalls.length} API paths`);
  for (const u of apiCalls) assert.ok(exists(u.slice(1) + ".js") || exists(u.slice(1) + "/index.js"), `${u} has no function file`);
  const own = [...urls].filter((u) => /localhost|127\.0\.0\.1|vercel\.app|github\.io/.test(u));
  assert.deepEqual(own, [], "no hard-coded host names in the frontend");
});

test("[vercel] .vercelignore keeps secrets and developer-only files out, and never excludes the application", () => {
  const lines = read(".vercelignore").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  for (const must of [".env", ".env.*", "tests", "scripts", ".github", "node_modules", "README.md", "firestore.rules"]) assert.ok(lines.includes(must), `${must} should be ignored`);
  for (const mustNot of ["api", "api/", "js", "js/", "css", "css/", "citizen", "staff", "admin", "services", "package.json", "package-lock.json", "vercel.json", "*.html"]) assert.ok(!lines.includes(mustNot), `${mustNot} is part of the application`);
  assert.ok(exists("404.html"), "a friendly 404 page for the primary site");
  assert.ok(!/(?:href|src)="(?!\/|https:)/.test(read("404.html")), "404.html is served at any depth, so it uses root-absolute or absolute links only");
});

test("[vercel] .env.example documents every environment variable the server code reads — by name, with no values", () => {
  const used = new Set();
  const scan = (dir) => { for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) { const rel = path.join(dir, e.name); if (e.isDirectory()) scan(rel); else if (e.name.endsWith(".js")) for (const m of read(rel).matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) used.add(m[1]); } };
  scan("api"); scan("scripts");
  used.delete("GITHUB_ACTIONS");                                    // set by GitHub itself, read only by the backup builder
  used.delete("PRIMARY_APP_URL");                                   // GitHub repository variable, read only by the backup builder
  assert.ok(used.size >= 5, `found ${[...used]}`);

  const example = read(".env.example");
  const documented = new Map([...example.matchAll(/^([A-Z][A-Z0-9_]+)=(.*)$/gm)].map((m) => [m[1], m[2].trim()]));
  for (const name of used) assert.ok(documented.has(name), `${name} is used by the server but missing from .env.example`);
  for (const name of documented.keys()) assert.ok(used.has(name), `${name} is documented but nothing reads it`);

  // names only: the one non-empty entry is the (public, non-secret) default bucket name
  for (const [name, value] of documented) {
    if (name === "SUPABASE_BUCKET") assert.equal(value, "gp-documents");
    else assert.equal(value, "", `${name} must have no value in .env.example`);
  }
  assert.ok(!/eyJ[A-Za-z0-9_-]{10,}|BEGIN [A-Z ]*PRIVATE KEY|"private_key"|sk_live/.test(example), "no key-like content");
  assert.match(example, /PRIMARY_APP_URL/, "the backup's repository variable is explained");
});

test("[hosting] .env.local and credentials are ignored by Git and by Vercel, and no env file is tracked", () => {
  const ignore = read(".gitignore").split("\n").map((l) => l.trim());
  for (const needle of [".env", ".env.*", "!.env.example", "node_modules/", ".vercel", "dist-static/", "graphify-out/", ".agents/", "*firebase-adminsdk*.json", "*serviceAccount*.json"]) assert.ok(ignore.includes(needle), `.gitignore should list ${needle}`);
  const { spawnSync } = require("node:child_process");
  const tracked = spawnSync("git", ["ls-files"], { cwd: root, encoding: "utf8" });
  if (tracked.status === 0) {
    const files = tracked.stdout.split("\n").filter(Boolean);
    assert.ok(!files.some((f) => /(^|\/)\.env(\.|$)/.test(f) && f !== ".env.example"), "an env file is tracked by Git");
    assert.ok(!files.some((f) => /service-?account|adminsdk/i.test(f)), "a credential file is tracked by Git");
  }
});

test("[hosting] the README documents both deployments, the variables by name, and the backup's limits", () => {
  const readme = read("README.md");
  for (const name of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY", "SUPABASE_BUCKET", "FIREBASE_SERVICE_ACCOUNT_KEY", "PRIMARY_APP_URL"]) assert.ok(readme.includes(name), `README should name ${name}`);
  assert.match(readme, /## Hosting/);
  assert.match(readme, /Vercel \(primary\)/);
  assert.match(readme, /GitHub Pages \(static backup\)/);
  assert.match(readme, /does \*\*not\*\* call the Vercel API/, "says the backup has no API");
  assert.match(readme, /CORS/, "explains why the backup does not call the Vercel API cross-origin");
});
