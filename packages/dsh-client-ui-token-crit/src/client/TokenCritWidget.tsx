/**
 * The token-usage crit meter widget: a floating, transparent, draggable and
 * resizable badge registered into the shell.overlay list. It reads the
 * current session's cumulative token usage from the `tokenUsage` projection
 * (input + output + cache read + cache write buckets) via the standard
 * `useSessions` prop, rolls the number, and fires MMO-style crit effects —
 * floating input/output damage numbers, particles, a combo counter, edge
 * flash and an optional sound — whenever usage grows. All tuning lives in a
 * small hover-revealed settings panel.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import css from './TokenCritWidget.module.css'

/** Cumulative token-usage projection value (from the token-meter). */
interface TokenUsage {
  uncachedInputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

/** One floating damage number. */
interface CritItem {
  id: string
  kind: 'in' | 'out'
  delta: number
  hue: number
  size: number
  big: boolean
}

/** One burst particle. */
interface Particle {
  id: string
  dx: number
  dy: number
  hue: number
  size: number
}

/** Ambient ember spec. */
interface AmbientSpec {
  left: number
  top: number
  size: string
  hue: number
  dx: number
  dy: number
  dur: string
  delay: string
}

/** Pointer-drag state. */
interface DragState {
  mode: 'move' | 'resize'
  pointerId: number
  startX: number
  startY: number
  originLeft: number
  originTop: number
  startScale: number
}

function fmt(n: number): string {
  const v = Math.round(Number(n) || 0)
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function compact(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 1e4) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K'
  return String(Math.round(n))
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

function hueRange(color: string): [number, number] {
  if (color === 'cyan') return [180, 210]
  if (color === 'purple') return [260, 290]
  if (color === 'multi') return [0, 360]
  return [28, 62]
}

function makeAmbient(count: number, color: string): AmbientSpec[] {
  const r = hueRange(color)
  const arr: AmbientSpec[] = []
  for (let i = 0; i < count; i++) {
    arr.push({
      left: Math.round(10 + Math.random() * 80),
      top: Math.round(35 + Math.random() * 55),
      size: (1.5 + Math.random() * 2.5).toFixed(1),
      hue: Math.round(r[0] + Math.random() * (r[1] - r[0])),
      dx: Math.round((Math.random() * 2 - 1) * 16),
      dy: Math.round(-(26 + Math.random() * 28)),
      dur: (2.6 + Math.random() * 2.4).toFixed(2),
      delay: (Math.random() * 4).toFixed(2),
    })
  }
  return arr
}

function selectUsage(s: any): TokenUsage | undefined {
  const cid = s.current
  const entry = cid ? s.byId[cid] : undefined
  return entry && entry.projectionValues ? entry.projectionValues.tokenUsage : undefined
}

function loadPos(): { x: number; y: number } | null {
  try {
    const s = window.localStorage.getItem('dsh.tcrit.pos')
    return s ? JSON.parse(s) : null
  } catch {
    return null
  }
}

function loadScale(): number {
  try {
    const v = parseFloat(window.localStorage.getItem('dsh.tcrit.scale') ?? '')
    return Number.isFinite(v) ? clamp(v, 0.6, 2.5) : 1
  } catch {
    return 1
  }
}

export function TokenCritWidget(props: { useSessions: (sel: (s: any) => any) => any }) {
  const usage = props.useSessions(selectUsage)

  const input = usage
    ? (usage.uncachedInputTokens ?? 0) + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
    : 0
  const output = usage ? (usage.outputTokens ?? 0) : 0
  const total = input + output

  const anchorRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const movedRef = useRef(false)
  const shownRef = useRef(0)
  const prevRef = useRef({ input: 0, output: 0, seen: false })
  const lastGrowthRef = useRef(0)
  const comboTimerRef = useRef<number | null>(null)
  const boostTimerRef = useRef<number | null>(null)
  const audioRef = useRef<any>(null)

  const [pos, setPos] = useState<{ x: number; y: number } | null>(loadPos)
  const [scale, setScale] = useState(loadScale)
  const [dragging, setDragging] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [panelPos, setPanelPos] = useState<{ x: number; y: number } | null>(null)
  const [shown, setShown] = useState(0)
  const [crits, setCrits] = useState<CritItem[]>([])
  const [particles, setParticles] = useState<Particle[]>([])
  const [critKey, setCritKey] = useState(0)
  const [combo, setCombo] = useState(0)
  const [comboKey, setComboKey] = useState(0)
  const [edgeKey, setEdgeKey] = useState(0)
  const [boost, setBoost] = useState(false)

  const [critAbs, setCritAbs] = useState(4000)
  const [critRatio, setCritRatio] = useState(0.12)
  const [lang, setLang] = useState('zh')
  const [showTags, setShowTags] = useState(true)
  const [soundOn, setSoundOn] = useState(false)
  const [edgeOn, setEdgeOn] = useState(true)
  const [ambientOn, setAmbientOn] = useState(true)
  const [ambientCount, setAmbientCount] = useState(7)
  const [particleColor, setParticleColor] = useState('gold')
  const [numSize, setNumSize] = useState(14)
  const [numFormat, setNumFormat] = useState('full')
  const [comboOn, setComboOn] = useState(true)

  const ambientParts = useMemo(
    () => (ambientOn ? makeAmbient(ambientCount, particleColor) : []),
    [ambientOn, ambientCount, particleColor],
  )

  useEffect(() => {
    try {
      window.localStorage.setItem('dsh.tcrit.pos', pos ? JSON.stringify(pos) : '')
    } catch { /* storage unavailable */ }
  }, [pos])

  useEffect(() => {
    try {
      window.localStorage.setItem('dsh.tcrit.scale', String(scale))
    } catch { /* storage unavailable */ }
  }, [scale])

  useEffect(() => () => {
    if (comboTimerRef.current !== null) clearTimeout(comboTimerRef.current)
    if (boostTimerRef.current !== null) clearTimeout(boostTimerRef.current)
  }, [])

  function playCritSound() {
    try {
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext
      if (!AC) return
      if (!audioRef.current) audioRef.current = new AC()
      const actx = audioRef.current
      const t = actx.currentTime
      const osc = actx.createOscillator()
      const gain = actx.createGain()
      osc.type = 'square'
      osc.frequency.setValueAtTime(520, t)
      osc.frequency.exponentialRampToValueAtTime(1180, t + 0.08)
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(0.12, t + 0.012)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2)
      osc.connect(gain)
      gain.connect(actx.destination)
      osc.start(t)
      osc.stop(t + 0.22)
    } catch { /* audio unavailable */ }
  }

  function tagText(c: CritItem): string | null {
    if (c.big) return lang === 'zh' ? '暴击!' : 'CRIT!'
    if (!showTags) return null
    return lang === 'zh' ? (c.kind === 'in' ? '输入' : '输出') : (c.kind === 'in' ? 'IN' : 'OUT')
  }

  function spawnPop(kind: 'in' | 'out', delta: number) {
    const big = kind === 'out' && (delta >= critAbs || delta >= total * critRatio)
    const hue = kind === 'out' ? (big ? 6 : 35) : 200
    const size = kind === 'out' ? (big ? 20 + Math.random() * 8 : 15 + Math.random() * 8) : 13 + Math.random() * 6
    const id = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
    setCrits((arr) => arr.concat({ id, kind, delta, hue, size, big }))
    window.setTimeout(() => setCrits((arr) => arr.filter((c) => c.id !== id)), 1600)

    if (big) {
      if (edgeOn) setEdgeKey((k) => k + 1)
      if (soundOn) playCritSound()
    }

    const n = big ? 18 : 11 + Math.floor(Math.random() * 6)
    const parts: Particle[] = []
    for (let i = 0; i < n; i++) {
      const angle = (Math.PI * 2 * i) / n + Math.random() * 0.7
      const dist = 22 + Math.random() * (big ? 52 : 34)
      parts.push({
        id: id + '-p' + i,
        dx: Math.round(Math.cos(angle) * dist),
        dy: Math.round(Math.sin(angle) * dist),
        hue: hue + Math.round(Math.random() * 30 - 15),
        size: Math.round(3 + Math.random() * (big ? 7 : 5)),
      })
    }
    setParticles((arr) => arr.concat(parts))
    window.setTimeout(() => setParticles((arr) => arr.filter((p) => !p.id.startsWith(id))), 900)
  }

  useEffect(() => {
    const prev = prevRef.current
    const seen = prev.seen
    const inputDelta = seen ? input - prev.input : 0
    const outputDelta = seen ? output - prev.output : 0
    prevRef.current = { input, output, seen: true }

    if (inputDelta > 0 || outputDelta > 0) {
      setCritKey((k) => k + 1)
      const now = Date.now()
      const last = lastGrowthRef.current
      setCombo((c) => (now - last < 1600 ? c + 1 : 1))
      lastGrowthRef.current = now
      setComboKey((k) => k + 1)
      if (comboTimerRef.current !== null) clearTimeout(comboTimerRef.current)
      comboTimerRef.current = window.setTimeout(() => setCombo(0), 1600)

      setBoost(true)
      if (boostTimerRef.current !== null) clearTimeout(boostTimerRef.current)
      boostTimerRef.current = window.setTimeout(() => setBoost(false), 900)
    }
    if (outputDelta > 0) spawnPop('out', outputDelta)
    if (inputDelta > 0) spawnPop('in', inputDelta)

    const from = shownRef.current
    if (total === from) return
    const start = performance.now()
    const duration = Math.min(620, 220 + Math.abs(total - from) * 0.06)
    let frame = 0
    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      const val = Math.round(from + (total - from) * eased)
      shownRef.current = val
      setShown(val)
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(frame) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total])

  function startDrag(e: ReactPointerEvent<HTMLDivElement>, mode: 'move' | 'resize') {
    if (e.button !== 0) return
    const target = e.currentTarget
    try { target.setPointerCapture(e.pointerId) } catch { /* unavailable in jsdom */ }
    const rect = anchorRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 }
    dragRef.current = {
      mode,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originLeft: rect.left,
      originTop: rect.top,
      startScale: scale,
    }
    movedRef.current = false
    setDragging(true)
    e.preventDefault()
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = dragRef.current
    if (!d) return
    if (d.mode === 'move') {
      const dx = e.clientX - d.startX
      const dy = e.clientY - d.startY
      if (Math.abs(dx) + Math.abs(dy) > 4) movedRef.current = true
      setPos({ x: Math.round(d.originLeft + dx), y: Math.round(d.originTop + dy) })
    } else {
      const dx = e.clientX - d.startX
      const dy = e.clientY - d.startY
      setScale(clamp(d.startScale + (dx + dy) / 140, 0.6, 2.5))
    }
  }

