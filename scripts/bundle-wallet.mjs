/**
 * Bundle Privy wallet UI plus the XMTP worker/WASM assets the browser SDK
 * loads via `new URL(..., import.meta.url)`. esbuild does not emit those
 * workers from the prebuilt SDK, so Client.create hangs forever without them.
 */
import * as esbuild from "esbuild";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function rewriteXmtpAssetUrls(contents) {
  return contents
    .replaceAll(
      'new URL("./workers/client", import.meta.url)',
      'new URL("/workers/client.js", import.meta.url)'
    )
    .replaceAll(
      'new URL("./workers/opfs", import.meta.url)',
      'new URL("/workers/opfs.js", import.meta.url)'
    )
    .replaceAll(
      "new URL('bindings_wasm_bg.wasm', import.meta.url)",
      'new URL("/bindings_wasm_bg.wasm", import.meta.url)'
    )
    .replaceAll(
      'new URL("bindings_wasm_bg.wasm", import.meta.url)',
      'new URL("/bindings_wasm_bg.wasm", import.meta.url)'
    )
    .replaceAll(
      'new URL("./bindings_wasm_bg.wasm", import.meta.url)',
      'new URL("/bindings_wasm_bg.wasm", import.meta.url)'
    );
}

const HISTORY_FETCH_PATCH = `/* azzle-xmtp-history-proxy */
(function () {
  var up = "https://message-history.production.ephemera.network";
  var proxy = "https://www.azzle.org/xmtp-history";
  var orig = globalThis.fetch.bind(globalThis);
  globalThis.fetch = function (input, init) {
    try {
      var raw = typeof input === "string" ? input : input instanceof URL ? String(input) : input && input.url;
      if (typeof raw === "string" && raw.indexOf(up) === 0) {
        var next = proxy + raw.slice(up.length);
        if (typeof input === "string" || input instanceof URL) return orig(next, init);
        return orig(new Request(next, input), init);
      }
    } catch (e) {}
    return orig(input, init);
  };
})();
`;

async function rewriteFile(filePath) {
  const contents = await readFile(filePath, "utf8");
  const next = rewriteXmtpAssetUrls(contents);
  if (next !== contents) await writeFile(filePath, next);
}

async function patchWorkerHistoryFetch(filePath) {
  const contents = await readFile(filePath, "utf8");
  if (contents.includes("azzle-xmtp-history-proxy")) return;
  await writeFile(filePath, HISTORY_FETCH_PATCH + contents);
}

function xmtpAssetPlugin() {
  return {
    name: "xmtp-browser-assets",
    setup(build) {
      build.onLoad({ filter: /@xmtp[/\\].*\.js$/ }, async (args) => {
        const contents = rewriteXmtpAssetUrls(await readFile(args.path, "utf8"));
        return { contents, loader: "js" };
      });
    },
  };
}

async function copyXmtpWasm(outDir) {
  const wasmSrc = join(root, "node_modules", "@xmtp", "wasm-bindings", "dist", "bindings_wasm_bg.wasm");
  await cp(wasmSrc, join(outDir, "bindings_wasm_bg.wasm"));
  await mkdir(join(outDir, "workers"), { recursive: true });
  await cp(wasmSrc, join(outDir, "workers", "bindings_wasm_bg.wasm"));
}

async function bundleXmtpWorkers(outDir, logLevel) {
  const workersSrc = join(root, "node_modules", "@xmtp", "browser-sdk", "dist", "workers");
  const workersOut = join(outDir, "workers");
  await mkdir(workersOut, { recursive: true });
  for (const name of ["client", "opfs"]) {
    await esbuild.build({
      entryPoints: [join(workersSrc, `${name}.js`)],
      bundle: true,
      format: "esm",
      outfile: join(workersOut, `${name}.js`),
      target: ["es2022", "chrome109", "firefox109", "safari16"],
      plugins: [xmtpAssetPlugin()],
      logLevel,
    });
  }
}

export async function bundleWallet(outDir, { logLevel = "info" } = {}) {
  await esbuild.build({
    entryPoints: [join(root, "src", "wallet-entry.jsx")],
    bundle: true,
    format: "esm",
    outfile: join(outDir, "role-wallet.bundle.js"),
    jsx: "automatic",
    target: ["es2022", "chrome109", "firefox109", "safari16"],
    plugins: [xmtpAssetPlugin()],
    logLevel,
  });

  await esbuild.build({
    entryPoints: [join(root, "src", "wallet-qr.mjs")],
    bundle: true,
    format: "iife",
    outfile: join(outDir, "wallet-qr.js"),
    target: ["es2022", "chrome109", "firefox109", "safari16"],
    logLevel,
  });

  await copyXmtpWasm(outDir);
  await bundleXmtpWorkers(outDir, logLevel);
  await rewriteFile(join(outDir, "role-wallet.bundle.js"));
  await rewriteFile(join(outDir, "workers", "client.js"));
  await rewriteFile(join(outDir, "workers", "opfs.js"));
  await patchWorkerHistoryFetch(join(outDir, "workers", "client.js"));
}
