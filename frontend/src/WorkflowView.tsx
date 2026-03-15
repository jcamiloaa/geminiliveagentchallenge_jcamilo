import { useEffect, useRef, useMemo } from 'react'
import { t } from './i18n'

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
type PlanData = { goal: string; steps: string[]; current_step: number }

interface WorkflowProps {
  agents: SwarmAgent[]
  events: SwarmEvent[]
  plan: PlanData | null
  language: string
}

// ── Hex to RGB ─────────────────────────────────────────────────────

function hexToRGB(hex: string): [number, number, number] {
  const c = hex.replace('#', '')
  return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)]
}

// ── Particle system for data flow ──────────────────────────────────

interface Particle {
  x: number; y: number; tx: number; ty: number
  progress: number; speed: number; color: string; size: number
}

// ── Short display names per role ───────────────────────────────────
const SHORT_NAMES: Record<string, string> = {
  orchestrator: 'CEO',
  web_scout: 'Scout',
  data_analyst: 'Analyst',
  strategy: 'Strategy',
  report_builder: 'Report',
  critic: 'Auditor',
}

// ── The Workflow Pipeline ──────────────────────────────────────────

const PIPELINE_ORDER = ['orchestrator', 'web_scout', 'data_analyst', 'strategy', 'report_builder', 'critic']

