import { describe, expect, it } from "vitest";
import { fixPrompt, scan, type SourceFile } from "./index";

const html = (body: string, path = "index.html"): SourceFile[] => [
  {
    path,
    content: `<!doctype html>\n<html><head><title>Patient tool</title></head>\n<body>\n${body}\n</body></html>`,
  },
];
const js = (code: string, path = "script.js"): SourceFile[] => [
  { path: "index.html", content: "<h1>Patient intake</h1>" },
  { path, content: code },
];
const rules = (files: SourceFile[], allowedHosts?: string[]) =>
  scan(files, { allowedHosts }).findings.map((f) => f.rule);

const CLEAN_TOOL = html(`<h1>BMI calculator</h1>
<label for="w">Weight (kg)</label><input id="w" type="number" value="70">
<label for="h">Height (cm)</label><input id="h" type="number" value="175">
<output id="out"></output>
<p>This tool supports clinical judgement and does not replace it.</p>
<script>
  const w = document.getElementById("w"), h = document.getElementById("h");
  function update() {
    const bmi = Number(w.value) / Math.pow(Number(h.value) / 100, 2);
    document.getElementById("out").textContent = bmi.toFixed(1);
  }
  w.addEventListener("input", update); h.addEventListener("input", update); update();
</script>`);

describe("a well-behaved tool", () => {
  it("has no findings", () => {
    const result = scan(CLEAN_TOOL);
    expect(result.findings).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

describe("browser storage", () => {
  it.each([
    `localStorage.setItem("patient", JSON.stringify(data));`,
    `window.sessionStorage.setItem("weight", w.value);`,
    `localStorage.lastPatient = name;`,
    `localStorage["dose"] = value;`,
    `document.cookie = "patient=" + id;`,
    `const request = indexedDB.open("records", 1);`,
  ])("blocks %s in a health tool", (code) => {
    const result = scan(html(`<script>\n${code}\n</script>`));
    expect(result.findings.map((f) => f.rule)).toEqual(["browser-storage"]);
    expect(result.ok).toBe(false);
  });

  it("only warns when nothing suggests health data", () => {
    const files = [{ path: "theme.js", content: `localStorage.setItem("theme", "dark");` }];
    const result = scan(files);
    expect(result.findings.map((f) => f.rule)).toEqual(["browser-storage-general"]);
    expect(result.ok).toBe(true);
  });

  it("ignores reads and the word in a comment or string", () => {
    expect(
      rules(
        js(
          `// localStorage.setItem("x", 1)\nconst saved = localStorage.getItem("x");\nconst note = "we never use localStorage.setItem here";`,
        ),
      ),
    ).toEqual([]);
  });

  it("points at the line inside the html file", () => {
    const [finding] = scan(
      html(`<p>one</p>\n<script>\n  const a = 1;\n  localStorage.setItem("a", a);\n</script>`),
    ).findings;
    expect(finding?.line).toBe(7);
    expect(finding?.excerpt).toBe(`localStorage.setItem("a", a);`);
  });
});

describe("trackers and third-party scripts", () => {
  it("flags analytics", () => {
    expect(
      rules(html(`<script async src="https://www.googletagmanager.com/gtag/js?id=G-1"></script>`)),
    ).toEqual(["tracker"]);
    expect(rules(js(`gtag("config", "G-123");`))).toEqual(["tracker"]);
    expect(rules(js(`fbq('track', 'PageView');`))).toEqual(["tracker"]);
  });

  it("flags any script from another site", () => {
    expect(rules(html(`<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>`))).toEqual([
      "third-party-script",
    ]);
    expect(rules(html(`<script src="//unpkg.com/vue"></script>`))).toEqual(["third-party-script"]);
  });

  it("allows the tool's own script file", () => {
    expect(rules(html(`<script src="script.js"></script>`))).toEqual([]);
  });
});

describe("logging", () => {
  it("flags personal values in the log", () => {
    expect(rules(js(`console.log("submitted", patient);`))).toEqual(["logs-personal-data"]);
    expect(rules(js(`console.error(form.email.value);`))).toEqual(["logs-personal-data"]);
  });

  it("allows fixed messages and unrelated values", () => {
    expect(rules(js(`console.log("patient form submitted");\nconsole.log(total, index);`))).toEqual(
      [],
    );
  });
});

describe("network", () => {
  it("flags unencrypted requests", () => {
    expect(rules(js(`fetch("http://api.example.org/save", { method: "POST" });`))).toEqual([
      "insecure-request",
    ]);
    expect(rules(js(`new WebSocket("ws://example.org/live");`))).toEqual(["insecure-request"]);
    expect(rules(html(`<form action="http://example.org/submit"></form>`))).toEqual([
      "insecure-request",
    ]);
  });

  it("flags hosts that are not approved, and accepts approved ones", () => {
    const code = `fetch(\`https://api.example.org/patients/\${id}\`);`;
    expect(rules(js(code))).toEqual(["host-not-allowed"]);
    expect(rules(js(code), ["api.example.org"])).toEqual([]);
  });

  it("reads XMLHttpRequest and axios", () => {
    expect(
      rules(js(`const x = new XMLHttpRequest(); x.open("POST", "https://collect.example.net/x");`)),
    ).toEqual(["host-not-allowed"]);
    expect(rules(js(`axios.post("https://collect.example.net/x", data);`))).toEqual([
      "host-not-allowed",
    ]);
  });

  it("allows relative and local addresses", () => {
    expect(
      rules(js(`fetch("/api/save"); fetch("./data.json"); fetch("http://localhost:8000/x");`)),
    ).toEqual([]);
  });
});

describe("secrets", () => {
  // Invented values, assembled from pieces so that no key-shaped string sits in
  // this repository for a secret scanner to trip over.
  const fake = {
    anthropic: ["sk", "ant", "api03", "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789"].join("-"),
    aws: "AK" + "IA" + "IOSFODNN7ABCDEFG",
    generic: "9f8e7d6c5b4a" + "39281706f5e4d3c2b1a0",
    pem: "-----BEGIN " + "PRIVATE KEY-----",
  };

  it.each([
    `const key = "${fake.anthropic}";`,
    `const aws = "${fake.aws}";`,
    `const config = { apiKey: "${fake.generic}" };`,
    fake.pem,
  ])("flags a key-shaped value without quoting it back (%#)", (line) => {
    const result = scan([{ path: "config.js", content: line }]);
    expect(result.findings.map((f) => f.rule)).toEqual(["hardcoded-secret"]);
    expect(result.findings[0]?.excerpt).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain(line.slice(15, 40));
  });

  it("ignores placeholders and environment variables", () => {
    expect(
      rules([
        {
          path: "config.js",
          content: `const apiKey = "YOUR_API_KEY_GOES_HERE_1234";\nconst secret = process.env.SECRET_VALUE_FROM_ENV;`,
        },
      ]),
    ).toEqual([]);
  });
});

describe("remote assets", () => {
  it("flags fonts, stylesheets, images and css urls from other sites", () => {
    expect(
      rules(html(`<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">`)),
    ).toEqual(["remote-asset"]);
    expect(rules(html(`<img src="https://images.example.com/logo.png" alt="">`))).toEqual([
      "remote-asset",
    ]);
    expect(
      rules([
        {
          path: "style.css",
          content: `@import "https://fonts.example.com/a.css";\nbody { background: url(https://cdn.example.com/bg.png); }`,
        },
      ]),
    ).toEqual(["remote-asset", "remote-asset"]);
  });

  it("allows local files and data URIs", () => {
    expect(
      rules(
        html(
          `<link rel="stylesheet" href="style.css"><img src="data:image/png;base64,AAAA" alt="">`,
        ),
      ),
    ).toEqual([]);
  });
});

describe("consent notice", () => {
  const form = `<form><label for="n">Full name</label><input id="n" name="name"><input type="email" name="email"></form>`;

  it("flags a personal-data form with no notice", () => {
    expect(rules(html(form))).toEqual(["missing-consent"]);
  });

  it("accepts a form that says what happens to the data", () => {
    expect(
      rules(
        html(`${form}<p>Nothing is stored or sent. Your details stay in this browser tab.</p>`),
      ),
    ).toEqual([]);
  });

  it("does not apply to tools that ask for nothing personal", () => {
    expect(rules(CLEAN_TOOL)).not.toContain("missing-consent");
  });
});

describe("unsafe code", () => {
  it("flags eval and new Function", () => {
    expect(rules(js(`const result = eval(formula);`))).toEqual(["dynamic-code"]);
    expect(rules(js(`const f = new Function("x", body);`))).toEqual(["dynamic-code"]);
    expect(rules(js(`setTimeout("update()", 100);`))).toEqual(["dynamic-code"]);
  });

  it("flags html built from values, not fixed text", () => {
    expect(rules(js(`out.innerHTML = "<b>" + name + "</b>";`))).toEqual(["unsafe-html"]);
    expect(rules(js(`out.innerHTML = "<b>Result</b>"; out.textContent = name;`))).toEqual([]);
  });

  it("flags dangerouslySetInnerHTML with a value", () => {
    const files = [
      {
        path: "Note.tsx",
        content: `export const Note = ({ html }: { html: string }) => <div dangerouslySetInnerHTML={{ __html: html }} />;`,
      },
    ];
    expect(rules(files)).toEqual(["unsafe-html"]);
  });

  it("flags postMessage to any window", () => {
    expect(rules(js(`parent.postMessage({ patient }, "*");`))).toEqual(["postmessage-wildcard"]);
    expect(rules(js(`parent.postMessage(data, "https://app.example.org");`))).toEqual([]);
  });
});

describe("code the parser cannot read", () => {
  it("still finds problems in TypeScript and JSX", () => {
    const files = [
      {
        path: "Form.tsx",
        content: `export function Form({ patient }: { patient: Patient }) {\n  localStorage.setItem("patient", JSON.stringify(patient));\n  return <p>{patient.name}</p>;\n}`,
      },
    ];
    const result = scan(files);
    expect(result.findings.map((f) => [f.rule, f.line])).toEqual([["browser-storage", 2]]);
  });
});

describe("results", () => {
  it("orders by severity and counts", () => {
    const result = scan(
      html(
        `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">\n<script>\n localStorage.setItem("p", patient);\n console.log(patient);\n</script>`,
      ),
    );
    expect(result.findings.map((f) => f.severity)).toEqual(["high", "medium", "medium"]);
    expect(result.counts).toEqual({ high: 1, medium: 2, low: 0 });
    expect(result.ok).toBe(false);
  });

  it("writes a fix request an assistant can act on", () => {
    const { findings } = scan(html(`<script>\nlocalStorage.setItem("p", patient);\n</script>`));
    const prompt = fixPrompt(findings);
    expect(prompt).toContain("index.html, line 5: Health data saved in the browser.");
    expect(prompt).toContain("keep the values in memory");
  });
});
