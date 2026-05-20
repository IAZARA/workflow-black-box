export type Severity = "critical" | "high" | "medium" | "low" | "info";

export type FlowNode = {
  id: string;
  name: string;
  type: string;
  x: number;
  y: number;
  risk: Severity;
  flags: string[];
};

export type FlowEdge = {
  source: string;
  target: string;
};

export type Finding = {
  id: string;
  severity: Severity;
  title: string;
  nodeName?: string;
  confidence: number;
  summary: string;
  evidence: string[];
  recommendations: string[];
  category: "runtime" | "data" | "auth" | "resilience" | "silent-failure" | "design";
};

export type AnalysisResult = {
  inputType: "n8n-workflow" | "logs-only" | "mixed" | "empty";
  nodes: FlowNode[];
  edges: FlowEdge[];
  findings: Finding[];
  healthScore: number;
  silentFailureRisk: number;
  rootCause: Finding | null;
  metrics: {
    nodeCount: number;
    edgeCount: number;
    criticalCount: number;
    highCount: number;
    protectedSteps: number;
  };
  clientReport: string;
};

type N8nWorkflow = {
  name?: string;
  nodes?: Array<{
    id?: string;
    name?: string;
    type?: string;
    position?: [number, number];
    parameters?: Record<string, unknown>;
    credentials?: Record<string, unknown>;
    continueOnFail?: boolean;
    retryOnFail?: boolean;
  }>;
  connections?: Record<string, Record<string, Array<Array<{ node?: string }>>>>;
};

type Candidate = {
  finding: Finding;
  penalty: number;
};

const severityWeight: Record<Severity, number> = {
  critical: 34,
  high: 22,
  medium: 11,
  low: 5,
  info: 0,
};

const riskyNodeTokens = [
  "http",
  "webhook",
  "openai",
  "langchain",
  "ai",
  "hubspot",
  "salesforce",
  "slack",
  "gmail",
  "stripe",
  "quickbooks",
  "code",
];

export function analyzeAutomation(workflowText: string, logText: string): AnalysisResult {
  const parsed = parseWorkflow(workflowText);
  const nodes = parsed ? normalizeNodes(parsed) : [];
  const edges = parsed ? normalizeEdges(parsed) : [];
  const candidates: Candidate[] = [];

  if (parsed) {
    candidates.push(...analyzeWorkflow(parsed, nodes, edges));
  }

  candidates.push(...analyzeLogs(logText, nodes));

  if (!workflowText.trim() && !logText.trim()) {
    return emptyResult();
  }

  const findings = dedupeFindings(candidates.map((item) => item.finding)).sort(
    (a, b) => severityRank(b.severity) - severityRank(a.severity) || b.confidence - a.confidence,
  );

  const nodeRiskMap = buildNodeRiskMap(findings);
  const scoredNodes = nodes.map((node) => ({
    ...node,
    risk: nodeRiskMap.get(node.name) ?? node.risk,
    flags: findings
      .filter((finding) => finding.nodeName === node.name)
      .slice(0, 3)
      .map((finding) => finding.title),
  }));

  const criticalCount = findings.filter((finding) => finding.severity === "critical").length;
  const highCount = findings.filter((finding) => finding.severity === "high").length;
  const totalPenalty = findings.reduce((sum, finding) => sum + severityWeight[finding.severity], 0);
  const healthScore = clamp(100 - totalPenalty, 8, 100);
  const silentFailureRisk = clamp(
    findings
      .filter((finding) => finding.category === "silent-failure" || finding.title.toLowerCase().includes("validation"))
      .reduce((sum, finding) => sum + severityWeight[finding.severity], 0),
    0,
    100,
  );
  const rootCause = findings.find((finding) => ["critical", "high"].includes(finding.severity)) ?? findings[0] ?? null;

  return {
    inputType: parsed && logText.trim() ? "mixed" : parsed ? "n8n-workflow" : "logs-only",
    nodes: scoredNodes,
    edges,
    findings,
    healthScore,
    silentFailureRisk,
    rootCause,
    metrics: {
      nodeCount: scoredNodes.length,
      edgeCount: edges.length,
      criticalCount,
      highCount,
      protectedSteps: findings.filter((finding) => finding.category === "resilience").length,
    },
    clientReport: buildClientReport(parsed?.name, findings, healthScore, silentFailureRisk),
  };
}

