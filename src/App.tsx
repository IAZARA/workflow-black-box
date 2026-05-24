import {
  AlertTriangle,
  Bug,
  ClipboardCopy,
  Download,
  FileJson,
  FileText,
  Gauge,
  GitBranch,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  Upload,
  Webhook,
  Code,
  Globe,
  Database,
  Terminal,
  Bot,
  BrainCircuit,
  Mail,
  MessageSquare,
  CreditCard,
  CalendarClock,
  Clock3,
  Filter,
  GitFork,
  ShieldCheck,
  KeyRound,
  Table2,
  FileSpreadsheet,
  ShoppingCart,
  Users,
  Send,
  X,
  Trash2,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  Info,
  CheckCircle2,
  SlidersHorizontal,
} from "lucide-react";
import { ChangeEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { analyzeAutomation, AnalysisResult, EvidenceReference, Finding, FlowEdge, FlowNode, Severity } from "./lib/analyzer";
import { sampleLog, sampleWorkflow } from "./samples";

const severityLabel: Record<Severity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  info: "Info",
};

type ActiveAnalysisTab = "findings" | "recommendations" | "evidence" | "report";

type EvidenceSelection = {
  findingId: string;
  line?: number;
} | null;

type LogLineView = {
  lineNumber: number;
  text: string;
};

function getNodeIcon(type: string) {
  const t = type.toLowerCase();
  if (t.includes("webhook")) return <Webhook size={15} />;
  if (t.includes("trigger")) return <GitFork size={15} />;
  if (t.includes("if") || t.includes("switch") || t.includes("filter") || t.includes("router")) return <Filter size={15} />;
  if (t.includes("code")) return <Code size={15} />;
  if (t.includes("httprequest") || t.includes("http")) return <Globe size={15} />;
  if (t.includes("openai") || t.includes("gemini") || t.includes("claude") || t.includes("anthropic")) return <BrainCircuit size={15} />;
  if (isAiVisualType(t)) return <Bot size={15} />;
  if (t.includes("gmail") || t.includes("mailchimp")) return <Mail size={15} />;
  if (t.includes("slack") || t.includes("telegram") || t.includes("whatsapp") || t.includes("mattermost")) return <MessageSquare size={15} />;
  if (t.includes("stripe") || t.includes("quickbooks") || t.includes("invoice")) return <CreditCard size={15} />;
  if (t.includes("shopify") || t.includes("woocommerce")) return <ShoppingCart size={15} />;
  if (t.includes("calendar") || t.includes("calendly")) return <CalendarClock size={15} />;
  if (t.includes("cron") || t.includes("schedule")) return <Clock3 size={15} />;
  if (t.includes("airtable") || t.includes("sheets")) return <Table2 size={15} />;
  if (t.includes("spreadsheet") || t.includes("excel")) return <FileSpreadsheet size={15} />;
  if (t.includes("hubspot") || t.includes("salesforce") || t.includes("pipedrive") || t.includes("zoho")) return <Users size={15} />;
  if (t.includes("auth") || t.includes("credential")) return <KeyRound size={15} />;
  if (t.includes("validation") || t.includes("validator")) return <ShieldCheck size={15} />;
  if (t.includes("send")) return <Send size={15} />;
  if (t.includes("database") || t.includes("postgres") || t.includes("supabase") || t.includes("mysql")) return <Database size={15} />;
  return <Terminal size={14} />;
}

function getNodeIconTone(type: string) {
  const t = type.toLowerCase();
  if (t.includes("webhook") || t.includes("trigger") || t.includes("cron") || t.includes("schedule")) return "trigger";
  if (t.includes("if") || t.includes("switch") || t.includes("filter") || t.includes("router") || t.includes("validation")) return "logic";
  if (t.includes("httprequest") || t.includes("http")) return "api";
  if (isAiVisualType(t) || t.includes("openai") || t.includes("gemini") || t.includes("claude")) return "ai";
  if (t.includes("gmail") || t.includes("slack") || t.includes("telegram") || t.includes("whatsapp") || t.includes("mail")) return "comms";
  if (t.includes("hubspot") || t.includes("salesforce") || t.includes("pipedrive") || t.includes("zoho")) return "crm";
  if (t.includes("stripe") || t.includes("quickbooks") || t.includes("shopify") || t.includes("woocommerce")) return "commerce";
  if (t.includes("airtable") || t.includes("sheets") || t.includes("database") || t.includes("postgres") || t.includes("supabase")) return "data";
  if (t.includes("code")) return "code";
  return "default";
}

function isAiVisualType(type: string) {
  return (
    type.includes("openai") ||
    type.includes("gemini") ||
    type.includes("anthropic") ||
    type.includes("claude") ||
    type.includes("mistral") ||
    type.includes("llm") ||
    type.includes("lmchat") ||
    type.includes("chatmodel") ||
    type.includes("langchain.agent") ||
    /(^|[.:-])agent([.:-]|$)/.test(type)
  );
}

