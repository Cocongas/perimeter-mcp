# perimeter-mcp

An MCP server for coding assistants such as Claude Code and Codex. It does two things:

- **Checks code for common health-data mistakes.** This runs on your machine, needs no
  account, and uploads nothing.
- **De-identifies clinical text** through a perimeter core service, if you run one. Core is not publicly available yet.

It reduces exposure and keeps a record. It does not certify anything, and a clean
check is not a compliance review.

## Set it up

**Claude Code**

```sh
claude mcp add perimeter -- npx -y perimeter-mcp
```

Or, to share it with everyone working on a project, add `.mcp.json` at the project root:

```json
{
  "mcpServers": {
    "perimeter": { "command": "npx", "args": ["-y", "perimeter-mcp"] }
  }
}
```

On Windows outside WSL, use `"command": "cmd"` with `"args": ["/c", "npx", "-y", "perimeter-mcp"]`.

**Codex** (`~/.codex/config.toml`)

```toml
[mcp_servers.perimeter]
command = "npx"
args = ["-y", "perimeter-mcp"]
```

**Claude Desktop** (`claude_desktop_config.json`): the same `mcpServers` block as above.

## Tools

| Tool                   | Needs core | What it does                                                        |
| ---------------------- | ---------- | ------------------------------------------------------------------- |
| `perimeter_scan_code`  | no         | Checks files or folders and returns findings with a suggested fix   |
| `perimeter_deidentify` | yes        | Replaces identifiers in text with placeholders such as `[PERSON_1]` |
| `perimeter_reidentify` | yes        | Restores placeholders, for showing a result to the data's owner     |
| `perimeter_log_event`  | yes        | Adds an entry to the tamper-evident audit log                       |

The last three only appear when a core is configured, so an assistant is never
offered a tool that cannot work:

```json
{
  "mcpServers": {
    "perimeter": {
      "command": "npx",
      "args": ["-y", "perimeter-mcp"],
      "env": {
        "PERIMETER_URL": "http://localhost:8000",
        "PERIMETER_API_KEY": "<a secret from PERIMETER_API_KEYS in core's settings>"
      }
    }
  }
}
```

## What the code check looks for

| Finding                                         | Severity |
| ----------------------------------------------- | -------- |
| Health data saved in browser storage or cookies | blocking |
| Analytics or tracking code                      | blocking |
| A script loaded from another site               | blocking |
| A request over http:// or ws://                 | blocking |
| A request to a host that is not approved        | blocking |
| A secret key written in the code                | blocking |
| eval, new Function                              | blocking |
| postMessage to any window (`"*"`)               | blocking |
| Personal data written to the log                | warning  |
| A font, stylesheet or image from another site   | warning  |
| A personal-data form with no privacy notice     | warning  |
| innerHTML and similar with a non-fixed value    | warning  |

It reads HTML, CSS, JavaScript and TypeScript (including JSX, Vue and Svelte
files). It does not read server-side languages, and it does not judge whether a
tool's clinical content is correct.

## Without an assistant

```sh
npx -y perimeter-mcp scan                # the current folder
npx -y perimeter-mcp scan src --json     # machine-readable
npx -y perimeter-mcp scan --allow-host api.example.org
```

The command exits with code 1 when there is a blocking finding, so it can gate a
commit or a CI job.

## Optional: check automatically in Claude Code

A hook runs the check each time Claude Code writes a file, and hands any blocking
finding straight back to it. Add this to `.claude/settings.json` in the project:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [{ "type": "command", "command": "npx -y perimeter-mcp hook" }]
      }
    ]
  }
}
```

It stays silent unless it finds something blocking.

## Optional: a note for the assistant

Assistants read a notes file in each project (`CLAUDE.md` for Claude Code,
`AGENTS.md` for Codex). If a project handles health information, a short note
helps. Edit this one to fit:

```markdown
## Health data

This project handles health information. When writing or changing code here:

- Do not save patient or health data in localStorage, sessionStorage, cookies or
  IndexedDB. Keep it in memory, or send it to our own server over HTTPS.
- Do not add analytics, trackers, or scripts, fonts and images loaded from other
  sites.
- Do not write patient details, form values or identifiers to logs.
- Do not put keys or passwords in the code.
- Use invented data in examples, tests and fixtures. Never real patient records.

If the `perimeter_scan_code` tool is available, run it on the files you changed
before reporting the work as done, and fix what it flags as blocking.

If you need to put clinical text into a prompt, a fixture or an issue and
`perimeter_deidentify` is available, pass the text through it first. It misses
things, so still read the result.

These are precautions, not a compliance review. Say so if asked whether the code
is compliant with a regulation.
```