export default function WorkflowView({ agents, events, plan, language }: WorkflowProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const particlesRef = useRef<Particle[]>([])
  const animRef = useRef<number>(0)
  const timeRef = useRef(0)

  const agentMap = useMemo(() => {
    const m: Record<string, SwarmAgent> = {}
    agents.forEach(a => { m[a.role] = a })
    return m
  }, [agents])

  const eventCounts = useMemo(() => {
    const c: Record<string, number> = {}
    events.forEach(e => { c[e.agent_role] = (c[e.agent_role] || 0) + 1 })
    return c
  }, [events])

  const latestEvent = useMemo(() => {
    const m: Record<string, SwarmEvent> = {}
    events.forEach(e => { m[e.agent_role] = e })
    return m
  }, [events])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const maybeCtx = canvas.getContext('2d')
    if (!maybeCtx) return
    const ctx = maybeCtx

    const resize = () => {
      const rect = canvas.parentElement?.getBoundingClientRect()
      if (rect) {
        canvas.width = rect.width * window.devicePixelRatio
        canvas.height = rect.height * window.devicePixelRatio
        ctx.scale(window.devicePixelRatio, window.devicePixelRatio)
        canvas.style.width = `${rect.width}px`
        canvas.style.height = `${rect.height}px`
      }
    }
    resize()
    window.addEventListener('resize', resize)

    const getW = () => canvas.width / window.devicePixelRatio
    const getH = () => canvas.height / window.devicePixelRatio

    // ── Node positions — hexagonal layout filling available space ──
    function getNodePositions() {
      const w = getW()
      const h = getH()
      const cx = w / 2
      const cy = h / 2
      // Use larger radii to spread nodes out and avoid center overlap
      const rx = Math.min(w * 0.40, w / 2 - 50)
      const ry = Math.min(h * 0.38, h / 2 - 45)
      const positions: Record<string, { x: number; y: number }> = {}
      const count = PIPELINE_ORDER.length
      for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count - Math.PI / 2
        positions[PIPELINE_ORDER[i]] = {
          x: cx + Math.cos(angle) * rx,
          y: cy + Math.sin(angle) * ry,
        }
      }
      return positions
    }

    // ── Draw curved connection ──────────────────────────
    function drawConnection(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, active: boolean, progress: number) {
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      if (active) {
        const gradient = ctx.createLinearGradient(x1, y1, x2, y2)
        gradient.addColorStop(0, 'rgba(139, 92, 246, 0.5)')
        gradient.addColorStop(progress, 'rgba(59, 130, 246, 0.8)')
        gradient.addColorStop(1, 'rgba(139, 92, 246, 0.2)')
        ctx.strokeStyle = gradient
        ctx.lineWidth = 2
      } else {
        ctx.strokeStyle = 'rgba(255,255,255,0.06)'
        ctx.lineWidth = 1
      }
      ctx.stroke()
    }

    // ── Draw a single node ──────────────────────────────
    function drawNode(
      ctx: CanvasRenderingContext2D,
      x: number, y: number, r: number,
      color: string, status: string, emoji: string, shortName: string,
      eventCount: number, time: number,
    ) {
      const [cr, cg, cb] = hexToRGB(color)

      // Glow for active agents
      if (status === 'thinking' || status === 'active') {
        const pulse = Math.sin(time * 3) * 0.3 + 0.7
        const glow = ctx.createRadialGradient(x, y, r * 0.5, x, y, r * 2.5)
        glow.addColorStop(0, `rgba(${cr},${cg},${cb},${0.4 * pulse})`)
        glow.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = glow
        ctx.beginPath()
        ctx.arc(x, y, r * 2.5, 0, Math.PI * 2)
        ctx.fill()
      }

      // Outer ring
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      const ringGrad = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r)
      ringGrad.addColorStop(0, `rgba(${cr},${cg},${cb},0.3)`)
      ringGrad.addColorStop(1, `rgba(${cr},${cg},${cb},0.08)`)
      ctx.fillStyle = ringGrad
      ctx.fill()

      // Border
      ctx.strokeStyle = status === 'complete'
        ? 'rgba(16, 185, 129, 0.8)'
        : status === 'error'
          ? 'rgba(239, 68, 68, 0.8)'
          : `rgba(${cr},${cg},${cb},${status === 'idle' ? 0.3 : 0.7})`
      ctx.lineWidth = status === 'thinking' || status === 'active' ? 2.5 : 1.5
      ctx.stroke()

      // Progress ring for active
      if (status === 'thinking' || status === 'active') {
        const sweep = (time * 1.5) % (Math.PI * 2)
        ctx.beginPath()
        ctx.arc(x, y, r + 3, sweep, sweep + Math.PI * 0.8)
        ctx.strokeStyle = `rgba(${cr},${cg},${cb},0.8)`
        ctx.lineWidth = 2
        ctx.lineCap = 'round'
        ctx.stroke()
        ctx.lineCap = 'butt'
      }

      // Complete check ring
      if (status === 'complete') {
        ctx.beginPath()
        ctx.arc(x, y, r + 3, 0, Math.PI * 2)
        ctx.strokeStyle = 'rgba(16, 185, 129, 0.4)'
        ctx.lineWidth = 1.5
        ctx.stroke()
      }

      // Emoji
      ctx.font = `${r * 0.8}px system-ui`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(emoji, x, y)

      // Short name below the circle
      ctx.font = 'bold 9px system-ui'
      ctx.fillStyle = 'rgba(255,255,255,0.85)'
      ctx.fillText(shortName, x, y + r + 12)

      // Event count badge
      if (eventCount > 0) {
        const badgeX = x + r * 0.7
        const badgeY = y - r * 0.7
        ctx.beginPath()
        ctx.arc(badgeX, badgeY, 8, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(${cr},${cg},${cb},0.9)`
        ctx.fill()
        ctx.font = 'bold 8px system-ui'
        ctx.fillStyle = '#fff'
        ctx.fillText(String(eventCount), badgeX, badgeY + 1)
      }

      // Status indicator (compact — single line only)
      const statusIcon = status === 'thinking' ? '⏳' : status === 'active' ? '⚡' : status === 'complete' ? '✓' : status === 'error' ? '✗' : ''
      if (statusIcon) {
        ctx.font = '8px system-ui'
        ctx.fillStyle = status === 'complete' ? 'rgba(16,185,129,0.7)' : status === 'error' ? 'rgba(239,68,68,0.7)' : 'rgba(250,204,21,0.7)'
        ctx.fillText(statusIcon, x, y + r + 22)
      }
    }

    // ── Animation loop ──────────────────────────────────

    function animate() {
      const w = getW()
      const h = getH()
      timeRef.current += 0.016
      const time = timeRef.current

      ctx.clearRect(0, 0, w, h)

      // Background subtle grid
      ctx.strokeStyle = 'rgba(255,255,255,0.02)'
      ctx.lineWidth = 1
      for (let gx = 0; gx < w; gx += 40) {
        ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke()
      }
      for (let gy = 0; gy < h; gy += 40) {
        ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke()
      }

      const positions = getNodePositions()

      // Draw connections
      for (let i = 0; i < PIPELINE_ORDER.length; i++) {
        const curr = PIPELINE_ORDER[i]
        const next = PIPELINE_ORDER[(i + 1) % PIPELINE_ORDER.length]
        const p1 = positions[curr]
        const p2 = positions[next]
        if (p1 && p2) {
          const currAgent = agentMap[curr]
          const nextAgent = agentMap[next]
          const isActive = currAgent?.status === 'complete' && (nextAgent?.status === 'thinking' || nextAgent?.status === 'active')
          drawConnection(ctx, p1.x, p1.y, p2.x, p2.y, isActive, (Math.sin(time * 2) + 1) / 2)
        }
      }

      // Spawn particles for flow
      const particles = particlesRef.current
      for (let i = 0; i < PIPELINE_ORDER.length; i++) {
        const curr = PIPELINE_ORDER[i]
        const next = PIPELINE_ORDER[(i + 1) % PIPELINE_ORDER.length]
        const currAgent = agentMap[curr]
        if (currAgent?.status === 'complete' || currAgent?.status === 'active') {
          if (Math.random() < 0.08) {
            const p1 = positions[curr]
            const p2 = positions[next]
            if (p1 && p2) {
              particles.push({
                x: p1.x, y: p1.y, tx: p2.x, ty: p2.y,
                progress: 0, speed: 0.008 + Math.random() * 0.012,
                color: currAgent.color, size: 2 + Math.random() * 2,
              })
            }
          }
        }
      }

      // Update & draw particles
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]
        p.progress += p.speed
        if (p.progress >= 1) { particles.splice(i, 1); continue }
        p.x = p.x + (p.tx - p.x) * p.speed * 3
        p.y = p.y + (p.ty - p.y) * p.speed * 3
        const alpha = p.progress < 0.2 ? p.progress * 5 : p.progress > 0.8 ? (1 - p.progress) * 5 : 1
        const [pr, pg, pb] = hexToRGB(p.color)
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(${pr},${pg},${pb},${alpha * 0.8})`
        ctx.fill()
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size * 2, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(${pr},${pg},${pb},${alpha * 0.15})`
        ctx.fill()
      }

      // Draw nodes
      const nodeR = Math.min(24, w * 0.055)
      for (const role of PIPELINE_ORDER) {
        const pos = positions[role]
        const agent = agentMap[role]
        if (pos && agent) {
          drawNode(ctx, pos.x, pos.y, nodeR, agent.color, agent.status, agent.emoji, SHORT_NAMES[role] || agent.name, eventCounts[role] || 0, time)
        }
      }

      // Center: compact progress ring only (no text to overlap)
      if (plan) {
        const cx = w / 2
        const cy = h / 2
        const pRad = 18
        const pct = plan.steps.length > 0 ? plan.current_step / plan.steps.length : 0
        // Outer track
        ctx.beginPath()
        ctx.arc(cx, cy, pRad, 0, Math.PI * 2)
        ctx.strokeStyle = 'rgba(255,255,255,0.06)'
        ctx.lineWidth = 3
        ctx.stroke()
        // Progress arc
        ctx.beginPath()
        ctx.arc(cx, cy, pRad, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pct)
        ctx.strokeStyle = 'rgba(16,185,129,0.8)'
        ctx.lineWidth = 3
        ctx.lineCap = 'round'
        ctx.stroke()
        ctx.lineCap = 'butt'
        // Percentage
        ctx.font = 'bold 10px system-ui'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = 'rgba(255,255,255,0.7)'
        ctx.fillText(`${Math.round(pct * 100)}%`, cx, cy + 1)
      }

      animRef.current = requestAnimationFrame(animate)
    }

    animRef.current = requestAnimationFrame(animate)

    return () => {
      window.removeEventListener('resize', resize)
      cancelAnimationFrame(animRef.current)
    }
  }, [agentMap, eventCounts, latestEvent, plan])

  // Data flow summary stats
  const artifactCount = events.filter(e => e.event_type === 'finding' && e.agent_role === 'web_scout').length
  const findingCount = events.filter(e => e.event_type === 'finding' && e.agent_role === 'data_analyst').length
  const insightCount = events.filter(e => e.event_type === 'finding' && e.agent_role === 'strategy').length

  const hasActivity = agents.length > 0
  const pct = plan && plan.steps.length > 0 ? Math.round((plan.current_step / plan.steps.length) * 100) : 0

  return (
    <div className="h-full flex flex-col">
      {/* Header with plan goal */}
      <div className="px-3 py-2 border-b border-white/5 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold text-white/80">{t(language, 'workflow_title')}</div>
            <div className="text-[9px] text-white/30">{t(language, 'workflow_subtitle')}</div>
          </div>
          {plan && (
            <div className="text-right ml-2">
              <div className="text-[9px] text-purple-300 font-medium">Step {plan.current_step + 1}/{plan.steps.length}</div>
              <div className="w-16 h-1 bg-white/10 rounded-full overflow-hidden mt-0.5">
                <div className="h-full bg-emerald-500 rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
              </div>
            </div>
          )}
        </div>
        {plan && (
          <div className="mt-1.5 text-[9px] text-white/50 truncate">
            🎯 {plan.goal}
          </div>
        )}
      </div>

      {/* Canvas area */}
      <div className="flex-1 relative min-h-0">
        <canvas ref={canvasRef} className="absolute inset-0" />
        {!hasActivity && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <div className="text-4xl mb-3 animate-pulse">⚡</div>
              <p className="text-[11px] text-white/30">{t(language, 'workflow_idle')}</p>
            </div>
          </div>
        )}
      </div>

      {/* Data flow stats bar */}
      {hasActivity && (
        <div className="px-3 py-2 border-t border-white/5 flex items-center justify-around text-[9px] shrink-0">
          <div className="text-center">
            <div className="text-lg font-bold text-blue-400">{artifactCount}</div>
            <div className="text-white/30">{t(language, 'workflow_sources')}</div>
          </div>
          <div className="text-white/10">→</div>
          <div className="text-center">
            <div className="text-lg font-bold text-emerald-400">{findingCount}</div>
            <div className="text-white/30">{t(language, 'workflow_findings')}</div>
          </div>
          <div className="text-white/10">→</div>
          <div className="text-center">
            <div className="text-lg font-bold text-amber-400">{insightCount}</div>
            <div className="text-white/30">{t(language, 'workflow_insights')}</div>
          </div>
        </div>
      )}
    </div>
  )
}