export function App() {
  const [workflowText, setWorkflowText] = useState(sampleWorkflow);
  const [logText, setLogText] = useState(sampleLog);
  const [copied, setCopied] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [activeInputTab, setActiveInputTab] = useState<'workflow' | 'logs'>('workflow');
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [reportTab, setReportTab] = useState<'preview' | 'raw'>('preview');
  const [activeAnalysisTab, setActiveAnalysisTab] = useState<ActiveAnalysisTab>('findings');
  const [selectedEvidence, setSelectedEvidence] = useState<EvidenceSelection>(null);
  const [evidenceCopied, setEvidenceCopied] = useState(false);
  
  // Double-State Sidebar: 'summary' or 'editors'
  const [sidebarMode, setSidebarMode] = useState<'summary' | 'editors'>('summary');
  
  // Mobile inputs drawer toggle state
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // SVG Pan & Zoom transform state coordinates
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const workflowFileRef = useRef<HTMLInputElement>(null);
  const logFileRef = useRef<HTMLInputElement>(null);

  const result = useMemo(() => analyzeAutomation(workflowText, logText), [workflowText, logText]);
  const logLines = useMemo<LogLineView[]>(
    () => logText.split(/\r?\n/).map((text, index) => ({ lineNumber: index + 1, text })),
    [logText],
  );
  const evidenceCount = useMemo(
    () => result.findings.reduce((total, finding) => total + getLogEvidence(finding).length, 0),
    [result.findings],
  );

  async function copyReport() {
    await navigator.clipboard.writeText(result.clientReport);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  function downloadReport() {
    const blob = new Blob([result.clientReport], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "workflow-black-box-report.md";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function loadSample() {
    setWorkflowText(sampleWorkflow);
    setLogText(sampleLog);
    setSelectedNode(null);
    setSelectedEvidence(null);
    setSidebarMode('summary');
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }

  function clearInputs() {
    setWorkflowText("");
    setLogText("");
    setSelectedNode(null);
    setSelectedEvidence(null);
    setSidebarMode('editors');
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }

  async function loadFile(event: ChangeEvent<HTMLInputElement>, target: "workflow" | "log") {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    const text = await file.text();
    if (target === "workflow") {
      setWorkflowText(text);
      setActiveInputTab('workflow');
    } else {
      setLogText(text);
      setActiveInputTab('logs');
    }
    event.target.value = "";
    setSelectedEvidence(null);
    setSidebarMode('summary');
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      const text = await file.text();
      if (file.name.endsWith('.json') || text.trim().startsWith('{') || text.trim().startsWith('[')) {
        setWorkflowText(text);
        setActiveInputTab('workflow');
      } else {
        setLogText(text);
        setActiveInputTab('logs');
      }
      setSelectedEvidence(null);
      setSidebarMode('summary');
      setZoom(1);
      setPan({ x: 0, y: 0 });
    }
  };

  const filteredFindings = useMemo(() => {
    if (!selectedNode) return result.findings;
    return result.findings.filter((f) => f.nodeName === selectedNode);
  }, [result.findings, selectedNode]);

  // Aggregate all actionable checklist items
  const allRecommendations = useMemo(() => {
    const list: string[] = [];
    result.findings.forEach(f => {
      f.recommendations.forEach(r => {
        if (!list.includes(r)) list.push(r);
      });
    });
    return list;
  }, [result.findings]);

  function openFindingEvidence(finding: Finding, evidenceRef?: EvidenceReference) {
    const primaryEvidence = evidenceRef ?? getPrimaryLogEvidence(finding);

    setSelectedEvidence({
      findingId: finding.id,
      line: primaryEvidence?.line,
    });

    if (finding.nodeName) {
      setSelectedNode(finding.nodeName);
    }

    setActiveAnalysisTab('evidence');
  }

  async function copyEvidencePacket() {
    const selectedFinding = selectedEvidence
      ? result.findings.find((finding) => finding.id === selectedEvidence.findingId)
      : null;
    const findings = selectedFinding ? [selectedFinding] : result.findings.filter((finding) => getLogEvidence(finding).length > 0);
    const packet = buildEvidencePacket(findings);

    if (!packet) {
      return;
    }

    await navigator.clipboard.writeText(packet);
    setEvidenceCopied(true);
    window.setTimeout(() => setEvidenceCopied(false), 1400);
  }

  // Pathfinding algorithm (BFS) to trace the risk path from trigger node to root cause failure node
  const riskPathEdges = useMemo(() => {
    if (!result.rootCause || !result.rootCause.nodeName) return new Set<string>();
    const target = result.rootCause.nodeName;

    // Build adjacency list
    const adj = new Map<string, string[]>();
    result.edges.forEach(e => {
      if (!adj.has(e.source)) adj.set(e.source, []);
      adj.get(e.source)!.push(e.target);
    });

    // In-degree computation
    const inDegree = new Map<string, number>();
    result.nodes.forEach(n => inDegree.set(n.name, 0));
    result.edges.forEach(e => {
      inDegree.set(e.target, (inDegree.get(e.target) || 0) + 1);
    });

    // Start nodes are trigger points (in-degree == 0)
    const startNodes = result.nodes.filter(n => inDegree.get(n.name) === 0).map(n => n.name);
    if (startNodes.length === 0 && result.nodes.length > 0) {
      startNodes.push(result.nodes[0].name);
    }

    // Traverse to locate shortest incident vector path
    for (const start of startNodes) {
      const queue: { node: string; path: string[] }[] = [{ node: start, path: [] }];
      const visited = new Set<string>();
      visited.add(start);

      while (queue.length > 0) {
        const { node, path } = queue.shift()!;
        if (node === target) {
          return new Set(path); // Set containing keys like "Webhook->Code"
        }
        const neighbors = adj.get(node) || [];
        for (const next of neighbors) {
          if (!visited.has(next)) {
            visited.add(next);
            queue.push({
              node: next,
              path: [...path, `${node}->${next}`]
            });
          }
        }
      }
    }
    return new Set<string>();
  }, [result]);

  const parsedReport = useMemo(() => {
    const lines = result.clientReport.split('\n');
    let workflowName = "";
    let healthScore = 100;
    let silentRisk = 0;
    const concerns: { severity: Severity; text: string }[] = [];
    const evidence: string[] = [];
    const nextSteps: string[] = [];

    let section: 'none' | 'concerns' | 'evidence' | 'steps' = 'none';

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("Workflow:")) {
        workflowName = trimmed.replace("Workflow:", "").trim();
      } else if (trimmed.startsWith("Automation health:")) {
        const match = trimmed.match(/(\d+)/);
        if (match) healthScore = parseInt(match[1]);
      } else if (trimmed.startsWith("Silent failure risk:")) {
        const match = trimmed.match(/(\d+)/);
        if (match) silentRisk = parseInt(match[1]);
      } else if (trimmed.startsWith("Primary concerns:")) {
        section = 'concerns';
      } else if (trimmed.startsWith("Evidence detected:")) {
        section = 'evidence';
      } else if (trimmed.startsWith("Recommended next steps:")) {
        section = 'steps';
      } else if (trimmed === "") {
        // spacing
      } else if (trimmed.startsWith("-")) {
        if (section === 'concerns') {
          const text = trimmed.replace(/^- \s*/, "");
          const match = text.match(/^\[(CRITICAL|HIGH|MEDIUM|LOW|INFO)\]\s*(.*)$/i);
          if (match) {
            concerns.push({
              severity: match[1].toLowerCase() as Severity,
              text: match[2],
            });
          } else {
            concerns.push({
              severity: 'info',
              text: text,
            });
          }
        } else if (section === 'evidence') {
          evidence.push(trimmed.replace(/^- \s*/, ""));
        } else if (section === 'steps') {
          nextSteps.push(trimmed.replace(/^- \s*/, ""));
        }
      }
    }

    return { workflowName, healthScore, silentRisk, concerns, evidence, nextSteps };
  }, [result.clientReport]);

  const toggleMobileSidebar = () => {
    setMobileSidebarOpen(!mobileSidebarOpen);
    if (!mobileSidebarOpen) {
      setSidebarMode('editors');
    }
  };

  const handleCenterNode = (nodeName: string) => {
    const node = result.nodes.find(n => n.name === nodeName);
    if (!node) return;
    setSelectedNode(nodeName);
    
    const layout = layoutGraph(result.nodes, result.edges);
    const normNode = layout.nodes.find(n => n.name === nodeName);
    if (!normNode) return;

    // Reset zoom scale to 1.0x and position selected node center to SVG coordinate space center (460, 190)
    setZoom(1.0);
    setPan({
      x: 460 - (normNode.x + 70),
      y: 190 - (normNode.y + 34)
    });
  };

  return (
    <main className="shell">
      <header className="headerBar">
        <div className="brand">
          <div className="brandMark">
            <Bug size={16} />
          </div>
          <div>
            <h1>Workflow Black Box</h1>
            <span>Observability Console</span>
          </div>
        </div>

        <section className="statusBar" aria-label="System Metrics Summary">
          <div className="statusItem">
            <span>Health Rating:</span>
            <span className={`statusBadge ${scoreTone(result.healthScore)}`}>
              {result.healthScore}/100
            </span>
          </div>
          <div className="divider" />
          <div className="statusItem">
            <span>Silent Failure Risk:</span>
            <span className={`statusBadge ${riskTone(result.silentFailureRisk)}`}>
              {result.silentFailureRisk}/100
            </span>
          </div>
          <div className="divider" />
          <div className="statusItem">
            <span>Nodes:</span>
            <span className="statusBadge neutral">
              {result.metrics.nodeCount}
            </span>
          </div>
          <div className="divider" />
          <div className="statusItem">
            <span>Blockers:</span>
            <span className="statusBadge danger">
              {result.metrics.criticalCount + result.metrics.highCount}
            </span>
          </div>
        </section>

        <div className="headerControls">
          <button type="button" className="iconButton" title="Load sample workflow" onClick={loadSample}>
            <Sparkles size={14} />
          </button>
          <button type="button" className="iconButton" title="Clear all inputs" onClick={clearInputs}>
            <RotateCcw size={14} />
          </button>
          <button type="button" className="secondaryButton" title="Download markdown report" onClick={downloadReport}>
            <Download size={14} />
            Export
          </button>
          <button type="button" className="primaryButton" title="Copy markdown to clipboard" onClick={copyReport}>
            <ClipboardCopy size={14} />
            {copied ? "Copied" : "Copy Report"}
          </button>
        </div>
      </header>

      {/* Mobile Drawer Trigger Accordion */}
      <div className="mobileInputHeader" onClick={toggleMobileSidebar}>
        <span>Configure Workflow & Logs</span>
        <SlidersHorizontal size={14} />
      </div>

      <section className={`workspaceGrid ${sidebarMode === 'editors' ? 'editors-mode' : ''}`}>
        <aside className={`sidebarPanel ${!mobileSidebarOpen ? 'collapsed-mobile' : ''}`}>
          {sidebarMode === 'summary' ? (
            <div className="sourcesSummary">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                <h3>Configured Sources</h3>
              </div>

              <div className="sourceCard">
                <div className="sourceCardHeader">
                  <span>Workflow JSON</span>
                  <span className={`sourceStatus ${workflowText ? 'loaded' : 'empty'}`}>
                    {workflowText ? 'Loaded' : 'Empty'}
                  </span>
                </div>
                <div className="sourceCardMeta">
                  {workflowText ? `${result.metrics.nodeCount} active nodes` : 'No payload loaded'}
                </div>
              </div>

              <div className="sourceCard">
                <div className="sourceCardHeader">
                  <span>Execution Logs</span>
                  <span className={`sourceStatus ${logText ? 'loaded' : 'empty'}`}>
                    {logText ? 'Loaded' : 'Empty'}
                  </span>
                </div>
                <div className="sourceCardMeta">
                  {logText ? `${logText.length} characters` : 'No log buffer loaded'}
                </div>
              </div>

              <button
                type="button"
                className="secondaryButton"
                style={{ width: '100%', height: '30px', marginTop: '6px' }}
                onClick={() => setSidebarMode('editors')}
              >
                <SlidersHorizontal size={12} />
                Edit Sources
              </button>
            </div>
          ) : (
            <>
              <div className="sidebarHeader">
                <span>Input Editors</span>
                {workflowText && (
                  <button
                    type="button"
                    className="secondaryButton"
                    style={{ height: '22px', fontSize: '10.5px', padding: '0 8px' }}
                    onClick={() => setSidebarMode('summary')}
                  >
                    Minimize
                  </button>
                )}
              </div>
              <div className="tabHeaders">
                <button
                  type="button"
                  className={`tabButton ${activeInputTab === 'workflow' ? 'active' : ''}`}
                  onClick={() => setActiveInputTab('workflow')}
                >
                  <FileJson size={13} />
                  Workflow JSON
                </button>
                <button
                  type="button"
                  className={`tabButton ${activeInputTab === 'logs' ? 'active' : ''}`}
                  onClick={() => setActiveInputTab('logs')}
                >
                  <FileText size={13} />
                  Logs
                </button>
              </div>

              <div className="editorContainer">
                <div
                  className="fileDropZone"
                  onDragEnter={handleDrag}
                  onDragOver={handleDrag}
                  onDragLeave={handleDrag}
                  onDrop={handleDrop}
                >
                  {dragActive && (
                    <div className="dropOverlay">
                      <Upload size={24} />
                      <span>Drop file to load</span>
                    </div>
                  )}

                  {activeInputTab === 'workflow' ? (
                    <>
                      <textarea
                        className="codeInput"
                        placeholder="Paste JSON structure..."
                        spellCheck={false}
                        value={workflowText}
                        onChange={(event) => setWorkflowText(event.target.value)}
                      />
                      <div className="inputActions">
                        <input
                          ref={workflowFileRef}
                          type="file"
                          accept=".json,.txt"
                          hidden
                          onChange={(event) => loadFile(event, "workflow")}
                        />
                        <button type="button" className="secondaryButton" onClick={() => workflowFileRef.current?.click()}>
                          <Upload size={12} />
                          Upload File
                        </button>
                        {workflowText && (
                          <button type="button" className="iconButton" title="Clear input" onClick={() => setWorkflowText("")}>
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <textarea
                        className="codeInput"
                        placeholder="Paste logs contents..."
                        spellCheck={false}
                        value={logText}
                        onChange={(event) => setLogText(event.target.value)}
                      />
                      <div className="inputActions">
                        <input
                          ref={logFileRef}
                          type="file"
                          accept=".log,.txt,.json"
                          hidden
                          onChange={(event) => loadFile(event, "log")}
                        />
                        <button type="button" className="secondaryButton" onClick={() => logFileRef.current?.click()}>
                          <Upload size={12} />
                          Upload File
                        </button>
                        {logText && (
                          <button type="button" className="iconButton" title="Clear input" onClick={() => setLogText("")}>
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </>
          )}
        </aside>

        <section className="contentArea">
          <section className="graphPanel">
            <div className="sectionHeader">
              <PanelTitle icon={<GitBranch size={14} />} title="Execution Map Viewport" />
              <div className="severityLegend">
                <span className="legendDot critical">Critical</span>
                <span className="legendDot high">High</span>
                <span className="legendDot medium">Medium</span>
                <span className="legendDot low">Low</span>
              </div>
            </div>
            
            <div className="mapContainer">
              <div className="graphScrollerWrapper">
                <FlowGraph
                  result={result}
                  selectedNode={selectedNode}
                  onSelectNode={setSelectedNode}
                  riskPathEdges={riskPathEdges}
                  zoom={zoom}
                  pan={pan}
                  setZoom={setZoom}
                  setPan={setPan}
                />
                
                {/* Floating Canvas Toolbar Controls */}
                <div className="canvasToolbar">
                  <button
                    type="button"
                    className="canvasToolbarButton"
                    onClick={() => setZoom(z => Math.min(2.5, z * 1.15))}
                    title="Zoom In"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    className="canvasToolbarButton"
                    onClick={() => setZoom(z => Math.max(0.4, z / 1.15))}
                    title="Zoom Out"
                  >
                    -
                  </button>
                  <button
                    type="button"
                    className="canvasToolbarButton"
                    onClick={() => {
                      setZoom(1.0);
                      setPan({ x: 0, y: 0 });
                    }}
                    title="Fit View"
                  >
                    Fit
                  </button>
                  {result.rootCause?.nodeName && (
                    <button
                      type="button"
                      className="canvasToolbarButton"
                      onClick={() => handleCenterNode(result.rootCause!.nodeName!)}
                      title="Center on root cause failure"
                    >
                      <AlertTriangle size={11} />
                      Center Root Cause
                    </button>
                  )}
                </div>
              </div>

              {selectedNode && (
                <NodeInspector
                  nodeName={selectedNode}
                  node={result.nodes.find(n => n.name === selectedNode)}
                  findings={result.findings.filter(f => f.nodeName === selectedNode)}
                  isRootCause={result.rootCause?.nodeName === selectedNode}
                  onClose={() => setSelectedNode(null)}
                  onFilterFindings={() => {
                    setActiveAnalysisTab('findings');
                  }}
                  onOpenEvidence={openFindingEvidence}
                />
              )}
            </div>
          </section>

          <section className="tabsPanel">
            <header className="tabsPanelHeader">
              <div className="analysisTabs">
                <button
                  type="button"
                  className={`analysisTabButton ${activeAnalysisTab === 'findings' ? 'active' : ''}`}
                  onClick={() => setActiveAnalysisTab('findings')}
                >
                  <ShieldAlert size={14} />
                  Findings
                </button>
                <button
                  type="button"
                  className={`analysisTabButton ${activeAnalysisTab === 'recommendations' ? 'active' : ''}`}
                  onClick={() => setActiveAnalysisTab('recommendations')}
                >
                  <CheckCircle2 size={14} />
                  Checklist ({allRecommendations.length})
                </button>
                <button
                  type="button"
                  className={`analysisTabButton ${activeAnalysisTab === 'evidence' ? 'active' : ''}`}
                  onClick={() => setActiveAnalysisTab('evidence')}
                >
                  <FileText size={14} />
                  Evidence ({evidenceCount})
                </button>
                <button
                  type="button"
                  className={`analysisTabButton ${activeAnalysisTab === 'report' ? 'active' : ''}`}
                  onClick={() => setActiveAnalysisTab('report')}
                >
                  <FileText size={14} />
                  Report
                </button>
              </div>

              {selectedNode && activeAnalysisTab === 'findings' && (
                <span className="filterBadge">
                  Target: {selectedNode}
                  <button type="button" onClick={() => setSelectedNode(null)} title="Clear filter">
                    <X size={10} />
                  </button>
                </span>
              )}
            </header>

            <div className="tabsContent">
              {activeAnalysisTab === 'findings' && (
                <div className="findingsLayout">
                  <div className="rootCauseCol">
                    <div className="rootCauseHeader">Incident Vector</div>
                    {result.rootCause && !selectedNode ? (
                      <div className={`rootCauseCard ${result.rootCause.severity}`}>
                        <strong>{result.rootCause.title}</strong>
                        {result.rootCause.nodeName && <span>@{result.rootCause.nodeName}</span>}
                      </div>
                    ) : (
                      <div className="emptyState" style={{ height: "64px" }}>
                        {selectedNode ? "Node filter active" : "No critical cause detected"}
                      </div>
                    )}
                  </div>
                  <div className="findingsListCol">
                    {filteredFindings.map((finding) => {
                      const primaryEvidence = getPrimaryLogEvidence(finding);

                      return (
                        <div className="findingRow" key={finding.id}>
                          <div>
                            <span className={`severityIndicator ${finding.severity}`}>
                              {severityLabel[finding.severity]}
                            </span>
                          </div>
                          <div className="findingTarget">
                            {finding.nodeName ? `@${finding.nodeName}` : "Global"}
                          </div>
                          <div className="findingDetails">
                            {finding.summary}
                          </div>
                          <div className="findingActions">
                            {primaryEvidence ? (
                              <button
                                type="button"
                                className="evidenceLinkButton"
                                onClick={() => openFindingEvidence(finding, primaryEvidence)}
                                title="Open linked log evidence"
                              >
                                <FileText size={12} />
                                L{primaryEvidence.line}
                              </button>
                            ) : (
                              <span className="structureBadge">Structure</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {!filteredFindings.length && (
                      <div className="emptyState">
                        No active diagnostics for this selection.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {activeAnalysisTab === 'recommendations' && (
                <div className="recommendationsGrid">
                  {allRecommendations.map((recommendation, idx) => (
                    <div className="recommendationItem" key={idx}>
                      <span className="recommendationNum">{String(idx + 1).padStart(2, '0')}.</span>
                      <span className="recommendationText">{recommendation}</span>
                    </div>
                  ))}
                  {allRecommendations.length === 0 && (
                    <div className="emptyState">
                      No immediate checklist items generated.
                    </div>
                  )}
                </div>
              )}

              {activeAnalysisTab === 'evidence' && (
                <EvidencePanel
                  findings={result.findings}
                  logLines={logLines}
                  selectedEvidence={selectedEvidence}
                  selectedNode={selectedNode}
                  copied={evidenceCopied}
                  onOpenEvidence={openFindingEvidence}
                  onCopyEvidence={copyEvidencePacket}
                />
              )}

              {activeAnalysisTab === 'report' && (
                <div className="reportWorkspace">
                  <div className="reportContentArea">
                    {reportTab === 'preview' ? (
                      <div className="reportDocSheet">
                        <div className="reportDocHeader">
                          <h2>Workflow Diagnostic Report</h2>
                          <p>Run against payload structures</p>
                        </div>
                        <div className="reportDocMetrics">
                          <div className="reportDocMetricBox health">
                            <span>Health Score</span>
                            <strong>{parsedReport.healthScore}/100</strong>
                          </div>
                          <div className="reportDocMetricBox risk">
                            <span>Silent Failure Risk</span>
                            <strong>{parsedReport.silentRisk}/100</strong>
                          </div>
                        </div>

                        <div className="reportDocSection">
                          <h3>Risk Elements</h3>
                          {parsedReport.concerns.length > 0 ? (
                            <ul className="reportDocList">
                              {parsedReport.concerns.map((c, idx) => (
                                <li key={idx} className={`reportDocItem ${c.severity}`}>
                                  [{c.severity.toUpperCase()}] {c.text}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <div className="emptyState" style={{ height: "48px" }}>No diagnostic markers.</div>
                          )}
                        </div>

                        <div className="reportDocSection">
                          <h3>Remediation Steps</h3>
                          {parsedReport.nextSteps.length > 0 ? (
                            <ul className="reportDocList">
                              {parsedReport.nextSteps.map((step, idx) => (
                                <li key={idx} className="reportDocItem">
                                  {step}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <div className="emptyState" style={{ height: "48px" }}>Workflow operates within safe margins.</div>
                          )}
                        </div>

                        <div className="reportDocSection">
                          <h3>Evidence</h3>
                          {parsedReport.evidence.length > 0 ? (
                            <ul className="reportDocList">
                              {parsedReport.evidence.map((item, idx) => (
                                <li key={idx} className="reportDocItem evidence">
                                  {item}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <div className="emptyState" style={{ height: "48px" }}>No linked log lines yet.</div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <textarea
                        className="reportText"
                        readOnly
                        value={result.clientReport}
                      />
                    )}
                  </div>

                  <div className="reportSidebarControls">
                    <button
                      type="button"
                      className={`secondaryButton ${reportTab === 'preview' ? 'active' : ''}`}
                      style={{ height: "24px" }}
                      onClick={() => setReportTab('preview')}
                    >
                      Styled Doc
                    </button>
                    <button
                      type="button"
                      className={`secondaryButton ${reportTab === 'raw' ? 'active' : ''}`}
                      style={{ height: "24px" }}
                      onClick={() => setReportTab('raw')}
                    >
                      Raw Markdown
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>
        </section>
      </section>
    </main>
  );
}

function PanelTitle({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="panelTitle">
      {icon}
      <span>{title}</span>
    </div>
  );
}

function FlowGraph({
  result,
  selectedNode,
  onSelectNode,
  riskPathEdges,
  zoom,
  pan,
  setZoom,
  setPan,
}: {
  result: AnalysisResult;
  selectedNode: string | null;
  onSelectNode: (name: string | null) => void;
  riskPathEdges: Set<string>;
  zoom: number;
  pan: { x: number; y: number };
  setZoom: React.Dispatch<React.SetStateAction<number>>;
  setPan: React.Dispatch<React.SetStateAction<{ x: number; y: number }>>;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  if (!result.nodes.length) {
    return <div className="graphEmpty">Provide a workflow JSON to construct map viewport.</div>;
  }

  const graphLayout = layoutGraph(result.nodes, result.edges);
  const normalized = graphLayout.nodes;
  const nodeMap = new Map(normalized.map((node) => [node.name, node]));
  const primaryRootCauseNode = result.rootCause?.nodeName;

  // Zoom on wheel scroll bounds [0.4x, 2.5x]
  const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const scaleFactor = 1.08;
    let newZoom = zoom;
    if (e.deltaY < 0) {
      newZoom = Math.min(2.5, zoom * scaleFactor);
    } else {
      newZoom = Math.max(0.4, zoom / scaleFactor);
    }
    setZoom(newZoom);
  };

  // Mouse drag coordinates tracking
  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (e.button !== 0) return; // Drag on left click only
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!isDragging) return;
    setPan({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y
    });
  };

  const handleMouseUpOrLeave = () => {
    setIsDragging(false);
  };

  // Touch drag tracking for mobile compatibility
  const handleTouchStart = (e: React.TouchEvent<SVGSVGElement>) => {
    if (e.touches.length === 1) {
      setIsDragging(true);
      const touch = e.touches[0];
      setDragStart({ x: touch.clientX - pan.x, y: touch.clientY - pan.y });
    }
  };

  const handleTouchMove = (e: React.TouchEvent<SVGSVGElement>) => {
    if (!isDragging) return;
    const touch = e.touches[0];
    setPan({
      x: touch.clientX - dragStart.x,
      y: touch.clientY - dragStart.y
    });
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
  };

  return (
    <div className="graphScroller">
      <svg
        className="flowGraph"
        viewBox={`0 0 ${graphLayout.width} ${graphLayout.height}`}
        style={{ minWidth: graphLayout.width, height: graphLayout.height }}
        role="img"
        aria-label="Workflow graph"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUpOrLeave}
        onMouseLeave={handleMouseUpOrLeave}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={() => onSelectNode(null)}
      >
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#475569" />
          </marker>
        </defs>
        
        {/* Transform Group wraps nodes and edges to perform smooth pan/zoom */}
        <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
          {result.edges.map((edge, index) => {
            const source = nodeMap.get(edge.source);
            const target = nodeMap.get(edge.target);
            if (!source || !target) {
              return null;
            }
            const pathData = `M ${source.x + 140} ${source.y + 34} C ${source.x + 190} ${source.y + 34}, ${target.x - 50} ${target.y + 34}, ${target.x} ${target.y + 34}`;
            const isSourceOrTargetSelected = selectedNode === edge.source || selectedNode === edge.target;
            const isRiskPath = riskPathEdges.has(`${edge.source}->${edge.target}`);
            
            return (
              <g key={`${edge.source}-${edge.target}-${index}`}>
                <path
                  className={`edge ${isSourceOrTargetSelected ? "active" : ""} ${isRiskPath ? "risk-path" : ""}`}
                  d={pathData}
                />
                <path
                  className={`edge-glow ${isRiskPath ? "risk-path" : ""}`}
                  d={pathData}
                />
              </g>
            );
          })}
          {normalized.map((node) => {
            const isRootCause = primaryRootCauseNode === node.name;
            return (
              <g
                className={`graphNode ${node.risk} ${selectedNode === node.name ? "selected" : ""} ${isRootCause ? "root-cause" : ""}`}
                key={node.id}
                transform={`translate(${node.x}, ${node.y})`}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectNode(selectedNode === node.name ? null : node.name);
                }}
              >
                {/* Highlight root cause node visually */}
                {isRootCause && (
                  <g transform="translate(30, -14)">
                    <rect width="80" height="12" rx="3" className="rootCauseBadgeBg" />
                    <text x="40" y="9" textAnchor="middle" className="rootCauseBadgeText">ROOT CAUSE</text>
                  </g>
                )}
                <rect width="140" height="68" rx="6" className="bg" />
                <foreignObject x="10" y="15" width="38" height="38">
                  <div className={`nodeIconBox ${getNodeIconTone(node.type)}`}>
                    {getNodeIcon(node.type)}
                  </div>
                </foreignObject>
                <text x="56" y="28" className="nodeNameText">
                  {truncate(node.name, 11)}
                </text>
                <text x="56" y="44" className="nodeTypeText">
                  {shortType(node.type)}
                </text>
                <circle cx="128" cy="12" r="4.5" className={`nodeStatusDot ${node.risk}`} />
              </g>
            );
          })}
        </g>
      </svg>
      <div className="swipeIndicator">Swipe to pan graph</div>
    </div>
  );
}

function NodeInspector({
  nodeName,
  node,
  findings,
  isRootCause,
  onClose,
  onFilterFindings,
  onOpenEvidence,
}: {
  nodeName: string;
  node?: FlowNode;
  findings: Finding[];
  isRootCause: boolean;
  onClose: () => void;
  onFilterFindings: () => void;
  onOpenEvidence: (finding: Finding, evidenceRef?: EvidenceReference) => void;
}) {
  const recommendations = useMemo(() => {
    const list = findings.flatMap((f) => f.recommendations);
    return list.slice(0, 2); // Show top 2 recommendations
  }, [findings]);

  return (
    <div className="nodeInspector">
      <div className="inspectorHeader">
        <div>
          <h3>Node Inspector</h3>
          <span className="inspectorName">@{nodeName}</span>
        </div>
        <button type="button" className="iconButton" onClick={onClose} title="Close inspector">
          <X size={12} />
        </button>
      </div>

      <div className="inspectorSection">
        <h4>Severity Status</h4>
        <div className="inspectorMetaRow">
          <span>Risk Level:</span>
          <strong className={node?.risk || "info"}>
            {node?.risk ? severityLabel[node.risk] : "Info"}
          </strong>
        </div>
        {isRootCause && (
          <div className="inspectorMetaRow" style={{ borderColor: 'var(--color-critical-border)', background: 'var(--color-critical-bg)' }}>
            <span style={{ color: 'var(--color-critical)' }}>Incident Vector:</span>
            <strong className="critical">Primary Cause</strong>
          </div>
        )}
      </div>

      <div className="inspectorSection">
        <h4>Diagnostics ({findings.length})</h4>
        {findings.length > 0 ? (
          findings.map((f) => {
            const primaryEvidence = getPrimaryLogEvidence(f);

            return (
              <div className="inspectorFindingCard" key={f.id}>
                <strong>[{severityLabel[f.severity]}]</strong> {f.summary}
                {primaryEvidence && (
                  <button
                    type="button"
                    className="inspectorEvidenceButton"
                    onClick={() => onOpenEvidence(f, primaryEvidence)}
                  >
                    <FileText size={11} />
                    Open evidence L{primaryEvidence.line}
                  </button>
                )}
              </div>
            );
          })
        ) : (
          <div className="emptyState" style={{ height: "48px", fontSize: "10.5px" }}>
            No diagnostics reported.
          </div>
        )}
      </div>

      {recommendations.length > 0 && (
        <div className="inspectorSection">
          <h4>Recommended Fixes</h4>
          <div className="inspectorFixText">
            {recommendations.map((r, idx) => (
              <div key={idx} style={{ marginBottom: idx > 0 ? "6px" : "0" }}>
                • {r}
              </div>
            ))}
          </div>
        </div>
      )}

      <button
        type="button"
        className="secondaryButton"
        style={{ width: '100%', height: '26px', marginTop: '4px' }}
        onClick={onFilterFindings}
      >
        Filter Findings
      </button>
    </div>
  );
}

function EvidencePanel({
  findings,
  logLines,
  selectedEvidence,
  selectedNode,
  copied,
  onOpenEvidence,
  onCopyEvidence,
}: {
  findings: Finding[];
  logLines: LogLineView[];
  selectedEvidence: EvidenceSelection;
  selectedNode: string | null;
  copied: boolean;
  onOpenEvidence: (finding: Finding, evidenceRef?: EvidenceReference) => void;
  onCopyEvidence: () => void;
}) {
  const selectedLineRef = useRef<HTMLDivElement | null>(null);
  const findingsWithEvidence = useMemo(
    () => findings.filter((finding) => getLogEvidence(finding).length > 0),
    [findings],
  );
  const selectedFinding =
    findingsWithEvidence.find((finding) => finding.id === selectedEvidence?.findingId) ?? findingsWithEvidence[0];
  const selectedRefs = selectedFinding ? getLogEvidence(selectedFinding) : [];
  const selectedLine = selectedEvidence?.line ?? selectedRefs[0]?.line;
  const selectedLineSet = new Set(selectedRefs.map((ref) => ref.line).filter(Boolean));
  const hasLogs = logLines.some((line) => line.text.trim());

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      selectedLineRef.current?.scrollIntoView({ behavior: "auto", block: "center" });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [selectedFinding?.id, selectedLine]);

  if (!hasLogs) {
    return (
      <div className="emptyState evidenceEmpty">
        Load execution logs to link findings with concrete evidence.
      </div>
    );
  }

  if (!findingsWithEvidence.length) {
    return (
      <div className="evidenceWorkspace single">
        <div className="logEvidenceViewer">
          <div className="logViewerHeader">
            <div>
              <strong>Execution Log</strong>
              <span>No high-confidence evidence links were detected.</span>
            </div>
          </div>
          <div className="logLines">
            {logLines.map((line) => (
              <div className="logLine" key={line.lineNumber}>
                <span className="logLineNumber">{line.lineNumber}</span>
                <code>{line.text || " "}</code>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="evidenceWorkspace">
      <aside className="evidenceIndex">
        <div className="evidenceToolbar">
          <div>
            <strong>{findingsWithEvidence.length} linked findings</strong>
            <span>{selectedNode ? `Map synced @${selectedNode}` : "Map sync enabled"}</span>
          </div>
          <button type="button" className="secondaryButton" onClick={onCopyEvidence}>
            <ClipboardCopy size={12} />
            {copied ? "Copied" : "Copy"}
          </button>
        </div>

        <div className="evidenceCards">
          {findingsWithEvidence.map((finding) => {
            const refs = getLogEvidence(finding);
            const active = finding.id === selectedFinding?.id;

            return (
              <div className={`evidenceCard ${active ? "active" : ""}`} key={finding.id}>
                <button
                  type="button"
                  className="evidenceCardMain"
                  onClick={() => onOpenEvidence(finding, refs[0])}
                >
                  <span className={`severityIndicator ${finding.severity}`}>
                    {severityLabel[finding.severity]}
                  </span>
                  <strong>{finding.title}</strong>
                  <small>{finding.nodeName ? `@${finding.nodeName}` : "Global"} · {finding.confidence}% confidence</small>
                </button>
                <div className="evidenceRefs">
                  {refs.map((ref) => (
                    <button
                      type="button"
                      className={`logLinePill ${selectedLine === ref.line ? "active" : ""}`}
                      key={`${finding.id}-${ref.line}-${ref.text}`}
                      onClick={() => onOpenEvidence(finding, ref)}
                      title={ref.text}
                    >
                      L{ref.line}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </aside>

      <div className="logEvidenceViewer">
        <div className="logViewerHeader">
          <div>
            <strong>{selectedFinding?.title ?? "Execution Log"}</strong>
            <span>{selectedLine ? `Focused on log line ${selectedLine}` : "Choose evidence to focus a line"}</span>
          </div>
          {selectedFinding?.nodeName && <span className="logViewerNode">@{selectedFinding.nodeName}</span>}
        </div>

        <div className="logLines">
          {logLines.map((line) => {
            const isSelected = selectedLine === line.lineNumber;
            const isRelated = selectedLineSet.has(line.lineNumber);
            const isContext = selectedLine ? Math.abs(line.lineNumber - selectedLine) <= 2 : false;

            return (
              <div
                ref={isSelected ? selectedLineRef : null}
                className={`logLine ${isSelected ? "selected" : ""} ${isRelated ? "related" : ""} ${isContext ? "context" : ""}`}
                key={line.lineNumber}
              >
                <span className="logLineNumber">{line.lineNumber}</span>
                <code>{line.text || " "}</code>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function layoutGraph(nodes: FlowNode[], edges: FlowEdge[]): { nodes: FlowNode[]; width: number; height: number } {
  if (!nodes.length) return { nodes: [], width: 920, height: 380 };

  const nodeWidth = 140;
  const nodeHeight = 68;
  const nodeNames = new Set(nodes.map((node) => node.name));
  const validEdges = edges.filter((edge) => nodeNames.has(edge.source) && nodeNames.has(edge.target));
  const connectedNames = new Set(validEdges.flatMap((edge) => [edge.source, edge.target]));
  const nodeByName = new Map(nodes.map((node) => [node.name, node]));
  const levels = new Map<string, number>();

  const outgoing = new Map<string, string[]>();
  const indegree = new Map<string, number>();

  for (const node of nodes) {
    if (connectedNames.has(node.name)) {
      outgoing.set(node.name, []);
      indegree.set(node.name, 0);
    }
  }

  for (const edge of validEdges) {
    outgoing.get(edge.source)?.push(edge.target);
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  }

  const queue = nodes
    .filter((node) => connectedNames.has(node.name) && (indegree.get(node.name) ?? 0) === 0)
    .sort(compareOriginalPosition)
    .map((node) => node.name);

  for (const name of queue) {
    levels.set(name, 0);
  }

  while (queue.length) {
    const current = queue.shift()!;
    const currentLevel = levels.get(current) ?? 0;

    for (const target of outgoing.get(current) ?? []) {
      levels.set(target, Math.max(levels.get(target) ?? 0, currentLevel + 1));
      indegree.set(target, (indegree.get(target) ?? 0) - 1);

      if ((indegree.get(target) ?? 0) === 0) {
        queue.push(target);
      }
    }
  }

  const positionedConnected = [...levels.keys()].length;
  const baseLevelCount = Math.max(1, Math.max(0, ...levels.values()) + 1);
  const minX = Math.min(...nodes.map((node) => node.x));
  const maxX = Math.max(...nodes.map((node) => node.x));
  const spanX = Math.max(1, maxX - minX);

  for (const node of nodes) {
    if (levels.has(node.name)) {
      continue;
    }

    if (connectedNames.has(node.name)) {
      const rank = [...connectedNames].filter((name) => !levels.has(name)).indexOf(node.name);
      levels.set(node.name, baseLevelCount + Math.max(0, rank));
      continue;
    }

    const originalBucket = Math.round(((node.x - minX) / spanX) * Math.max(1, baseLevelCount - 1));
    levels.set(node.name, positionedConnected ? originalBucket : Math.floor(nodes.indexOf(node) / 4));
  }

  const groups = new Map<number, FlowNode[]>();
  for (const node of nodes) {
    const level = levels.get(node.name) ?? 0;
    groups.set(level, [...(groups.get(level) ?? []), node]);
  }

  const orderedLevels = [...groups.keys()].sort((a, b) => a - b);
  const levelToColumn = new Map(orderedLevels.map((level, index) => [level, index]));
  const maxRows = Math.max(1, ...orderedLevels.map((level) => groups.get(level)?.length ?? 1));
  const compact = nodes.length <= 8 && maxRows <= 2;
  const xGap = compact ? 155 : 230;
  const yGap = compact ? 88 : 98;
  const width = compact ? 920 : Math.max(920, 160 + nodeWidth + Math.max(0, orderedLevels.length - 1) * xGap);
  const marginX = compact ? Math.max(56, (width - (nodeWidth + Math.max(0, orderedLevels.length - 1) * xGap)) / 2) : 80;
  const marginY = compact ? 110 : 58;
  const laidOut: FlowNode[] = [];

  for (const level of orderedLevels) {
    const group = groups.get(level)!.sort(compareOriginalPosition);
    const column = levelToColumn.get(level) ?? 0;

    group.forEach((node, row) => {
      laidOut.push({
        ...node,
        x: marginX + column * xGap,
        y: marginY + row * yGap,
      });
    });
  }

  const maxColumn = Math.max(0, ...laidOut.map((node) => Math.round((node.x - marginX) / xGap)));

  return {
    nodes: laidOut.sort((a, b) => nodes.indexOf(nodeByName.get(a.name) ?? a) - nodes.indexOf(nodeByName.get(b.name) ?? b)),
    width: Math.max(width, marginX * 2 + nodeWidth + maxColumn * xGap),
    height: Math.max(380, marginY * 2 + nodeHeight + (maxRows - 1) * yGap),
  };
}

function compareOriginalPosition(a: FlowNode, b: FlowNode): number {
  return a.x - b.x || a.y - b.y || a.name.localeCompare(b.name);
}

function getLogEvidence(finding: Finding): EvidenceReference[] {
  return (finding.evidenceRefs ?? []).filter((ref) => ref.source === "logs" && typeof ref.line === "number");
}

function getPrimaryLogEvidence(finding: Finding): EvidenceReference | undefined {
  return getLogEvidence(finding)[0];
}

function buildEvidencePacket(findings: Finding[]): string {
  return findings
    .flatMap((finding) =>
      getLogEvidence(finding).map((ref) =>
        [
          `[${severityLabel[finding.severity]}] ${finding.title}`,
          `Node: ${ref.nodeName ?? finding.nodeName ?? "Global"}`,
          `Evidence: L${ref.line} ${ref.text}`,
          "",
        ].join("\n"),
      ),
    )
    .join("\n")
    .trim();
}

function scoreTone(score: number): "good" | "warn" | "danger" | "neutral" {
  if (score >= 75) return "good";
  if (score >= 45) return "warn";
  return "danger";
}

// Fixed warning label matching
function riskTone(score: number): "good" | "warn" | "danger" | "neutral" {
  if (score >= 65) return "danger";
  if (score >= 30) return "warn";
  return "good";
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}

function shortType(type: string): string {
  const parts = type.split(".");
  const name = parts[parts.length - 1] || type;
  return truncate(name.replace("n8n-nodes-base.", ""), 11);
}
