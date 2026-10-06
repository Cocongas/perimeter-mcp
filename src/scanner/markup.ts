import {
  isRemote,
  judgeUrl,
  lineAt,
  lineText,
  TRACKER,
  type Context,
  type SourceFile,
} from "./shared";

const attr = (tag: string, name: string): string | null =>
  new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i")
    .exec(tag)
    ?.slice(1)
    .find((v) => v !== undefined) ?? null;

/** Tags and attributes: scripts, stylesheets, images, frames and forms. */
export function checkHtml(file: SourceFile, ctx: Context): void {
  const { path, content } = file;
  for (const match of content.matchAll(
    /<(script|link|img|iframe|video|audio|source|embed|object|form)\b[^>]*>/gi,
  )) {
    const tag = match[0];
    const name = (match[1] ?? "").toLowerCase();
    const line = lineAt(content, match.index ?? 0);
    const say = (rule: Parameters<Context["report"]>[0]) =>
      ctx.report(rule, path, line, lineText(content, line));

    if (name === "script") {
      const src = attr(tag, "src");
      if (src && isRemote(src)) say(TRACKER.test(src) ? "tracker" : "third-party-script");
    } else if (name === "form") {
      const verdict = judgeUrl(attr(tag, "action") ?? "", ctx);
      if (verdict) say(verdict);
    } else {
      const url = attr(tag, name === "link" ? "href" : name === "object" ? "data" : "src");
      if (!url || !isRemote(url)) continue;
      if (
        name === "link" &&
        !/rel\s*=\s*["']?[^"'>]*(stylesheet|preload|icon|font|preconnect|dns-prefetch)/i.test(tag)
      ) {
        continue; // a plain hyperlink reference, not a load
      }
      say(TRACKER.test(url) ? "tracker" : "remote-asset");
    }
  }
}

/** url(...) and @import in stylesheets and <style> blocks. */
export function checkCss(file: SourceFile, ctx: Context): void {
  const { path, content } = file;
  const pattern =
    /url\(\s*["']?((?:https?:)?\/\/[^"')\s]+)|@import\s+["']((?:https?:)?\/\/[^"']+)/gi;
  for (const match of content.matchAll(pattern)) {
    const line = lineAt(content, match.index ?? 0);
    ctx.report("remote-asset", path, line, lineText(content, line));
  }
}

/** Tracker snippets and React's dangerouslySetInnerHTML, wherever they appear. */
export function checkText(file: SourceFile, ctx: Context): void {
  const { path, content } = file;
  content.split("\n").forEach((line, index) => {
    if (TRACKER.test(line)) ctx.report("tracker", path, index + 1, line);
    if (
      /dangerouslySetInnerHTML\s*=\s*\{\s*\{\s*__html\s*:\s*(?!["'`][^"'`$]*["'`]\s*\})/.test(line)
    ) {
      ctx.report("unsafe-html", path, index + 1, line);
    }
  });
}

const SECRETS: RegExp[] = [
  /\bsk-ant-[A-Za-z0-9_-]{20,}/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{40,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\b(?:sk|rk)_live_[0-9a-zA-Z]{24,}/,
  /\beyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
  /\b(?:api[_-]?key|apikey|secret|client[_-]?secret|access[_-]?token|auth[_-]?token|password|passwd)\b["']?\s*[:=]\s*["'`][A-Za-z0-9+/_\-.=]{16,}["'`]/i,
];
const PLACEHOLDER =
  /your[_-]?|example|changeme|placeholder|xxxx|<[^>]+>|\*{4,}|process\.env|import\.meta\.env/i;

export function checkSecrets(file: SourceFile, ctx: Context): void {
  file.content.split("\n").forEach((line, index) => {
    if (PLACEHOLDER.test(line)) return;
    if (SECRETS.some((pattern) => pattern.test(line))) {
      ctx.report("hardcoded-secret", file.path, index + 1);
    }
  });
}

const PERSONAL_INPUT =
  /<(?:input|textarea|select)\b[^>]*(?:type\s*=\s*["']?(?:email|tel|password)|(?:name|id|placeholder|autocomplete|aria-label)\s*=\s*["'][^"']*(?:name|nombre|apellido|e-?mail|correo|phone|tel[eé]fono|birth|nacimiento|\bdob\b|address|direcci[oó]n|\bdni\b|\bssn\b|passport|pasaporte|patient|paciente))/i;
const LABEL_PERSONAL =
  /<label\b[^>]*>[^<]*(?:full name|first name|last name|nombre|apellido|e-?mail|correo|phone|tel[eé]fono|date of birth|fecha de nacimiento|address|direcci[oó]n|\bDNI\b|passport|pasaporte)/i;
const NOTICE =
  /consent|consentimiento|privacy|privacidad|data protection|protecci[oó]n de datos|not (?:stored|saved|sent)|nothing (?:is )?(?:stored|saved|sent)|no se (?:guarda|almacena|env[ií]a)|stays (?:on|in) (?:this|your) (?:device|browser)|how (?:we|your data)|aviso legal|disclaimer/i;

/** A form that asks for personal details should say what happens to them. */
export function checkConsent(files: SourceFile[], ctx: Context): void {
  const pages = files.filter((f) => /\.(html?|jsx|tsx|vue|svelte)$/i.test(f.path));
  const asking = pages.find(
    (f) => PERSONAL_INPUT.test(f.content) || LABEL_PERSONAL.test(f.content),
  );
  if (!asking) return;
  if (pages.some((f) => NOTICE.test(f.content))) return;
  const index = Math.max(
    asking.content.search(PERSONAL_INPUT),
    asking.content.search(LABEL_PERSONAL),
    0,
  );
  const line = lineAt(asking.content, index);
  ctx.report("missing-consent", asking.path, line, lineText(asking.content, line));
}
