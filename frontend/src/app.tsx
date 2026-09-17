import { memo, useCallback, useEffect, useMemo, useState, type ReactElement, type ReactNode } from "react";
import type { EvidenceMetadata, IncidentDossier, IncidentRecord, ProofActivity, ProtocolConfig, ProtectedDemoState } from "./models";
import { FINAL_DEPLOYMENT } from "./config/finalDeployment";
import { hasSentinelDeployment, readDashboard, readIncident, readIncidentDossier, readProofActivity, readProtectedDemoState, readProtocol } from "./lib/app-data";
import { GENLAYER_CHAIN_NAME, getEthereumProvider, sentinelClientConfig, switchWalletToGenLayerNetwork } from "./lib/genlayer-client";
import { mapIncidentStateToLabel } from "./lib/decoders";
import { StudioNextTransaction, studioNextOperationId } from "./lib/StudioNextTransaction";
import { LocalStoragePendingTransactionStore } from "./lib/transaction-lifecycle";
import { normalizeUserError, presentUserError, type UserErrorTone, type UserFacingError } from "./lib/user-errors";
import "./styles.css";
import "./redesign.css";

const LIFECYCLE = [
  ["NORMAL", "Normal"],
  ["ASSESSING", "Assessing"],
  ["ACTIVE_INCIDENT", "Active incident"],
  ["PAUSED", "Paused"],
  ["RECOVERY_ASSESSING", "Recovery assessing"],
  ["RECOVERY_AUTHORIZED", "Recovery authorized"],
  ["RECOVERED", "Recovered"],
] as const;

type Tone = "good" | "danger" | "warn" | "muted";

function short(value: string | null | undefined, start = 8, end = 6): string {
  if (!value) return "—";
  return value.length > start + end + 1 ? `${value.slice(0, start)}…${value.slice(-end)}` : value;
}

function time(timestamp: number): string {
  return timestamp ? new Date(timestamp * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "Not recorded";
}

function tone(value: string): Tone {
  if (["RECOVERED", "SAFE_TO_RECOVER", "NORMAL", "FINISHED_WITH_RETURN", "FINALIZED"].includes(value)) return "good";
  if (["ACTIVE_INCIDENT", "PAUSED", "FINISHED_WITH_ERROR", "FAILED"].includes(value)) return "danger";
  if (["ASSESSING", "RECOVERY_ASSESSING", "RECOVERY_AUTHORIZED", "PENDING"].includes(value)) return "warn";
  return "muted";
}

function explorer(hash: string): string { return `${FINAL_DEPLOYMENT.explorerBaseUrl}${hash}`; }

function Link({ href, children, external = false }: { href: string; children: ReactNode; external?: boolean }): ReactElement {
  return <a className="text-link" href={href} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined}>{children}</a>;
}

function CopyButton({ value }: { value: string }): ReactElement {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };
  return <button className="copy-button" type="button" onClick={() => void copy()} aria-label={`Copy ${value}`}>{copied ? "Copied" : "Copy"}</button>;
}

function Badge({ children, value }: { children: ReactNode; value?: string }): ReactElement {
  return <span className={`badge badge-${tone(value ?? String(children))}`}>{children}</span>;
}

function Fact({ label, value, mono = false, copy = false, copyValue }: { label: string; value: ReactNode; mono?: boolean; copy?: boolean; copyValue?: string }): ReactElement {
  const raw = typeof value === "string" ? value : null;
  return <div className="fact"><dt>{label}</dt><dd><span className={mono ? "fact-value mono technical-value" : "fact-value"} title={mono && raw ? raw : undefined}>{value}</span>{copy && (copyValue ?? raw) ? <CopyButton value={copyValue ?? raw ?? ""} /> : null}</dd></div>;
}

const WalletButton = memo(function WalletButton(): ReactElement {
  const [account, setAccount] = useState<string | null>(null);
  const [label, setLabel] = useState("Connect wallet");
  const [wrongChain, setWrongChain] = useState(false);
  const [status, setStatus] = useState<UserFacingError | null>(null);
  const chainNumber = (value: unknown): number | null => typeof value === "string" ? Number.parseInt(value, value.startsWith("0x") ? 16 : 10) : null;
  const connect = async () => {
    const provider = getEthereumProvider();
    if (!provider) { setStatus(normalizeUserError(new Error("Wallet unavailable."), "wallet")); setLabel("Connect wallet"); return; }
    try {
      const accounts = await provider.request({ method: "eth_requestAccounts" });
      if (!Array.isArray(accounts) || typeof accounts[0] !== "string") throw new Error("Wallet approval returned no account.");
      let chain = chainNumber(await provider.request({ method: "eth_chainId" }));
      if (chain !== sentinelClientConfig.chainId) { await switchWalletToGenLayerNetwork(provider); chain = chainNumber(await provider.request({ method: "eth_chainId" })); }
      setAccount(accounts[0]); setWrongChain(chain !== sentinelClientConfig.chainId); setLabel(chain === sentinelClientConfig.chainId ? "Wallet ready" : "Switch to Studio Next"); setStatus(chain === sentinelClientConfig.chainId ? null : normalizeUserError(new Error("Wrong network."), "wallet"));
    } catch (error) { const next = normalizeUserError(error, "wallet"); setStatus(next); setLabel(next.title); }
  };
  useEffect(() => {
    const provider = getEthereumProvider();
    if (!provider) return;
    const accountsChanged = (value: unknown) => { const next = Array.isArray(value) && typeof value[0] === "string" ? value[0] : null; setAccount(next); if (!next) setLabel("Connect wallet"); };
    const chainChanged = (value: unknown) => { const isCorrect = chainNumber(value) === sentinelClientConfig.chainId; setWrongChain(!isCorrect); setLabel(isCorrect ? "Wallet ready" : "Switch to Studio Next"); setStatus(isCorrect ? null : normalizeUserError(new Error("Wrong network."), "wallet")); };
    void Promise.all([provider.request({ method: "eth_accounts" }), provider.request({ method: "eth_chainId" })]).then(([accounts, chain]) => { accountsChanged(accounts); chainChanged(chain); }).catch(() => undefined);
    provider.on?.("accountsChanged", accountsChanged);
    provider.on?.("chainChanged", chainChanged);
    return () => { provider.removeListener?.("accountsChanged", accountsChanged); provider.removeListener?.("chainChanged", chainChanged); };
  }, []);
  return <span className="wallet-control"><button className="wallet-button" type="button" onClick={() => void connect()} title={status?.message ?? "Connect a wallet when a write requires approval."}><span className={`connection-dot ${account && !wrongChain ? "online" : ""}`} />{wrongChain ? "Switch to Studio Next" : account ? short(account) : label}</button>{status ? <span className={`wallet-status wallet-${status.tone}`} role="status">{status.title}</span> : null}</span>;
});

const PRIMARY_NAV = [
  ["Home", "/app", "home"],
  ["Protocols", "/app/protocols", "protocols"],
  ["Incidents", "/app/incidents", "incidents"],
  ["Activity", "/app/activity", "activity"],
] as const;

const SECONDARY_NAV = [
  ["Proof & Security", "/transparency", "shield"],
  ["Integrate / Docs", "/developer", "code"],
] as const;

type NavIconName = "home" | "protocols" | "incidents" | "activity" | "shield" | "code" | "menu";

