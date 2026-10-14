/* Starts `vercel dev` with the variables from .env.local injected into the
   process environment (run via: npm run dev:api, which adds --env-file).
   Needed because this Vercel CLI does not load .env.local itself — it pulls
   env from the linked cloud project instead, so the /api functions would
   otherwise see none of the Firebase or Supabase variables at all. */
const { spawn } = require("child_process");

const child = spawn("npx", ["vercel", "dev", ...process.argv.slice(2)], { stdio: "inherit", shell: true });
child.on("exit", (code) => process.exit(code ?? 0));
