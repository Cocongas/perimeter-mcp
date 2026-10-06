import type { ScanResult } from "./scanner/index";

/** The scan result as plain text, for an agent or a terminal. */
export function formatScan(result: ScanResult, skipped: string[] = []): string {
  const lines: string[] = [];
  const { high, medium, low } = result.counts;
  const total = result.findings.length;

  if (result.filesScanned === 0) {
    lines.push("No files were checked.");
  } else if (total === 0) {
    lines.push(
      `Checked ${result.filesScanned} file(s). None of the mistakes this check looks for were found.`,
    );
  } else {
    lines.push(
      `Checked ${result.filesScanned} file(s). Found ${total}: ${high} high, ${medium} medium, ${low} low.`,
    );
  }

  for (const finding of result.findings) {
    lines.push(
      "",
      `[${finding.severity}] ${finding.file}:${finding.line}  ${finding.title}`,
      ...(finding.excerpt ? [`  code: ${finding.excerpt}`] : []),
      `  why:  ${finding.explanation}`,
      `  fix:  ${finding.fix}`,
    );
  }

  if (skipped.length > 0) {
    lines.push("", "Not checked:", ...skipped.map((s) => `  ${s}`));
  }
  lines.push(
    "",
    "This check looks for a fixed list of common mistakes. A clean result is not a compliance or security review.",
  );
  return lines.join("\n");
}
