import standardManifest from "./contracts.json" with { type: "json" };

let cached = null;

export function loadManifest() {
  if (cached) return cached;
  cached = standardManifest ?? null;
  return cached;
}