  function endDrag() {
    const d = dragRef.current
    const wasTap = d?.mode === 'move' && !movedRef.current
    dragRef.current = null
    setDragging(false)
    if (wasTap && collapsed) setCollapsed(false)
  }

  function toggleSettings() {
    if (settingsOpen) {
      setSettingsOpen(false)
      setPanelPos(null)
      return
    }
    const rect = anchorRef.current?.getBoundingClientRect() ?? null
    const x = rect ? clamp(Math.round(rect.left), 8, Math.max(8, window.innerWidth - 280)) : 18
    const y = rect ? Math.round(rect.bottom + 10) : 220
    setPanelPos({ x, y })
    setSettingsOpen(true)
  }

  function resetPlacement() {
    setPos(null)
    setScale(1)
    try {
      window.localStorage.removeItem('dsh.tcrit.pos')
      window.localStorage.removeItem('dsh.tcrit.scale')
    } catch { /* storage unavailable */ }
  }

  const anchorStyle: CSSProperties = {
    position: 'fixed',
    zIndex: 9999,
    pointerEvents: 'auto',
    transform: `scale(${scale})`,
    transformOrigin: 'top left',
    touchAction: 'none',
  }
  if (pos) {
    anchorStyle.left = pos.x
    anchorStyle.top = pos.y
  } else {
    anchorStyle.right = 18
    anchorStyle.bottom = 130
  }

