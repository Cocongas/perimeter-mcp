import { checkJavaScript, inlineScripts } from "./javascript";
import { checkConsent, checkCss, checkHtml, checkSecrets, checkText } from "./markup";
import {
  HEALTH,
  makeFinding,
  type Context,
  type Finding,
  type ScanOptions,
  type SourceFile,
} from "./shared";

export { RULES, type Rule, type RuleId, type Severity } from "./rules";
export type { Finding, ScanOptions, SourceFile } from "./shared";

export type ScanResult = {
  findings: Finding[];
  counts: { high: number; medium: number; low: number };
  /** True when nothing blocks publishing: no `high` findings. */
  ok: boolean;
  filesScanned: number;
};

const SCRIPT = /\.(?:m?js|cjs|jsx|ts|tsx|mts|cts)$/i;
const MARKUP = /\.(?:html?|vue|svelte)$/i;
const STYLE = /\.(?:css|scss|less)$/i;
const ORDER = { high: 0, medium: 1, low: 2 } as const;

/**
 * Checks a set of files for common health-data mistakes. Pure: no network, no
 * file access, nothing leaves the process. The same input gives the same output.
 *
 * A clean result means none of these particular mistakes were found. It is
 * not a review, and it says nothing about whether the tool's content is right.
 */
export function scan(files: SourceFile[], options: ScanOptions = {}): ScanResult {
  const seen = new Set<string>();
  const findings: Finding[] = [];
  const ctx: Context = {
    allowedHosts: new Set((options.allowedHosts ?? []).map((h) => h.toLowerCase())),
    health: files.some((f) => HEALTH.test(f.content)),
    report(rule, file, line, excerpt) {
      const key = `${rule}|${file}|${line}`;
      if (seen.has(key)) return;
      seen.add(key);
      findings.push(makeFinding(rule, file, line, excerpt));
    },
  };

  for (const file of files) {
    if (MARKUP.test(file.path)) {
      checkHtml(file, ctx);
      checkCss(file, ctx);
      for (const script of inlineScripts(file.content)) {
        checkJavaScript(script.code, file.path, script.lineOffset, ctx);
      }
    } else if (SCRIPT.test(file.path)) {
      checkJavaScript(file.content, file.path, 0, ctx);
      if (/\.(?:jsx|tsx)$/i.test(file.path)) checkHtml(file, ctx);
    } else if (STYLE.test(file.path)) {
      checkCss(file, ctx);
    }
    checkText(file, ctx);
    checkSecrets(file, ctx);
  }
  checkConsent(files, ctx);

  // One finding per line is enough when a tracker is also a third-party script.
  const trackerLines = new Set(
    findings.filter((f) => f.rule === "tracker").map((f) => `${f.file}|${f.line}`),
  );
  const kept = findings.filter(
    (f) =>
      f.rule === "tracker" ||
      !trackerLines.has(`${f.file}|${f.line}`) ||
      f.rule === "hardcoded-secret",
  );
  kept.sort(
    (a, b) =>
      ORDER[a.severity] - ORDER[b.severity] || a.file.localeCompare(b.file) || a.line - b.line,
  );

  const counts = { high: 0, medium: 0, low: 0 };
  for (const finding of kept) counts[finding.severity]++;
  return { findings: kept, counts, ok: counts.high === 0, filesScanned: files.length };
}

/** A request an assistant can act on: what to fix, where, and how. */
export function fixPrompt(findings: Finding[]): string {
  const lines = findings.map((f, i) => `${i + 1}. ${f.file}, line ${f.line}: ${f.title}. ${f.fix}`);
  return [
    "The code check found the problems below. Fix each one and return the complete updated files. Keep everything else the tool does unchanged.",
    "",
    ...lines,
  ].join("\n");
}
