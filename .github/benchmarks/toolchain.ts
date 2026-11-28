/**
 * Compare real project commands, never publish or mutate a developer's checkout.
 * The workflow provides three Bun executables. Candidate installs are disposable.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { cpus, platform, arch, totalmem } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { cacheResult } from "./cache-result";

const suite = process.argv[2];
if (suite !== "tools" && suite !== "tests") throw Error("Use: bun .github/benchmarks/toolchain.ts tools|tests");
const root = process.cwd();
const temp = process.env.RUNNER_TEMP;
if (!temp) throw Error("Run this benchmark in GitHub Actions (RUNNER_TEMP is required).");
const home = join(temp, "toolchain-work", suite);
const output = join(temp, "toolchain-results", suite);
mkdirSync(home, { recursive: true });
mkdirSync(output, { recursive: true });
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const hum = manifest.name === "humagent";
if (!hum && manifest.name !== "stelz") throw Error("Unknown benchmark project.");
// Freeze the pre-migration source and lockfile. HEAD now uses the adopted stack.
const baselineRef = hum
  ? "89a457c7f3e214ac713253c2d6d940a96bca6cc6"
  : "c11f9175942163815c69d231592cb67032721b46";
const runtimes = Object.fromEntries(["baseline", "stable", "canary"].map(name => [name, join(temp, "toolchain-bun", name, "bun")]));
type Runtime = "baseline" | "stable" | "canary";
type Work = { cwd: string; runtime: Runtime; cache?: string };
type Trial = {
  name: string; cwd: string; command: string[]; runtime: Runtime; ms: number;
  rssKiB: number | null; exit: number; ok: boolean; required: boolean; log: string;
};
type Case = {
  name: string; work: Work; args: string[]; required?: boolean;
  before?: () => void | Promise<void>; validate?: (out: string, exit: number) => boolean;
  env?: Record<string, string>;
};
const rows: Trial[] = [];
const errors: string[] = [];
let serial = 0;
const versions: Record<string, string> = {};
const base: Work = { cwd: join(home, "baseline"), runtime: "baseline" };
const candidate: Work = { cwd: join(home, "candidate"), runtime: "stable" };
const adopted: Work = { cwd: join(home, "adopted"), runtime: "canary" };
const stable = (work: Work = candidate): Work => ({ ...work, runtime: "stable" });
const canary = (work: Work = candidate): Work => ({ ...work, runtime: "canary" });
const bin = (work: Work, name: string) => join(work.cwd, "node_modules", ".bin", name);
const bun = (work: Work) => runtimes[work.runtime]!;
const sh = (command: string) => ["bash", "-c", command];
const envFor = (work: Work, extra: Record<string, string> = {}) => ({
  ...process.env,
  PATH: dirname(bun(work)) + ":" + (process.env.PATH || ""),
  BUN_INSTALL_CACHE_DIR: work.cache || join(home, "install-cache", work.runtime),
  CI: "true",
  ...extra,
});
const safeName = (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, "-");
const installArgs = ["bun", "install", "--frozen-lockfile", "--ignore-scripts"];

async function execute(args: string[], work: Work, extra: Record<string, string> = {}, timed = false) {
  // Do not let an external timing wrapper replace the tested program's exit code.
  const start = performance.now();
  const child = Bun.spawn(args, { cwd: work.cwd, env: envFor(work, extra), stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  const ms = performance.now() - start;
  let rssKiB: number | null = null;
  if (timed) {
    try {
      const usage = child.resourceUsage();
      if (usage && Number.isFinite(usage.maxRSS) && usage.maxRSS > 0) rssKiB = Math.round(usage.maxRSS / 1024);
    } catch { /* A missing measurement must not invalidate a successful command. */ }
  }
  return { stdout, stderr, exit, ms, rssKiB };
}

async function trial(c: Case, record = true) {
  const file = safeName(c.name) + "-" + (++serial) + ".log";
  try {
    await c.before?.();
    const r = await execute(c.args, c.work, c.env, true);
    const combined = r.stdout + "\n" + r.stderr;
    const ok = c.validate ? c.validate(combined, r.exit) : r.exit === 0;
    writeFileSync(join(output, file), "Command: " + JSON.stringify(c.args) + "\nExit: " + r.exit + "\n" + combined);
    if (record) rows.push({ name: c.name, command: c.args, cwd: c.work.cwd, runtime: c.work.runtime, ms: r.ms, rssKiB: r.rssKiB, exit: r.exit, ok, required: !!c.required, log: file });
    console.log(c.name + ": " + r.ms.toFixed(1) + " ms (" + (ok ? "ok" : "INVALID, exit " + r.exit) + ")" + (record ? "" : " [warmup]"));
    return ok;
  } catch (error) {
    writeFileSync(join(output, file), String(error));
    if (record) rows.push({ name: c.name, command: c.args, cwd: c.work.cwd, runtime: c.work.runtime, ms: 0, rssKiB: null, exit: -1, ok: false, required: !!c.required, log: file });
    console.log(c.name + ": INVALID (" + String(error) + ")");
    return false;
  }
}

