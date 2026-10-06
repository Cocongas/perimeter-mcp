import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { scan } from "./scanner/index";
import { coreConfig } from "./core";
import { readPaths } from "./files";
import { formatScan } from "./report";
import { createServer } from "./server";

declare const __VERSION__: string;
const VERSION = typeof __VERSION__ === "string" ? __VERSION__ : "0.0.0-dev";

const HELP = `perimeter-mcp ${VERSION}

  perimeter-mcp                     Start the MCP server (for Claude Code, Codex and other clients).
  perimeter-mcp scan [paths...]     Check files or folders. Defaults to the current folder.
        --json                      Print the result as JSON.
        --allow-host <host>         A host the code may send requests to. Repeatable.
        --fail-on <high|medium|never>   When to exit with code 1. Default: high.
  perimeter-mcp hook                For a Claude Code hook: checks the file named on stdin.

The code check runs on this machine and needs no account. The de-identification
tools appear when PERIMETER_URL and PERIMETER_API_KEY point at a perimeter core.`;

function runScan(args: string[]): number {
  const paths: string[] = [];
  const allowedHosts: string[] = [];
  let json = false;
  let failOn = "high";
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--json") json = true;
    else if (arg === "--allow-host") allowedHosts.push(args[++i] ?? "");
    else if (arg === "--fail-on") failOn = args[++i] ?? "high";
    else paths.push(arg);
  }
  const { files, skipped } = readPaths(paths.length ? paths : ["."]);
  const result = scan(files, { allowedHosts });
  console.log(json ? JSON.stringify({ ...result, skipped }, null, 2) : formatScan(result, skipped));
  if (failOn === "never") return 0;
  if (failOn === "medium") return result.counts.high + result.counts.medium > 0 ? 1 : 0;
  return result.ok ? 0 : 1;
}

/**
 * Claude Code runs this after it writes a file and passes the tool call as
 * JSON on stdin. Exit code 2 hands the findings back to the model so it can
 * fix them; anything else lets the edit stand without comment.
 */
async function runHook(): Promise<number> {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  let path: unknown;
  try {
    path = JSON.parse(input)?.tool_input?.file_path;
  } catch {
    return 0;
  }
  if (typeof path !== "string") return 0;
  const { files } = readPaths([path]);
  const result = scan(files);
  const high = result.findings.filter((f) => f.severity === "high");
  if (high.length === 0) return 0;
  console.error(formatScan({ ...result, findings: high }));
  return 2;
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "scan") process.exit(runScan(rest));
  if (command === "hook") process.exit(await runHook());
  if (command === "--help" || command === "-h" || command === "help") {
    console.log(HELP);
    return;
  }
  if (command === "--version" || command === "-v") {
    console.log(VERSION);
    return;
  }
  if (command) {
    console.error(`Unknown command "${command}".\n\n${HELP}`);
    process.exit(1);
  }
  // Stdout carries the protocol from here on; nothing else may print to it.
  await createServer(VERSION, coreConfig()).connect(new StdioServerTransport());
}

main().catch(() => {
  console.error("perimeter-mcp stopped because of an unexpected error.");
  process.exit(1);
});