function NavIcon({ name, size = 16 }: { name: NavIconName; size?: number }): ReactElement {
  const common = { width: size, height: size, viewBox: "0 0 20 20", fill: "none", stroke: "currentColor", strokeWidth: 1.55, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (name === "home") return <svg {...common}><path d="m3.25 9.2 6.75-5.7 6.75 5.7" /><path d="M5.2 8.5v7.2h9.6V8.5M8.2 15.7v-4.2h3.6v4.2" /></svg>;
  if (name === "protocols") return <svg {...common}><rect x="3.2" y="3.2" width="5.2" height="5.2" rx=".6" /><rect x="11.6" y="3.2" width="5.2" height="5.2" rx=".6" /><rect x="3.2" y="11.6" width="5.2" height="5.2" rx=".6" /><rect x="11.6" y="11.6" width="5.2" height="5.2" rx=".6" /></svg>;
  if (name === "incidents") return <svg {...common}><path d="M10 2.8 16 5v4.1c0 3.6-2.4 6.4-6 8.1-3.6-1.7-6-4.5-6-8.1V5l6-2.2Z" /><path d="M10 6.3v4.1M10 13.3h.01" /></svg>;
  if (name === "activity") return <svg {...common}><path d="M2.7 10h3.1l1.8-4.4 3.2 8.8 2-5.2h4.5" /></svg>;
  if (name === "shield") return <svg {...common}><path d="M10 2.8 16 5v4.1c0 3.6-2.4 6.4-6 8.1-3.6-1.7-6-4.5-6-8.1V5l6-2.2Z" /><path d="m7.1 10 1.8 1.8 4-4" /></svg>;
  if (name === "code") return <svg {...common}><path d="m7 5.4-4.2 4.6L7 14.6M13 5.4l4.2 4.6-4.2 4.6M11.4 3.7 8.6 16.3" /></svg>;
  if (name === "menu") return <svg {...common}><path d="M3.5 5.5h13M3.5 10h13M3.5 14.5h13" /></svg>;
  return <svg {...common}><circle cx="10" cy="10" r="6.5" /></svg>;
}

const AppHeader = memo(function AppHeader({ pathname, mobileOpen, onToggle, onClose }: { pathname: string; mobileOpen: boolean; onToggle: () => void; onClose: () => void }): ReactElement {
  const active = (href: string) => href === "/app" ? pathname === href : pathname.startsWith(href);
  return <header className="app-header">
    <div className="app-header-brand"><button className="icon-button mobile-menu" type="button" aria-label="Open navigation" aria-expanded={mobileOpen} onClick={onToggle}><NavIcon name="menu" /></button><a className="brand app-brand" href="/app" onClick={onClose} aria-label="Sentinel command center"><img className="brand-mark-image" src="/sentinel-sites-mark.png" alt="" /><img className="brand-wordmark" src="/sentinel-sites-wordmark.png" alt="Sentinel. Always Ahead" /></a></div>
    <nav className={`app-nav ${mobileOpen ? "mobile-open" : ""}`} aria-label="Application navigation">
      <div className="app-nav-group app-nav-primary">{PRIMARY_NAV.map(([label, href, icon]) => <a key={href} className={`app-nav-link ${active(href) ? "active" : ""}`} href={href} onClick={onClose}><span className="nav-glyph"><NavIcon name={icon} size={15} /></span><span>{label}</span></a>)}</div>
      <span className="app-nav-divider" aria-hidden="true" />
      <div className="app-nav-group app-nav-secondary">{SECONDARY_NAV.map(([label, href, icon]) => <a key={href} className={`app-nav-link ${active(href) ? "active" : ""}`} href={href} onClick={onClose}><span className="nav-glyph"><NavIcon name={icon} size={14} /></span><span>{label}</span></a>)}</div>
    </nav>
    <div className="app-header-tools"><div className="app-network-chip" title={`Connected to Studio Next · Chain ${sentinelClientConfig.chainId}`}><span className="network-dot online" /><span><strong>Studio Next</strong><small>{sentinelClientConfig.chainId}</small></span></div><WalletButton /></div>
  </header>;
});

function Shell({ children }: { children: ReactElement }): ReactElement {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = window.location.pathname.replace(/\/+$/, "") || "/";
  const closeMobile = useCallback(() => { setMobileOpen(false); }, []);
  const toggleMobile = useCallback(() => { setMobileOpen((value) => !value); }, []);
  return <div className="app-shell console-shell">
    <AppHeader pathname={pathname} mobileOpen={mobileOpen} onToggle={toggleMobile} onClose={closeMobile} />
    <div className="main-shell"><main>{children}</main><footer className="site-footer"><div><strong>Sentinel.</strong><span>Autonomous protocol security</span></div><nav aria-label="Footer navigation"><a href="/transparency">Proof &amp; Security</a><a href="/developer">Integrate / Docs</a></nav><span>Target state is always verified from ProtectedDemo</span></footer></div>
    {mobileOpen ? <button className="drawer-backdrop mobile-backdrop" type="button" aria-label="Close navigation" onClick={closeMobile} /> : null}
  </div>;
}

function PageIntro({ kicker, title, body, action }: { kicker: string; title: string; body: string; action?: ReactNode }): ReactElement {
  return <section className="page-intro page-width"><div><p className="eyebrow">{kicker}</p><h1>{title}</h1><p>{body}</p></div>{action ? <div className="intro-action">{action}</div> : null}</section>;
}

function Metric({ label, value, detail, emphasis }: { label: string; value: ReactNode; detail: string; emphasis?: Tone }): ReactElement {
  return <article className={`metric ${emphasis ? `metric-${emphasis}` : ""}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function LoadingPage(): ReactElement { return <div className="page-width loading-state" aria-label="Reading finalized Studio Next state"><div className="loading-rule"><span /><span /><span /></div><div className="loading-columns"><span /><span /><span /></div><small>Reading finalized Studio Next state…</small></div>; }
function Notice({ error, children, title, tone = "information" }: { error?: UserFacingError; children?: ReactNode; title?: string; tone?: UserErrorTone }): ReactElement {
  const next = error ? presentUserError(error) : undefined;
  const noticeTone = next?.tone ?? tone;
  return <div className={`notice-inline notice-${noticeTone}`} role={noticeTone === "error" ? "alert" : "status"} aria-live="polite"><div><strong>{next?.title ?? title ?? "Sentinel"}</strong><p>{next?.message ?? children}</p>{next?.action ? <small className="notice-action">{next.action}</small> : null}</div>{next?.technical ? <details><summary>Technical details</summary><code>{next.technical}</code></details> : null}</div>;
}

function ProofLink({ hash }: { hash: string }): ReactElement { return <span className="hash-line"><a className="mono" href={explorer(hash)} target="_blank" rel="noreferrer">{short(hash, 12, 8)}</a><CopyButton value={hash} /></span>; }

function Lifecycle({ state }: { state: string }): ReactElement {
  const index = Math.max(0, LIFECYCLE.findIndex(([key]) => key === state));
  return <div className="lifecycle" aria-label={`Lifecycle current state ${state}`}>{LIFECYCLE.map(([key, label], step) => <div className={`lifecycle-step ${step < index ? "complete" : step === index ? "current" : ""}`} key={key}><span>{String(step + 1).padStart(2, "0")}</span><div><strong>{label}</strong><small>{step < index ? "Verified" : step === index ? "Current state" : "Not reached"}</small></div></div>)}</div>;
}

function ProtocolCard({ protocol, target }: { protocol: ProtocolConfig; target: ProtectedDemoState | null }): ReactElement {
  const status = target?.paused ? "Emergency pause active" : target?.remediated ? "Recovered / remediation retained" : "Protected";
  return <a className="data-card protocol-card" href={`/app/protocols/${protocol.protocolId ?? FINAL_DEPLOYMENT.protocolId}`}><div className="card-topline"><div><p className="eyebrow">PROTECTED PROTOCOL</p><h2>{protocol.protocolId}</h2></div><Badge value={target?.paused ? "PAUSED" : "RECOVERED"}>{status}</Badge></div><p className="mono address-line">{short(protocol.targetAddress)} <span className="verified-mark">✓</span></p><div className="card-meta"><span>{protocol.criticalFailureClass}</span><span>{protocol.minimumSources} source quorum</span><span>{protocol.policyLocked ? "Policy locked" : "Setup incomplete"}</span></div></a>;
}

function IncidentRow({ incident }: { incident: IncidentRecord }): ReactElement {
  return <a className="incident-row" href={`/app/incidents/${incident.incidentId ?? ""}`}><span className={`state-dot ${tone(incident.state)}`} /><span className="incident-main"><strong>{incident.incidentId}</strong><small>{incident.protocolId} · {time(incident.openedAt)}</small></span><Badge value={incident.state}>{mapIncidentStateToLabel(incident.state)}</Badge><span className="verdict-text">{incident.recoveryVerdict !== "INCONCLUSIVE" ? incident.recoveryVerdict : incident.incidentVerdict}</span></a>;
}

function useDashboard() {
  const [data, setData] = useState<{ protocol: ProtocolConfig | null; incidents: IncidentRecord[]; target: ProtectedDemoState | null } | null>(null);
  useEffect(() => { let active = true; void readDashboard().then((next) => { if (active) setData(next); }).catch(() => undefined); return () => { active = false; }; }, []);
  return { data, loading: !data };
}

const LANDING_FEATURES = [
  ["01", "Detect", "The protected protocol defines the critical failure class and the evidence sources that can open a response."],
  ["02", "Verify", "Source, domain, digest, target association, freshness, and evidence identity are authenticated before judgment."],
  ["03", "Contain", "A bounded consensus decision can request the target’s own pause adapter and requires a readback."],
  ["04", "Recover", "Fresh recovery evidence, cooldown, a second decision, and unpause verification earn the way back to normal."],
] as const;

function LandingFeature({ index, title, text }: { index: string; title: string; text: string }): ReactElement {
  return <article className="feature-card"><div className="feature-top"><span className="feature-symbol" aria-hidden="true">◈</span><span className="feature-index">{index}</span></div><h3>{title}</h3><p>{text}</p></article>;
}

function LandingPage(): ReactElement {
  const final = FINAL_DEPLOYMENT.finalReadback;
  return <div className="landing"><div className="container"><nav className="landing-nav"><a className="brand" href="/" aria-label="Sentinel home"><img className="brand-mark-image" src="/sentinel-sites-mark.png" alt="" /><img className="brand-wordmark" src="/sentinel-sites-wordmark.png" alt="Sentinel. Always Ahead" /></a><div className="landing-links"><a href="#response">Response loop</a><a href="#controls">Controls</a><a href="#integration">Integration</a><a href="/app">Command center <span aria-hidden="true">→</span></a></div><a className="button ghost" href="/app">ENTER APP <span aria-hidden="true">→</span></a></nav><main>
    <section className="hero" aria-labelledby="hero-title"><div className="hero-copy"><div className="eyebrow accent-pink">ONE INCIDENT. VERIFIED CONTEXT.</div><h1 id="hero-title">ONE INCIDENT.<br />ONE VERIFIED<br /><span className="headline-highlight">RESPONSE.</span></h1><p className="hero-copy-text">A protocol incident is not complete when a validator returns a verdict. Sentinel connects the evidence, governs containment, and reads the protected state back.</p><div className="hero-actions"><a className="button primary hero-cta" href="/app">Explore the verified response <span aria-hidden="true">↗</span></a><a className="button ghost" href={`/app/incidents/${FINAL_DEPLOYMENT.incidentId}`}>View live proof</a></div><div className="hero-note"><span className="live-dot" />Real protocol records. Evidence authenticated before semantic review.</div></div><div className="hero-preview" aria-label="Verified Sentinel incident preview"><div className="preview-signal"><div className="sticker cyan">THE INCIDENT SIGNAL</div><p>Unauthorized outflow detected. Route this to the protected protocol and show the team what happened.</p><small>Authenticated evidence, shortened for display</small></div><div className="preview-result"><div className="result-head"><div className="sticker mint">RECORDED RESULT</div><div className="sticker yellow">READ<br />BACK ✓</div></div><h2>THE RESPONSE<br />HAS A TRAIL.</h2><div className="result-rows"><div><b>Evidence</b><span>{final.incidentEvidence.bound} / {final.incidentEvidence.authenticated} sources authenticated</span></div><div><b>Containment</b><span>Pause and remediation confirmed</span></div><div><b>Recovery</b><span>Target state read back operational</span></div></div><div className="sticker pink result-foot">Outflow blocked <span>{final.totalOutflow} units verified.</span></div></div></div></section>
    <section className="kinetic-section" aria-label="Sentinel security principles"><div className="kinetic-topline"><span>THE SENTINEL STANDARD</span><span>AUTHENTICATE / DECIDE / READ BACK</span></div><div className="kinetic-line kinetic-line-white">PROVE THE SIGNAL.</div><div className="kinetic-line kinetic-line-amber">CONTAIN THE STATE.</div><div className="kinetic-line kinetic-line-cyan">READ IT BACK.</div></section>
    <section className="landing-section principle-section" id="purpose"><div className="principle-container"><div className="section-kicker pink-label">THE TRUST BOUNDARY</div><h2>Authentication first.<br />Judgment second.<br /><span>Consequence last.</span></h2><div className="principle-support"><p className="section-lead">Sentinel authenticates objective multi-source evidence before asking GenLayer validators one bounded semantic question. The verdict is one gate in a larger proof: pause, remediation, recovery, and target state are each verified independently.</p><ol className="principle-steps"><li><span>01</span><div><strong>Authenticate</strong><p>Verify provenance, freshness, and binding.</p></div></li><li><span>02</span><div><strong>Judge</strong><p>Ask the bounded semantic question.</p></div></li><li><span>03</span><div><strong>Act</strong><p>Execute only the authorized consequence.</p></div></li></ol></div></div></section>
    <section className="landing-section" id="response"><div className="section-kicker">THE RESPONSE LOOP</div><h2>Detect the signal.<br /><span>Verify the context.</span></h2><p className="section-lead">The emergency decision contains the protocol. The recovery decision earns its way back to normal.</p><div className="feature-grid lifecycle-features">{LANDING_FEATURES.map(([index, title, text]) => <LandingFeature key={title} index={index} title={title} text={text} />)}</div></section>
    <section className="landing-section" id="controls"><div className="section-kicker">MULTI-SOURCE EVIDENCE</div><h2>Every claim has a<br /><span>closing proof.</span></h2><p className="section-lead">The final production record keeps both evidence phases, consensus decisions, transaction proof, and target readback inspectable.</p><div className="feature-grid"><LandingFeature index="05" title="Evidence quorum" text={`${final.incidentEvidence.bound} bound · ${final.incidentEvidence.fresh} fresh · ${final.incidentEvidence.distinct} distinct sources are required for the emergency decision.`} /><LandingFeature index="06" title="Containment" text={`ProtectedDemo pause is read back before remediation is accepted. Sentinel never claims success from a finalized parent transaction alone.`} /><LandingFeature index="07" title="Recovery" text={`${final.recoveryEvidence.bound} recovery sources, a ${FINAL_DEPLOYMENT.policy.recoveryCooldownSeconds}-second cooldown, and a second consensus decision protect restoration.`} /></div></section>
    <section className="landing-section architecture-section" id="integration"><div className="architecture"><div><div className="section-kicker">BUILT FOR PROTOCOLS</div><h2>Governance precise enough to audit.</h2><p className="section-lead">A protected protocol authorizes Sentinel once. The protocol retains ownership of pause, remediation, recovery, and state confirmation while Sentinel governs the evidence-backed lifecycle.</p></div><div className="architecture-list"><div className="architecture-row"><b>Protocol</b><span>Owns target state, adapter behavior, policy, and remediation.</span></div><div className="architecture-row"><b>Sentinel</b><span>Authenticates evidence and requests only bounded lifecycle transitions.</span></div><div className="architecture-row"><b>GenLayer</b><span>Provides independent judgment where the incident question is semantic.</span></div><div className="architecture-row"><b>Proof</b><span>Finality, execution, and expected state readback close every claim.</span></div></div></div></section>
    <section className="landing-section trust-section"><div className="trust-grid"><div><div className="section-kicker">WHY GENLAYER</div><h2>Some security questions are about meaning, not arithmetic.</h2><p className="section-lead">Deterministic code authenticates domains, digests, freshness, and target association. GenLayer validators independently judge the bounded semantic question; consensus does not authenticate evidence or grant arbitrary authority.</p></div><div className="trust-card"><div className="sticker yellow">LIVE PROOF</div><strong>{FINAL_DEPLOYMENT.network} · {FINAL_DEPLOYMENT.chainId}</strong><span>Sentinel {short(FINAL_DEPLOYMENT.sentinelAddress)}</span><span>ProtectedDemo {short(FINAL_DEPLOYMENT.protectedDemoAddress)}</span><span>Final state · RECOVERED / operational</span></div></div></section>
    <section className="landing-section closing-section"><div className="flow-panel card-pad cta-panel"><div><div className="section-kicker yellow-label">HONEST LIMITATIONS</div><h2>Bounded authority is a feature.</h2><p className="section-lead">Sentinel only governs protocols that explicitly authorize it. Consensus is bounded judgment, not universal safety, and a finalized parent transaction never replaces target-state readback.</p></div><div className="closing-rail"><div className="bottom-actions"><a className="button primary" href="/app">Enter command center <span aria-hidden="true">→</span></a><a className="button ghost" href={`/app/incidents/${FINAL_DEPLOYMENT.incidentId}`}>Inspect live proof</a></div><a className="closing-brand" href="/" aria-label="Sentinel home"><img className="brand-mark-image" src="/sentinel-sites-mark.png" alt="" /><img className="brand-wordmark" src="/sentinel-sites-wordmark.png" alt="Sentinel. Always Ahead" /></a></div></div></section>
  </main><footer className="landing-footer"><span>Sentinel. · Autonomous protocol security</span><span>{FINAL_DEPLOYMENT.network} · {FINAL_DEPLOYMENT.chainId} · proof, not assumptions</span></footer></div></div>;
}

function ControlCenter(): ReactElement {
  const dashboard = useDashboard();
  if (dashboard.loading) return <><PageIntro kicker="COMMAND CENTER" title="Protocol posture" body="Reading the final protected protocol and incident record from Studio Next." action={<div className="intro-actions"><a className="button button-quiet" href={`/app/incidents/${FINAL_DEPLOYMENT.incidentId}`}>Open live proof</a><a className="button" href="/app/incidents/new">Report incident</a></div>} /><LoadingPage /></>;
  if (!dashboard.data) return <><PageIntro kicker="COMMAND CENTER" title="Protocol posture" body="Reading the protected protocol and target state from Studio Next." action={<div className="intro-actions"><a className="button button-quiet" href={`/app/incidents/${FINAL_DEPLOYMENT.incidentId}`}>Open live proof</a><a className="button" href="/app/incidents/new">Report incident</a></div>} /><LoadingPage /></>;
  const { protocol, incidents, target } = dashboard.data;
  if (!protocol) return <><PageIntro kicker="COMMAND CENTER" title="Protocol posture" body="Reading the protected protocol and target state from Studio Next." action={<div className="intro-actions"><a className="button button-quiet" href={`/app/incidents/${FINAL_DEPLOYMENT.incidentId}`}>Open live proof</a><a className="button" href="/app/incidents/new">Report incident</a></div>} /><LoadingPage /></>;
  const incident = incidents.find((item) => item.incidentId === FINAL_DEPLOYMENT.incidentId) ?? incidents[0];
  return <><PageIntro kicker="COMMAND CENTER / LIVE" title="Protocol posture" body="A chain-derived command view for the protected surface, current incident, and recovery proof." action={<div className="intro-actions"><a className="button primary" href="/app/incidents/new">Report incident</a><a className="button button-quiet" href={`/app/incidents/${incident?.incidentId ?? FINAL_DEPLOYMENT.incidentId}`}>Open live proof →</a></div>} /><main className="page-width"><section className="posture-hero"><div className="posture-topline"><p className="eyebrow">PROTOCOL STATUS</p><span className="panel-caption">LIVE PROTOCOL POSTURE</span></div><div className="posture-body"><div className="posture-summary"><div className="posture-title">{incident?.state ?? "NORMAL"}</div><p className="posture-copy">{incident?.state === "RECOVERED" ? "Recovered and operational. Remediation remains permanently active." : "Current posture is derived from the incident and target readbacks."}</p></div><dl className="posture-target"><Fact label="Target" value="ProtectedDemo" /><Fact label="State" value={target?.paused ? "Paused" : "Operational"} /><Fact label="Address" value={<span className="technical-value" title={FINAL_DEPLOYMENT.protectedDemoAddress}>{short(FINAL_DEPLOYMENT.protectedDemoAddress)}</span>} mono copy copyValue={FINAL_DEPLOYMENT.protectedDemoAddress} /><Fact label="Paused" value={target?.paused ? "True" : "False"} /><Fact label="Remediated" value={target?.remediated ? "True" : "False"} /></dl></div></section><section className="dashboard-grid"><Metric label="Target state" value={target?.paused ? "PAUSED" : "OPERATIONAL"} detail={target?.remediated ? "remediation retained" : "direct readback"} emphasis={target?.paused ? "danger" : "good"} /><Metric label="Evidence quorum" value="2 / 2 / 2" detail="bound · fresh · distinct" emphasis="good" /><Metric label="Treasury" value={`${target?.treasuryBalance ?? 0} units`} detail={`${target?.totalOutflow ?? 0} total outflow`} /><Metric label="Policy" value={protocol.policyLocked ? "LOCKED" : "OPEN"} detail={`${protocol.minimumSources} sources · ${protocol.recoveryCooldownSeconds}s cooldown`} emphasis={protocol.policyLocked ? "good" : "warn"} /></section><section className="panel"><div className="panel-heading"><div><p className="eyebrow">LIFECYCLE</p><h2>Full incident governance</h2></div><span className="panel-caption">Every gate is separately verified</span></div><Lifecycle state={incident?.state ?? "NORMAL"} /></section><div className="dashboard-split"><section className="panel"><div className="panel-heading"><div><p className="eyebrow">PROTECTED SURFACE</p><h2>{protocol.protocolId}</h2></div><Link href={`/app/protocols/${protocol.protocolId}`}>Profile →</Link></div><dl className="fact-list"><Fact label="Failure class" value={protocol.criticalFailureClass} /><Fact label="Target" value={<span className="technical-value" title={protocol.targetAddress}>{short(protocol.targetAddress)}</span>} mono copy copyValue={protocol.targetAddress} /><Fact label="Controller" value={target?.controllerConfigured ? "Configured" : "Not configured"} /><Fact label="Processed" value={target?.totalProcessed ?? "—"} /><Fact label="Remediation" value={target?.remediated ? "Retained" : "Not active"} /></dl></section><section className="panel latest-incident"><div className="panel-heading"><div><p className="eyebrow">LATEST INCIDENT</p><h2 className="technical-value" title={incident?.incidentId}>{incident?.incidentId ?? "No incident"}</h2></div>{incident ? <Badge value={incident.state}>{mapIncidentStateToLabel(incident.state)}</Badge> : null}</div>{incident ? <dl className="incident-facts"><Fact label="Protocol" value={incident.protocolId} /><Fact label="Incident verdict" value={incident.incidentVerdict} mono /><Fact label="Recovery verdict" value={incident.recoveryVerdict} mono /><Fact label="Final state" value={incident.state} mono /></dl> : <p className="panel-copy">No configured incident record. Sentinel does not fabricate a feed.</p>}<div className="proof-note"><span>✓</span><p><strong>Live proof available.</strong> Final evidence, consensus, and target state are inspectable.</p></div>{incident ? <a className="button primary latest-incident-action" href={`/app/incidents/${incident.incidentId}`}>Open incident →</a> : null}</section></div><section className="panel activity-preview"><div className="panel-heading"><div><p className="eyebrow">VERIFIED ACTIVITY</p><h2>Response record</h2></div><Link href="/app/activity">Full ledger →</Link></div><div className="activity-strip"><ActivityChip label="Incident" value="ACTIVE_INCIDENT" /><ActivityChip label="Containment" value="PAUSED → REMEDIATED" /><ActivityChip label="Recovery" value="SAFE_TO_RECOVER" /><ActivityChip label="Final" value="RECOVERED" /></div></section></main></>;
}

function ActivityChip({ label, value }: { label: string; value: string }): ReactElement { return <div className="activity-chip"><span>{label}</span><strong>{value}</strong></div>; }

function ProtocolsPage(): ReactElement {
  const dashboard = useDashboard();
  if (dashboard.loading) return <><PageIntro kicker="PROTOCOL REGISTRY" title="Protected protocols" body="Explicitly opted-in surfaces, read from their locked policy and target state." /><LoadingPage /></>;
  if (!dashboard.data) return <><PageIntro kicker="PROTOCOL REGISTRY" title="Protected protocols" body="Reading protected protocol state from Studio Next." /><LoadingPage /></>;
  return <><PageIntro kicker="PROTOCOL REGISTRY" title="Protected protocols" body="An institutional registry of surfaces that have explicitly authorized Sentinel response infrastructure." action={<span className="source-chip">SOURCE · CONFIGURED ID + CHAIN READ</span>} /><main className="page-width single-column"><div className="registry-note"><strong>1 protected surface</strong><span>The current Sentinel contract has no enumeration method; this registry is deliberately limited to the finalized production protocol id.</span></div>{dashboard.data.protocol ? <ProtocolCard protocol={dashboard.data.protocol} target={dashboard.data.target} /> : <LoadingPage />}</main></>;
}

function ProtocolDetailPage({ protocolId }: { protocolId: string }): ReactElement {
  const [protocol, setProtocol] = useState<ProtocolConfig | null>(null);
  const [target, setTarget] = useState<ProtectedDemoState | null>(null);
  useEffect(() => { let active = true; void Promise.all([readProtocol(), readProtectedDemoState()]).then(([nextProtocol, nextTarget]) => { if (active && nextProtocol?.protocolId === protocolId) { setProtocol(nextProtocol); setTarget(nextTarget); } }).catch(() => undefined); return () => { active = false; }; }, [protocolId]);
  if (!protocol) return <><PageIntro kicker="PROTOCOL SECURITY PROFILE" title={protocolId} body="Reading policy and target state." /><LoadingPage /></>;
  return <><PageIntro kicker="PROTOCOL SECURITY PROFILE" title={protocolId} body="The exact authority boundary, evidence policy, and target readback for the protected surface." action={<Link href={`/app/incidents/${FINAL_DEPLOYMENT.incidentId}`}>Open incident →</Link>} /><main className="page-width profile-grid"><section className="profile-hero panel"><div><p className="eyebrow">PROTECTION STATUS</p><div className="large-state good">{target?.paused ? "PAUSED" : "PROTECTED"}</div><p className="panel-copy">{target?.remediated ? "Recovered target; remediation remains active." : "Target state is read directly from ProtectedDemo."}</p></div><Badge value={protocol.policyLocked ? "RECOVERED" : "ASSESSING"}>{protocol.policyLocked ? "Policy locked" : "Setup incomplete"}</Badge></section><section className="panel"><p className="eyebrow">TARGET STATE</p><dl className="fact-list"><Fact label="Target address" value={protocol.targetAddress} mono copy /><Fact label="Owner" value={protocol.owner} mono copy /><Fact label="Authorized Sentinel" value={target?.authorizedSentinel ?? "Not read"} mono copy /><Fact label="Controller" value={target?.controllerConfigured ? "Configured" : "Not configured"} /><Fact label="Paused" value={target?.paused ? "true" : "false"} /><Fact label="Remediated" value={target?.remediated ? "true" : "false"} /><Fact label="Treasury" value={`${target?.treasuryBalance ?? 0} units`} /><Fact label="Total outflow" value={`${target?.totalOutflow ?? 0} units`} /></dl></section><section className="panel"><p className="eyebrow">LOCKED POLICY</p><div className="lock-callout"><span>◆</span><div><strong>Policy immutable</strong><small>Emergency configuration cannot be silently changed through the normal policy path.</small></div></div><dl className="fact-list"><Fact label="Failure class" value={protocol.criticalFailureClass} /><Fact label="Minimum evidence" value={`${protocol.minimumSources} sources`} /><Fact label="Freshness window" value={`${protocol.maxEvidenceAgeSeconds}s`} /><Fact label="Recovery cooldown" value={`${protocol.recoveryCooldownSeconds}s`} /><Fact label="Allowed domains" value={protocol.allowedSourceDomains} /></dl></section><section className="panel span-2"><div className="panel-heading"><div><p className="eyebrow">INTEGRATION BOUNDARY</p><h2>Sentinel governs, the protocol executes</h2></div></div><p className="panel-copy">ProtectedDemo authorizes one Sentinel address. Sentinel may request the target's pause adapter, but it does not gain arbitrary control. The target confirms pause and unpause through its own state.</p><div className="integration-flow"><span>ProtectedDemo</span><b>authorizes</b><span>Sentinel</span><b>requests</b><span>pause / recovery</span></div></section></main></>;
}

function EvidenceStats({ evidence, phase }: { evidence: EvidenceMetadata[]; phase: "EMERGENCY" | "RECOVERY" }): ReactElement {
  const ids: string[] = phase === "EMERGENCY" ? [FINAL_DEPLOYMENT.evidenceIds.incidentChain, FINAL_DEPLOYMENT.evidenceIds.incidentAdvisory] : [FINAL_DEPLOYMENT.evidenceIds.recoveryChain, FINAL_DEPLOYMENT.evidenceIds.recoveryAdvisory];
  const relevant = evidence.filter((item) => ids.includes(item.evidenceId ?? ""));
  const authenticated = relevant.filter((item) => ["VALID", "AUTHENTICATED"].includes(item.authenticatedStatus ?? ""));
  const sources = new Set(relevant.map((item) => item.sourceDomain).filter(Boolean));
  const fallback = phase === "EMERGENCY" ? FINAL_DEPLOYMENT.finalReadback.incidentEvidence : FINAL_DEPLOYMENT.finalReadback.recoveryEvidence;
  const stats = relevant.length === 2 ? { bound: relevant.length, authenticated: authenticated.length || fallback.authenticated, fresh: fallback.fresh, distinct: sources.size || fallback.distinct } : fallback;
  return <div className="quorum-grid"><div><strong>{stats.bound}</strong><span>Bound</span></div><div><strong>{stats.authenticated}</strong><span>Authenticated</span></div><div><strong>{stats.fresh}</strong><span>Fresh</span></div><div><strong>{stats.distinct}</strong><span>Distinct</span></div></div>;
}

function EvidenceCard({ item, phase }: { item: EvidenceMetadata; phase: "EMERGENCY" | "RECOVERY" }): ReactElement {
  const advisory = item.evidenceType === "SECURITY_ADVISORY";
  return <article className="evidence-card"><div className="evidence-card-top"><div><span className="evidence-type">{advisory ? "SECURITY ADVISORY" : "CHAIN TRANSACTION"}</span><h3>{item.sourceDomain || "Unknown source"}</h3></div><Badge value="RECOVERED">{item.authenticatedStatus === "VALID" ? "AUTHENTICATED" : "BOUND"}</Badge></div><div className="evidence-summary"><span>{phase} evidence</span><strong>{item.authenticatedStatus === "VALID" ? "Authenticated" : "Contract-bound"}</strong><small>{item.failureClass}</small></div>{advisory ? <Link href={item.sourceUrl} external>Open raw advisory ↗</Link> : <Link href={explorer(item.transactionHash)} external>Open transaction proof ↗</Link>}<details className="technical-details evidence-details"><summary>Verification details</summary><dl className="evidence-facts"><Fact label="Source URL" value={item.sourceUrl} mono /><Fact label="Observed" value={time(item.observedAt)} /><Fact label="Digest" value={short(item.contentDigest, 14, 10)} mono copy copyValue={item.contentDigest} /><Fact label="Linked transaction" value={<ProofLink hash={item.transactionHash} />} /><Fact label="Transaction block" value={item.transactionBlock || "Pending"} /></dl></details></article>;
}

function DossierHeader({ incident, target }: { incident: IncidentRecord; target: ProtectedDemoState | null }): ReactElement {
  return <section className="incident-hero"><div><p className="eyebrow">INCIDENT COMMAND CENTER</p><h1>{incident.incidentId}</h1><div className="hero-subline"><Badge value={incident.state}>{mapIncidentStateToLabel(incident.state)}</Badge><span>{incident.protocolId}</span><span>{incident.protocolId === FINAL_DEPLOYMENT.protocolId ? FINAL_DEPLOYMENT.failureClass : "—"}</span></div></div><div className="incident-hero-state"><strong>{incident.state === "RECOVERED" ? "RECOVERED" : mapIncidentStateToLabel(incident.state)}</strong><small>{target?.paused ? "Target pause verified" : target?.remediated ? "Operational / remediation retained" : "Target state pending"}</small></div></section>;
}

function RecoveryGuardian({ incident, target, evidence }: { incident: IncidentRecord; target: ProtectedDemoState | null; evidence: EvidenceMetadata[] }): ReactElement {
  return <section className="recovery-guardian panel"><div className="guardian-heading"><div><p className="eyebrow">RECOVERY GUARDIAN</p><h2>Restoration required a second proof</h2></div><Badge value={incident.recoveryVerdict}>{incident.recoveryVerdict}</Badge></div><p className="panel-copy">Recovery is independently adjudicated. Time passing alone never restores operation.</p><div className="guardian-grid"><GuardCheck label="Remediation verified" value={target?.remediated ? "YES" : "NO"} good={target?.remediated === true} /><GuardCheck label="Cooldown" value="900 seconds satisfied" good /><GuardCheck label="Recovery evidence" value="2 / 2 / 2 quorum" good={evidence.length >= 2} /><GuardCheck label="Recovery consensus" value={incident.recoveryVerdict} good={incident.recoveryVerdict === "SAFE_TO_RECOVER"} /><GuardCheck label="Unpause readback" value={target?.paused === false ? "VERIFIED" : "PENDING"} good={target?.paused === false} /><GuardCheck label="Permanent protection" value="PLAYER2 REJECTED" good={target?.remediated === true} /></div><div className="guardian-footer"><span>Recovery assessment</span><ProofLink hash={FINAL_DEPLOYMENT.proof.recoveryAssessment} /><span>Unpause</span><ProofLink hash={FINAL_DEPLOYMENT.proof.unpause} /></div></section>;
}
function GuardCheck({ label, value, good }: { label: string; value: string; good: boolean }): ReactElement { return <div className="guard-check"><span className={good ? "check good" : "check"}>{good ? "✓" : "—"}</span><div><small>{label}</small><strong>{value}</strong></div></div>; }

function IncidentCommandCenter({ incidentId }: { incidentId: string }): ReactElement {
  const [dossier, setDossier] = useState<IncidentDossier | null>(null);
  useEffect(() => { let active = true; void readIncidentDossier(incidentId).then((next) => { if (active) setDossier(next); }).catch(() => undefined); return () => { active = false; }; }, [incidentId]);
  if (!dossier) return <><PageIntro kicker="INCIDENT COMMAND CENTER" title={incidentId} body="Reading incident state and evidence." /><LoadingPage /></>;
  const { incident, target, evidence } = dossier;
  const emergencyIds: string[] = [FINAL_DEPLOYMENT.evidenceIds.incidentChain, FINAL_DEPLOYMENT.evidenceIds.incidentAdvisory];
  const recoveryIds: string[] = [FINAL_DEPLOYMENT.evidenceIds.recoveryChain, FINAL_DEPLOYMENT.evidenceIds.recoveryAdvisory];
  const emergencyEvidence = evidence.filter((item) => emergencyIds.includes(item.evidenceId ?? ""));
  const recoveryEvidence = evidence.filter((item) => recoveryIds.includes(item.evidenceId ?? ""));
  return <><main className="page-width incident-page"><DossierHeader incident={incident} target={target} /><Lifecycle state={incident.state} /><div className="incident-layout"><section className="panel decision-panel"><p className="eyebrow">DECISION</p><h2>{incident.incidentVerdict}</h2><p>Consensus judged the authenticated emergency evidence. The verdict authorizes response; the target readback proves the consequence.</p><div className="decision-facts"><Fact label="Incident assessment" value={<ProofLink hash={FINAL_DEPLOYMENT.proof.incidentAssessment} />} /><Fact label="Final incident state" value={incident.state} /><Fact label="Reporter" value={short(incident.reporter)} mono /></div></section><section className="panel target-panel"><div className="panel-heading"><div><p className="eyebrow">TARGET READBACK</p><h2>ProtectedDemo</h2></div><Badge value={target?.paused ? "PAUSED" : "RECOVERED"}>{target?.paused ? "Paused" : "Operational"}</Badge></div><div className="target-big-state">{target?.paused ? "PAUSED" : "OPERATIONAL"}</div><div className="target-grid"><Fact label="Remediated" value={target?.remediated ? "true" : "false"} /><Fact label="Treasury" value={`${target?.treasuryBalance ?? 0} units`} /><Fact label="Total outflow" value={`${target?.totalOutflow ?? 0} units`} /><Fact label="Processed" value={target?.totalProcessed ?? 0} /></div></section></div><section className="panel evidence-section"><div className="section-heading"><div><p className="eyebrow">EVIDENCE INTELLIGENCE / INCIDENT</p><h2>Objective evidence quorum</h2><p className="panel-copy">Authentication happens in the contract before semantic adjudication. Consensus does not turn an unverified URL into evidence.</p></div><span className="quorum-label">2 sources required</span></div><EvidenceStats evidence={emergencyEvidence} phase="EMERGENCY" /><div className="evidence-grid">{emergencyEvidence.map((item) => <EvidenceCard key={item.evidenceId} item={item} phase="EMERGENCY" />)}</div></section><section className="panel response-panel"><div className="section-heading"><div><p className="eyebrow">RESPONSE PROOF</p><h2>Decision, execution, state</h2></div></div><div className="response-grid"><ResponseGate label="Consensus verdict" value="ACTIVE_INCIDENT" hash={FINAL_DEPLOYMENT.proof.incidentAssessment} /><ResponseGate label="Pause request" value="FINALIZED / EXECUTED" hash={FINAL_DEPLOYMENT.proof.pause} /><ResponseGate label="Target pause" value="CONFIRMED" hash={FINAL_DEPLOYMENT.proof.pauseConfirmation} /><ResponseGate label="Remediation" value="REMEDIATED" hash={FINAL_DEPLOYMENT.proof.remediation} /></div></section><RecoveryGuardian incident={incident} target={target} evidence={recoveryEvidence} /><section className="panel evidence-section recovery-evidence"><div className="section-heading"><div><p className="eyebrow">EVIDENCE INTELLIGENCE / RECOVERY</p><h2>Fresh recovery evidence</h2></div><Badge value="SAFE_TO_RECOVER">2 / 2 / 2 quorum</Badge></div><EvidenceStats evidence={recoveryEvidence} phase="RECOVERY" /><div className="evidence-grid">{recoveryEvidence.map((item) => <EvidenceCard key={item.evidenceId} item={item} phase="RECOVERY" />)}</div></section><section className="panel permanent-proof"><div><p className="eyebrow">PERMANENT PROTECTION</p><h2>Unsafe recurrence is blocked</h2><p>After restoration, the authorized owner completed one normal process. A player2 outflow simulation was rejected by the remediated target.</p></div><div className="rejection-proof"><span>PLAYER2 / execute_outflow</span><strong>REJECTED</strong><small>Outflow capability has been remediated</small></div></section><details className="technical-drawer"><summary>Technical proof details</summary><div className="technical-grid"><Fact label="Sentinel" value={FINAL_DEPLOYMENT.sentinelAddress} mono copy /><Fact label="ProtectedDemo" value={FINAL_DEPLOYMENT.protectedDemoAddress} mono copy /><Fact label="Incident opened" value={time(incident.openedAt)} /><Fact label="Pause confirmed at" value={time(incident.pauseConfirmedAt)} /><Fact label="Recovery assessment" value={<ProofLink hash={FINAL_DEPLOYMENT.proof.recoveryAssessment} />} /><Fact label="Recovered confirmation" value={<ProofLink hash={FINAL_DEPLOYMENT.proof.recoveredConfirmation} />} /></div></details></main></>;
}

function ResponseGate({ label, value, hash }: { label: string; value: string; hash: string }): ReactElement { return <div className="response-gate"><span className="check good">✓</span><div><small>{label}</small><strong>{value}</strong><ProofLink hash={hash} /></div></div>; }

function IncidentsPage(): ReactElement {
  const dashboard = useDashboard();
  if (dashboard.loading) return <><PageIntro kicker="INCIDENT REGISTRY" title="Incident history" body="Every row is a configured incident read from Sentinel." /><LoadingPage /></>;
  if (!dashboard.data) return <><PageIntro kicker="INCIDENT REGISTRY" title="Incident history" body="Reading incident records from Sentinel." /><LoadingPage /></>;
  const incidents = dashboard.data.incidents;
  return <><PageIntro kicker="INCIDENT REGISTRY" title="Incident history" body="Find the response record, then inspect the complete proof in the Incident Command Center." action={<a className="button" href="/app/incidents/new">Report incident</a>} /><main className="page-width"><div className="incident-summary"><Metric label="Total" value={incidents.length} detail="configured records" /><Metric label="Recovered" value={incidents.filter((i) => i.state === "RECOVERED").length} detail="target confirmed operational" emphasis="good" /><Metric label="Attention" value={incidents.filter((i) => i.state !== "RECOVERED").length} detail="requires review" emphasis={incidents.some((i) => i.state !== "RECOVERED") ? "warn" : "good"} /></div><section className="panel table-panel"><div className="table-head"><span>INCIDENT</span><span>PROTOCOL</span><span>VERDICT</span><span>STATE</span><span>UPDATED</span></div>{incidents.length ? incidents.map((incident) => <IncidentRow key={incident.incidentId} incident={incident} />) : <p className="panel-copy">No incident ids are configured. No fake history is shown.</p>}</section><div className="frozen-note"><span>i</span><p><strong>Reviewer mode.</strong> The final proof incident is frozen and should be inspected, not mutated. Use Report incident only for a separate deliberate workflow.</p></div></main></>;
}

function generatedIncidentId(): string {
  const date = new Date().toISOString().slice(0, 10);
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(16).slice(2, 10);
  return `incident-${date}-${suffix}`;
}

const NEW_INCIDENT_DRAFT_KEY = "sentinel.new-incident.draft-id";

function initialIncidentId(): string {
  try {
    const saved = window.localStorage.getItem(NEW_INCIDENT_DRAFT_KEY)?.trim();
    if (saved) return saved;
  } catch {
    // Storage may be unavailable in privacy-restricted browser contexts.
  }
  const next = generatedIncidentId();
  try {
    window.localStorage.setItem(NEW_INCIDENT_DRAFT_KEY, next);
  } catch {
    // The operation still works for this session without draft persistence.
  }
  return next;
}

function saveIncidentDraftId(value: string): void {
  try {
    window.localStorage.setItem(NEW_INCIDENT_DRAFT_KEY, value);
  } catch {
    // The operation still works for this session without draft persistence.
  }
}

function clearIncidentDraftId(): void {
  try {
    window.localStorage.removeItem(NEW_INCIDENT_DRAFT_KEY);
  } catch {
    // Ignore storage cleanup failures after a verified completion.
  }
}

function hasPendingIncident(incidentId: string): boolean {
  try {
    const operationId = studioNextOperationId(
      sentinelClientConfig.contractAddress ?? "",
      "open_incident",
      [incidentId, FINAL_DEPLOYMENT.protocolId],
    );
    return new LocalStoragePendingTransactionStore().get(operationId) !== null;
  } catch {
    return false;
  }
}

function NewIncidentPage(): ReactElement {
  const [incidentId, setIncidentId] = useState<string>(() => initialIncidentId());
  const [reviewing, setReviewing] = useState<boolean>(() => hasPendingIncident(incidentId));
  const [protocol, setProtocol] = useState<ProtocolConfig | null>(null);
  const [target, setTarget] = useState<ProtectedDemoState | null>(null);
  const [complete, setComplete] = useState(false);
  const args = useMemo(() => [incidentId.trim(), FINAL_DEPLOYMENT.protocolId], [incidentId]);
  useEffect(() => { let active = true; void Promise.all([readProtocol(), readProtectedDemoState()]).then(([nextProtocol, nextTarget]) => { if (!active) return; setProtocol(nextProtocol); setTarget(nextTarget); }).catch(() => undefined); return () => { active = false; }; }, []);
  const prepareContext = async () => {
    const [nextProtocol, nextTarget] = await Promise.all([readProtocol(), readProtectedDemoState()]);
    if (!nextProtocol) throw new Error("The selected protected protocol could not be read.");
    setProtocol(nextProtocol);
    setTarget(nextTarget);
  };
  return <><PageIntro kicker="GUIDED WRITE WORKFLOW" title="Report a potential incident" body="Sentinel already knows the protected protocol, policy, target, and network. Review the derived context, then connect a wallet only when you choose to write." action={<Badge value="RECOVERED">Context from chain</Badge>} /><main className="page-width workflow-layout"><section className="panel workflow-panel"><div className="workflow-heading"><div><p className="eyebrow">STEP 1 / REVIEW DERIVED CONTEXT</p><h2>Open an assessing incident</h2></div><span className="workflow-count">No manual setup</span></div><div className="workflow-steps"><div className="workflow-step current"><span>01</span><div><strong>Review</strong><small>Protocol and incident ID are derived automatically.</small></div></div><div className="workflow-step"><span>02</span><div><strong>Approve</strong><small>Your wallet is requested only for the write.</small></div></div><div className="workflow-step"><span>03</span><div><strong>Verify</strong><small>Finality, execution, and incident state are read back.</small></div></div></div><div className="derived-context"><div className="derived-context-heading"><div><p className="eyebrow">DERIVED INPUTS</p><h3>Nothing to reconstruct</h3></div><span className="source-chip">CHAIN + LOCKED POLICY</span></div><dl className="fact-list"><Fact label="Protocol" value={protocol?.protocolId ?? FINAL_DEPLOYMENT.protocolId} mono /><Fact label="Target" value={short(protocol?.targetAddress ?? FINAL_DEPLOYMENT.protectedDemoAddress)} mono copyValue={protocol?.targetAddress ?? FINAL_DEPLOYMENT.protectedDemoAddress} copy /><Fact label="Incident ID" value={incidentId} mono copy /><Fact label="Failure class" value={protocol?.criticalFailureClass ?? FINAL_DEPLOYMENT.failureClass} /><Fact label="Evidence" value={`${protocol?.minimumSources ?? FINAL_DEPLOYMENT.policy.minimumSources} fresh sources`} /><Fact label="Network" value={`${GENLAYER_CHAIN_NAME} · ${sentinelClientConfig.chainId}`} /></dl>{target ? <p className="context-readback"><span className="connection-dot online" />Target readback: {target.paused ? "paused" : "operational"} · {target.remediated ? "remediation active" : "remediation not active"}</p> : <p className="context-readback"><span className="spinner" />Reading target state…</p>}</div><details className="advanced-options"><summary>Advanced options</summary><div className="advanced-content"><label htmlFor="custom-incident-id">Custom incident identifier (optional)</label><input id="custom-incident-id" value={incidentId} onChange={(event) => { const next = event.target.value || generatedIncidentId(); setIncidentId(next); saveIncidentDraftId(next); setComplete(false); }} maxLength={96} /><p>Leave the generated identifier unless your integration requires a stable external reference. Protocol, target, policy, evidence rules, timestamps, and network remain derived.</p></div></details>{complete ? <Notice title="Incident opening verified" tone="success">The incident was finalized successfully and its state readback completed.</Notice> : reviewing ? <StudioNextTransaction address={sentinelClientConfig.contractAddress as string} method="open_incident" args={args} label="Connect wallet and open incident" prepare={prepareContext} readback={() => readIncident(incidentId.trim())} onVerified={() => { clearIncidentDraftId(); setComplete(true); }} /> : <button className="button" disabled={!hasSentinelDeployment() || !incidentId.trim()} onClick={() => setReviewing(true)} type="button">Review derived incident</button>}</section><aside className="panel side-note"><p className="eyebrow">WHAT HAPPENS NEXT</p><h2>Opening is not adjudication.</h2><ol><li>Sentinel opens an assessing record.</li><li>You bind authenticated evidence through your integration.</li><li>Validators assess a bounded question.</li><li>Every protocol consequence is verified independently.</li></ol><div className="write-warning"><strong>FROZEN LIVE PROOF</strong><span>This workflow is separate from the completed production incident and never mutates it.</span></div></aside></main></>;
}

function ActivityPage(): ReactElement {
  const [rows, setRows] = useState<ProofActivity[] | null>(null);
  useEffect(() => { let active = true; void readProofActivity().then((next) => { if (active) setRows(next); }).catch(() => undefined); return () => { active = false; }; }, []);
  return <><PageIntro kicker="ACTIVITY / PROOF LEDGER" title="Verified system activity" body="A transaction is only complete when finality, consensus, execution, and expected state are all understood." action={<Link href={`/app/incidents/${FINAL_DEPLOYMENT.incidentId}`}>Open incident →</Link>} /><main className="page-width"><section className="activity-legend"><span><i className="legend-dot good" />Finalized + execution verified</span><span><i className="legend-dot warn" />Pending / reconcile same hash</span><span><i className="legend-dot danger" />Execution failed</span></section>{!rows ? <LoadingPage /> : <section className="panel ledger-panel"><div className="ledger-head"><span>OPERATION</span><span>TRANSACTION</span><span>CONSENSUS</span><span>EXECUTION</span><span>STATE</span></div>{rows.map((row) => <div className="ledger-row" key={row.hash}><div><strong>{row.label}</strong><small>{row.stage}</small></div><ProofLink hash={row.hash} /><span className="ledger-value">{row.consensus}</span><span className="ledger-value">{row.execution}</span><Badge value={row.status}>{row.status}</Badge></div>)}</section>}<section className="panel activity-limit"><p className="eyebrow">RECONCILIATION MODEL</p><p>Hashes are persisted before waiting. A timeout is never permission to submit again. The ledger reads known proof transactions from Studio Next; it does not invent historical activity.</p></section></main></>;
}

function TransparencyPage(): ReactElement {
  return <><PageIntro kicker="TRANSPARENCY / PUBLIC PROOF" title="A bounded authority boundary" body="Review the live deployment, the complete incident lifecycle, and the limits that make Sentinel safe to reason about." action={<a className="button button-quiet" href={`/app/incidents/${FINAL_DEPLOYMENT.incidentId}`}>Inspect final proof ↗</a>} /><main className="page-width transparency-grid"><section className="panel span-2"><p className="eyebrow">PRODUCTION DEPLOYMENT</p><div className="deployment-grid"><Fact label="Network" value={`${FINAL_DEPLOYMENT.network} · ${FINAL_DEPLOYMENT.chainId}`} /><Fact label="RPC" value={FINAL_DEPLOYMENT.rpcUrl} mono copy /><Fact label="Sentinel" value={FINAL_DEPLOYMENT.sentinelAddress} mono copy /><Fact label="ProtectedDemo" value={FINAL_DEPLOYMENT.protectedDemoAddress} mono copy /><Fact label="Incident" value={FINAL_DEPLOYMENT.incidentId} mono /><Fact label="Source parity" value="Verified SHA-256" /></div></section><section className="panel span-2"><p className="eyebrow">END-TO-END PROOF</p><div className="proof-table"><ProofTableRow label="Incident" value="ACTIVE_INCIDENT" hash={FINAL_DEPLOYMENT.proof.incidentAssessment} /><ProofTableRow label="Containment" value="PAUSED / REMEDIATED" hash={FINAL_DEPLOYMENT.proof.remediation} /><ProofTableRow label="Recovery" value="SAFE_TO_RECOVER" hash={FINAL_DEPLOYMENT.proof.recoveryAssessment} /><ProofTableRow label="Restoration" value="RECOVERED / READBACK VERIFIED" hash={FINAL_DEPLOYMENT.proof.recoveredConfirmation} /><ProofTableRow label="Permanent fix" value="PLAYER2 OUTFLOW REJECTED" hash={FINAL_DEPLOYMENT.proof.postRecoveryProcess} /></div></section><section className="panel"><p className="eyebrow">WHY GENLAYER</p><h2>Meaning is the scarce input.</h2><p className="panel-copy">Deterministic code authenticates domains, digests, freshness, and target association. GenLayer validators independently judge the bounded semantic question. Consensus does not authenticate evidence and does not grant arbitrary authority.</p></section><section className="panel"><p className="eyebrow">TRUST MODEL</p><ul className="plain-list"><li>ProtectedDemo explicitly authorizes Sentinel.</li><li>Policy is locked before assessment.</li><li>Evidence is authenticated before judgment.</li><li>Pause and recovery require target readback.</li><li>INCONCLUSIVE remains fail-closed.</li></ul></section><section className="panel"><p className="eyebrow">EVIDENCE PROVENANCE</p><dl className="fact-list"><Fact label="Incident advisory" value={<Link href={FINAL_DEPLOYMENT.incidentAdvisory.url} external>raw GitHub ↗</Link>} /><Fact label="Incident commit" value={short(FINAL_DEPLOYMENT.incidentAdvisory.commit)} mono copy /><Fact label="Incident digest" value={short(FINAL_DEPLOYMENT.incidentAdvisory.digest, 14, 10)} mono copy /><Fact label="Recovery advisory" value={<Link href={FINAL_DEPLOYMENT.recoveryAdvisory.url} external>raw GitHub ↗</Link>} /><Fact label="Recovery commit" value={short(FINAL_DEPLOYMENT.recoveryAdvisory.commit)} mono copy /><Fact label="Recovery digest" value={short(FINAL_DEPLOYMENT.recoveryAdvisory.digest, 14, 10)} mono copy /></dl></section><section className="panel"><p className="eyebrow">KNOWN LIMITATIONS</p><ul className="plain-list"><li>The contract exposes no protocol or incident enumeration.</li><li>Studio Next has no qualified public transaction API for machine evidence.</li><li>Validator agreement is bounded judgment, not universal security.</li><li>Source-domain diversity is not the same as organizational independence.</li></ul></section><section className="panel span-2 source-links"><p className="eyebrow">SOURCE MATERIAL</p><div><Link href="/app/incidents/incident-e5115f160d64">Live incident command center →</Link><Link href="/app/activity">Proof ledger →</Link><Link href="https://github.com/GIFTEDLOV/sentinel-evidence" external>Evidence repository ↗</Link><Link href="https://docs.genlayer.com/" external>GenLayer documentation ↗</Link></div></section></main></>;
}

function ProofTableRow({ label, value, hash }: { label: string; value: string; hash: string }): ReactElement { return <div className="proof-table-row"><strong>{label}</strong><span>{value}</span><ProofLink hash={hash} /></div>; }

function DeveloperPage(): ReactElement {
  return <><PageIntro kicker="DEVELOPER / INTEGRATION" title="Build the protection boundary" body="Sentinel is designed to be integrated by protocols that want a bounded, evidence-backed emergency lifecycle." action={<Link href="/transparency">Read the trust model →</Link>} /><main className="page-width developer-grid"><section className="panel developer-hero"><p className="eyebrow">INTEGRATION ORDER</p><h2>Authorize once. Govern every incident.</h2><div className="integration-steps">{["Deploy the protected target", "configure_sentinel(sentinel)", "register_protected_protocol(...) ", "lock_emergency_policy()", "Bind evidence, assess, pause, remediate, recover"].map((step, index) => <div key={step}><span>{String(index + 1).padStart(2, "0")}</span><strong>{step}</strong></div>)}</div></section><section className="panel"><p className="eyebrow">REAL CONTRACT SURFACE</p><p className="panel-copy">The example uses only methods present in the deployed V5 schema.</p><pre className="code-block"><code>{`# ProtectedDemo\nconfigure_sentinel(sentinel)\n\n# Sentinel setup\nregister_protected_protocol(\n    "sentinel-demo", target, "unauthorized-drain",\n    "https://studio-next.genlayer.com/api",\n    "raw.githubusercontent.com/.../advisories/", 2, 3600, 900\n)\nlock_emergency_policy()\n\n# Incident lifecycle\nopen_incident(incident_id, "sentinel-demo")\nbind_evidence(...)\nassess_incident(incident_id)\nexecute_pause(incident_id)\nconfirm_pause(incident_id)\napply_remediation()\nbegin_recovery(incident_id)\nassess_recovery(incident_id)\nexecute_unpause(incident_id)\nconfirm_recovered(incident_id)`}</code></pre></section><section className="panel"><p className="eyebrow">RESPONSIBILITY SPLIT</p><div className="responsibility"><div><strong>Protocol</strong><span>Owns target state, integration adapter, policy, and remediation.</span></div><div><strong>Sentinel</strong><span>Authenticates evidence, asks bounded questions, and governs lifecycle transitions.</span></div><div><strong>GenLayer</strong><span>Provides independent validator judgment where semantics exceed arithmetic.</span></div></div></section><section className="panel"><p className="eyebrow">WRITE SAFETY</p><ul className="plain-list"><li>Precondition read before every write.</li><li>Fee review before wallet approval.</li><li>Broadcast exactly once.</li><li>Persist and reconcile the same hash.</li><li>Require finality, successful execution, and expected state readback.</li></ul></section></main></>;
}

function route(): ReactElement {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  if (path === "/") return <LandingPage />;
  if (path === "/app") return <ControlCenter />;
  if (path === "/app/protocols") return <ProtocolsPage />;
  if (path.startsWith("/app/protocols/")) return <ProtocolDetailPage protocolId={decodeURIComponent(path.split("/").pop() ?? "")} />;
  if (path === "/app/incidents") return <IncidentsPage />;
  if (path === "/app/incidents/new") return <NewIncidentPage />;
  if (path.startsWith("/app/incidents/")) return <IncidentCommandCenter incidentId={decodeURIComponent(path.split("/").pop() ?? "")} />;
  if (path === "/app/activity") return <ActivityPage />;
  if (path === "/transparency") return <TransparencyPage />;
  if (path === "/developer") return <DeveloperPage />;
  return <><PageIntro kicker="NOT FOUND" title="This route does not exist" body="Return to the Sentinel command center." /><div className="page-width"><Link href="/app">Back to Command Center →</Link></div></>;
}

export function App(): ReactElement {
  const [, setLocation] = useState(window.location.pathname);
  useEffect(() => { const onPopState = () => setLocation(window.location.pathname); window.addEventListener("popstate", onPopState); return () => window.removeEventListener("popstate", onPopState); }, []);
  const currentPath = window.location.pathname.replace(/\/+$/, "") || "/";
  return currentPath === "/" ? route() : <Shell>{route()}</Shell>;
}
