import { useState, useRef, useCallback, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import { t } from './i18n'
import { generatePDF } from './pdfgen'
import WorkflowView from './WorkflowView'
import HelpModal from './HelpModal'

// ── Types ──────────────────────────────────────────────────────────
type SwarmAgent = {
  role: string; name: string; emoji: string; color: string;
  description: string; status: 'idle' | 'thinking' | 'active' | 'complete' | 'error';
}
type SwarmEvent = {
  agent_role: string; agent_name: string; agent_emoji: string;
  agent_color: string; event_type: string; message: string;
  data?: any; timestamp: number;
}
type ChatMsg = { role: 'user' | 'assistant' | 'system'; text: string }
type SwarmReport = { report?: string; audit?: { quality_score?: number; verdict?: string; summary?: string } }
type PlanData = { goal: string; steps: string[]; current_step: number }
type ConfirmRequest = { action_description: string; risk_level: string }
type BackendLog = { message: string; timestamp: number }

// ── Helpers ────────────────────────────────────────────────────────
const BACKEND_WS = () => {
  const loc = window.location
  const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${loc.host}/ws/swarm`
}

export default function App() {
  // Connection
  const wsRef = useRef<WebSocket | null>(null)
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [language, setLanguage] = useState('en-US')

  // Browser viewport
  const [screenshot, setScreenshot] = useState<string | null>(null)
  const [pageUrl, setPageUrl] = useState('about:blank')

  // Chat
  const [chatHistory, setChatHistory] = useState<ChatMsg[]>([])
  const [inputText, setInputText] = useState('')

  // Swarm
  const [swarmAgents, setSwarmAgents] = useState<SwarmAgent[]>([])
  const [swarmEvents, setSwarmEvents] = useState<SwarmEvent[]>([])
  const [swarmReport, setSwarmReport] = useState<SwarmReport | null>(null)
  const [plan, setPlan] = useState<PlanData | null>(null)
  const [confirmReq, setConfirmReq] = useState<ConfirmRequest | null>(null)

  // Backend logs
  const [backendLogs, setBackendLogs] = useState<BackendLog[]>([])
  const [showLogs, setShowLogs] = useState(false)

  // UI
  const [activeTab, setActiveTab] = useState<'chat' | 'swarm' | 'workflow' | 'report'>('chat')
  const [busy, setBusy] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const eventsEndRef = useRef<HTMLDivElement>(null)
  const logsEndRef = useRef<HTMLDivElement>(null)
  const reportRef = useRef<HTMLDivElement>(null)
  const [expandedAgents, setExpandedAgents] = useState<Record<string, boolean>>({})
  const [showHelp, setShowHelp] = useState(false)

  // Auto-scroll
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [chatHistory])
  useEffect(() => { eventsEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [swarmEvents])
  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [backendLogs])

  // ── WebSocket ──────────────────────────────────────────────────

  const connect = useCallback(() => {
    if (wsRef.current) return
    setConnecting(true)

    const ws = new WebSocket(`${BACKEND_WS()}?language=${language}&session_id=${Date.now()}`)

    ws.onopen = () => {
      setConnected(true)
      setConnecting(false)
      setChatHistory(prev => [...prev, { role: 'system', text: t(language, 'connected_msg') }])
    }

    ws.onclose = () => {
      wsRef.current = null
      setConnected(false)
      setConnecting(false)
      setBusy(false)
    }

    ws.onerror = () => {
      wsRef.current = null
      setConnected(false)
      setConnecting(false)
    }

    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data)

      switch (msg.type) {
        case 'screenshot':
          setScreenshot(msg.data)
          if (msg.url) setPageUrl(msg.url)
          break

        case 'text':
          setChatHistory(prev => [...prev, { role: 'assistant', text: msg.text }])
          break

        case 'swarm_status':
          setSwarmAgents(msg.agents)
          break

        case 'swarm_event':
          setSwarmEvents(prev => [...prev, {
            agent_role: msg.agent_role,
            agent_name: msg.agent_name,
            agent_emoji: msg.agent_emoji,
            agent_color: msg.agent_color,
            event_type: msg.event_type,
            message: msg.message,
            data: msg.data,
            timestamp: msg.timestamp || Date.now() / 1000,
          }])
          // Update agent status
          setSwarmAgents(prev => prev.map(a =>
            a.role === msg.agent_role
              ? { ...a, status: msg.event_type === 'complete' ? 'complete' : msg.event_type === 'error' ? 'error' : msg.event_type === 'thinking' ? 'thinking' : 'active' }
              : a
          ))
          // Auto-expand active agent panel
          if (msg.event_type === 'thinking' || msg.event_type === 'finding') {
            setExpandedAgents(prev => ({ ...prev, [msg.agent_role]: true }))
          }
          break

        case 'plan':
          setPlan({ goal: msg.goal, steps: msg.steps, current_step: msg.current_step })
          break

        case 'swarm_report':
          setSwarmReport({ report: msg.report, audit: msg.audit })
          setActiveTab('report')
          break

        case 'confirmation_request':
          setConfirmReq({ action_description: msg.action_description, risk_level: msg.risk_level })
          break

        case 'task_complete':
          setBusy(false)
          setChatHistory(prev => [...prev, { role: 'system', text: `✅ ${msg.summary}` }])
          break

        case 'turn_complete':
          setBusy(false)
          break

        case 'backend_log':
          setBackendLogs(prev => [...prev, { message: msg.message, timestamp: msg.timestamp }])
          break

        case 'reset_complete':
          setChatHistory(prev => [...prev, { role: 'system', text: t(language, 'reset_msg') }])
          setBusy(false)
          break
      }
    }

    wsRef.current = ws
  }, [language])

  const disconnect = useCallback(() => {
    wsRef.current?.close()
    wsRef.current = null
  }, [])

  // ── Send message ───────────────────────────────────────────────

  const sendGoal = useCallback(() => {
    const text = inputText.trim()
    if (!text || !wsRef.current || busy) return
    setChatHistory(prev => [...prev, { role: 'user', text }])
    wsRef.current.send(JSON.stringify({ type: 'text', text }))
    setInputText('')
    setBusy(true)
    setSwarmEvents([])
    setSwarmReport(null)
    setPlan(null)
    setExpandedAgents({})
  }, [inputText, busy])

  const sendConfirmation = useCallback((confirmed: boolean) => {
    wsRef.current?.send(JSON.stringify({ type: 'user_confirmation', confirmed }))
    setConfirmReq(null)
    if (!confirmed) setBusy(false)
  }, [])

  // ── Reset ──────────────────────────────────────────────────────

  const resetSession = useCallback(() => {
    if (!wsRef.current || !connected) return
    wsRef.current.send(JSON.stringify({ type: 'reset' }))
    setScreenshot(null)
    setPageUrl('about:blank')
    setSwarmAgents([])
    setSwarmEvents([])
    setSwarmReport(null)
    setPlan(null)
    setConfirmReq(null)
    setBackendLogs([])
    setBusy(false)
    setExpandedAgents({})
  }, [connected])

  // ── Download PDF ───────────────────────────────────────────────

  const downloadPDF = useCallback(() => {
    if (!swarmReport?.report) return
    generatePDF(swarmReport.report, swarmReport.audit)
  }, [swarmReport])

  // ── Quick tasks ────────────────────────────────────────────────
  const quickTasks = [
    { label: t(language, 'quick_task_1'), goal: t(language, 'quick_task_1_goal') },
    { label: t(language, 'quick_task_2'), goal: t(language, 'quick_task_2_goal') },
    { label: t(language, 'quick_task_3'), goal: t(language, 'quick_task_3_goal') },
  ]

  // ── Group events by agent ──────────────────────────────────────
  const groupedEvents = swarmEvents.reduce((acc, evt) => {
    if (!acc[evt.agent_role]) acc[evt.agent_role] = []
    acc[evt.agent_role].push(evt)
    return acc
  }, {} as Record<string, SwarmEvent[]>)

  // ── Render ─────────────────────────────────────────────────────

  const statusDot = (s: SwarmAgent['status']) => {
    const colors: Record<string, string> = {
      idle: 'bg-gray-500', thinking: 'bg-yellow-400 animate-pulse',
      active: 'bg-blue-400 animate-pulse', complete: 'bg-emerald-400', error: 'bg-red-400',
    }
    return <span className={`inline-block w-2 h-2 rounded-full ${colors[s] || 'bg-gray-500'}`} />
  }

  const eventBadge = (type: string) => {
    const styles: Record<string, string> = {
      complete: 'bg-emerald-600/30 text-emerald-300',
      finding: 'bg-blue-600/30 text-blue-300',
      thinking: 'bg-yellow-600/30 text-yellow-300',
      error: 'bg-red-600/30 text-red-300',
      message: 'bg-white/10 text-white/50',
    }
    return <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${styles[type] || styles.message}`}>{type}</span>
  }

  return (
    <div className="h-screen flex flex-col bg-gray-950 text-white">
      {/* ── Header ─────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-gray-900/80 backdrop-blur shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-xl">🐝</span>
          <div>
            <h1 className="text-sm font-bold tracking-wide">{t(language, 'title')}</h1>
            <p className="text-[9px] text-white/30 leading-tight">{t(language, 'header_subtitle')}</p>
          </div>
          <span className="text-[10px] text-white/30 bg-white/5 px-2 py-0.5 rounded-full">{t(language, 'model_badge')}</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowHelp(true)}
            className="text-xs px-2 py-1 rounded bg-white/5 text-white/50 border border-white/10 hover:bg-white/10 hover:text-white/80 transition"
            title="Help"
          >❓</button>
          <select
            value={language}
            onChange={e => setLanguage(e.target.value)}
            className="bg-gray-800 text-xs rounded px-2 py-1 border border-white/10"
          >
            <option value="en-US">🇺🇸 English</option>
            <option value="es-ES">🇪🇸 Español</option>
            <option value="pt-BR">🇧🇷 Português</option>
            <option value="fr-FR">🇫🇷 Français</option>
          </select>
          {connected && (
            <button onClick={resetSession} className="text-xs px-3 py-1 rounded bg-amber-600/20 text-amber-400 border border-amber-500/30 hover:bg-amber-600/40 transition">
              {t(language, 'reset')}
            </button>
          )}
          {connected ? (
            <button onClick={disconnect} className="text-xs px-3 py-1 rounded bg-red-600/20 text-red-400 border border-red-500/30 hover:bg-red-600/40 transition">
              {t(language, 'disconnect')}
            </button>
          ) : (
            <button onClick={connect} disabled={connecting} className="text-xs px-3 py-1 rounded bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-600/40 transition disabled:opacity-50">
              {connecting ? t(language, 'connecting') : t(language, 'connect')}
            </button>
          )}
        </div>
      </header>

      {/* ── Main layout ───────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Browser Viewport */}
        <div className="flex-1 flex flex-col border-r border-white/10 min-w-0">
          {/* URL bar */}
          <div className="px-3 py-1.5 bg-gray-900/60 border-b border-white/5 flex items-center gap-2 shrink-0">
            <span className="text-[10px] text-white/30">🌐</span>
            <span className="text-[11px] text-white/50 truncate flex-1">{pageUrl}</span>
            {busy && <span className="text-[10px] text-yellow-400 animate-pulse">{t(language, 'navigating')}</span>}
          </div>
          {/* Screenshot */}
          <div className="flex-1 bg-gray-900 flex items-center justify-center overflow-hidden">
            {screenshot ? (
              <img
                src={`data:image/jpeg;base64,${screenshot}`}
                alt="Browser viewport"
                className="max-w-full max-h-full object-contain"
              />
            ) : (
              <div className="text-center text-white/20">
                <p className="text-4xl mb-3">🌐</p>
                <p className="text-sm">{t(language, 'browser_viewport')}</p>
                <p className="text-xs mt-1">{t(language, 'browser_subtitle')}</p>
              </div>
            )}
          </div>
          {/* Agent roster bar */}
          {swarmAgents.length > 0 && (
            <div className="px-3 py-2 bg-gray-900/80 border-t border-white/5 flex gap-3 overflow-x-auto shrink-0">
              {swarmAgents.map(a => (
                <div key={a.role} className="flex items-center gap-1.5 text-[10px] whitespace-nowrap">
                  {statusDot(a.status)}
                  <span>{a.emoji}</span>
                  <span className="text-white/60">{a.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: Sidebar (Chat/Swarm/Report) */}
        <div className="w-[420px] flex flex-col bg-gray-900/40 shrink-0">
          {/* Tabs */}
          <div className="flex border-b border-white/10 shrink-0">
            {(['chat', 'swarm', 'workflow', 'report'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 py-2 text-[11px] font-medium transition ${
                  activeTab === tab
                    ? 'text-white border-b-2 border-purple-500'
                    : 'text-white/40 hover:text-white/60'
                }`}
              >
                {t(language, `tab_${tab}`)}
                {tab === 'swarm' && swarmEvents.length > 0 && (
                  <span className="ml-1 text-[9px] bg-purple-600/30 px-1 rounded">{swarmEvents.length}</span>
                )}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {/* ── Chat tab ──────────────────────────────── */}
            {activeTab === 'chat' && (
              <>
                {/* Plan */}
                {plan && (
                  <div className="rounded-lg border border-purple-500/20 bg-purple-900/10 p-2.5 mb-2">
                    <div className="text-[10px] font-semibold text-purple-300 mb-1.5">{t(language, 'plan_label')} {plan.goal}</div>
                    {plan.steps.map((step, i) => {
                      const isDone = i < plan.current_step
                      const isCurrent = i === plan.current_step
                      return (
                        <div key={i} className={`text-[10px] py-0.5 flex gap-1.5 transition-all duration-300 ${
                          isDone ? 'text-emerald-400' : isCurrent ? 'text-yellow-300 font-medium' : 'text-white/30'
                        }`}>
                          <span className="shrink-0">{isDone ? '✅' : isCurrent ? '▶️' : '○'}</span>
                          <span className={isCurrent ? 'animate-pulse' : ''}>{step}</span>
                        </div>
                      )
                    })}
                    {/* Progress bar */}
                    <div className="mt-2 h-1 bg-white/10 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-purple-500 to-emerald-500 transition-all duration-500 rounded-full"
                        style={{ width: `${Math.min(100, (plan.current_step / plan.steps.length) * 100)}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Quick tasks (when no messages) */}
                {chatHistory.length === 0 && (
                  <div className="space-y-2 mb-3">
                    <p className="text-[11px] text-white/40 text-center">{t(language, 'quick_tasks_title')}</p>
                    {quickTasks.map((qt, i) => (
                      <button
                        key={i}
                        onClick={() => {
                          if (!connected) connect()
                          setInputText(qt.goal)
                        }}
                        className="w-full text-left text-[11px] px-3 py-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 transition"
                      >
                        {qt.label}
                      </button>
                    ))}
                  </div>
                )}

                {/* Messages */}
                {chatHistory.map((msg, i) => (
                  <div key={i} className={`text-[11px] leading-relaxed ${
                    msg.role === 'user' ? 'text-right' : msg.role === 'system' ? 'text-center text-white/40 text-[10px]' : ''
                  }`}>
                    {msg.role === 'user' ? (
                      <span className="inline-block bg-purple-600/30 rounded-xl px-3 py-1.5 max-w-[85%] text-left">{msg.text}</span>
                    ) : msg.role === 'system' ? (
                      <span>{msg.text}</span>
                    ) : (
                      <div className="bg-white/5 rounded-xl px-3 py-2 text-white/80">{msg.text}</div>
                    )}
                  </div>
                ))}
                <div ref={chatEndRef} />

                {/* Confirmation dialog */}
                {confirmReq && (
                  <div className="rounded-lg border border-yellow-500/30 bg-yellow-900/20 p-3">
                    <div className="text-[11px] font-semibold text-yellow-300 mb-1">{t(language, 'confirm_title')}</div>
                    <p className="text-[11px] text-white/70 mb-2">{confirmReq.action_description}</p>
                    <div className="flex gap-2">
                      <button onClick={() => sendConfirmation(true)} className="flex-1 text-[10px] py-1 rounded bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-600/50 transition">
                        {t(language, 'confirm_yes')}
                      </button>
                      <button onClick={() => sendConfirmation(false)} className="flex-1 text-[10px] py-1 rounded bg-red-600/30 text-red-300 border border-red-500/30 hover:bg-red-600/50 transition">
                        {t(language, 'confirm_no')}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ── Swarm tab — Grouped agent panels ─────── */}
            {activeTab === 'swarm' && (
              <>
                {/* Agent cards grid */}
                {swarmAgents.length > 0 && (
                  <div className="grid grid-cols-2 gap-1.5 mb-3">
                    {swarmAgents.map(a => {
                      const evtCount = (groupedEvents[a.role] || []).length
                      return (
                        <button
                          key={a.role}
                          onClick={() => setExpandedAgents(prev => ({ ...prev, [a.role]: !prev[a.role] }))}
                          className={`rounded-lg border bg-white/5 p-2 flex items-center gap-2 text-left transition-all ${
                            a.status === 'thinking' || a.status === 'active'
                              ? 'border-white/30 bg-white/10 shadow-lg shadow-white/5'
                              : 'border-white/10'
                          }`}
                          style={{ borderLeftColor: a.color, borderLeftWidth: 3 }}
                        >
                          <span className="text-lg">{a.emoji}</span>
                          <div className="min-w-0 flex-1">
                            <div className="text-[10px] font-semibold truncate flex items-center gap-1">
                              {a.name} {statusDot(a.status)}
                            </div>
                            <div className="text-[9px] text-white/30 truncate">{a.description}</div>
                            {evtCount > 0 && (
                              <div className="text-[8px] text-white/20 mt-0.5">
                                {evtCount} {t(language, 'events')} {expandedAgents[a.role] ? '▼' : '▶'}
                              </div>
                            )}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}

                {/* Grouped agent activity panels */}
                {swarmAgents.length > 0 ? (
                  <div className="space-y-2">
                    {swarmAgents
                      .filter(a => (groupedEvents[a.role] || []).length > 0)
                      .map(a => {
                        const events = groupedEvents[a.role] || []
                        const isExpanded = expandedAgents[a.role] !== false
                        return (
                          <div key={a.role} className="rounded-lg border border-white/10 overflow-hidden">
                            <button
                              onClick={() => setExpandedAgents(prev => ({ ...prev, [a.role]: !isExpanded }))}
                              className="w-full flex items-center gap-2 px-3 py-2 bg-white/5 hover:bg-white/[0.08] transition"
                              style={{ borderLeftColor: a.color, borderLeftWidth: 3 }}
                            >
                              <span>{a.emoji}</span>
                              <span className="text-[11px] font-semibold flex-1 text-left" style={{ color: a.color }}>
                                {a.name}
                              </span>
                              {statusDot(a.status)}
                              <span className="text-[9px] text-white/30">{events.length}</span>
                              <span className="text-[10px] text-white/20">{isExpanded ? '▼' : '▶'}</span>
                            </button>
                            {isExpanded && (
                              <div className="px-3 py-1 space-y-1 max-h-60 overflow-y-auto bg-black/20">
                                {events.map((evt, i) => (
                                  <div key={i} className="flex gap-2 py-1 border-b border-white/5 last:border-0">
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-1.5 mb-0.5">
                                        {eventBadge(evt.event_type)}
                                      </div>
                                      <p className="text-[10px] text-white/60 break-words leading-relaxed">
                                        {evt.message}
                                      </p>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })}
                  </div>
                ) : (
                  <div className="text-center text-white/20 py-8">
                    <p className="text-2xl mb-2">🐝</p>
                    <p className="text-[11px]">{t(language, 'swarm_empty')}</p>
                  </div>
                )}
                <div ref={eventsEndRef} />
              </>
            )}

            {/* ── Workflow tab — Visual Mission Control ──── */}
            {activeTab === 'workflow' && (
              <div className="-m-3 h-[calc(100%+24px)]">
                <WorkflowView agents={swarmAgents} events={swarmEvents} plan={plan} language={language} />
              </div>
            )}

            {/* ── Report tab ────────────────────────────── */}
            {activeTab === 'report' && (
              <>
                {swarmReport ? (
                  <div>
                    {/* Quality badge + PDF button */}
                    <div className="flex items-center justify-between mb-3">
                      {swarmReport.audit?.quality_score ? (
                        <div className="flex items-center gap-2 py-1.5 px-3 rounded-lg bg-emerald-900/20 border border-emerald-500/20">
                          <span className="text-[11px] text-emerald-300 font-semibold">{t(language, 'quality')}: {swarmReport.audit.quality_score}/100</span>
                          <span className={`text-[10px] px-1.5 rounded ${
                            swarmReport.audit.verdict === 'approved' ? 'bg-emerald-600/30 text-emerald-300' : 'bg-yellow-600/30 text-yellow-300'
                          }`}>{swarmReport.audit.verdict}</span>
                        </div>
                      ) : <div />}
                      <button
                        onClick={downloadPDF}
                        className="text-[10px] px-3 py-1.5 rounded bg-blue-600/20 text-blue-300 border border-blue-500/30 hover:bg-blue-600/40 transition flex items-center gap-1"
                      >
                        {t(language, 'download_pdf')}
                      </button>
                    </div>
                    <div ref={reportRef} className="prose prose-invert prose-sm max-w-none text-[11px] leading-relaxed">
                      <ReactMarkdown>{swarmReport.report || 'No report generated.'}</ReactMarkdown>
                    </div>
                  </div>
                ) : (
                  <div className="text-center text-white/20 py-8">
                    <p className="text-2xl mb-2">📝</p>
                    <p className="text-[11px]">{t(language, 'report_empty_title')}</p>
                    <p className="text-[10px] mt-1">{t(language, 'report_empty_sub')}</p>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Input bar */}
          <div className="p-3 border-t border-white/10 shrink-0">
            <div className="flex gap-2">
              <input
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendGoal()}
                placeholder={connected ? t(language, 'placeholder') : t(language, 'placeholder_disconnected')}
                disabled={!connected}
                className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-[12px] text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50 disabled:opacity-40"
              />
              <button
                onClick={sendGoal}
                disabled={!connected || busy || !inputText.trim()}
                className="px-4 py-2 rounded-lg bg-purple-600 text-white text-[12px] font-medium hover:bg-purple-500 transition disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {busy ? '⏳' : '🚀'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Help Modal ────────────────────────────────── */}
      {showHelp && <HelpModal language={language} onClose={() => setShowHelp(false)} />}

      {/* ── Backend Log Panel (bottom, collapsible) ───── */}
      <div className={`border-t border-white/10 bg-gray-900/90 transition-all duration-300 shrink-0 ${showLogs ? 'h-48' : 'h-8'}`}>
        <button
          onClick={() => setShowLogs(!showLogs)}
          className="w-full px-4 py-1.5 flex items-center gap-2 text-[10px] text-white/40 hover:text-white/60 transition"
        >
          <span>{showLogs ? '▼' : '▲'}</span>
          <span>{t(language, 'backend_logs')}</span>
          {backendLogs.length > 0 && (
            <span className="bg-white/10 px-1.5 rounded text-[9px]">{backendLogs.length}</span>
          )}
        </button>
        {showLogs && (
          <div className="h-[calc(100%-28px)] overflow-y-auto px-4 pb-2 font-mono">
            {backendLogs.length === 0 ? (
              <p className="text-[10px] text-white/20 text-center py-4">{t(language, 'no_logs')}</p>
            ) : (
              backendLogs.map((log, i) => (
                <div key={i} className="text-[10px] text-white/40 py-0.5 border-b border-white/5">
                  <span className="text-white/20 mr-2">
                    {new Date(log.timestamp * 1000).toLocaleTimeString()}
                  </span>
                  {log.message}
                </div>
              ))
            )}
            <div ref={logsEndRef} />
          </div>
        )}
      </div>
    </div>
  )
}
