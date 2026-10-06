import { randomBytes } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { scan, type SourceFile } from "./scanner/index";
import { z } from "zod";
import { callCore, CoreError, type CoreConfig } from "./core";
import { readPaths } from "./files";
import { formatScan } from "./report";

const text = (value: string, isError = false) => ({
  content: [{ type: "text" as const, text: value }],
  ...(isError ? { isError: true } : {}),
});

const SESSION = z
  .string()
  .regex(/^[A-Za-z0-9_-]{8,64}$/)
  .describe("Groups placeholders that belong together. 8 to 64 letters, digits, - or _.");

type Deidentified = {
  text: string;
  entities: { type: string }[];
  risk: "low" | "medium" | "high";
  special_categories: string[];
};

/**
 * Builds the server. The code check always works, with no setup and no
 * network. The other three tools need a perimeter core service and are only
 * offered when one is configured, so an agent never sees a tool it cannot use.
 */
export function createServer(version: string, core: CoreConfig | null): McpServer {
  const server = new McpServer({ name: "perimeter", version });

  server.registerTool(
    "perimeter_scan_code",
    {
      title: "Check code for health-data mistakes",
      description:
        "Checks web code for common mistakes with patient or health data: data saved in browser storage, analytics trackers, scripts or fonts loaded from other sites, personal data written to logs, unencrypted or unapproved network requests, secret keys in the code, forms with no privacy notice, and eval-style code. " +
        "Runs on this machine; nothing is uploaded. Useful after writing or changing code that handles health information. " +
        "Returns each finding with its file, line, a plain explanation and a suggested fix. It looks for a fixed list of mistakes: a clean result is not a compliance review.",
      inputSchema: {
        paths: z
          .array(z.string())
          .optional()
          .describe("Files or folders to check, relative to the working directory."),
        files: z
          .array(z.object({ path: z.string(), content: z.string() }))
          .optional()
          .describe("File contents to check directly, instead of or as well as paths."),
        allowed_hosts: z
          .array(z.string())
          .optional()
          .describe("Hosts the code may send requests to, for example api.example.org."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ paths, files, allowed_hosts }) => {
      const fromDisk = paths?.length ? readPaths(paths) : { files: [], skipped: [] };
      const all: SourceFile[] = [...fromDisk.files, ...(files ?? [])];
      if (all.length === 0 && fromDisk.skipped.length === 0) {
        return text(
          "Give `paths` (files or folders) or `files` (path and content) to check.",
          true,
        );
      }
      return text(formatScan(scan(all, { allowedHosts: allowed_hosts }), fromDisk.skipped));
    },
  );

  if (!core) return server;

  const guarded = async (run: () => Promise<string>) => {
    try {
      return text(await run());
    } catch (error) {
      return text(error instanceof CoreError ? error.message : "perimeter core call failed.", true);
    }
  };

  server.registerTool(
    "perimeter_deidentify",
    {
      title: "Replace personal identifiers with placeholders",
      description:
        "Replaces personal identifiers in text (names, ID numbers, dates, contact details, addresses) with placeholders such as [PERSON_1], using your perimeter core service. Useful before putting clinical text into a prompt, a test fixture, an issue or a log. " +
        "Detection misses things, especially in untidy text: the result has fewer identifiers, and is not guaranteed anonymous. " +
        "Returns the text, the kinds of identifier replaced, a risk level, and the session_id needed to restore it.",
      inputSchema: {
        text: z.string().min(1).describe("The text to de-identify."),
        session_id: SESSION.optional(),
      },
      annotations: { openWorldHint: false },
    },
    ({ text: input, session_id }) =>
      guarded(async () => {
        const session = session_id ?? `mcp-${randomBytes(9).toString("hex")}`;
        const result = await callCore<Deidentified>(core, "/v1/deidentify", {
          text: input,
          session_id: session,
          locale: "auto",
        });
        const counts: Record<string, number> = {};
        for (const entity of result.entities) counts[entity.type] = (counts[entity.type] ?? 0) + 1;
        const replaced = Object.entries(counts).map(([type, n]) => `${type} x${n}`);
        return [
          result.text,
          "",
          "---",
          `session_id: ${session}`,
          `replaced: ${replaced.length ? replaced.join(", ") : "nothing"}`,
          `risk: ${result.risk}${result.risk === "high" ? " (something identifier-like remains; do not send this text on)" : ""}`,
          ...(result.special_categories.length
            ? [`sensitive topics present: ${result.special_categories.join(", ")}`]
            : []),
        ].join("\n");
      }),
  );

  server.registerTool(
    "perimeter_reidentify",
    {
      title: "Restore placeholders to the original values",
      description:
        "Puts the original values back in place of placeholders such as [PERSON_1], for the same session_id that perimeter_deidentify returned. For showing a result to the person who supplied the data. The restored text contains personal data again: do not send it to another service. Each use is recorded in the audit log.",
      inputSchema: {
        text: z.string().min(1).describe("Text containing placeholders."),
        session_id: SESSION,
      },
      annotations: { openWorldHint: false },
    },
    ({ text: input, session_id }) =>
      guarded(async () => {
        const result = await callCore<{ text: string }>(core, "/v1/reidentify", {
          text: input,
          session_id,
        });
        return result.text;
      }),
  );

  server.registerTool(
    "perimeter_log_event",
    {
      title: "Record an action in the audit log",
      description:
        "Adds an entry to perimeter's tamper-evident audit log, for example that a tool was published or data was exported. Use short codes, never free text or personal data: action such as 'tool.publish', resource such as 'tool:bmi-calculator'.",
      inputSchema: {
        action: z
          .string()
          .regex(/^[A-Za-z0-9_.:-]{1,64}$/)
          .describe("What happened, as a short code."),
        resource: z
          .string()
          .regex(/^[A-Za-z0-9_.:\/-]{1,128}$/)
          .describe("What it happened to."),
        purpose: z.enum(["education", "clinical_support", "administrative"]),
      },
      annotations: { openWorldHint: false },
    },
    ({ action, resource, purpose }) =>
      guarded(async () => {
        const row = await callCore<{ seq: number }>(core, "/v1/audit/events", {
          action,
          resource,
          purpose,
        });
        return `Recorded as entry ${row.seq}.`;
      }),
  );

  return server;
}
