import { parse, type Node } from "acorn";
import { full } from "acorn-walk";
import { judgeUrl, lineAt, lineText, PERSONAL, type Context } from "./shared";

// acorn's node types are a closed union; a loose view keeps the checks short.
type AnyNode = Node & Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const STORAGE = /(?:^|\.)(?:localStorage|sessionStorage)$/;
const LOG_METHODS = new Set(["log", "info", "debug", "warn", "error", "trace", "table", "dir"]);
const REQUEST_CALLS =
  /^(?:fetch|(?:window\.)?fetch|axios|axios\.(?:get|post|put|patch|delete|request)|navigator\.sendBeacon|\$\.(?:ajax|get|post|getJSON)|ky|ky\.(?:get|post|put))$/;

/** "window.localStorage.setItem" for a member expression, or "" if it is not a plain chain. */
function chain(node: AnyNode | null | undefined): string {
  if (!node) return "";
  if (node.type === "Identifier") return node.name;
  if (node.type === "ThisExpression") return "this";
  if (node.type === "MemberExpression") {
    const object = chain(node.object);
    const property = node.computed
      ? node.property.type === "Literal"
        ? String(node.property.value)
        : "[]"
      : node.property.name;
    return object ? `${object}.${property}` : "";
  }
  return "";
}

/** The fixed start of a string argument, or null when it is not a string we can read. */
function stringStart(node: AnyNode | undefined): string | null {
  if (!node) return null;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral") return node.quasis[0]?.value?.cooked ?? null;
  if (node.type === "BinaryExpression" && node.operator === "+") return stringStart(node.left);
  return null;
}

function isFixedText(node: AnyNode): boolean {
  return (
    (node.type === "Literal" && typeof node.value === "string") ||
    (node.type === "TemplateLiteral" && node.expressions.length === 0)
  );
}

function checkAst(code: string, file: string, lineOffset: number, ctx: Context, ast: Node): void {
  const at = (node: AnyNode) => lineOffset + node.loc!.start.line;
  const say = (rule: Parameters<Context["report"]>[0], node: AnyNode) =>
    ctx.report(rule, file, at(node), lineText(code, node.loc!.start.line));
  const storageRule = ctx.health ? "browser-storage" : "browser-storage-general";
  const checkUrl = (arg: AnyNode | undefined, node: AnyNode) => {
    const url = stringStart(arg);
    const verdict = url === null ? null : judgeUrl(url, ctx);
    if (verdict) say(verdict, node);
  };

  full(ast, (raw) => {
    const node = raw as AnyNode;

    if (node.type === "CallExpression") {
      const callee = chain(node.callee);
      const args: AnyNode[] = node.arguments;

      if (/(?:^|\.)(?:localStorage|sessionStorage)\.setItem$/.test(callee)) say(storageRule, node);
      else if (/(?:^|\.)indexedDB\.open$/.test(callee)) say(storageRule, node);
      else if (callee === "eval" || callee === "window.eval") say("dynamic-code", node);
      else if (callee === "document.write" || callee === "document.writeln") {
        if (args.some((arg) => !isFixedText(arg))) say("unsafe-html", node);
      } else if (callee.endsWith(".postMessage") || callee === "postMessage") {
        if (args[1]?.type === "Literal" && args[1].value === "*") say("postmessage-wildcard", node);
      } else if (callee.startsWith("console.") && LOG_METHODS.has(callee.slice(8))) {
        const logged = args
          .filter((arg) => !isFixedText(arg))
          .map((arg) => code.slice(arg.start, arg.end))
          .join(" ");
        if (logged && PERSONAL.test(logged)) say("logs-personal-data", node);
      } else if (REQUEST_CALLS.test(callee)) checkUrl(args[0], node);
      else if (callee.endsWith(".open") && args.length >= 2) {
        // XMLHttpRequest.open(method, url)
        const method = stringStart(args[0]);
        if (method && /^(get|post|put|patch|delete|head)$/i.test(method)) checkUrl(args[1], node);
      } else if (
        (callee === "setTimeout" || callee === "setInterval") &&
        args[0]?.type === "Literal" &&
        typeof args[0].value === "string"
      ) {
        say("dynamic-code", node);
      }
    }

    if (node.type === "NewExpression") {
      const callee = chain(node.callee);
      if (callee === "Function") say("dynamic-code", node);
      if (callee === "WebSocket" || callee === "EventSource") checkUrl(node.arguments[0], node);
    }

    if (node.type === "AssignmentExpression" && node.left.type === "MemberExpression") {
      const target = chain(node.left);
      if (STORAGE.test(chain(node.left.object))) say(storageRule, node);
      else if (target === "document.cookie" || target === "window.document.cookie") {
        say(storageRule, node);
      } else if (/\.(?:innerHTML|outerHTML)$/.test(target) && !isFixedText(node.right)) {
        say("unsafe-html", node);
      }
    }
  });
}

