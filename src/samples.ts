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
