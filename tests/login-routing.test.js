/* ==========================================================================
   tests/login-routing.test.js — static checks for the three login pages.

   Run with:  npm test

   Guards against the Phase 5 regression where /staff/login.html was a
   redirect stub that bounced straight back to the citizen login. These are
   file checks (no browser): they confirm the pages exist, link to each other,
   share the one sign-in flow, cannot pick a role in the UI, and that every
   relative link / role landing page resolves to a real file.
   ========================================================================== */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const exists = (p) => fs.existsSync(path.join(root, p));

const PAGES = { citizen: "login.html", staff: "staff/login.html", admin: "admin/login.html" };

test("all three login pages exist and none is a redirect stub", () => {
  for (const [name, file] of Object.entries(PAGES)) {
    assert.ok(exists(file), `${file} is missing`);
    const html = read(file);
    assert.ok(!/http-equiv=["']refresh/i.test(html), `${file} redirects instead of being a login page`);
    assert.ok(!/location\.(replace|href)\s*\(?\s*=?\s*['"]\.\.\/login\.html/.test(html), `${file} bounces to the citizen login`);
    assert.match(html, /id="[a-z-]*login-form"/, `${file} has no login form`);
    assert.match(html, new RegExp(`renderLoginSwitcher\\('${name}'\\)`), `${file} does not render the Citizen/Staff/Admin switcher`);
  }
});

test("each login page has the switcher mount and the shared sign-in + role redirect", () => {
  for (const file of Object.values(PAGES)) {
    const html = read(file);
    assert.match(html, /id="login-switcher"/, file);
    assert.match(html, /GPAuth\.loginWithEmail\(/, `${file} must use the shared sign-in`);
    assert.match(html, /GPAuth\.roleHomePath\(profile\.role\)/, `${file} must redirect by the profile's role`);
    assert.match(html, /adminUrl:/, `${file} must send an already-signed-in admin to the admin dashboard`);
  }
});

test("the switcher links to all three login pages", () => {
  const components = read("js/components.js");
  assert.match(components, /function renderLoginSwitcher/);
  for (const href of ["'login.html'", "'staff/login.html'", "'admin/login.html'"]) {
    assert.ok(components.includes(href), `switcher is missing ${href}`);
  }
  assert.match(read("login.html"), /href="staff\/login\.html"/, "citizen page needs a plain Staff login link");
  assert.match(read("login.html"), /href="admin\/login\.html"/, "citizen page needs a plain Admin login link");
});

test("the UI cannot choose a role (no role field on any login page)", () => {
  for (const file of Object.values(PAGES)) {
    const html = read(file);
    assert.ok(!/<select/i.test(html), `${file} has a <select>`);
    assert.ok(!/name=["']role["']|id=["'][a-z-]*role["']|type=["']radio["']/i.test(html), `${file} has a role input`);
  }
});

test("every role's landing page (auth.js ROLE_HOME) is a real file", () => {
  const auth = read("js/auth.js");
  const block = /const ROLE_HOME = \{([\s\S]*?)\};/.exec(auth);
  assert.ok(block, "ROLE_HOME not found");
  const homes = Object.fromEntries([...block[1].matchAll(/(\w+):\s*"([^"]+)"/g)].map((m) => [m[1], m[2]]));
  assert.deepEqual(Object.keys(homes).sort(), ["admin", "citizen", "staff"]);
  for (const file of Object.values(homes)) assert.ok(exists(file), `${file} does not exist`);
  // staff/admin pages build the URL as SITE_BASE ('../') + home — that must also resolve
  for (const dir of ["staff", "admin"]) {
    for (const file of Object.values(homes)) assert.ok(exists(path.posix.normalize(`${dir}/../${file}`)), `${dir}/../${file}`);
  }
});

test("every relative link and script in the login pages resolves to a real file", () => {
  for (const file of Object.values(PAGES)) {
    const html = read(file);
    const dir = path.posix.dirname(file);
    const refs = [...html.matchAll(/(?:href|src)="([^"#?]+)(?:[?#][^"]*)?"/g)].map((m) => m[1])
      .filter((u) => !/^(https?:|mailto:|tel:|data:|\/\/|\$\{|javascript:)/.test(u) && !u.includes("${"));
    assert.ok(refs.length > 3, `${file}: found no links to check`);
    for (const ref of refs) {
      const target = path.posix.normalize(`${dir}/${ref}`);
      assert.ok(exists(target), `${file}: "${ref}" -> ${target} does not exist`);
    }
  }
});

test("role-protected pages send signed-out visitors to the common login page", () => {
  for (const file of ["admin/dashboard.html", "admin/users.html", "admin/staff.html", "staff/dashboard.html", "staff/applications.html", "staff/application-details.html"]) {
    assert.match(read(file), /loginUrl: '\.\.\/login\.html'/, file);
  }
});

/* ---- "return to where you were" after login: same-site, citizen-only, allow-listed ---- */

const vm = require("node:vm");

test("login: a citizen returns to the page they came from, but ?redirect= can never lead anywhere else", () => {
  const html = read("login.html");
  const found = /function citizenReturnPath\(\) \{[\s\S]*?\n    \}/.exec(html);
  assert.ok(found, "citizenReturnPath() is missing from login.html");
  const returnPath = (search) => vm.runInContext(`(${found[0].replace("function citizenReturnPath", "function")})()`, vm.createContext({ window: { location: { search } }, URLSearchParams }));

  for (const ok of ["services/income.html", "services/other.html", "citizen/applications.html", "citizen/dashboard.html", "citizen/availability.html", "citizen/profile.html"]) {
    assert.equal(returnPath(`?redirect=${encodeURIComponent(ok)}`), ok);
  }
  for (const bad of [
    "https://evil.example/", "http://evil.example", "//evil.example", "/citizen/dashboard.html", "javascript:alert(1)", "data:text/html,x",
    "../admin/dashboard.html", "staff/dashboard.html", "admin/dashboard.html", "admin/users.html", "services/../admin/dashboard.html", "services/income.html/../../x.html",
    "citizen/dashboard.html?x=1", "citizen/dashboard.html#x", "services/income.html\r\nLocation: https://evil.example", "services/Income.html", "services/income.htm", "citizen/application-details.html",
    "", " ", "citizen/dashboard.html ",
  ]) {
    assert.equal(returnPath(`?redirect=${encodeURIComponent(bad)}`), null, JSON.stringify(bad));
  }
  assert.equal(returnPath(""), null, "no parameter");
  assert.equal(returnPath("?redirect=a&redirect=services/income.html"), null, "only the first value is read");

  assert.match(html, /profile\.role === 'citizen' && citizenReturnPath\(\)\) \|\| GPAuth\.roleHomePath\(profile\.role\)/, "only a citizen is sent back; everyone else goes to their own role's home");
  for (const file of ["staff/login.html", "admin/login.html"]) assert.ok(!/redirect/.test(read(file).replace(/redirectIfAlreadyLoggedIn/g, "")), `${file} must ignore ?redirect=`);
});