  const breakdown = usage
    ? lang === 'zh'
      ? `总用量 ${fmt(total)} · 输入 ${fmt(input)} · 缓存读 ${fmt(usage.cacheReadTokens ?? 0)} · 缓存写 ${fmt(usage.cacheWriteTokens ?? 0)} · 输出 ${fmt(output)}`
      : `Total ${fmt(total)} · Input ${fmt(input)} · Cache read ${fmt(usage.cacheReadTokens ?? 0)} · Cache write ${fmt(usage.cacheWriteTokens ?? 0)} · Output ${fmt(output)}`
    : lang === 'zh'
      ? '尚未产生 token 用量'
      : 'No token usage yet'

  const displayNum = numFormat === 'compact' ? compact(shown) : fmt(shown)

  const ambientNodes = ambientParts.map((p, i) => (
    <span
      key={'amb' + i}
      className={css.ambient}
      style={{
        left: p.left + '%',
        top: p.top + '%',
        width: p.size + 'px',
        height: p.size + 'px',
        background: `hsl(${p.hue},100%,66%)`,
        boxShadow: `0 0 4px hsla(${p.hue},100%,60%,.85)`,
        '--dx': p.dx + 'px',
        '--dy': p.dy + 'px',
        animationDuration: p.dur + 's',
        animationDelay: '-' + p.delay + 's',
      } as CSSProperties}
    />
  ))