function parseWorkflow(text: string): N8nWorkflow | null {
  if (!text.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(text) as N8nWorkflow;
    if (Array.isArray(parsed.nodes)) {
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
}

function normalizeNodes(workflow: N8nWorkflow): FlowNode[] {
  return (workflow.nodes ?? []).map((node, index) => {
    const fallbackX = 80 + (index % 5) * 220;
    const fallbackY = 120 + Math.floor(index / 5) * 150;
    const [x, y] = node.position ?? [fallbackX, fallbackY];

    return {
      id: node.id ?? node.name ?? `node-${index}`,
      name: node.name ?? `Node ${index + 1}`,
      type: node.type ?? "unknown",
      x,
      y,
      risk: "info",
      flags: [],
    };
  });
}

function normalizeEdges(workflow: N8nWorkflow): FlowEdge[] {
  const edges: FlowEdge[] = [];
  const connections = workflow.connections ?? {};

  for (const [source, outputs] of Object.entries(connections)) {
    for (const groups of Object.values(outputs)) {
      for (const group of groups ?? []) {
        for (const target of group ?? []) {
          if (target.node) {
            edges.push({ source, target: target.node });
          }
        }
      }
    }
  }

  return edges;
}

function analyzeWorkflow(workflow: N8nWorkflow, nodes: FlowNode[], edges: FlowEdge[]): Candidate[] {
  const candidates: Candidate[] = [];
  const nodeByName = new Map((workflow.nodes ?? []).map((node) => [node.name ?? "", node]));
  const lowerTypes = nodes.map((node) => node.type.toLowerCase());
  const hasErrorTrigger = lowerTypes.some((type) => type.includes("errortrigger"));
  const hasValidationNode = lowerTypes.some((type) => type.includes("if") || type.includes("switch") || type.includes("filter"));

  if (!hasErrorTrigger && nodes.length > 2) {
    candidates.push({
      penalty: 11,
      finding: {
        id: "missing-error-workflow",
        severity: "medium",
        title: "No global error workflow detected",
        confidence: 84,
        category: "resilience",
        summary: "This workflow has several steps but no visible error trigger or recovery lane.",
        evidence: ["No n8n Error Trigger node found in the workflow JSON."],
        recommendations: [
          "Add a dedicated error workflow that receives failed execution metadata.",
          "Route high-value failures to Slack, email, or ticketing with workflow name and node name.",
        ],
      },
    });
  }

  if (!hasValidationNode && nodes.length > 3) {
    candidates.push({
      penalty: 18,
      finding: {
        id: "no-validation-branch",
        severity: "high",
        title: "No validation branch before side effects",
        confidence: 79,
        category: "silent-failure",
        summary: "The workflow appears linear, so malformed data can reach CRM, billing, email, or other side-effect nodes.",
        evidence: ["No IF, Switch, or Filter node found."],
        recommendations: [
          "Add a validation node before writes to external systems.",
          "Fail closed when required fields are missing or AI output is outside the expected schema.",
        ],
      },
    });
  }

  for (const node of nodes) {
    const raw = nodeByName.get(node.name);
    const type = node.type.toLowerCase();
    const parameters = raw?.parameters ?? {};
    const parameterBlob = JSON.stringify(parameters).toLowerCase();

    if (type.includes("webhook") && !parameterBlob.includes("auth")) {
      candidates.push(nodeFinding(node.name, "high", "Webhook appears unauthenticated", "auth", 82, [
        "Webhook node does not expose an obvious authentication parameter.",
      ], [
        "Require header auth, signed secret, or allowlist if this receives customer data.",
        "Log rejected requests separately from accepted payloads.",
      ]));
    }

    if (type.includes("httprequest") || type.includes("http")) {
      if (!raw?.retryOnFail && !parameterBlob.includes("retry")) {
        candidates.push(nodeFinding(node.name, "high", "External API call has no retry/backoff plan", "resilience", 88, [
          "HTTP/API node found without retryOnFail or retry parameters.",
        ], [
          "Add retry with exponential backoff for 429, 500, 502, 503, and timeout responses.",
          "Capture response status and body in the failure report.",
        ]));
      }

      if (!parameterBlob.includes("timeout")) {
        candidates.push(nodeFinding(node.name, "medium", "External API call has no explicit timeout", "runtime", 74, [
          "No timeout parameter detected on an HTTP/API node.",
        ], [
          "Set a timeout that matches the vendor's normal latency.",
          "Send timeout failures through the same alerting path as hard errors.",
        ]));
      }
    }

    if (type.includes("openai") || type.includes("langchain") || type.includes("ai")) {
      const downstream = edges.filter((edge) => edge.source === node.name).map((edge) => edge.target);
      const downstreamTypes = downstream.map((name) => nodeByName.get(name)?.type?.toLowerCase() ?? "");
      const hasSchemaGuard = downstreamTypes.some((candidateType) =>
        ["if", "switch", "filter", "code"].some((token) => candidateType.includes(token)),
      );

      if (!hasSchemaGuard) {
        candidates.push(nodeFinding(node.name, "critical", "AI output is not schema-validated", "silent-failure", 91, [
          "AI node output flows directly to the next step without an obvious validator.",
        ], [
          "Force structured JSON output and validate required fields before the next action.",
          "Route invalid model output to human review instead of writing to CRM or sending messages.",
        ]));
      }
    }

    if (type.includes("code") && parameterBlob.includes(".") && !parameterBlob.includes("?.")) {
      candidates.push(nodeFinding(node.name, "medium", "Code node may assume fields always exist", "data", 71, [
        "Code contains property access but no optional chaining was detected.",
      ], [
        "Guard required fields and return a controlled validation error when data is missing.",
        "Add a test item with missing/null fields before running this in production.",
      ]));
    }

    if (["hubspot", "salesforce", "stripe", "quickbooks"].some((token) => type.includes(token))) {
      const incoming = edges.filter((edge) => edge.target === node.name).map((edge) => edge.source);
      const hasLookup = incoming.some((name) => {
        const sourceType = nodeByName.get(name)?.type?.toLowerCase() ?? "";
        const sourceParams = JSON.stringify(nodeByName.get(name)?.parameters ?? {}).toLowerCase();
        return sourceType.includes("if") || sourceParams.includes("search") || sourceParams.includes("lookup");
      });

      if (!hasLookup && parameterBlob.includes("create")) {
        candidates.push(nodeFinding(node.name, "high", "Create action may duplicate records", "data", 78, [
          "A create operation is visible without an obvious lookup/upsert step immediately before it.",
        ], [
          "Search by stable key before create, or use an upsert operation if available.",
          "Store external IDs to make retry behavior idempotent.",
        ]));
      }
    }
  }

  return candidates;
}

function analyzeLogs(logText: string, nodes: FlowNode[]): Candidate[] {
  if (!logText.trim()) {
    return [];
  }

  const candidates: Candidate[] = [];
  const lines = logText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const nodeName = extractNodeName(logText, nodes);
  const blob = logText.toLowerCase();

  if (/\b429\b|too many requests|rate limit/.test(blob)) {
    candidates.push(nodeFinding(nodeName, "high", "Rate limit failure detected", "runtime", 94, matchingLines(lines, /429|too many requests|rate limit/i), [
      "Add retry with backoff and respect Retry-After headers.",
      "Queue or throttle requests before the vendor API step.",
    ]));
  }

  if (/\b401\b|\b403\b|unauthorized|forbidden|credential|token expired/.test(blob)) {
    candidates.push(nodeFinding(nodeName, "high", "Authentication or credential failure detected", "auth", 92, matchingLines(lines, /401|403|unauthorized|forbidden|credential|token expired/i), [
      "Refresh credentials and alert before token expiration when possible.",
      "Separate auth failures from business-rule failures in reporting.",
    ]));
  }

  if (/timeout|timed out|etimedout|econnreset|socket hang up/.test(blob)) {
    candidates.push(nodeFinding(nodeName, "high", "Network timeout or connection reset", "runtime", 88, matchingLines(lines, /timeout|timed out|etimedout|econnreset|socket hang up/i), [
      "Set explicit timeouts and retry safe requests.",
      "Capture request IDs or vendor trace IDs for escalation.",
    ]));
  }

  if (/cannot read|undefined|null|missing|required field|companyid|property/.test(blob)) {
    candidates.push(nodeFinding(nodeName, "high", "Mapping is reading missing data", "data", 86, matchingLines(lines, /cannot read|undefined|null|missing|required field|companyid|property/i), [
      "Validate required fields before this node runs.",
      "Add a quarantine path for incomplete records instead of letting the workflow crash late.",
    ]));
  }

  if (/invalid json|schema|did not match|expected|malformed|not match expected/.test(blob)) {
    candidates.push(nodeFinding(nodeName, "critical", "Output contract mismatch", "silent-failure", 89, matchingLines(lines, /invalid json|schema|did not match|expected|malformed|not match expected/i), [
      "Validate outputs against a strict schema before the next step.",
      "For AI nodes, ask for JSON only and reject non-conforming responses.",
    ]));
  }

  if (/marked success|success but|warning|wrong value|bad data|silent/.test(blob)) {
    candidates.push(nodeFinding(nodeName, "critical", "Silent failure risk found in logs", "silent-failure", 93, matchingLines(lines, /marked success|success but|warning|wrong value|bad data|silent/i), [
      "Add post-run assertions that verify the business result, not just execution success.",
      "Send suspicious successes to review until confidence is high.",
    ]));
  }

  if (!candidates.length) {
    candidates.push({
      penalty: 0,
      finding: {
        id: "logs-ingested",
        severity: "info",
        title: "Logs ingested without a known fatal pattern",
        nodeName,
        confidence: 54,
        category: "design",
        summary: "No high-confidence failure signature was found, but the logs can still be attached to the client report.",
        evidence: lines.slice(0, 2),
        recommendations: [
          "Add a failed execution sample or a recent suspicious success for a stronger diagnosis.",
          "Include node names and response bodies when exporting logs.",
        ],
      },
    });
  }

  return candidates;
}

function nodeFinding(
  nodeName: string | undefined,
  severity: Severity,
  title: string,
  category: Finding["category"],
  confidence: number,
  evidence: string[],
  recommendations: string[],
): Candidate {
  return {
    penalty: severityWeight[severity],
    finding: {
      id: slugify(`${nodeName ?? "workflow"}-${title}`),
      severity,
      title,
      nodeName,
      confidence,
      category,
      summary: nodeName ? `${title} at "${nodeName}".` : title,
      evidence: evidence.length ? evidence : ["Detected from workflow structure."],
      recommendations,
    },
  };
}

function extractNodeName(logText: string, nodes: FlowNode[]): string | undefined {
  const explicit = logText.match(/node:\s*([^\n\r]+)/i)?.[1]?.trim();
  if (explicit) {
    return explicit;
  }

  const lowerLog = logText.toLowerCase();
  const named = nodes.find((node) => lowerLog.includes(node.name.toLowerCase()));
  if (named) {
    return named.name;
  }

  const risky = nodes.find((node) => riskyNodeTokens.some((token) => node.type.toLowerCase().includes(token)));
  return risky?.name;
}

function matchingLines(lines: string[], pattern: RegExp): string[] {
  return lines.filter((line) => pattern.test(line)).slice(0, 4);
}

function buildNodeRiskMap(findings: Finding[]): Map<string, Severity> {
  const map = new Map<string, Severity>();
  for (const finding of findings) {
    if (!finding.nodeName) {
      continue;
    }
    const current = map.get(finding.nodeName);
    if (!current || severityRank(finding.severity) > severityRank(current)) {
      map.set(finding.nodeName, finding.severity);
    }
  }
  return map;
}

function dedupeFindings(findings: Finding[]): Finding[] {
  const seen = new Map<string, Finding>();
  for (const finding of findings) {
    const key = `${finding.nodeName ?? "workflow"}-${finding.title}`;
    const existing = seen.get(key);
    if (!existing || finding.confidence > existing.confidence) {
      seen.set(key, finding);
    }
  }
  return [...seen.values()];
}

function buildClientReport(
  workflowName: string | undefined,
  findings: Finding[],
  healthScore: number,
  silentFailureRisk: number,
): string {
  const blockers = findings.filter((finding) => ["critical", "high"].includes(finding.severity)).slice(0, 4);
  const nextSteps = blockers.flatMap((finding) => finding.recommendations).slice(0, 5);

  return [
    `Workflow: ${workflowName ?? "Unnamed automation"}`,
    `Automation health: ${healthScore}/100`,
    `Silent failure risk: ${silentFailureRisk}/100`,
    "",
    "Primary concerns:",
    ...(blockers.length
      ? blockers.map((finding) => `- [${finding.severity.toUpperCase()}] ${finding.nodeName ? `${finding.nodeName}: ` : ""}${finding.title}`)
      : ["- No critical blockers detected from the provided sample."]),
    "",
    "Recommended next steps:",
    ...(nextSteps.length ? nextSteps.map((step) => `- ${step}`) : ["- Add failed execution logs and one known good run for comparison."]),
  ].join("\n");
}

function emptyResult(): AnalysisResult {
  return {
    inputType: "empty",
    nodes: [],
    edges: [],
    findings: [],
    healthScore: 100,
    silentFailureRisk: 0,
    rootCause: null,
    metrics: {
      nodeCount: 0,
      edgeCount: 0,
      criticalCount: 0,
      highCount: 0,
      protectedSteps: 0,
    },
    clientReport: "Paste a workflow JSON or execution log to generate a client-ready report.",
  };
}

function severityRank(severity: Severity): number {
  return ["info", "low", "medium", "high", "critical"].indexOf(severity);
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}
