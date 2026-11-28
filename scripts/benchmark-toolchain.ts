/**
 * Compare real project commands, never publish or mutate a developer's checkout.
 * The workflow provides three Bun executables. Candidate installs are disposable.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { cpus, platform, arch, totalmem } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";

const suite = process.argv[2];
if (suite !== "tools" && suite !== "tests") throw Error("Use: bun scripts/benchmark-toolchain.ts tools|tests");
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
  const command = timed ? ["/usr/bin/time", platform() === "darwin" ? "-l" : "-v", ...args] : args;
  const start = performance.now();
  const child = Bun.spawn(command, { cwd: work.cwd, env: envFor(work, extra), stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  const ms = performance.now() - start;
  const match = platform() === "darwin" ? stderr.match(/(\d+)\s+maximum resident set size/) : stderr.match(/Maximum resident set size \(kbytes\):\s*(\d+)/);
  return { stdout, stderr, exit, ms, rssKiB: match ? Math.round(Number(match[1]) / (platform() === "darwin" ? 1024 : 1)) : null };
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
  const active: Case[] = [];
  for (const c of cases) {
    if (!warmup || await trial(c, false)) active.push(c);
    else await trial(c); // Preserve failed candidates in the report, not a speedup.
  }
  for (let i = 0; i < repeats; i++) {
    const offset = i % (active.length || 1);
    for (const c of [...active.slice(offset), ...active.slice(0, offset)]) {
      if (!await trial(c)) break; // A failed repetition invalidates its entire row.
    }
  }
}
async function must(args: string[], work: Work, label: string) {
  const r = await execute(args, work);
  writeFileSync(join(output, safeName(label) + ".log"), r.stdout + "\n" + r.stderr);
  if (r.exit !== 0) throw Error(label + " failed: see " + safeName(label) + ".log");
  return r.stdout.trim();
}
async function worktree(work: Work) {
  await must(["git", "worktree", "add", "--detach", work.cwd, "HEAD"], { ...work, cwd: root }, "worktree-" + work.runtime);
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
  cpSync(join(candidate.cwd, "package.json"), join(output, "candidate-package.json"));
  cpSync(join(candidate.cwd, "bun.lock"), join(output, "candidate-bun.lock"));
}
async function formatting() {
  // All formatters receive identical TS/TSX/CSS inputs. No source edits survive.
  const paths: string[] = [];
  for (const item of sourcePaths()) {
    const absolute = join(candidate.cwd, item);
    if (statSync(absolute).isFile()) paths.push(item);
    else for (const file of new Bun.Glob("**/*.{ts,tsx,css}").scanSync({ cwd: absolute, onlyFiles: true })) paths.push(join(item, file));
  }
  const originals = new Map(paths.map(path => [path, readFileSync(join(candidate.cwd, path))]));
  const restore = () => { for (const [path, data] of originals) writeFileSync(join(candidate.cwd, path), data); };
  const config = join(candidate.cwd, ".oxfmtrc.json");
  writeJson(config, { singleQuote: hum, printWidth: 80, sortPackageJson: false });
  const formatters = [
    { name: "bun-stable", work: stable(), command: ["bun", "fmt"] },
    { name: "bun-canary", work: canary(), command: ["bun", "fmt"] },
    { name: "oxfmt", work: stable(), command: [bin(candidate, "oxfmt")] },
  ];
  try {
    await compare(formatters.map(f => ({ name: "format/write/" + f.name, work: f.work, args: [...f.command, ...paths], before: restore })), 10);
    // A check is meaningful only on input normalized by that formatter.
    for (const f of formatters) {
      restore();
      if (await trial({ name: "format/normalize/" + f.name, work: f.work, args: [...f.command, ...paths] })) {
        await compare([{ name: "format/check/" + f.name, work: f.work, args: [...f.command, "--check", ...paths] }], 10);
        const changed = paths.filter(path => !readFileSync(join(candidate.cwd, path)).equals(originals.get(path)!));
        writeJson(join(output, "format-" + f.name + "-changed.json"), changed);
      }
    }
  } finally { restore(); rmSync(config, { force: true }); }
}
async function linting() {
  await compare([{ name: "lint/pinned", work: base, args: ["bun", "run", "lint"], required: true }], 10);
  // Stelz already has its policy. Humagent has implicit defaults; compare both tools
  // with the same explicit correctness policy, and keep the pinned default result.
  const config = join(candidate.cwd, ".oxlintrc.json");
  const hadConfig = existsSync(config);
  if (!hadConfig) writeJson(config, { plugins: ["eslint", "typescript"], categories: { correctness: "error" } });
  const variants = [
    { name: "oxlint", work: stable(), args: [bin(candidate, "oxlint")] },
    { name: "bun-canary", work: canary(), args: ["bun", "lint", "--no-script"] },
  ];
  try {
    await compare(variants.map(v => ({ name: "lint/shared-policy/" + v.name, work: v.work, args: [...v.args, ...lintPaths()] })), 10);
    // Machine-readable reports and an intentional error test rule coverage, not just exit 0.
    for (const v of variants) await trial({ name: "lint/diagnostics/" + v.name, work: v.work, args: [...v.args, "--format", "json", ...lintPaths()] });
    const fixture = join(candidate.cwd, "src", "__bench_lint_fixture.ts");
    writeFileSync(fixture, "export function broken(n: number) { if (n === n) return 1; throw new Error('x'); return 2; }\n");
    try {
      for (const v of variants) await trial({
        name: "lint/seeded-error/" + v.name, work: v.work, args: [...v.args, "--format", "json", "src/__bench_lint_fixture.ts"],
        validate: (text, exit) => exit === 1 && /no-self-compare|no-unreachable/.test(text),
      });
    } finally { rmSync(fixture, { force: true }); }
  } finally { if (!hadConfig) rmSync(config, { force: true }); }
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
async function cacheAndChecks() {
  // Whole-repo check with existing orchestration. Force a real cold run in Humagent.
  await compare([
    { name: "check/pinned-cold", work: base, args: ["bun", "run", "check"], required: true, env: hum ? { TURBO_FORCE: "true" } : {} },
    { name: "check/updated-tools-cold", work: stable(), args: ["bun", "run", "check"], env: hum ? { TURBO_FORCE: "true" } : {} },
  ], 2, false);
  // Compare the proposed native quality gates as a complete workflow.
  const path = join(candidate.cwd, "package.json");
  const original = readFileSync(path, "utf8");
  const next = JSON.parse(original);
  next.scripts.lint = "bun lint --no-script " + lintPaths().join(" ");
  next.scripts.typecheck = "bun check --no-script -p tsconfig.json" + (hum ? " && bun check --no-script -p tsconfig.test.json" : "");
  writeJson(path, next);
  // Humagent's check includes package.json formatting, so normalize the changed manifest.
  if (hum) await must(["bun", "fmt", "package.json"], canary(), "candidate-format-manifest");
  try {
    await compare([{ name: "check/native-canary-cold", work: canary(), args: ["bun", "run", "check"], env: hum ? { TURBO_FORCE: "true" } : {} }], 2, false);
  } finally { writeFileSync(path, original); }

  // Same real build task and same Vite version under each scheduler.
  if (!hum) writeJson(join(candidate.cwd, "turbo.json"), {
    remoteCache: { enabled: false }, tasks: { build: { outputs: ["dist/**"] } },
  });
  mkdirSync(join(candidate.cwd, ".turbo"), { recursive: true });
  writeFileSync(join(candidate.cwd, ".turbo/node-version"), versions.node + "\n");
  await must(["bun", "add", "-d", "--exact", "--ignore-scripts", "vite-plus@1.8.0"], candidate, "vite-task-install");
  const cache = [
    { name: "turbo", args: [bin(candidate, "turbo"), "run", "build"], clean: () => rmSync(join(candidate.cwd, ".turbo/cache"), { recursive: true, force: true }) },
    { name: "vite-task", args: [bin(candidate, "vp"), "run", "--cache", "build"], clean: () => rmSync(join(candidate.cwd, "node_modules/.vite/task-cache"), { recursive: true, force: true }) },
  ];
  await compare([{ name: "task/direct-build", work: stable(), args: ["bun", "run", "build"], before: () => cleanDist(candidate), validate: (_, exit) => exit === 0 && validBuild(candidate) }], 5);
  for (const c of cache) {
    const build = (name: string, before?: () => void): Case => ({
      name: "task/" + c.name + "/" + name, work: stable(), args: c.args, before,
      validate: (_, exit) => exit === 0 && validBuild(candidate),
    });
    if (!await trial(build("cold", () => { c.clean(); cleanDist(candidate); }))) continue;
    await compare([build("unchanged")], 7, false);
    await compare([build("restore-output", () => cleanDist(candidate))], 5, false);
    // Mutate one input at a time in the disposable worktree. No result is a release gate.
    for (const [label, file] of [["docs-edit", "README.md"], ["test-edit", hum ? "test/text-diff.test.ts" : "tests/unit/sdk.test.ts"], ["source-edit", hum ? "src/sdk/sdk.ts" : "ui/src/main.tsx"]]) {
      const absolute = join(candidate.cwd, file!);
      const original = readFileSync(absolute);
      try {
        writeFileSync(absolute, Buffer.concat([original, Buffer.from("\n" + (label === "docs-edit" ? "<!-- benchmark -->" : "// benchmark input change") + "\n")]));
        await trial(build(label!));
      } finally { writeFileSync(absolute, original); }
      await trial(build("reset-after-" + label));
    }
  }
}
async function packaging() {
  if (hum) {
    const commands = [
      { name: "package/npm", args: ["npm", "pack", "--ignore-scripts", "--pack-destination"] },
      { name: "package/bun", args: ["bun", "pm", "pack", "--ignore-scripts", "--destination"] },
    ];
    for (const c of commands) {
      const dir = join(home, safeName(c.name));
      mkdirSync(dir, { recursive: true });
      await compare([{ name: c.name, work: base, args: [...c.args, dir],
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
  const metadata = { project: manifest.name, suite, ref: process.env.GITHUB_SHA, platform: platform(), arch: arch(), cpu: cpus()[0]?.model, cores: cpus().length, memoryBytes: totalmem(), versions, errors };
  writeJson(join(output, "results.json"), { metadata, aggregates, trials: rows });
  const number = (n: number | null) => n === null ? "—" : n.toFixed(1);
  const md = [
    "# Toolchain benchmarks: " + manifest.name + " / " + suite,
    "", "Commit: " + process.env.GITHUB_SHA + " · " + platform() + "/" + arch() + " · " + cpus().length + " CPUs",
    "", ...Object.entries(versions).map(([k, v]) => "- " + k + ": " + v),
    "", "| Scenario | Runs | Status | Median ms | p95 ms | Median peak RSS KiB |",
    "|---|---:|---|---:|---:|---:|",
    ...aggregates.map(r => "| " + [r.name, r.trials, r.ok ? "pass" : "INVALID", number(r.medianMs), number(r.p95Ms), number(r.medianRssKiB)].join(" | ") + " |"),
    "", "Invalid runs have no speed result. Candidate failures are evidence, not silent passes. RSS is the OS-reported maximum for the timed command, not aggregate concurrent process memory. Review raw diagnostic logs and build inventories before adopting changes.",
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
  } else await tests();
} catch (error) {
  errors.push(String(error));
  console.error(error);
} finally {
  report();
}
