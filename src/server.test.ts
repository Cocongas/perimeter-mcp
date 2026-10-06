import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

// These run the built file, the same one `npx perimeter-mcp` would run.
const BIN = join(__dirname, "..", "dist", "index.js");

let project: string;

beforeAll(() => {
  const build = spawnSync("npx", ["tsup"], { cwd: join(__dirname, ".."), shell: true });
  expect(build.status).toBe(0);

  project = mkdtempSync(join(tmpdir(), "perimeter-mcp-"));
  writeFileSync(
    join(project, "index.html"),
    `<!doctype html><html><head><title>Patient intake</title></head><body>\n<script>\n  localStorage.setItem("patient", name);\n</script>\n</body></html>`,
  );
  writeFileSync(join(project, "clean.js"), `export const bmi = (kg, m) => kg / (m * m);\n`);
});

type Rpc = { id?: number; result?: any; error?: any }; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Speaks MCP over stdio: one JSON message per line, as a client would. */
async function session(env: Record<string, string>, calls: object[]): Promise<Rpc[]> {
  const child = spawn(process.execPath, [BIN], {
    cwd: project,
    env: { ...process.env, PERIMETER_URL: "", PERIMETER_API_KEY: "", ...env },
  });
  const replies: Rpc[] = [];
  let buffer = "";
  const expected = calls.filter((c) => "id" in c).length + 1;

  const done = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out")), 15_000);
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) replies.push(JSON.parse(line) as Rpc);
      }
      if (replies.length >= expected) {
        clearTimeout(timer);
        resolve();
      }
    });
  });

  const send = (message: object) => child.stdin.write(JSON.stringify(message) + "\n");
  send({
    jsonrpc: "2.0",
    id: 0,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    },
  });
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  for (const call of calls) send({ jsonrpc: "2.0", ...call });

  await done;
  child.kill();
  return replies.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
}

describe("the MCP server", () => {
  it("offers only the code check when no core is configured", async () => {
    const [init, list] = await session({}, [{ id: 1, method: "tools/list" }]);
    expect(init?.result.serverInfo.name).toBe("perimeter");
    expect(list?.result.tools.map((t: { name: string }) => t.name)).toEqual([
      "perimeter_scan_code",
    ]);
  });

  it("offers all four tools when a core is configured", async () => {
    const [, list] = await session(
      { PERIMETER_URL: "http://localhost:8000", PERIMETER_API_KEY: "key" },
      [{ id: 1, method: "tools/list" }],
    );
    expect(list?.result.tools.map((t: { name: string }) => t.name)).toEqual([
      "perimeter_scan_code",
      "perimeter_deidentify",
      "perimeter_reidentify",
      "perimeter_log_event",
    ]);
  });

  it("describes its tools without overclaiming", async () => {
    const [, list] = await session(
      { PERIMETER_URL: "http://localhost:8000", PERIMETER_API_KEY: "key" },
      [{ id: 1, method: "tools/list" }],
    );
    const text = JSON.stringify(list?.result.tools).toLowerCase();
    for (const phrase of [
      "hipaa compliant",
      "gdpr compliant",
      "100% compliant",
      "always use",
      "must use",
    ]) {
      expect(text).not.toContain(phrase);
    }
    expect(text).toContain("not a compliance review");
    expect(text).toContain("not guaranteed anonymous");
  });

  it("checks files on disk and reports findings with a fix", async () => {
    const [, call] = await session({}, [
      {
        id: 1,
        method: "tools/call",
        params: { name: "perimeter_scan_code", arguments: { paths: ["."] } },
      },
    ]);
    const output: string = call?.result.content[0].text;
    expect(output).toContain("Checked 2 file(s). Found 1: 1 high, 0 medium, 0 low.");
    expect(output).toContain("[high] index.html:3  Health data saved in the browser");
    expect(output).toContain("fix:  Remove the browser storage calls");
  });

  it("checks file contents passed directly", async () => {
    const files = [{ path: "a.js", content: `gtag("config", "G-1");` }];
    const [, call] = await session({}, [
      {
        id: 1,
        method: "tools/call",
        params: { name: "perimeter_scan_code", arguments: { files } },
      },
    ]);
    expect(call?.result.content[0].text).toContain("Analytics or tracking code");
  });

  it("reports an unreachable core without echoing the text", async () => {
    const [, call] = await session(
      { PERIMETER_URL: "http://127.0.0.1:9", PERIMETER_API_KEY: "key" },
      [
        {
          id: 1,
          method: "tools/call",
          params: {
            name: "perimeter_deidentify",
            arguments: { text: "Juan Pérez, DNI 12345678Z" },
          },
        },
      ],
    );
    expect(call?.result.isError).toBe(true);
    expect(call?.result.content[0].text).toContain("could not be reached");
    expect(JSON.stringify(call)).not.toContain("Juan");
  });
});

describe("the command line", () => {
  const run = (args: string[], input?: string) =>
    spawnSync(process.execPath, [BIN, ...args], { cwd: project, input, encoding: "utf8" });

  it("exits 1 when there is a high finding", () => {
    const result = run(["scan"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Health data saved in the browser");
  });

  it("exits 0 on clean code and can print JSON", () => {
    const result = run(["scan", "clean.js", "--json"]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, filesScanned: 1, findings: [] });
  });

  it("as a hook, hands high findings back with exit code 2", () => {
    const edit = JSON.stringify({
      tool_name: "Write",
      tool_input: { file_path: join(project, "index.html") },
    });
    const result = run(["hook"], edit);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Health data saved in the browser");
  });

  it("as a hook, stays silent on clean files and on input it does not understand", () => {
    const clean = JSON.stringify({ tool_input: { file_path: join(project, "clean.js") } });
    expect(run(["hook"], clean)).toMatchObject({ status: 0, stderr: "" });
    expect(run(["hook"], "not json")).toMatchObject({ status: 0, stderr: "" });
    expect(run(["hook"], JSON.stringify({ tool_input: {} }))).toMatchObject({ status: 0 });
  });
});
