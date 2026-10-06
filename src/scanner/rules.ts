export type Severity = "high" | "medium" | "low";

export type Rule = {
  id: string;
  severity: Severity;
  /** A few words, shown as the finding's heading. */
  title: string;
  /** What is wrong and why it matters, for someone who does not program. */
  explanation: string;
  /** What to change, specific enough for a model to apply. */
  fix: string;
};

/**
 * The rules, as data. To add one: add an entry here, then report it from
 * `javascript.ts` (code behaviour) or `markup.ts` (HTML, CSS and plain text).
 * Severity `high` blocks publishing.
 */
export const RULES = {
  "browser-storage": {
    id: "browser-storage",
    severity: "high",
    title: "Health data saved in the browser",
    explanation:
      "This saves data in the browser (localStorage, sessionStorage, a cookie or IndexedDB). It stays on the device after the page is closed, unencrypted, where the next person to use the device or any other script on the page can read it.",
    fix: "Remove the browser storage calls and keep the values in memory (plain variables) for the life of the page. If data must persist, send it to a server you control over HTTPS instead.",
  },
  "browser-storage-general": {
    id: "browser-storage-general",
    severity: "medium",
    title: "Data saved in the browser",
    explanation:
      "This saves data in the browser (localStorage, sessionStorage, a cookie or IndexedDB). That is fine for preferences, but anything personal stored this way stays on the device, unencrypted.",
    fix: "Confirm nothing personal or health-related is stored. If it is, keep it in memory instead.",
  },
  tracker: {
    id: "tracker",
    severity: "high",
    title: "Analytics or tracking code",
    explanation:
      "This loads an analytics or advertising tracker. Trackers send the page address and what the visitor does to another company, which for a health tool can reveal a person's condition.",
    fix: "Remove the tracker script and every call to it (gtag, fbq, and similar). Do not replace it with another third-party analytics service.",
  },
  "third-party-script": {
    id: "third-party-script",
    severity: "high",
    title: "Script loaded from another site",
    explanation:
      "This runs a script from a server you do not control. That script can read everything on the page, including what a patient types, and can change at any time.",
    fix: "Remove the external <script src>. Write the needed code inline, or copy a reviewed version of the library into the project and load it from there.",
  },
  "logs-personal-data": {
    id: "logs-personal-data",
    severity: "medium",
    title: "Personal data written to the log",
    explanation:
      "This writes what looks like personal or form data to the console or a log. Logs are kept, copied and read by people who should not see patient details.",
    fix: "Remove the log statement, or log only a fixed message without the value (for example 'form submitted').",
  },
  "insecure-request": {
    id: "insecure-request",
    severity: "high",
    title: "Data sent without encryption",
    explanation:
      "This sends or loads data over http:// (or ws://), which is not encrypted. Anyone on the same network can read or change it.",
    fix: "Use https:// (or wss://) for this address, or remove the request if the tool does not need it.",
  },
  "host-not-allowed": {
    id: "host-not-allowed",
    severity: "high",
    title: "Request to a server that is not approved",
    explanation:
      "This sends a request to a server that is not on the list of approved hosts. Data entered in the tool could leave to a third party.",
    fix: "Remove the request, or do the work in the page itself. If the server is one you operate, add its host to the approved list.",
  },
  "hardcoded-secret": {
    id: "hardcoded-secret",
    severity: "high",
    title: "Secret key written in the code",
    explanation:
      "This contains what looks like an API key, token or password. Anyone who can open the tool can read its code and take the key.",
    fix: "Remove the key from the code and revoke it, since it has been exposed. Keep secrets on a server, read from an environment variable, and never send them to the browser.",
  },
  "remote-asset": {
    id: "remote-asset",
    severity: "medium",
    title: "Font, stylesheet or image loaded from another site",
    explanation:
      "This loads a font, stylesheet, image or frame from another company's server. Each visit tells that company who opened the tool and when.",
    fix: "Use system fonts and inline styles, or copy the file into the project and load it from there. Embed small images as data URIs.",
  },
  "missing-consent": {
    id: "missing-consent",
    severity: "medium",
    title: "Asks for personal data without saying how it is used",
    explanation:
      "This tool asks for personal details (such as a name, email, phone or date of birth) and shows no notice about what happens to them.",
    fix: "Add a short, visible notice next to the form that says what is collected, what it is used for, and that nothing is stored or sent if that is the case. Add a consent checkbox if the data is sent anywhere.",
  },
  "dynamic-code": {
    id: "dynamic-code",
    severity: "high",
    title: "Runs text as code",
    explanation:
      "This uses eval or new Function, which runs text as code. If any of that text comes from a user or another site, they control what the tool does.",
    fix: "Replace eval or new Function with ordinary code. To read JSON use JSON.parse; to compute a formula, write the calculation directly.",
  },
  "unsafe-html": {
    id: "unsafe-html",
    severity: "medium",
    title: "Inserts unchecked content into the page",
    explanation:
      "This places content into the page as HTML (innerHTML, document.write or dangerouslySetInnerHTML) using a value that is not fixed text. If the value contains markup, it runs as part of the page.",
    fix: "Set textContent instead of innerHTML, or build elements with document.createElement. In React, render the value as text instead of using dangerouslySetInnerHTML.",
  },
  "postmessage-wildcard": {
    id: "postmessage-wildcard",
    severity: "high",
    title: "Sends messages to any window",
    explanation:
      'This calls postMessage with "*" as the target, which delivers the message to whatever page happens to be listening, including one that should not receive it.',
    fix: 'Replace "*" with the exact origin that should receive the message, for example "https://example.org".',
  },
} as const satisfies Record<string, Rule>;

export type RuleId = keyof typeof RULES;
