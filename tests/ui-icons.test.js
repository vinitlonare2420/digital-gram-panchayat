/* ==========================================================================
   tests/ui-icons.test.js — every inline <svg> must have a real size.

   Why: Tailwind has no "4.5" spacing step, so `h-4.5 w-4.5` silently produces
   NO size. An unsized <svg> stretches to fill its container — on
   /citizen/applications.html that turned the small search icon into a giant
   magnifying glass covering the page. These checks fail if an <svg> (in any
   page or in a JS template string) has no width/height and no valid
   Tailwind h-/w- (or size-) classes.

   Run with:  npm test
   ========================================================================== */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const SKIP = new Set(["node_modules", ".git", "graphify-out", ".agents", ".vercel", "tests"]);
// Tailwind v3 spacing steps that exist (the CDN build this project uses)
const VALID_STEPS = new Set(["0", "px", "0.5", "1", "1.5", "2", "2.5", "3", "3.5", "4", "5", "6", "7", "8", "9", "10", "11", "12", "14", "16", "20", "24", "28", "32", "36", "40", "44", "48", "52", "56", "60", "64", "72", "80", "96"]);

function sourceFiles() {
  const out = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(html|js)$/.test(e.name)) out.push(p);
    }
  })(root);
  return out;
}

const lineOf = (text, index) => text.slice(0, index).split("\n").length;
const rel = (p) => path.relative(root, p).split(path.sep).join("/");

/** All <svg ...> opening tags with their class list and whether an explicit size attribute exists. */
function svgTags(text) {
  return [...text.matchAll(/<svg\b([^>]*)>/g)].map((m) => ({
    index: m.index,
    classes: ((/class="([^"]*)"/.exec(m[1]) || [, ""])[1]).split(/\s+/).filter(Boolean),
    hasSizeAttr: /(?<![\w-])(width|height)=/.test(m[1]),
  }));
}

const sizeClass = (cls, axes) => cls.match(new RegExp(`^(?:[a-z]+:)?(?:${axes})-(.+)$`));

test("no <svg> uses a size class that does not exist in Tailwind (e.g. h-4.5 / w-4.5)", () => {
  const problems = [];
  for (const file of sourceFiles()) {
    const text = fs.readFileSync(file, "utf8");
    for (const svg of svgTags(text)) {
      for (const cls of svg.classes) {
        const m = sizeClass(cls, "h|w|size");
        if (m && /^\d+(\.\d+)?$/.test(m[1]) && !VALID_STEPS.has(m[1])) {
          problems.push(`${rel(file)}:${lineOf(text, svg.index)}  "${cls}" is not a Tailwind size, so the icon gets NO size`);
        }
      }
    }
  }
  assert.deepEqual(problems, []);
});

test("every <svg> has an explicit width/height or valid h-/w- classes, so it can never fill its container", () => {
  const problems = [];
  let checked = 0;
  for (const file of sourceFiles()) {
    const text = fs.readFileSync(file, "utf8");
    for (const svg of svgTags(text)) {
      checked++;
      const valid = (axes) => svg.classes.some((cls) => {
        const m = sizeClass(cls, axes);
        return m && (VALID_STEPS.has(m[1]) || /^\[.+\]$/.test(m[1]) || m[1] === "full");
      });
      if (!svg.hasSizeAttr && !(valid("h|size") && valid("w|size"))) {
        problems.push(`${rel(file)}:${lineOf(text, svg.index)}  <svg class="${svg.classes.join(" ").slice(0, 70)}"> has no usable size`);
      }
    }
  }
  assert.ok(checked > 40, `only found ${checked} svgs — the scan is not reaching the pages`);
  assert.deepEqual(problems, []);
});

test("the search icon on My Applications (and the password eye on login) are small, inline-sized icons", () => {
  for (const [file, marker] of [["citizen/applications.html", "absolute left-3 top-1/2"], ["login.html", 'data-toggle-password="login-password"']]) {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    const at = text.indexOf(marker);
    assert.ok(at > -1, `${file}: marker not found`);
    const svg = /<svg\b[^>]*>/.exec(text.slice(at - (marker.startsWith("absolute") ? 20 : 0)));
    assert.ok(svg && /\bh-5\b/.test(svg[0]) && /\bw-5\b/.test(svg[0]), `${file}: icon must be h-5 w-5`);
  }
});

test("shared CSS has no rule that resizes every svg", () => {
  const css = fs.readFileSync(path.join(root, "css/style.css"), "utf8");
  assert.ok(!/(^|[\s,}])svg\s*[{,]/m.test(css), "style.css has a bare `svg { … }` rule");
});