// Interleave variants to reduce bias from runner load. Warmups are not timed samples.
async function compare(cases: Case[], repeats = 5, warmup = true) {
  let active: Case[] = [];
  // Record failures on the warmup as invalid, but omit successful warmup timings.
  for (const c of cases) {
    if (!warmup || await trial(c, false)) active.push(c);
    else rows.push({ name: c.name, command: c.args, cwd: c.work.cwd, runtime: c.work.runtime, ms: 0, rssKiB: null, exit: -1, ok: false, required: !!c.required, log: safeName(c.name) + "-" + serial + ".log" });
  }
  for (let i = 0; i < repeats && active.length; i++) {
    const offset = i % active.length;
    const remaining: Case[] = [];
    for (const c of [...active.slice(offset), ...active.slice(0, offset)]) {
      if (await trial(c)) remaining.push(c);
    }
    active = remaining;
  }
}
async function must(args: string[], work: Work, label: string) {
  const r = await execute(args, work);
  writeFileSync(join(output, safeName(label) + ".log"), r.stdout + "\n" + r.stderr);
  if (r.exit !== 0) throw Error(label + " failed: see " + safeName(label) + ".log");
  return r.stdout.trim();
}
async function worktree(work: Work, ref = baselineRef) {
  await must(["git", "worktree", "add", "--detach", work.cwd, ref], { ...work, cwd: root }, "worktree-" + work.cwd.split("/").at(-1));
}
function cleanModules(work: Work) {
  rmSync(join(work.cwd, "node_modules"), { recursive: true, force: true });
}
function cleanDist(work: Work) {
  rmSync(join(work.cwd, "dist"), { recursive: true, force: true });
}
function writeJson(path: string, object: unknown) {
  writeFileSync(path, JSON.stringify(object, null, 2) + "\n");
}
function sourcePaths() {
  return hum ? ["src", "test", "vite.config.ts"] : ["src", "ui", "scripts", "tests", "vite.config.ts"];
}
function lintPaths() {
  return sourcePaths();
}
function buildCommand(work: Work, useBun: boolean) {
  const runtime = useBun ? "bun" : "node";
  const command = runtime + " node_modules/vite/bin/vite.js build";
  return sh(command + (hum ? " && " + command + " src/examples" : ""));
}
function validBuild(work: Work) {
  const required = hum
    ? ["client/.vite/manifest.json", "node/cli.js", "node/server.js", "node/feedback.js", "node/server.d.ts", "node/feedback.d.ts", "examples/index.html"]
    : ["plugin.js", "ui/index.html", "ui/theme.js", "ui/licenses.json"];
  return required.every(file => existsSync(join(work.cwd, "dist", file)));
}
function inventory(work: Work, label: string) {
  const dir = join(work.cwd, "dist");
  if (!existsSync(dir)) return;
  const files = readdirSync(dir, { recursive: true }).map(String).filter(path => statSync(join(dir, path)).isFile());
  writeJson(join(output, label + "-build.json"), files.sort().map(path => ({
    path, bytes: statSync(join(dir, path)).size,
    sha256: createHash("sha256").update(readFileSync(join(dir, path))).digest("hex"),
  })));
}
function typeCommand(kind: "tsrs" | "tsc" | "bun") {
  const tool = kind === "bun" ? "bun check --no-script" : "node_modules/.bin/" + kind;
  return sh(tool + " -p tsconfig.json" + (hum ? " && " + tool + " -p tsconfig.test.json" : ""));
}
async function prepare() {
  for (const [name, file] of Object.entries(runtimes)) {
    versions[name] = await must([file, "--revision"], { cwd: root, runtime: "stable" }, "revision-" + name);
  }
  versions.node = await must(["node", "--version"], { cwd: root, runtime: "stable" }, "node-version");
  versions.npm = await must(["npm", "--version"], { cwd: root, runtime: "stable" }, "npm-version");
  await worktree(base);
  await worktree(candidate);
  cpSync(join(base.cwd, "package.json"), join(output, "baseline-package.json"));
  cpSync(join(base.cwd, "bun.lock"), join(output, "baseline-bun.lock"));
  if (suite === "tools") {
    // Exact same original lockfile and separate empty package caches.
    const installs = [base, stable(), canary()];
    for (const work of installs) {
      const cache = join(home, "install-cache", work.runtime);
      await trial({
        name: "install/cold/" + work.runtime, work, args: installArgs, required: work.runtime === "baseline",
        before: () => { cleanModules(work); rmSync(cache, { recursive: true, force: true }); },
      });
    }
    await compare(installs.map(work => ({
      name: "install/warm/" + work.runtime, work, args: installArgs,
      required: work.runtime === "baseline", before: () => cleanModules(work),
    })), 5, false);
    // Ensure baseline and candidate are correctly installed even if a trial failed.
  }
  await must(installArgs, base, "baseline-frozen-install");
  await must(installArgs, candidate, "candidate-frozen-install");
  // Change only development dependencies, in a separate checkout. Keep runtime deps and patches.
  const tools = suite === "tools"
    ? ["vite@8.4.0", "oxlint@1.95.0", "oxfmt@0.80.0", "tsrs@7.1.0-beta.tsrs5", "typescript@7.0.2", "turbo@2.11.13"]
    : ["vite@8.4.0"];
  await must(["bun", "add", "-d", "--exact", "--ignore-scripts", ...tools], candidate, "candidate-tool-install");
  if (hum) await must(["bun", "fmt", "--no-script", "package.json"], candidate, "candidate-normalize-manifest");
  cpSync(join(candidate.cwd, "package.json"), join(output, "candidate-package.json"));
  cpSync(join(candidate.cwd, "bun.lock"), join(output, "candidate-bun.lock"));
}
// Normalize only in the disposable worktree, outside timed trials. Require a fixed
// point rather than assuming that one formatter write is idempotent.
async function normalize(work: Work, command: string[], paths: string[], label: string) {
  for (let pass = 1; pass <= 5; pass++) {
    const write = await execute([...command, ...paths], work);
    const check = await execute([...command, "--check", ...paths], work);
    writeFileSync(join(output, safeName(label) + "-pass-" + pass + ".log"), "WRITE " + write.exit + "\n" + write.stdout + write.stderr + "\nCHECK " + check.exit + "\n" + check.stdout + check.stderr);
    if (write.exit !== 0) return false;
    if (check.exit === 0) return true;
  }
  return false;
}
async function savePatch(work: Work, label: string) {
  const diff = await execute(["git", "diff", "--", "src", "ui", "scripts", "tests", "test", "vite.config.ts", "package.json", "tsconfig.json", "tsconfig.test.json", "turbo.json"], work);
  writeFileSync(join(output, safeName(label) + ".patch"), diff.stdout);
}
async function formatting() {
  const paths: string[] = [];
  for (const item of sourcePaths()) {
    const absolute = join(candidate.cwd, item);
    if (statSync(absolute).isFile()) paths.push(item);
    else for (const file of new Bun.Glob("**/*.{ts,tsx,css}").scanSync({ cwd: absolute, onlyFiles: true })) paths.push(join(item, file));
  }
  paths.sort();
  const originals = new Map(paths.map(path => [path, readFileSync(join(candidate.cwd, path))]));
  const restore = () => { for (const [path, data] of originals) writeFileSync(join(candidate.cwd, path), data); };
  const config = join(candidate.cwd, ".oxfmtrc.json");
  writeJson(config, { singleQuote: hum, printWidth: 80, sortPackageJson: false });
  const formatters = [
    { name: "bun-pinned", work: { ...candidate, runtime: "baseline" as const }, command: ["bun", "fmt", "--no-script"] },
    { name: "bun-stable", work: stable(), command: ["bun", "fmt", "--no-script"] },
    { name: "bun-canary", work: canary(), command: ["bun", "fmt", "--no-script"] },
    { name: "oxfmt", work: stable(), command: [bin(candidate, "oxfmt")] },
  ];
  try {
    await compare(formatters.map(f => ({ name: "format/write/" + f.name, work: f.work, args: [...f.command, ...paths], before: restore })), 10);
    for (const f of formatters) {
      restore();
      const settled = await normalize(f.work, f.command, paths, "format-normalize-" + f.name);
      const changed = paths.filter(path => !readFileSync(join(candidate.cwd, path)).equals(originals.get(path)!));
      writeJson(join(output, "format-" + f.name + "-changed.json"), changed);
      await savePatch(candidate, "format-" + f.name);
      const c = { name: "format/check/" + f.name, work: f.work, args: [...f.command, "--check", ...paths] };
      if (settled) await compare([c], 10);
      else {
        // Preserve the actual failure and diff for diagnosis. Never time a reduced file set.
        await trial(c);
      }
    }
  } finally { restore(); rmSync(config, { force: true }); }
}

