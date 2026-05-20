#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { analyzeAutomation, AnalysisResult, Finding } from "../src/lib/analyzer";

const server = new McpServer({
  name: "workflow-black-box",
  version: "0.1.0",
});

const workflowSchema = {
  workflowJson: z
    .string()
    .min(1)
    .describe("Exported workflow JSON, for example from n8n. Keep it as raw JSON text."),
};

const logsSchema = {
  logs: z
    .string()
    .min(1)
    .describe("Execution logs, error text, or suspicious-success logs from an automation run."),
};

server.registerTool(
  "analyze_workflow_json",
  {
    title: "Analyze Workflow JSON",
    description:
      "Analyze a workflow JSON for automation risks such as unauthenticated webhooks, missing validation, missing retries, duplicate writes, and silent failure risks.",
    inputSchema: workflowSchema,
  },
  async ({ workflowJson }) => makeToolResult(analyzeAutomation(workflowJson, ""), "Workflow JSON analysis"),
);

server.registerTool(
  "analyze_execution_logs",
  {
    title: "Analyze Execution Logs",
    description:
      "Analyze automation execution logs for likely root causes, silent failures, rate limits, missing data, auth issues, timeouts, and output contract mismatches.",
    inputSchema: logsSchema,
  },
  async ({ logs }) => makeToolResult(analyzeAutomation("", logs), "Execution log analysis"),
);

server.registerTool(
  "analyze_workflow_with_logs",
  {
    title: "Analyze Workflow With Logs",
    description:
      "Analyze a workflow JSON together with execution logs and return scores, root cause, findings, recommendations, graph metadata, and a client-ready report.",
    inputSchema: {
      ...workflowSchema,
      ...logsSchema,
    },
  },
  async ({ workflowJson, logs }) => makeToolResult(analyzeAutomation(workflowJson, logs), "Workflow and log analysis"),
);

server.registerTool(
  "generate_client_report",
  {
    title: "Generate Client Report",
    description:
      "Generate a concise client-ready diagnosis report from workflow JSON and/or execution logs.",
    inputSchema: {
      workflowJson: z.string().optional().describe("Optional exported workflow JSON."),
      logs: z.string().optional().describe("Optional execution logs or error text."),
    },
  },
  async ({ workflowJson = "", logs = "" }) => {
    const result = analyzeAutomation(workflowJson, logs);

    return {
      content: [
        {
          type: "text" as const,
          text: result.clientReport,
        },
      ],
      structuredContent: {
        report: result.clientReport,
        summary: summarize(result),
      },
    };
  },
);

server.registerTool(
  "list_supported_patterns",
  {
    title: "List Supported Diagnostic Patterns",
    description: "List the workflow and log risk patterns currently detected by Workflow Black Box.",
    inputSchema: {},
  },
  async () => {
    const structuredContent = {
      workflowPatterns: [
        "webhooks without obvious authentication",
        "external HTTP/API calls without retry or backoff",
        "external HTTP/API calls without explicit timeout",
        "AI outputs flowing into downstream actions without schema validation",
        "code nodes that assume nested fields always exist",
        "CRM/billing create actions that may duplicate records",
        "linear workflows without validation branches",
        "missing global error workflow or error trigger",
      ],
      logPatterns: [
        "429 and rate limit failures",
        "401/403 authentication and credential failures",
        "timeouts, connection resets, and socket failures",
        "missing/undefined/null data mapping errors",
        "invalid JSON, schema mismatch, malformed output, and output contract failures",
        "silent failure or suspicious success signals",
      ],
    };

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(structuredContent, null, 2),
        },
      ],
      structuredContent,
    };
  },
);

function makeToolResult(result: AnalysisResult, label: string) {
  const structuredContent = {
    summary: summarize(result),
    nodes: result.nodes,
    edges: result.edges,
    findings: result.findings,
    recommendations: collectRecommendations(result.findings),
    clientReport: result.clientReport,
  };

  return {
    content: [
      {
        type: "text" as const,
        text: [
          `${label}:`,
          `Health score: ${result.healthScore}/100`,
          `Silent failure risk: ${result.silentFailureRisk}/100`,
          `Root cause: ${result.rootCause?.title ?? "none detected"}`,
          `Findings: ${result.findings.length}`,
          "",
          result.clientReport,
        ].join("\n"),
      },
    ],
    structuredContent,
  };
}

function summarize(result: AnalysisResult) {
  return {
    inputType: result.inputType,
    healthScore: result.healthScore,
    silentFailureRisk: result.silentFailureRisk,
    rootCause: result.rootCause,
    metrics: result.metrics,
    findingCount: result.findings.length,
    criticalFindings: result.findings.filter((finding) => finding.severity === "critical").length,
    highFindings: result.findings.filter((finding) => finding.severity === "high").length,
  };
}

function collectRecommendations(findings: Finding[]) {
  return [...new Set(findings.flatMap((finding) => finding.recommendations))];
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Workflow Black Box MCP server running on stdio");
}

main().catch((error) => {
  console.error("Workflow Black Box MCP server failed:", error);
  process.exit(1);
});
