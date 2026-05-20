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
  X,
  Trash2,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  Info,
  CheckCircle2,
  SlidersHorizontal,
} from "lucide-react";
import { ChangeEvent, ReactNode, useMemo, useRef, useState } from "react";
import { analyzeAutomation, AnalysisResult, Finding, FlowNode, Severity } from "./lib/analyzer";
import { sampleLog, sampleWorkflow } from "./samples";

const severityLabel: Record<Severity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  info: "Info",
};

function getNodeIcon(type: string) {
  const t = type.toLowerCase();
  if (t.includes("webhook")) return <Webhook size={14} />;
  if (t.includes("code")) return <Code size={14} />;
  if (t.includes("httprequest") || t.includes("http")) return <Globe size={14} />;
  if (t.includes("openai") || t.includes("langchain") || t.includes("ai")) return <Sparkles size={14} />;
  if (t.includes("hubspot") || t.includes("salesforce") || t.includes("stripe") || t.includes("quickbooks")) {
    return <Database size={14} />;
  }
  return <Terminal size={14} />;
}

export function App() {
  const [workflowText, setWorkflowText] = useState(sampleWorkflow);
  const [logText, setLogText] = useState(sampleLog);
  const [copied, setCopied] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [activeInputTab, setActiveInputTab] = useState<'workflow' | 'logs'>('workflow');
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [reportTab, setReportTab] = useState<'preview' | 'raw'>('preview');
  const [activeAnalysisTab, setActiveAnalysisTab] = useState<'findings' | 'recommendations' | 'report'>('findings');
  
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
    setSidebarMode('summary');
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }

  function clearInputs() {
    setWorkflowText("");
    setLogText("");
    setSelectedNode(null);
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
    const nextSteps: string[] = [];

    let section: 'none' | 'concerns' | 'steps' = 'none';

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
        } else if (section === 'steps') {
          nextSteps.push(trimmed.replace(/^- \s*/, ""));
        }
      }
    }

    return { workflowName, healthScore, silentRisk, concerns, nextSteps };
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
    
    const normalized = normalizeGraph(result.nodes);
    const normNode = normalized.find(n => n.name === nodeName);
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
                    {filteredFindings.map((finding) => (
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
                      </div>
                    ))}
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

  const normalized = normalizeGraph(result.nodes);
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
        viewBox="0 0 920 380"
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
                  <div className="nodeIconBox">
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
}: {
  nodeName: string;
  node?: FlowNode;
  findings: Finding[];
  isRootCause: boolean;
  onClose: () => void;
  onFilterFindings: () => void;
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
          findings.map((f) => (
            <div className="inspectorFindingCard" key={f.id}>
              <strong>[{severityLabel[f.severity]}]</strong> {f.summary}
            </div>
          ))
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

function normalizeGraph(nodes: FlowNode[]): FlowNode[] {
  if (!nodes.length) return [];
  const minX = Math.min(...nodes.map((node) => node.x));
  const maxX = Math.max(...nodes.map((node) => node.x));
  const minY = Math.min(...nodes.map((node) => node.y));
  const maxY = Math.max(...nodes.map((node) => node.y));
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);

  // Spreads nodes evenly and centers them vertically inside the viewport (height range 110 to 250)
  return nodes.map((node) => {
    const normX = spanX === 0 ? 0.5 : (node.x - minX) / spanX;
    const normY = spanY === 0 ? 0.5 : (node.y - minY) / spanY;
    return {
      ...node,
      x: 80 + normX * 640,
      y: 110 + normY * 140, // Perfectly centers vertically in a 380px viewBox
    };
  });
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
