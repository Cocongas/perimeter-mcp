import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import type { SourceFile } from "./scanner/index";

const EXTENSIONS = new Set([
  ".html",
  ".htm",
  ".js",
  ".mjs",
  ".cjs",
  ".jsx",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".vue",
  ".svelte",
  ".css",
  ".scss",
  ".less",
]);
const SKIP = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "out",
  "coverage",
  ".venv",
  "venv",
  "__pycache__",
  ".turbo",
  ".vercel",
  ".cache",
  "vendor",
]);
const MAX_FILES = 500;
const MAX_BYTES = 500_000;

export type ReadResult = { files: SourceFile[]; skipped: string[] };

function* walk(dir: string): Generator<string> {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name) && !entry.name.startsWith(".")) yield* walk(join(dir, entry.name));
    } else if (entry.isFile()) {
      yield join(dir, entry.name);
    }
  }
}

/**
 * Reads source files from paths on disk. Folders are walked; dependency and
 * build folders, minified files and very large files are left out and listed
 * in `skipped` when they were asked for by name.
 */
export function readPaths(paths: string[], cwd = process.cwd()): ReadResult {
  const files: SourceFile[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();

  const add = (absolute: string, named: boolean) => {
    const shown = relative(cwd, absolute).replaceAll("\\", "/") || absolute;
    if (seen.has(absolute)) return;
    seen.add(absolute);
    if (!EXTENSIONS.has(extname(absolute).toLowerCase()) || /\.min\.(js|css)$/i.test(absolute)) {
      if (named) skipped.push(`${shown} (not a file type the check reads)`);
      return;
    }
    if (files.length >= MAX_FILES) {
      skipped.push(`${shown} (over the ${MAX_FILES}-file limit)`);
      return;
    }
    try {
      if (statSync(absolute).size > MAX_BYTES) {
        skipped.push(`${shown} (larger than ${MAX_BYTES / 1000} kB)`);
        return;
      }
      files.push({ path: shown, content: readFileSync(absolute, "utf8") });
    } catch {
      skipped.push(`${shown} (could not be read)`);
    }
  };

  for (const path of paths) {
    const absolute = resolve(cwd, path);
    let stats;
    try {
      stats = statSync(absolute);
    } catch {
      skipped.push(`${path} (not found)`);
      continue;
    }
    if (stats.isDirectory()) for (const file of walk(absolute)) add(file, false);
    else add(absolute, true);
  }
  return { files, skipped };
}