/** Coarser checks for code acorn cannot parse (JSX, TypeScript, a syntax error). */
const FALLBACK: [RegExp, "storage" | Parameters<Context["report"]>[0]][] = [
  [/\b(?:localStorage|sessionStorage)\s*\.\s*setItem\s*\(/, "storage"],
  [/\b(?:localStorage|sessionStorage)\s*(?:\.\w+|\[[^\]]+\])\s*=(?!=)/, "storage"],
  [/\bdocument\s*\.\s*cookie\s*=(?!=)/, "storage"],
  [/\bindexedDB\s*\.\s*open\s*\(/, "storage"],
  [/(?<![.\w])eval\s*\(/, "dynamic-code"],
  [/\bnew\s+Function\s*\(/, "dynamic-code"],
  [/\.postMessage\s*\([^)]*,\s*["'`]\*["'`]\s*\)/, "postmessage-wildcard"],
  [/\.(?:innerHTML|outerHTML)\s*=(?!=)\s*(?!["'`][^"'`$]*["'`]\s*;?\s*$)/, "unsafe-html"],
];
const FALLBACK_LOG = /\bconsole\s*\.\s*(?:log|info|debug|warn|error|trace)\s*\((.*)/;
const FALLBACK_REQUEST =
  /\b(?:fetch|axios(?:\.\w+)?|sendBeacon|new\s+WebSocket|new\s+EventSource)\s*\(\s*["'`]([^"'`]+)/;

function checkLines(code: string, file: string, lineOffset: number, ctx: Context): void {
  const storageRule = ctx.health ? "browser-storage" : "browser-storage-general";
  code.split("\n").forEach((line, index) => {
    const text = line.replace(/^\s*(?:\/\/|\*).*$/, "");
    if (!text.trim()) return;
    const at = lineOffset + index + 1;
    for (const [pattern, rule] of FALLBACK) {
      if (pattern.test(text)) ctx.report(rule === "storage" ? storageRule : rule, file, at, line);
    }
    const logged = FALLBACK_LOG.exec(text)?.[1]?.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, "");
    if (logged && PERSONAL.test(logged)) ctx.report("logs-personal-data", file, at, line);
    const url = FALLBACK_REQUEST.exec(text)?.[1];
    const verdict = url ? judgeUrl(url, ctx) : null;
    if (verdict) ctx.report(verdict, file, at, line);
  });
}

/**
 * Checks one piece of JavaScript. `lineOffset` is the number of lines before
 * it in its file, so findings in an inline <script> point at the right line.
 */
export function checkJavaScript(
  code: string,
  file: string,
  lineOffset: number,
  ctx: Context,
): void {
  for (const sourceType of ["module", "script"] as const) {
    try {
      const ast = parse(code, { ecmaVersion: "latest", sourceType, locations: true });
      checkAst(code, file, lineOffset, ctx, ast);
      return;
    } catch {
      // try the next way of reading it
    }
  }
  checkLines(code, file, lineOffset, ctx);
}

export function inlineScripts(html: string): { code: string; lineOffset: number }[] {
  const scripts = [];
  const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  for (const match of html.matchAll(pattern)) {
    const [whole, attributes = "", code = ""] = match;
    if (/\bsrc\s*=/i.test(attributes) || !code.trim()) continue;
    if (
      /\btype\s*=\s*["']?(?!module|text\/javascript|application\/javascript)[^"'\s>]+/i.test(
        attributes,
      )
    ) {
      continue; // JSON, templates, importmaps
    }
    const start = (match.index ?? 0) + whole.indexOf(">") + 1;
    scripts.push({ code, lineOffset: lineAt(html, start) - 1 });
  }
  return scripts;
}