  let main
  if (collapsed) {
    main = (
      <div
        key="dot"
        className={css.dot}
        title="点击展开 · 拖动移动"
        onPointerDown={(e) => startDrag(e, 'move')}
      >
        {compact(shown)}
      </div>
    )
  } else {
    const badgeClass = [
      css.badge,
      dragging ? css.dragging : '',
      boost ? css.boost : '',
      critKey > 0 ? css.burst : '',
    ].filter(Boolean).join(' ')
    main = (
      <div
        key={'b' + critKey}
        className={badgeClass}
        title="拖动移动 · 双击折叠 · 拖右下角缩放"
        onPointerDown={(e) => startDrag(e, 'move')}
        onDoubleClick={() => { setSettingsOpen(false); setCollapsed(true) }}
      >
        {comboOn && combo >= 2
          ? <span key={'combo' + comboKey} className={css.combo}>{lang === 'zh' ? `×${combo} 连击` : `×${combo} COMBO`}</span>
          : null}
        <span className={css.num} style={{ fontSize: numSize + 'px' }}>{displayNum}</span>
        <span className={css.label} style={{ fontSize: Math.round(numSize * 0.62) + 'px' }}>{lang === 'zh' ? '词元' : 'TOKENS'}</span>
        {ambientNodes}
        {crits.map((c) => (
          <span
            key={c.id}
            className={css.float}
            style={{
              color: `hsl(${c.hue},100%,${c.kind === 'in' ? '66%' : '62%'})`,
              fontSize: c.size + 'px',
              left: c.kind === 'in' ? '38%' : '62%',
              top: '42%',
              textShadow: `0 0 9px hsla(${c.hue},100%,55%,.9)`,
            }}
          >
            {'+' + fmt(c.delta)}
          </span>
        ))}
        {crits.map((c) => {
          const tt = tagText(c)
          return tt
            ? (
              <span
                key={c.id + '-tag'}
                className={css.critTag}
                style={{
                  color: `hsl(${c.hue},100%,${c.kind === 'in' ? '66%' : '62%'})`,
                  fontSize: c.big ? '12px' : '9px',
                  left: c.kind === 'in' ? '38%' : '62%',
                  top: '6%',
                  textShadow: `0 0 10px hsla(${c.hue},100%,55%,.9)`,
                }}
              >
                {tt}
              </span>
              )
            : null
        })}
        {particles.map((p) => (
          <span
            key={p.id}
            className={css.particle}
            style={{
              background: `hsl(${p.hue},100%,60%)`,
              width: p.size + 'px',
              height: p.size + 'px',
              boxShadow: `0 0 6px hsla(${p.hue},100%,55%,.9)`,
              '--dx': p.dx + 'px',
              '--dy': p.dy + 'px',
            } as CSSProperties}
          />
        ))}
        <div
          className={css.gear}
          title="设置"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={toggleSettings}
        >
          ⚙
        </div>
      </div>
    )
  }

