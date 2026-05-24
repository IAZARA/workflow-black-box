export const sampleWorkflow = `{
  "name": "Lead Enrichment to CRM",
  "nodes": [
    {
      "id": "1",
      "name": "Webhook Intake",
      "type": "n8n-nodes-base.webhook",
      "position": [120, 220],
      "parameters": {
        "path": "lead-intake",
        "httpMethod": "POST"
      }
    },
    {
      "id": "2",
      "name": "Normalize Payload",
      "type": "n8n-nodes-base.code",
      "position": [360, 220],
      "parameters": {
        "jsCode": "return items.map(item => ({ json: { email: item.json.email.toLowerCase(), company: item.json.company } }))"
      }
    },
    {
      "id": "3",
      "name": "Enrichment API",
      "type": "n8n-nodes-base.httpRequest",
      "position": [610, 220],
      "parameters": {
        "url": "https://api.example.com/enrich",
        "method": "POST",
        "timeout": 10000
      }
    },
    {
      "id": "4",
      "name": "AI Lead Score",
      "type": "@n8n/n8n-nodes-langchain.openAi",
      "position": [860, 220],
      "parameters": {
        "model": "gpt-4o-mini",
        "prompt": "Score this lead from 1 to 5 and explain why."
      }
    },
    {
      "id": "5",
      "name": "Create HubSpot Deal",
      "type": "n8n-nodes-base.hubspot",
      "position": [1110, 220],
      "parameters": {
        "resource": "deal",
        "operation": "create"
      }
    }
  ],
  "connections": {
    "Webhook Intake": {
      "main": [[{ "node": "Normalize Payload", "type": "main", "index": 0 }]]
    },
    "Normalize Payload": {
      "main": [[{ "node": "Enrichment API", "type": "main", "index": 0 }]]
    },
    "Enrichment API": {
      "main": [[{ "node": "AI Lead Score", "type": "main", "index": 0 }]]
    },
    "AI Lead Score": {
      "main": [[{ "node": "Create HubSpot Deal", "type": "main", "index": 0 }]]
    }
  }
}`;

export const sampleLog = `Execution 2841 failed
Workflow: Lead Enrichment to CRM
Node: Enrichment API
Error: 429 Too Many Requests from api.example.com
Retry-After: 60
Input item: {"email":"maria@example.com","company":"Northwind"}

Previous run marked success but HubSpot received score = "maybe_high"
Node: AI Lead Score
Warning: model output did not match expected numeric score

Node: Create HubSpot Deal
Error: Cannot read properties of undefined (reading 'companyId')`;

export type DemoScenario = {
  id: string;
  label: string;
  signal: string;
  description: string;
  workflow: string;
  logs: string;
};

const guardedWorkflow = `{
  "name": "Validated CRM Sync",
  "nodes": [
    {
      "id": "1",
      "name": "Signed Webhook",
      "type": "n8n-nodes-base.webhook",
      "position": [120, 220],
      "parameters": {
        "path": "signed-lead",
        "httpMethod": "POST",
        "authentication": "headerAuth"
      }
    },
    {
      "id": "2",
      "name": "Validate Payload",
      "type": "n8n-nodes-base.if",
      "position": [360, 220],
      "parameters": {
        "conditions": {
          "string": [
            { "value1": "={{$json.email}}", "operation": "isNotEmpty" },
            { "value1": "={{$json.company}}", "operation": "isNotEmpty" }
          ]
        }
      }
    },
    {
      "id": "3",
      "name": "Enrichment API",
      "type": "n8n-nodes-base.httpRequest",
      "position": [610, 220],
      "retryOnFail": true,
      "parameters": {
        "url": "https://api.example.com/enrich",
        "method": "POST",
        "timeout": 12000
      }
    },
    {
      "id": "4",
      "name": "Upsert HubSpot Contact",
      "type": "n8n-nodes-base.hubspot",
      "position": [860, 220],
      "parameters": {
        "resource": "contact",
        "operation": "upsert"
      }
    },
    {
      "id": "5",
      "name": "Error Trigger",
      "type": "n8n-nodes-base.errorTrigger",
      "position": [120, 420],
      "parameters": {}
    }
  ],
  "connections": {
    "Signed Webhook": {
      "main": [[{ "node": "Validate Payload", "type": "main", "index": 0 }]]
    },
    "Validate Payload": {
      "main": [[{ "node": "Enrichment API", "type": "main", "index": 0 }]]
    },
    "Enrichment API": {
      "main": [[{ "node": "Upsert HubSpot Contact", "type": "main", "index": 0 }]]
    }
  }
}`;