// Match Humagent's implicit Oxlint defaults instead of silently narrowing the rules.
function sharedLintPolicy(work: Work) {
  const path = join(work.cwd, ".oxlintrc.json");
  if (!existsSync(path)) writeJson(path, {
    plugins: ["eslint", "typescript", "unicorn", "oxc"],
    categories: { correctness: "error" },
  });
  return path;
}
function lintReport(raw: string) {
  const parsed = JSON.parse(raw);
  return {
    files: parsed.number_of_files,
    rules: parsed.number_of_rules,
    diagnostics: (parsed.diagnostics || []).map((d: any) => ({
      file: d.filename, rule: d.code, severity: d.severity,
      spans: (d.labels || []).map((l: any) => l.span),
    })).sort((a: any, b: any) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  };
}
async function linting() {
  await compare([{ name: "lint/pinned", work: base, args: ["bun", "run", "lint"], required: true }], 10);
  // The candidate's explicit policy is also used by its whole-project quality gate.
  sharedLintPolicy(candidate);
  const variants = [
    { name: "oxlint", work: stable(), args: [bin(candidate, "oxlint")] },
    { name: "bun-canary", work: canary(), args: ["bun", "lint", "--no-script"] },
  ];
  await compare(variants.map(v => ({ name: "lint/shared-policy/" + v.name, work: v.work, args: [...v.args, ...lintPaths()] })), 10);
  const fixture = join(candidate.cwd, "src", "__bench_lint_fixture.ts");
  const parity: Record<string, unknown> = {};
  let same = true;
  async function compareReports(label: string, files: string[], expectError: boolean) {
    const reports = [];
    for (const v of variants) {
      const args = [...v.args, "--format", "json", ...files];
      const r = await execute(args, v.work);
      writeFileSync(join(output, "lint-" + label + "-" + v.name + ".json"), r.stdout);
      writeFileSync(join(output, "lint-" + label + "-" + v.name + ".stderr.log"), r.stderr);
      let report;
      try { report = lintReport(r.stdout); } catch { same = false; }
      if (!report || r.exit !== (expectError ? 1 : 0) || (expectError && !report.diagnostics.length)) same = false;
      reports.push({ exit: r.exit, report });
    }
    parity[label] = reports;
    if (JSON.stringify(reports[0]) !== JSON.stringify(reports[1])) same = false;
  }
  await compareReports("repository", lintPaths(), false);
  // Different rules, file locations and severities. No production file is changed.
  const fixtures = {
    unreachable: "export function broken(n: number) { if (n) return 1; throw new Error('x'); return 2; }\n",
    duplicate: "export const broken = { a: 1, a: 2 };\n",
    constant: "export function broken() { if (true) return 1; return 2; }\n",
  };
  try {
    for (const [name, source] of Object.entries(fixtures)) {
      writeFileSync(fixture, source);
      await compareReports(name, ["src/__bench_lint_fixture.ts"], true);
    }
  } finally { rmSync(fixture, { force: true }); }
  writeJson(join(output, "lint-parity.json"), { equivalent: same, reports: parity });
  console.log("Lint diagnostic parity: " + (same ? "PASS (sampled rules)" : "DIFFERENCE — retain Oxlint"));
  // A mismatch is evidence against adoption; the stable quality gate still runs.
}

async function builds() {
  const cases = [
    { name: "build/pinned", work: base, args: ["bun", "run", "build"], required: true },
    { name: "build/vite-latest-node", work: stable(), args: buildCommand(candidate, false) },
    { name: "build/vite-latest-bun", work: stable(), args: buildCommand(candidate, true) },
    { name: "build/vite-latest-bun-canary", work: canary(), args: buildCommand(candidate, true) },
  ];
  await compare(cases.map(c => ({
    ...c, before: () => cleanDist(c.work),
    validate: (_, exit) => exit === 0 && validBuild(c.work),
  })), 5);
  // Keep a normal Node build for acceptance and type checks. Record the output contract.
  await must(["bun", "run", "build"], base, "baseline-build");
  if (!validBuild(base)) throw Error("Baseline build contract failed.");
  inventory(base, "baseline");
  for (const c of cases.slice(1)) {
    if (await trial({ ...c, before: () => cleanDist(c.work), validate: (_, exit) => exit === 0 && validBuild(c.work) })) inventory(c.work, safeName(c.name));
  }
  await must(buildCommand(candidate, false), candidate, "candidate-node-build");
  if (!validBuild(candidate)) throw Error("Candidate build contract failed.");
}
async function typechecks() {
  const checkers = [
    { name: "types/pinned", work: base, args: ["bun", "run", "typecheck"], required: true },
    { name: "types/tsrs", work: stable(), args: typeCommand("tsrs") },
    { name: "types/typescript7", work: stable(), args: typeCommand("tsc") },
    { name: "types/bun-stable", work: stable(), args: typeCommand("bun") },
    { name: "types/bun-canary", work: canary(), args: typeCommand("bun") },
  ];
  await compare(checkers, 7);
  const fixture = join(candidate.cwd, "src", "__bench_type_error.ts");
  writeFileSync(fixture, "export const broken: string = 42;\n");
  try {
    for (const c of checkers.slice(1)) await trial({
      ...c, name: c.name + "/seeded-error", validate: (text, exit) => exit !== 0 && /TS2322|not assignable/.test(text),
    });
  } finally { rmSync(fixture, { force: true }); }
}
function buildFingerprint(work: Work) {
  const dir = join(work.cwd, "dist");
  if (!existsSync(dir)) return "";
  const digest = createHash("sha256");
  const files = readdirSync(dir, { recursive: true }).map(String).filter(path => statSync(join(dir, path)).isFile()).sort();
  for (const file of files) digest.update(file).update("\0").update(readFileSync(join(dir, file))).update("\0");
  return digest.digest("hex");
}
async function cacheAndChecks() {
  await compare([{ name: "check/pinned-cold", work: base, args: ["bun", "run", "check"], required: true, env: hum ? { TURBO_FORCE: "true" } : {} }], 2, false);
  const path = join(candidate.cwd, "package.json");
  const original = readFileSync(path, "utf8");
  const originalManifest = JSON.parse(original);
  const paths = sourcePaths();
  const fmtPaths = hum ? [...paths, "tsconfig.json", "tsconfig.test.json", "package.json", "turbo.json"] : paths;
  // Normalize separately for each version, before timing; preserve a patch for review.
  // Worktrees are disposable. The checked-in baseline remains unchanged.
  const originals = new Map<string, Buffer>();
  for (const item of fmtPaths) {
    const absolute = join(candidate.cwd, item);
    if (statSync(absolute).isFile()) originals.set(item, readFileSync(absolute));
    else for (const file of new Bun.Glob("**/*.{ts,tsx,css}").scanSync({ cwd: absolute, onlyFiles: true })) {
      const key = join(item, file);
      originals.set(key, readFileSync(join(candidate.cwd, key)));
    }
  }
  function restoreSource() {
    for (const [file, bytes] of originals) writeFileSync(join(candidate.cwd, file), bytes);
    writeFileSync(path, original);
  }
  const nativeCheck = "bun check --no-script -p tsconfig.json" + (hum ? " && bun check --no-script -p tsconfig.test.json" : "");
  const candidates = [
    { name: "updated-tools", work: stable(), native: false, nativeLint: false, required: false },
    { name: "native-stable", work: stable(), native: true, nativeLint: false, required: false },
    { name: "native-canary", work: canary(), native: true, nativeLint: true, required: true },
  ];
  try {
    for (const c of candidates) {
      restoreSource();
      const next = JSON.parse(JSON.stringify(originalManifest));
      if (c.native) next.scripts.typecheck = nativeCheck;
      if (c.nativeLint) next.scripts.lint = "bun lint --no-script " + lintPaths().join(" ");
      if (!hum) {
        // Include the new format gate in the candidate, not in the original baseline.
        next.scripts.check = next.scripts.check.replace(" lint ", " format:check lint ");
      }
      writeJson(path, next);
      // For Humagent tsrs remains installed because Vite's declaration plugin needs it;
      // no tsrs check is invoked by either native quality gate.
      const ready = await normalize(c.work, ["bun", "fmt", "--no-script"], fmtPaths, "quality-format-" + c.name);
      await savePatch(candidate, "quality-" + c.name);
      if (!ready) console.log("Quality gate " + c.name + ": formatting did not converge; preserve failure.");
      const gate: Case = { name: "check/" + c.name + "-cold", work: c.work, args: ["bun", "run", "check"], required: c.required, env: hum ? { TURBO_FORCE: "true" } : {} };
      await compare([gate], 3, false);
    }
  } finally { restoreSource(); }

  // Compare an identical build using isolated caches, with an explicit input set.
  // Exclude cache files and outputs themselves from hashing, including in linked worktrees.
  if (!hum) writeJson(join(candidate.cwd, "turbo.json"), {
    remoteCache: { enabled: false },
    globalDependencies: ["bun.lock", "package.json"],
    tasks: { build: {
      inputs: ["src/**", "ui/**", "assets/brand/**", "scripts/bundled-dependencies.ts", "patches/**", "vite.config.ts", "tsconfig.json", "package.json", "bun.lock"],
      outputs: ["dist/**"],
    } },
  });
  mkdirSync(join(candidate.cwd, ".turbo"), { recursive: true });
  writeFileSync(join(candidate.cwd, ".turbo/node-version"), versions.node + "\n");
  await must(["bun", "add", "-d", "--exact", "--ignore-scripts", "vite-plus@1.8.0"], candidate, "vite-task-install");
  const turboCache = join(home, "turbo-build-cache");
  const cache = [
    { name: "turbo" as const, args: [bin(candidate, "turbo"), "run", "build", "--cache-dir=" + turboCache], clean: () => rmSync(turboCache, { recursive: true, force: true }) },
    { name: "vite-task" as const, args: [bin(candidate, "vp"), "run", "--cache", "build"], clean: () => rmSync(join(candidate.cwd, "node_modules/.vite/task-cache"), { recursive: true, force: true }) },
  ];
  await compare([{ name: "task/direct-build", work: stable(), args: ["bun", "run", "build"], before: () => cleanDist(candidate), validate: (_, exit) => exit === 0 && validBuild(candidate) }], 5);
  for (const c of cache) {
    let expected = "";
    const build = (name: string, mode: "hit" | "miss" | "either", before?: () => void): Case => ({
      name: "task/" + c.name + "/" + name, work: stable(), args: c.args, before,
      env: { TURBO_FORCE: "false" },
      validate: (text, exit) => exit === 0 && validBuild(candidate) &&
        (mode === "either" || cacheResult(c.name, text) === mode) &&
        (name !== "restore-output" || buildFingerprint(candidate) === expected),
    });
    if (!await trial(build("cold", "miss", () => { c.clean(); cleanDist(candidate); }))) continue;
    expected = buildFingerprint(candidate);
    await compare([build("unchanged", "hit")], 7, false);
    await compare([build("restore-output", "hit", () => cleanDist(candidate))], 5, false);
    for (const [label, file] of [["docs-edit", "README.md"], ["test-edit", hum ? "test/text-diff.test.ts" : "tests/unit/sdk.test.ts"], ["source-edit", hum ? "src/sdk/sdk.ts" : "ui/src/main.tsx"]]) {
      const absolute = join(candidate.cwd, file!);
      const original = readFileSync(absolute);
      try {
        writeFileSync(absolute, Buffer.concat([original, Buffer.from("\n" + (label === "docs-edit" ? "<!-- benchmark -->" : "// benchmark input change") + "\n")]));
        await trial(build(label!, label === "source-edit" ? "miss" : "hit"));
      } finally { writeFileSync(absolute, original); }
      await trial(build("reset-after-" + label, "either"));
    }
  }
}


async function adoptedChecks() {
  await worktree(adopted, "HEAD");
  const install: Case = {
    name: "adopted/install-frozen", work: adopted, args: ["bun", "install", "--frozen-lockfile"], required: true,
  };
  if (!await trial(install)) return;
  const cache = join(home, "adopted-turbo-cache");
  const check = (name: string, mode: "hit" | "miss" | "warm" | "either", before?: () => void): Case => ({
    name: "adopted/check/" + name, work: adopted, args: ["bun", "run", "check"], required: true, before,
    env: { TURBO_CACHE_DIR: cache, TURBO_FORCE: "false" },
    validate: (text, exit) => exit === 0 && validBuild(adopted) &&
      (mode === "either" || (mode === "warm"
        ? ["hit", "partial"].includes(cacheResult("turbo", text))
        : cacheResult("turbo", text) === mode)),
  });
  await compare([check("cold", "miss", () => {
    rmSync(cache, { recursive: true, force: true });
    cleanDist(adopted);
  })], 2, false);
  await compare([check("unchanged", "warm")], 3, false);
  const expected = buildFingerprint(adopted);
  const restore = check("restore-output", "warm", () => cleanDist(adopted));
  const validate = restore.validate!;
  restore.validate = (text, exit) => validate(text, exit) && buildFingerprint(adopted) === expected;
  await trial(restore);
  for (const [label, file] of [["docs-edit", "README.md"], ["test-edit", hum ? "test/text-diff.test.ts" : "tests/unit/sdk.test.ts"], ["source-edit", hum ? "src/sdk/sdk.ts" : "ui/src/main.tsx"]]) {
    const absolute = join(adopted.cwd, file!);
    const original = readFileSync(absolute);
    try {
      // A valid comment changes the hash without creating an unrelated failure.
      const comment = label === "docs-edit" ? "<!-- benchmark -->" : "// benchmark input change";
      writeFileSync(absolute, Buffer.concat([original, Buffer.from("\n" + comment + "\n")]));
      const changed = check(label!, "either");
      // Source/test edits must invalidate at least one task. Documentation may
      // also run a dedicated links check, according to the project's task graph.
      changed.validate = (text, exit) => {
        const result = cacheResult("turbo", text);
        return exit === 0 && validBuild(adopted) && result !== "unknown" &&
          (label === "docs-edit" || result === "miss" || result === "partial");
      };
      await trial(changed);
    } finally { writeFileSync(absolute, original); }
  }
}

async function packaging() {
  if (hum) {
    const commands = [
      { name: "package/npm", work: base, args: ["npm", "pack", "--ignore-scripts", "--pack-destination"] },
      ...([ "baseline", "stable", "canary" ] as Runtime[]).map(runtime => ({ name: "package/bun-" + runtime, work: { ...base, runtime }, args: ["bun", "pm", "pack", "--ignore-scripts", "--destination"] })),
    ];
    for (const c of commands) {
      const dir = join(home, safeName(c.name));
      mkdirSync(dir, { recursive: true });
      await compare([{ name: c.name, work: c.work, args: [...c.args, dir],
        before: () => { for (const f of readdirSync(dir)) rmSync(join(dir, f), { force: true }); } }], 3, false);
      const archive = readdirSync(dir).find(f => f.endsWith(".tgz"));
      if (archive) await must(["tar", "-tzf", join(dir, archive)], base, safeName(c.name) + "-contents");
    }
  } else {
    // This is the repository's real archive acceptance, not a generic bundling benchmark.
    for (const work of [base, stable()]) {
      await trial({ name: "package/archive-acceptance/" + work.runtime, work, args: ["bun", "run", "check:archive", "--out-dir", join(home, "archive-" + work.runtime)], required: work.runtime === "baseline" });
    }
  }
}
function fastTestArgs(work: Work, parallel?: number) {
  if (hum) return parallel ? ["bun", "test", "--parallel=" + parallel, "./test/cli.test.ts", "./test/server.test.ts", "./test/text-diff.test.ts", "--timeout", "15000", "--bail=1"] : ["bun", "run", "test:fast"];
  return parallel ? ["bun", "test", "--parallel=" + parallel, "--timeout", "15000", "./tests/unit"] : ["bun", "run", "test"];
}
async function tests() {
  await must(["bun", "run", "build"], base, "baseline-build");
  await must(["bun", "run", "build"], candidate, "candidate-build");
  if (!validBuild(base) || !validBuild(candidate)) throw Error("Build output contract failed.");
  await compare([
    { name: "tests/pinned", work: base, args: fastTestArgs(base), required: true },
    { name: "tests/bun-stable", work: stable(), args: fastTestArgs(candidate) },
    { name: "tests/bun-canary", work: canary(), args: fastTestArgs(candidate) },
    ...[2, 4, 8].map(n => ({ name: "tests/bun-stable-workers-" + n, work: stable(), args: fastTestArgs(candidate, n) })),
  ], hum ? 3 : 2, false);
  if (hum) {
    for (const work of [base, stable(), canary()]) rmSync(join(work.cwd, ".local/dev"), { recursive: true, force: true });
    await compare([
      { name: "dev/workspace-pinned-node", work: base, args: ["bun", ".github/benchmarks/dev-start.ts", "node"], required: true },
      { name: "dev/workspace-latest-node", work: stable(), args: ["bun", ".github/benchmarks/dev-start.ts", "node"] },
      { name: "dev/workspace-latest-bun", work: stable(), args: ["bun", ".github/benchmarks/dev-start.ts", "bun"] },
      { name: "dev/workspace-latest-canary", work: canary(), args: ["bun", ".github/benchmarks/dev-start.ts", "bun"] },
    ].map(c => ({ ...c, before: () => rmSync(join(c.work.cwd, ".local/dev"), { recursive: true, force: true }) })), 3, false);
    const cli = "node_modules/@playwright/test/cli.js";
    await must(["node", cli, "install", ...(platform() === "linux" ? ["--with-deps"] : []), "--only-shell", "chromium"], base, "install-playwright-chromium");
    await compare([
      { name: "browser/playwright-node-pinned", work: base, args: ["node", cli, "test", "--config", "test/playwright.config.ts"], required: true },
      { name: "browser/playwright-node-latest-tools", work: stable(), args: ["node", cli, "test", "--config", "test/playwright.config.ts"] },
      { name: "browser/playwright-bun-stable", work: stable(), args: ["bun", cli, "test", "--config", "test/playwright.config.ts"] },
      { name: "browser/playwright-bun-canary", work: canary(), args: ["bun", cli, "test", "--config", "test/playwright.config.ts"] },
    ], 3, false);
  } else {
    // Real local UI API plus Vite source server. No external sites or browser profile downloads.
    await compare([
      { name: "dev/server-smoke-pinned", work: base, args: ["bun", "run", "dev:smoke"], required: true },
      { name: "dev/server-smoke-latest", work: stable(), args: ["bun", "run", "dev:smoke"] },
      { name: "dev/server-smoke-canary", work: canary(), args: ["bun", "run", "dev:smoke"] },
    ], 3, false);
  }
}
function percentile(values: number[], fraction: number) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  if (fraction === 0.5 && sorted.length % 2 === 0) return (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2;
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]!;
}
function report() {
  const names = [...new Set(rows.map(r => r.name))];
  const aggregates = names.map(name => {
    const trials = rows.filter(r => r.name === name);
    const ok = trials.every(r => r.ok);
    const times = ok ? trials.map(r => r.ms) : [];
    const memory = ok ? trials.flatMap(r => r.rssKiB === null ? [] : [r.rssKiB]) : [];
    return { name, trials: trials.length, ok, required: trials.some(r => r.required), medianMs: percentile(times, 0.5), p95Ms: percentile(times, 0.95), medianRssKiB: percentile(memory, 0.5) };
  });
  const metadata = { project: manifest.name, suite, ref: process.env.GITHUB_SHA, baselineRef, adoptedPackageManager: manifest.packageManager, platform: platform(), arch: arch(), cpu: cpus()[0]?.model, cores: cpus().length, memoryBytes: totalmem(), versions, errors };
  writeJson(join(output, "results.json"), { metadata, aggregates, trials: rows });
  const number = (n: number | null) => n === null ? "—" : n.toFixed(1);
  const md = [
    "# Toolchain benchmarks: " + manifest.name + " / " + suite,
    "", "Commit: " + process.env.GITHUB_SHA + " · " + platform() + "/" + arch() + " · " + cpus().length + " CPUs",
    "", "Historical baseline and isolated comparison source: `" + baselineRef + "`. Adopted stack: `" + manifest.packageManager + "` at the tested commit.",
    "", ...Object.entries(versions).map(([k, v]) => "- " + k + ": " + v),
    "", "| Scenario | Runs | Status | Median ms | p95 ms | Median peak RSS KiB |",
    "|---|---:|---|---:|---:|---:|",
    ...aggregates.map(r => "| " + [r.name, r.trials, r.ok ? "pass" : "INVALID", number(r.medianMs), number(r.p95Ms), number(r.medianRssKiB)].join(" | ") + " |"),
    "", "Invalid runs have no speed result. Candidate failures are evidence, not silent passes. RSS is the direct child process maximum reported by Bun resourceUsage(), not aggregate concurrent process memory. Missing RSS does not change the command result. Review raw diagnostic logs and build inventories before adopting changes.",
    ...(errors.length ? ["", "Setup errors:", ...errors.map(e => "- " + e)] : []), "",
  ].join("\n");
  writeFileSync(join(output, "summary.md"), md);
  if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, md, { flag: "a" });
  if (errors.length || aggregates.some(r => r.required && !r.ok)) process.exitCode = 1;
}
try {
  await prepare();
  if (suite === "tools") {
    await formatting();
    await linting();
    await builds();
    await typechecks();
    await packaging();
    await cacheAndChecks();
    await adoptedChecks();
  } else await tests();
} catch (error) {
  errors.push(String(error));
  console.error(error);
} finally {
  report();
}
