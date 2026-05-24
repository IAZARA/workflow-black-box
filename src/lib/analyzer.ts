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
  evidenceRefs?: EvidenceReference[];
  recommendations: string[];
  category: "runtime" | "data" | "auth" | "resilience" | "silent-failure" | "design";
};

export type EvidenceReference = {
  source: "logs" | "workflow";
  line?: number;
  text: string;
  nodeName?: string;
};

export type AnalysisResult = {
  inputType:
    | "n8n-workflow"
    | "make-scenario"
    | "zapier-zap"
    | "logs-only"
    | "mixed"
    | "empty"
    | "invalid-json"
    | "unsupported-json";
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

type WorkflowFormat = "n8n" | "make" | "zapier";

type DiagnosticWorkflow = {
  name?: string;
  format: WorkflowFormat;
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

type WorkflowNode = NonNullable<DiagnosticWorkflow["nodes"]>[number];

type WorkflowParseResult =
  | { status: "empty" }
  | { status: "valid"; workflow: DiagnosticWorkflow }
  | { status: "invalid"; message: string }
  | { status: "unsupported"; message: string };

type Candidate = {
  finding: Finding;
  penalty: number;
};

type LogLine = {
  lineNumber: number;
  raw: string;
  text: string;
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
  "gemini",
  "anthropic",
  "claude",
  "mistral",
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
  const workflow = parsed.status === "valid" ? parsed.workflow : null;
  const nodes = workflow ? normalizeNodes(workflow) : [];
  const edges = workflow ? normalizeEdges(workflow) : [];
  const candidates: Candidate[] = [];

  if (workflow) {
    candidates.push(...analyzeWorkflow(workflow, nodes, edges));
  } else if (parsed.status === "invalid") {
    candidates.push(workflowInputFinding("invalid-json", "Workflow JSON could not be parsed", parsed.message, [
      "Fix the JSON syntax before trusting this diagnostic.",
      "Export the workflow again from the automation platform and reload it.",
    ]));
  } else if (parsed.status === "unsupported") {
    candidates.push(workflowInputFinding("unsupported-json", "Unsupported workflow JSON format", parsed.message, [
      "Load an n8n export, a Make scenario blueprint, or a Zapier-like steps export.",
      "If this is a valid platform export, add a parser adapter before using the score with clients.",
    ]));
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
    inputType: resolveInputType(parsed, Boolean(logText.trim())),
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
    clientReport: buildClientReport(workflow?.name, findings, healthScore, silentFailureRisk),
  };
}

function parseWorkflow(text: string): WorkflowParseResult {
  if (!text.trim()) {
    return { status: "empty" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown JSON parse error.";
    return { status: "invalid", message };
  }

  if (!isRecord(parsed)) {
    return { status: "unsupported", message: "The workflow input is valid JSON, but it is not a JSON object." };
  }

  if (Array.isArray(parsed.nodes)) {
    return { status: "valid", workflow: { ...(parsed as Omit<DiagnosticWorkflow, "format">), format: "n8n" } };
  }

  if (Array.isArray(parsed.flow)) {
    const workflow = makeScenarioToWorkflow(parsed);
    return workflow.nodes?.length
      ? { status: "valid", workflow }
      : { status: "unsupported", message: "The Make flow array did not contain any readable modules." };
  }

  if (Array.isArray(parsed.steps) || Array.isArray(parsed.actions)) {
    const workflow = zapierExportToWorkflow(parsed);
    return workflow.nodes?.length
      ? { status: "valid", workflow }
      : { status: "unsupported", message: "The Zapier steps/actions array did not contain any readable steps." };
  }

  return {
    status: "unsupported",
    message: "The JSON does not include n8n nodes, a Make flow array, or Zapier steps/actions.",
  };
}

function makeScenarioToWorkflow(input: Record<string, unknown>): DiagnosticWorkflow {
  const modules = flattenMakeModules(input.flow);
  const names = modules.map((module, index) => makeModuleName(module, index));
  const connections: DiagnosticWorkflow["connections"] = {};

  for (let index = 0; index < names.length - 1; index += 1) {
    addMainConnection(connections, names[index], names[index + 1]);
  }

  return {
    name: stringOrUndefined(input.name) ?? "Imported Make scenario",
    format: "make",
    nodes: modules.map((module, index) => {
      const metadata = recordOrEmpty(module.metadata);
      const designer = recordOrEmpty(metadata.designer);
      const moduleName = stringOrUndefined(module.module) ?? stringOrUndefined(module.type) ?? "unknown";
      const x = numberOrUndefined(designer.x) ?? 80 + index * 220;
      const y = numberOrUndefined(designer.y) ?? 120 + (index % 4) * 120;

      return {
        id: String(module.id ?? `make-${index + 1}`),
        name: names[index],
        type: `make.${moduleName}`,
        position: [x, y],
        parameters: {
          module: moduleName,
          parameters: recordOrEmpty(module.parameters),
          mapper: recordOrEmpty(module.mapper),
        },
      };
    }),
    connections,
  };
}

function zapierExportToWorkflow(input: Record<string, unknown>): DiagnosticWorkflow {
  const steps = (Array.isArray(input.steps) ? input.steps : input.actions) as unknown[];
  const records = steps.filter(isRecord);
  const names = records.map((step, index) => zapierStepName(step, index));
  const connections: DiagnosticWorkflow["connections"] = {};

  for (let index = 0; index < names.length - 1; index += 1) {
    addMainConnection(connections, names[index], names[index + 1]);
  }

  return {
    name: stringOrUndefined(input.name) ?? stringOrUndefined(input.title) ?? "Imported Zapier zap",
    format: "zapier",
    nodes: records.map((step, index) => {
      const appName = stringOrUndefined(step.app) ?? stringOrUndefined(step.appName) ?? stringOrUndefined(step.service);
      const actionName = stringOrUndefined(step.action) ?? stringOrUndefined(step.event) ?? stringOrUndefined(step.type);

      return {
        id: String(step.id ?? step.key ?? `zapier-${index + 1}`),
        name: names[index],
        type: ["zapier", appName, actionName].filter(Boolean).join("."),
        position: [80 + index * 220, 120],
        parameters: recordOrEmpty(step),
      };
    }),
    connections,
  };
}

function flattenMakeModules(flow: unknown): Record<string, unknown>[] {
  if (!Array.isArray(flow)) {
    return [];
  }

  const modules: Record<string, unknown>[] = [];

  for (const item of flow) {
    if (!isRecord(item)) {
      continue;
    }

    modules.push(item);

    const routes = item.routes;
    if (Array.isArray(routes)) {
      for (const route of routes) {
        if (isRecord(route)) {
          modules.push(...flattenMakeModules(route.flow));
        }
      }
    }
  }

  return modules;
}

function makeModuleName(module: Record<string, unknown>, index: number): string {
  const metadata = recordOrEmpty(module.metadata);
  const label =
    stringOrUndefined(module.name) ??
    stringOrUndefined(module.label) ??
    stringOrUndefined(metadata.name) ??
    stringOrUndefined(metadata.label);

  if (label) {
    return label;
  }

  const moduleName = stringOrUndefined(module.module) ?? stringOrUndefined(module.type);
  return moduleName ? humanizeToken(moduleName) : `Make module ${index + 1}`;
}

function zapierStepName(step: Record<string, unknown>, index: number): string {
  return (
    stringOrUndefined(step.name) ??
    stringOrUndefined(step.title) ??
    stringOrUndefined(step.label) ??
    stringOrUndefined(step.key) ??
    `Zapier step ${index + 1}`
  );
}

function addMainConnection(
  connections: NonNullable<DiagnosticWorkflow["connections"]>,
  source: string,
  target: string,
): void {
  connections[source] ??= {};
  connections[source].main ??= [[]];
  connections[source].main[0] ??= [];
  connections[source].main[0].push({ node: target });
}

function normalizeNodes(workflow: DiagnosticWorkflow): FlowNode[] {
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

function normalizeEdges(workflow: DiagnosticWorkflow): FlowEdge[] {
  const edges: FlowEdge[] = [];
  const connections = workflow.connections ?? {};

  for (const [source, outputs] of Object.entries(connections)) {
    const outputEntries = Object.entries(outputs).filter(([outputName]) => outputName === "main");

    for (const [, groups] of outputEntries) {
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

function analyzeWorkflow(workflow: DiagnosticWorkflow, nodes: FlowNode[], edges: FlowEdge[]): Candidate[] {
  const candidates: Candidate[] = [];
  const nodeByName = new Map((workflow.nodes ?? []).map((node) => [node.name ?? "", node]));
  const lowerTypes = nodes.map((node) => node.type.toLowerCase());
  const hasErrorTrigger = lowerTypes.some((type) => type.includes("errortrigger"));
  const hasValidationNode = lowerTypes.some(isValidationNodeType);

  if (workflow.format === "n8n" && !hasErrorTrigger && nodes.length > 2) {
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

    if (isAiProducerNodeType(type)) {
      const downstream = edges.filter((edge) => edge.source === node.name).map((edge) => edge.target);
      const downstreamTypes = downstream.map((name) => nodeByName.get(name)?.type?.toLowerCase() ?? "");
      const hasSchemaGuard =
        downstreamTypes.some((candidateType) => isValidationNodeType(candidateType) || isStructuredOutputParserType(candidateType)) ||
        hasIncomingStructuredOutputParser(workflow, node.name);

      if (downstream.length > 0 && !hasSchemaGuard) {
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

      if (!hasLookup && hasCreateSideEffect(raw, node.name)) {
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
  const lines = parseLogLines(logText);
  const visibleLines = lines.filter((line) => line.text);
  const nodeName = extractNodeName(logText, nodes);
  const blob = logText.toLowerCase();

  if (/\b429\b|too many requests|rate limit/.test(blob)) {
    const evidenceRefs = matchingLogEvidence(lines, /429|too many requests|rate limit/i, nodes);
    candidates.push(nodeFinding(evidenceNodeName(evidenceRefs, nodeName), "high", "Rate limit failure detected", "runtime", 94, evidenceTexts(evidenceRefs), [
      "Add retry with backoff and respect Retry-After headers.",
      "Queue or throttle requests before the vendor API step.",
    ], evidenceRefs));
  }

  if (/\b401\b|\b403\b|unauthorized|forbidden|credential|token expired/.test(blob)) {
    const evidenceRefs = matchingLogEvidence(lines, /401|403|unauthorized|forbidden|credential|token expired/i, nodes);
    candidates.push(nodeFinding(evidenceNodeName(evidenceRefs, nodeName), "high", "Authentication or credential failure detected", "auth", 92, evidenceTexts(evidenceRefs), [
      "Refresh credentials and alert before token expiration when possible.",
      "Separate auth failures from business-rule failures in reporting.",
    ], evidenceRefs));
  }

  if (/timeout|timed out|etimedout|econnreset|socket hang up/.test(blob)) {
    const evidenceRefs = matchingLogEvidence(lines, /timeout|timed out|etimedout|econnreset|socket hang up/i, nodes);
    candidates.push(nodeFinding(evidenceNodeName(evidenceRefs, nodeName), "high", "Network timeout or connection reset", "runtime", 88, evidenceTexts(evidenceRefs), [
      "Set explicit timeouts and retry safe requests.",
      "Capture request IDs or vendor trace IDs for escalation.",
    ], evidenceRefs));
  }

  if (/cannot read|undefined|null|missing|required field|companyid|property/.test(blob)) {
    const evidenceRefs = matchingLogEvidence(lines, /cannot read|undefined|null|missing|required field|companyid|property/i, nodes);
    candidates.push(nodeFinding(evidenceNodeName(evidenceRefs, nodeName), "high", "Mapping is reading missing data", "data", 86, evidenceTexts(evidenceRefs), [
      "Validate required fields before this node runs.",
      "Add a quarantine path for incomplete records instead of letting the workflow crash late.",
    ], evidenceRefs));
  }

  if (/invalid json|schema|did not match|expected|malformed|not match expected/.test(blob)) {
    const evidenceRefs = matchingLogEvidence(lines, /invalid json|schema|did not match|expected|malformed|not match expected/i, nodes);
    candidates.push(nodeFinding(evidenceNodeName(evidenceRefs, nodeName), "critical", "Output contract mismatch", "silent-failure", 89, evidenceTexts(evidenceRefs), [
      "Validate outputs against a strict schema before the next step.",
      "For AI nodes, ask for JSON only and reject non-conforming responses.",
    ], evidenceRefs));
  }

  if (/marked success|success but|warning|wrong value|bad data|silent/.test(blob)) {
    const evidenceRefs = matchingLogEvidence(lines, /marked success|success but|warning|wrong value|bad data|silent/i, nodes);
    candidates.push(nodeFinding(evidenceNodeName(evidenceRefs, nodeName), "critical", "Silent failure risk found in logs", "silent-failure", 93, evidenceTexts(evidenceRefs), [
      "Add post-run assertions that verify the business result, not just execution success.",
      "Send suspicious successes to review until confidence is high.",
    ], evidenceRefs));
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
        evidence: visibleLines.slice(0, 2).map((line) => line.text),
        evidenceRefs: visibleLines.slice(0, 2).map((line) => ({
          source: "logs",
          line: line.lineNumber,
          text: line.text,
          nodeName: nodeName,
        })),
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
  evidenceRefs: EvidenceReference[] = [],
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
      evidenceRefs,
      recommendations,
    },
  };
}

function workflowInputFinding(
  id: string,
  title: string,
  message: string,
  recommendations: string[],
): Candidate {
  return {
    penalty: severityWeight.high,
    finding: {
      id,
      severity: "high",
      title,
      confidence: 98,
      category: "design",
      summary: `${title}.`,
      evidence: [`Workflow input: ${message}`],
      evidenceRefs: [
        {
          source: "workflow",
          text: message,
        },
      ],
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

function resolveInputType(parsed: WorkflowParseResult, hasLogs: boolean): AnalysisResult["inputType"] {
  if (parsed.status === "valid") {
    if (hasLogs) {
      return "mixed";
    }

    if (parsed.workflow.format === "make") {
      return "make-scenario";
    }

    if (parsed.workflow.format === "zapier") {
      return "zapier-zap";
    }

    return "n8n-workflow";
  }

  if (parsed.status === "invalid") {
    return "invalid-json";
  }

  if (parsed.status === "unsupported") {
    return "unsupported-json";
  }

  return hasLogs ? "logs-only" : "empty";
}

function isValidationNodeType(type: string): boolean {
  const lower = type.toLowerCase();
  return (
    /(^|[.:-])(if|switch|filter|router)([.:-]|$)/.test(lower) ||
    lower.includes("validator") ||
    lower.includes("validation") ||
    lower.includes("outputparser")
  );
}

function isAiProducerNodeType(type: string): boolean {
  const lower = type.toLowerCase();

  if (
    lower.includes("memory") ||
    lower.includes("outputparser") ||
    lower.includes("tool") ||
    lower.includes("airtable") ||
    lower.includes("gmail")
  ) {
    return false;
  }

  return (
    lower.includes("openai") ||
    lower.includes("gemini") ||
    lower.includes("anthropic") ||
    lower.includes("claude") ||
    lower.includes("mistral") ||
    lower.includes("llm") ||
    lower.includes("lmchat") ||
    lower.includes("chatmodel") ||
    lower.includes("langchain.agent") ||
    /(^|[.:-])agent([.:-]|$)/.test(lower)
  );
}

function isStructuredOutputParserType(type: string): boolean {
  const lower = type.toLowerCase();
  return lower.includes("outputparser") || lower.includes("structuredoutputparser");
}

function hasIncomingStructuredOutputParser(workflow: DiagnosticWorkflow, nodeName: string): boolean {
  const nodes = new Map((workflow.nodes ?? []).map((node) => [node.name ?? "", node]));

  for (const [source, outputs] of Object.entries(workflow.connections ?? {})) {
    const sourceType = nodes.get(source)?.type ?? "";
    if (!isStructuredOutputParserType(sourceType)) {
      continue;
    }

    for (const groups of Object.values(outputs)) {
      for (const group of groups ?? []) {
        if (group?.some((target) => target.node === nodeName)) {
          return true;
        }
      }
    }
  }

  return false;
}

function hasCreateSideEffect(node: WorkflowNode | undefined, nodeName: string): boolean {
  const parameters = recordOrEmpty(node?.parameters);
  const operation =
    stringOrUndefined(parameters.operation) ??
    stringOrUndefined(parameters.action) ??
    stringOrUndefined(parameters.resourceOperation) ??
    stringOrUndefined(parameters.mode);
  const normalizedOperation = operation?.toLowerCase().replace(/\s+/g, "");

  if (normalizedOperation) {
    return (
      normalizedOperation.includes("create") &&
      !normalizedOperation.includes("update") &&
      !normalizedOperation.includes("upsert") &&
      !normalizedOperation.includes("get") &&
      !normalizedOperation.includes("search")
    );
  }

  const normalizedName = nodeName.toLowerCase();
  return (
    /^create\b/.test(normalizedName) &&
    !normalizedName.includes("create or update") &&
    !normalizedName.includes("upsert")
  );
}

function parseLogLines(logText: string): LogLine[] {
  return logText.split(/\r?\n/).map((raw, index) => ({
    lineNumber: index + 1,
    raw,
    text: raw.trim(),
  }));
}

function matchingLogEvidence(lines: LogLine[], pattern: RegExp, nodes: FlowNode[]): EvidenceReference[] {
  return lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.text && pattern.test(line.text))
    .slice(0, 4)
    .map(({ line, index }) => ({
      source: "logs",
      line: line.lineNumber,
      text: line.text,
      nodeName: resolveLogNodeName(lines, index, nodes),
    }));
}

function evidenceTexts(evidenceRefs: EvidenceReference[]): string[] {
  return evidenceRefs.map((ref) => (ref.line ? `L${ref.line}: ${ref.text}` : ref.text));
}

function evidenceNodeName(evidenceRefs: EvidenceReference[], fallback: string | undefined): string | undefined {
  return evidenceRefs.find((ref) => ref.nodeName)?.nodeName ?? fallback;
}

function resolveLogNodeName(lines: LogLine[], index: number, nodes: FlowNode[]): string | undefined {
  const offsets = [0, -1, 1, -2, 2, -3, 3];

  for (const offset of offsets) {
    const line = lines[index + offset];
    if (!line?.text) {
      continue;
    }

    const explicit = line.text.match(/^node:\s*(.+)$/i)?.[1]?.trim();
    if (explicit) {
      return knownNodeName(explicit, nodes) ?? explicit;
    }

    const named = nodes.find((node) => line.text.toLowerCase().includes(node.name.toLowerCase()));
    if (named) {
      return named.name;
    }
  }

  return undefined;
}

function knownNodeName(value: string, nodes: FlowNode[]): string | undefined {
  const lower = value.toLowerCase();
  return nodes.find((node) => node.name.toLowerCase() === lower)?.name;
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
  const evidence = blockers
    .flatMap((finding) =>
      (finding.evidenceRefs ?? [])
        .filter((ref) => ref.source === "logs" && ref.line)
        .slice(0, 2)
        .map((ref) => `- L${ref.line} (${ref.nodeName ?? finding.nodeName ?? "Global"}): ${ref.text}`),
    )
    .slice(0, 6);

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
    "Evidence detected:",
    ...(evidence.length ? evidence : ["- No log-line evidence linked yet."]),
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function humanizeToken(value: string): string {
  const lastSegment = value.split(/[.:/]/).filter(Boolean).pop() ?? value;
  return lastSegment
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
