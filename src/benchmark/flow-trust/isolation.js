import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export async function scanModuleImports(entryFile, root) {
  const visited = new Set();
  const imports = [];
  async function visit(file) {
    const resolved = path.resolve(file);
    if (visited.has(resolved)) return;
    visited.add(resolved);
    const source = await readFile(resolved, "utf8");
    const expression = /(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/gu;
    for (const match of source.matchAll(expression)) {
      const specifier = match[1];
      imports.push({ importer: path.relative(root, resolved), specifier });
      if (specifier.startsWith(".")) await visit(path.resolve(path.dirname(resolved), specifier));
    }
  }
  await visit(entryFile);
  return imports;
}
