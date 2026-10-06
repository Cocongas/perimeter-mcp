import { RULES, type RuleId, type Severity } from "./rules";

export type SourceFile = { path: string; content: string };

export type Finding = {
  rule: RuleId;
  severity: Severity;
  file: string;
  line: number;
  title: string;
  explanation: string;
  fix: string;
  /** The offending line, trimmed. Omitted for secrets. */
  excerpt?: string;
};

export type ScanOptions = {
  /** Hosts requests may go to, e.g. ["api.example.org"]. Relative URLs are always fine. */
  allowedHosts?: string[];
};

export type Context = {
  allowedHosts: Set<string>;
  /** True when the project as a whole is about health or patients. */
  health: boolean;
  report: (rule: RuleId, file: string, line: number, excerpt?: string) => void;
};

export function makeFinding(rule: RuleId, file: string, line: number, excerpt?: string): Finding {
  const { severity, title, explanation, fix } = RULES[rule];
  const finding: Finding = { rule, severity, file, line, title, explanation, fix };
  if (excerpt && rule !== "hardcoded-secret") finding.excerpt = excerpt.trim().slice(0, 160);
  return finding;
}

export function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

export function lineText(text: string, line: number): string {
  return text.split("\n")[line - 1] ?? "";
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "0.0.0.0"]);

/**
 * Judges a URL found in a request or a tag. Returns the rule it breaks, or
 * null when it is fine (relative, data:, same page, local, or an approved host).
 */
export function judgeUrl(
  url: string,
  ctx: Context,
): "insecure-request" | "host-not-allowed" | null {
  const value = url.trim();
  const match = /^(https?:|wss?:)?\/\/([^/?#\s:]+|\[[^\]]+\])/i.exec(value);
  if (!match) return null;
  const scheme = (match[1] ?? "").toLowerCase();
  const host = (match[2] ?? "").toLowerCase();
  if (LOCAL_HOSTS.has(host)) return null;
  if (scheme === "http:" || scheme === "ws:") return "insecure-request";
  return ctx.allowedHosts.has(host) ? null : "host-not-allowed";
}

export function isRemote(url: string): boolean {
  return /^(https?:)?\/\//i.test(url.trim());
}

export const TRACKER =
  /googletagmanager\.com|google-analytics\.com|analytics\.google\.com|doubleclick\.net|connect\.facebook\.net|facebook\.com\/tr\b|static\.hotjar\.com|hotjar\.com|clarity\.ms|cdn\.segment\.com|api\.segment\.io|mixpanel\.com|cdn\.mxpnl\.com|amplitude\.com|fullstory\.com|widget\.intercom\.io|plausible\.io|matomo|cdn\.heapanalytics\.com|snap\.licdn\.com|analytics\.tiktok\.com|\bgtag\s*\(|\bfbq\s*\(|\bga\s*\(\s*["']create|\bhj\s*\(|\bmixpanel\.(?:init|track)\s*\(|\bamplitude\.(?:init|track|getInstance)\s*\(|\banalytics\.(?:track|identify|page)\s*\(/i;

/** Names that suggest a variable holds something personal. */
export const PERSONAL =
  /patient|paciente|\bname\b|nombre|apellido|surname|\bdob\b|birth|nacimiento|e-?mail|correo|phone|tel[eé]fono|\bdni\b|\bnie\b|\bssn\b|\bmrn\b|\bnhc\b|address|direcci[oó]n|domicilio|passport|password|contraseña|diagnos|medication|medicaci[oó]n|symptom|s[ií]ntoma|formdata|form\.|\.value\b|\bvalues\b|\binput\b|\buser\b|\bperson/i;

export const HEALTH =
  /patient|paciente|clinic|cl[ií]nic|diagnos|medic|symptom|s[ií]ntoma|treatment|tratamiento|\bdose\b|dosis|\bbmi\b|\bimc\b|blood|sangre|health|salud|hospital|doctor|physician|nurse|enfermer|therapy|terapia|prescription|receta|allerg|alergi|vaccin|vacun|\begfr\b|creatinin|glucos|pressure|tensi[oó]n arterial/i;