  const anchor = (
    <div
      ref={anchorRef}
      className={css.anchor}
      style={anchorStyle}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {main}
      {collapsed ? null : <div className={css.resize} onPointerDown={(e) => startDrag(e, 'resize')} />}
    </div>
  )

  return (
    <>
      {anchor}
      {settingsOpen && panelPos
        ? (
          <div className={css.panel} style={{ left: panelPos.x, top: panelPos.y }}>
            <div className={css.phead}>
              <span className={css.ptitle}>Token 挂件设置</span>
              <button className={css.pclose} onClick={() => { setSettingsOpen(false); setPanelPos(null) }}>✕</button>
            </div>
            <div className={css.srow}>
              <span className={css.slabel}>语言</span>
              <select value={lang} onChange={(e) => setLang(e.target.value)}>
                <option value="zh">中文</option>
                <option value="en">English</option>
              </select>
            </div>
            <div className={css.srow}>
              <span className={css.slabel}>数字格式</span>
              <select value={numFormat} onChange={(e) => setNumFormat(e.target.value)}>
                <option value="full">完整</option>
                <option value="compact">精简</option>
              </select>
            </div>
            <div className={css.srow}>
              <span className={css.slabel}>数字字号</span>
              <input type="range" min={10} max={22} step={1} value={numSize} onChange={(e) => setNumSize(Number(e.target.value) || 14)} />
              <span className={css.sval}>{numSize}px</span>
            </div>
            <div className={css.srow}>
              <span className={css.slabel}>显示标签</span>
              <input type="checkbox" checked={showTags} onChange={(e) => setShowTags(e.target.checked)} />
            </div>
            <div className={css.srow}>
              <span className={css.slabel}>连击</span>
              <input type="checkbox" checked={comboOn} onChange={(e) => setComboOn(e.target.checked)} />
            </div>
            <div className={css.srow}>
              <span className={css.slabel}>常驻粒子</span>
              <input type="checkbox" checked={ambientOn} onChange={(e) => setAmbientOn(e.target.checked)} />
            </div>
            <div className={css.srow}>
              <span className={css.slabel}>粒子数量</span>
              <input type="range" min={3} max={16} step={1} value={ambientCount} onChange={(e) => setAmbientCount(Number(e.target.value) || 7)} />
              <span className={css.sval}>{ambientCount}</span>
            </div>
            <div className={css.srow}>
              <span className={css.slabel}>粒子颜色</span>
              <select value={particleColor} onChange={(e) => setParticleColor(e.target.value)}>
                <option value="gold">金色</option>
                <option value="cyan">青蓝</option>
                <option value="purple">紫</option>
                <option value="multi">多彩</option>
              </select>
            </div>
            <div className={css.srow}>
              <span className={css.slabel}>暴击阈值</span>
              <input type="range" min={500} max={20000} step={500} value={critAbs} onChange={(e) => setCritAbs(Number(e.target.value) || 500)} />
              <span className={css.sval}>{fmt(critAbs)}</span>
            </div>
            <div className={css.srow}>
              <span className={css.slabel}>暴击比例</span>
              <input type="range" min={2} max={30} step={1} value={Math.round(critRatio * 100)} onChange={(e) => setCritRatio((Number(e.target.value) || 2) / 100)} />
              <span className={css.sval}>{Math.round(critRatio * 100)}%</span>
            </div>
            <div className={css.srow}>
              <span className={css.slabel}>暴击音效</span>
              <input type="checkbox" checked={soundOn} onChange={(e) => setSoundOn(e.target.checked)} />
            </div>
            <div className={css.srow}>
              <span className={css.slabel}>边缘泛光</span>
              <input type="checkbox" checked={edgeOn} onChange={(e) => setEdgeOn(e.target.checked)} />
            </div>
            <div className={css.srow} style={{ justifyContent: 'flex-start', gap: 10 }}>
              <button className={css.pbtn} onClick={resetPlacement}>重置位置/缩放</button>
              <button className={css.pbtn} onClick={() => { setSettingsOpen(false); setCollapsed(true) }}>折叠</button>
            </div>
          </div>
          )
        : null}
      {edgeKey > 0 && edgeOn ? <div key={'e' + edgeKey} className={css.edge} /> : null}
    </>
  )
}