const guardedLogs = `Execution 9102 completed
Workflow: Validated CRM Sync
Node: Validate Payload
Status: payload accepted
Node: Enrichment API
Status: 200 OK after 1 attempt
Node: Upsert HubSpot Contact
Status: contact updated by stable email key`;

const makeScenarioWorkflow = `{
  "name": "Make Checkout Monitor",
  "flow": [
    {
      "id": 1,
      "module": "webhook:CustomWebhook",
      "metadata": {
        "name": "Checkout Webhook",
        "designer": { "x": 120, "y": 220 }
      },
      "parameters": {
        "hook": "checkout-created"
      }
    },
    {
      "id": 2,
      "module": "http:ActionSendData",
      "metadata": {
        "name": "Payment API",
        "designer": { "x": 360, "y": 220 }
      },
      "parameters": {
        "url": "https://payments.example.com/charge",
        "method": "POST"
      }
    },
    {
      "id": 3,
      "module": "slack:CreateMessage",
      "metadata": {
        "name": "Slack Alert",
        "designer": { "x": 610, "y": 220 }
      },
      "parameters": {
        "channel": "#ops"
      }
    }
  ]
}`;

const makeScenarioLogs = `Execution 553 failed
Scenario: Make Checkout Monitor
Node: Payment API
Error: timeout after 30000ms
Node: Slack Alert
Warning: success but message was missing checkout_id`;

const zapierScenarioWorkflow = `{
  "name": "Zapier AI Lead Intake",
  "steps": [
    {
      "id": "trigger",
      "name": "Catch Lead Hook",
      "app": "Webhooks",
      "action": "Catch Hook"
    },
    {
      "id": "score",
      "name": "OpenAI Lead Score",
      "app": "OpenAI",
      "action": "Analyze Lead"
    },
    {
      "id": "create",
      "name": "Create HubSpot Contact",
      "app": "HubSpot",
      "action": "Create Contact"
    }
  ]
}`;

const zapierScenarioLogs = `Zap run 119 failed
Node: OpenAI Lead Score
Warning: model output did not match expected schema
Node: Create HubSpot Contact
Error: Cannot read properties of undefined (reading 'email')`;

export const demoScenarios: DemoScenario[] = [
  {
    id: "incident",
    label: "Risk",
    signal: "CRIT",
    description: "n8n lead flow with rate limits, AI contract drift, and late CRM mapping failure.",
    workflow: sampleWorkflow,
    logs: sampleLog,
  },
  {
    id: "guarded",
    label: "Safe",
    signal: "OK",
    description: "n8n flow with auth, validation, retry, timeout, upsert, and an error trigger.",
    workflow: guardedWorkflow,
    logs: guardedLogs,
  },
  {
    id: "make",
    label: "Make",
    signal: "API",
    description: "Make-style checkout scenario with timeout and suspicious-success evidence.",
    workflow: makeScenarioWorkflow,
    logs: makeScenarioLogs,
  },
  {
    id: "zapier",
    label: "Zapier",
    signal: "AI",
    description: "Zapier-style lead intake with AI schema mismatch before CRM creation.",
    workflow: zapierScenarioWorkflow,
    logs: zapierScenarioLogs,
  },
];
