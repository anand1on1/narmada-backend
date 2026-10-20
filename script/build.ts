import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile, cp, access, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times
const allowlist = [
  "@google/generative-ai",
  "axios",
  "cors",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "express-session",
  "jsonwebtoken",
  "memorystore",
  "multer",
  "nanoid",
  "nodemailer",
  "openai",
  "passport",
  "passport-local",
  "stripe",
  "uuid",
  "ws",
  "xlsx",
  "zod",
  "zod-validation-error",
];

async function buildAll() {
  const out=resolve(process.env.BUILD_OUT_DIR || "dist");
  if(!process.env.BUILD_OUT_DIR) await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild({build:{outDir:resolve(out,"public"),emptyOutDir:!process.env.BUILD_OUT_DIR}});
  // Release identity, not credentials. Detect uploading an older GoDaddy ZIP.
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const dirty = !!execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
  await writeFile(resolve(out,"public/version.json"), JSON.stringify({ release: "price-list-catalog-v1", commit, dirty, builtAt: new Date().toISOString() }, null, 2) + "\n");

  // Vite's publicDir copy skips dotfiles, so .htaccess (SPA rewrite + cache headers
  // for the GoDaddy frontend) is copied explicitly into dist/public.
  try {
    await access("client/public/.htaccess");
    await cp("client/public/.htaccess", resolve(out,"public/.htaccess"));
    console.log("copied client/public/.htaccess -> dist/public/.htaccess");
  } catch {
    console.log("no client/public/.htaccess to copy");
  }

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: resolve(out,"index.cjs"),
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });

  console.log("copying server assets...");
  await cp("server/assets", resolve(out,"assets"), { recursive: true });
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
