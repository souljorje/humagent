// Humagent: measure readiness of the actual Vite workspace, not just process spawn.
const runtime = process.argv[2];
if (runtime !== "node" && runtime !== "bun") throw Error("Use node or bun.");
const child = Bun.spawn([runtime, "node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "5173", "--strictPort"], {
  cwd: process.cwd(), stdout: "pipe", stderr: "pipe", env: process.env,
});
const stderr = new Response(child.stderr).text();
const reader = child.stdout.getReader();
const decoder = new TextDecoder();
let timeout: ReturnType<typeof setTimeout> | undefined;
try {
  await Promise.race([
    (async () => {
      let output = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) throw Error("Vite exited before the workspace was ready.");
        output += decoder.decode(value, { stream: true });
        if (/Workspace:\s+http/.test(output)) break;
      }
      const response = await fetch("http://127.0.0.1:5173/examples/", { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw Error("Vite example is unavailable.");
    })(),
    new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(Error("Workspace startup timed out.")), 30_000); }),
  ]);
  console.log("Workspace and example ready.");
} finally {
  if (timeout) clearTimeout(timeout);
  child.kill("SIGTERM");
  await child.exited;
  await reader.cancel().catch(() => {});
  // Keep private workspace launch URLs out of benchmark artifacts.
  await stderr;
}
