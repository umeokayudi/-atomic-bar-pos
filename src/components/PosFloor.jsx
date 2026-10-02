import { useEffect, useMemo, useState } from 'react'
import { isLocalDemo, supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { schemaMissing } from '../lib/fulfillment'
import { groupSpaces } from '../lib/posFloor'
import { readPosDeviceMode, suggestPosDeviceMode, writePosDeviceMode } from '../lib/posDeviceMode'
import { fmtYen } from './utils'
import PosModePicker from './pos/PosModePicker'
import PosMobile from './pos/PosMobile'
import PosTablet from './pos/PosTablet'

const PAY = ['cash', 'card', 'credit', 'other']
const BOTTLE_MOVES = ['waste', 'breakage', 'spill', 'complimentary', 'adjustment']

function closeKey(ticketId) {
  const storageKey = `pos-close:${ticketId}`
  const existing = sessionStorage.getItem(storageKey)
  if (existing) return existing
  const created = crypto.randomUUID()
  sessionStorage.setItem(storageKey, created)
  return created
}

export default function PosFloor({ bar, drinks = [], shots = [], agents = [], catalogError = '', onSale }) {
  const { t } = useI18n()
  const [spaces, setSpaces] = useState([])
  const [spaceId, setSpaceId] = useState('')
  const [zone, setZone] = useState('table')
  const [cat, setCat] = useState('all')
  const [ticket, setTicket] = useState(null)
  const [lines, setLines] = useState([])
  const [preview, setPreview] = useState(null)
  const [pay, setPay] = useState('cash')
  const [agentId, setAgentId] = useState('')
  const [err, setErr] = useState(catalogError || '')
  const [busy, setBusy] = useState(false)
  const [openForm, setOpenForm] = useState(false)
  const [bottleCode, setBottleCode] = useState('')
  const [bottleProduct, setBottleProduct] = useState('')
  const [bottles, setBottles] = useState([])
  const [lossBottle, setLossBottle] = useState('')
  const [lossKind, setLossKind] = useState('waste')
  const [lossMl, setLossMl] = useState('')
  const [lossReason, setLossReason] = useState('')
  const [userId, setUserId] = useState('')
  const [modeReady, setModeReady] = useState(false)
  const [mode, setMode] = useState(null)
  const [asking, setAsking] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [step, setStep] = useState('tables')
  const [pendingRemove, setPendingRemove] = useState(null)
  const [receipt, setReceipt] = useState(null)
  const [lossAsk, setLossAsk] = useState(false)
  const [orientation, setOrientation] = useState(() => (
    typeof window !== 'undefined' && window.innerHeight >= window.innerWidth ? 'portrait' : 'landscape'
  ))

  useEffect(() => { setErr(catalogError || '') }, [catalogError])

  useEffect(() => {
    let cancelled = false
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      const id = data.session?.user?.id || ''
      setUserId(id)
      const saved = readPosDeviceMode(id)
      const next = saved || suggestPosDeviceMode({ width: window.innerWidth, height: window.innerHeight })
      if (!saved) writePosDeviceMode(id, next)
      setMode(next)
      setAsking(false)
      setModeReady(true)
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const read = () => setOrientation(window.innerHeight >= window.innerWidth ? 'portrait' : 'landscape')
    window.addEventListener('resize', read)
    return () => window.removeEventListener('resize', read)
  }, [])

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return undefined
    const lift = () => {
      const covered = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
      document.documentElement.style.setProperty('--pos-keyboard', `${covered}px`)
    }
    vv.addEventListener('resize', lift)
    vv.addEventListener('scroll', lift)
    return () => {
      vv.removeEventListener('resize', lift)
      vv.removeEventListener('scroll', lift)
    }
  }, [])

  function saveMode(next) {
    writePosDeviceMode(userId, next)
    setMode(next)
    setAsking(false)
    setSettingsOpen(false)
  }

  useEffect(() => {
    let cancelled = false
    Promise.all([
      supabase.from('bar_spaces').select('id,nome,tipo,zona,ativo').eq('bar_id', bar.id).eq('ativo', true).order('ordem'),
      supabase.rpc('pos_bottle_board', { p_bar: bar.id }),
    ]).then(([spacesRes, boardRes]) => {
      if (cancelled) return
      if (spacesRes.error) setErr(spacesRes.error.message)
      else setSpaces(spacesRes.data || [])
      if (boardRes.error && !schemaMissing(boardRes.error)) setErr(boardRes.error.message)
      else setBottles(boardRes.data || [])
    })
    return () => { cancelled = true }
  }, [bar.id])

  const groups = groupSpaces(spaces)
  const catalog = useMemo(() => ([
    ...(drinks || []).map(d => ({ ...d, id: d.id, kind: 'drink' })),
    ...(shots || []).map(s => ({
      id: s.produto_id,
      produto_id: s.produto_id,
      nome: s.produtos?.nome || s.nome,
      categoria: s.produtos?.categoria || 'Other',
      preco_venda: s.preco_drink,
      volume_ml: s.produtos?.volume_ml,
      kind: 'shot',
    })),
  ]), [drinks, shots])
  const cats = ['all', ...new Set(catalog.map(row => row.categoria).filter(Boolean))]
  const visible = catalog.filter(row => cat === 'all' || row.categoria === cat)
  const space = spaces.find(row => row.id === spaceId)
  const blocked = preview?.blocked || ''

  async function refreshPreview(ticketId, payment = pay, agent = agentId) {
    if (!ticketId) {
      setPreview(null)
      return
    }
    const res = await supabase.rpc('pos_preview_ticket', {
      p_bar: bar.id,
      p_ticket: ticketId,
      p_payment: payment,
      p_agent: agent || null,
    })
    if (res.error) {
      if (!schemaMissing(res.error)) setErr(res.error.message)
      setPreview(null)
      return
    }
    setPreview(res.data || null)
  }

  async function loadSpace(id) {
    if (!id) {
      setTicket(null)
      setLines([])
      setPreview(null)
      return
    }
    const res = await supabase.rpc('pos_load_ticket', { p_bar: bar.id, p_space: id, p_guest: '' })
    if (res.error) {
      setErr(res.error.message)
      return
    }
    const row = res.data || {}
    setTicket(row)
    setLines(row.items || [])
    await refreshPreview(row.id)
  }

  async function chooseSpace(id) {
    setErr('')
    setSpaceId(id)
    await loadSpace(id)
    setStep('products')
  }

  function requestQty(line, qtd) {
    if (qtd < 1) {
      setPendingRemove(line)
      return
    }
    changeItem(line, qtd)
  }

  function confirmRemove() {
    const line = pendingRemove
    setPendingRemove(null)
    if (line) changeItem(line, 0)
  }

  function askLoss() {
    if (!lossBottle || !lossReason.trim()) {
      setErr(t('posFloor.reasonRequired'))
      return
    }
    setLossAsk(true)
  }

  async function confirmLoss() {
    setLossAsk(false)
    await postBottleLoss()
  }

  async function addProduct(product) {
    if (!spaceId || busy) {
      setErr(t('posFloor.pickSpace'))
      return
    }
    setBusy(true)
    setErr('')
    let ticketId = ticket?.id
    if (!ticketId) {
      const opened = await supabase.rpc('pos_load_ticket', { p_bar: bar.id, p_space: spaceId, p_guest: '' })
      if (opened.error) {
        setErr(opened.error.message)
        setBusy(false)
        return
      }
      ticketId = opened.data?.id
      setTicket(opened.data)
    }
    const saved = await supabase.rpc('pos_ticket_item', {
      p_bar: bar.id,
      p_ticket: ticketId,
      p_item: null,
      p_qtd: 1,
      p_for_cast: false,
      p_drink: product.kind === 'drink' ? product.id : null,
      p_produto: product.kind === 'shot' ? product.id : null,
    })
    setBusy(false)
    if (saved.error) {
      setErr(saved.error.message)
      return
    }
    await loadSpace(spaceId)
  }

  async function changeItem(line, qtd, forCast = line.for_cast) {
    if (!ticket?.id || busy) return
    setBusy(true)
    setErr('')
    const saved = await supabase.rpc('pos_ticket_item', {
      p_bar: bar.id,
      p_ticket: ticket.id,
      p_item: line.id,
      p_qtd: qtd,
      p_for_cast: forCast,
      p_drink: null,
      p_produto: null,
    })
    setBusy(false)
    if (saved.error) {
      setErr(saved.error.message)
      return
    }
    await loadSpace(spaceId)
  }

  async function applyDiscount(rate) {
    if (!isLocalDemo || !ticket?.id || busy) return
    setBusy(true)
    setErr('')
    const saved = await supabase.rpc('pos_apply_discount', { p_ticket: ticket.id, p_rate: rate })
    setBusy(false)
    if (saved.error) {
      setErr(saved.error.message)
      return
    }
    await refreshPreview(ticket.id)
  }

  async function charge() {
    if (!ticket?.id || !lines.length || busy || blocked) return
    setBusy(true)
    setErr('')
    const key = isLocalDemo ? `demo-${ticket.id}` : closeKey(ticket.id)
    const closed = await supabase.rpc('pos_close_ticket', {
      p_bar: bar.id,
      p_ticket: ticket.id,
      p_payment: pay,
      p_key: key,
      p_agent: agentId || null,
    })
    setBusy(false)
    if (closed.error) {
      setErr(closed.error.message)
      return
    }
    if (!isLocalDemo) sessionStorage.removeItem(`pos-close:${ticket.id}`)
    if (closed.data?.receipt) setReceipt({ ...closed.data.receipt, space: space?.nome || '' })
    setTicket(null)
    setLines([])
    setPreview(null)
    setSpaceId('')
    onSale?.()
  }

  async function openBottle() {
    setErr('')
    const { error } = await supabase.rpc('pos_open_bottle', {
      p_bar: bar.id,
      p_produto: bottleProduct,
      p_code: bottleCode,
    })
    if (error) {
      setErr(error.message)
      return
    }
    setOpenForm(false)
    const board = await supabase.rpc('pos_bottle_board', { p_bar: bar.id })
    if (!board.error) setBottles(board.data || [])
    if (ticket?.id) await refreshPreview(ticket.id)
  }

  async function reloadBoard() {
    const board = await supabase.rpc('pos_bottle_board', { p_bar: bar.id })
    if (!board.error) setBottles(board.data || [])
  }

  async function postBottleLoss() {
    if (!lossBottle || busy) return
    if (!lossReason.trim()) {
      setErr(t('posFloor.reasonRequired'))
      return
    }
    setBusy(true)
    setErr('')
    const { error } = await supabase.rpc('pos_bottle_move', {
      p_bottle: lossBottle,
      p_kind: lossKind,
      p_volume: Math.round(+lossMl || 0),
      p_reason: lossReason.trim(),
    })
    setBusy(false)
    if (error) {
      setErr(error.message)
      return
    }
    setLossMl('')
    setLossReason('')
    await reloadBoard()
  }

  async function changePay(id) {
    setPay(id)
    if (ticket?.id) await refreshPreview(ticket.id, id, agentId)
  }

  async function changeAgent(id) {
    setAgentId(id)
    if (ticket?.id) await refreshPreview(ticket.id, pay, id)
  }

  const selectedBottle = shots.find(row => row.produto_id === bottleProduct)
  const suggested = suggestPosDeviceMode({ width: window.innerWidth, height: window.innerHeight })
  const floor = {
    zone, zones: ['table', 'vip', 'floor', 'counter'], spaces: groups[zone] || [], space, spaceId,
    cats, cat, setCat, visible, lines, preview, blocked, err, busy, pay, payments: PAY,
    agents, agentId, bottles, openForm, setOpenForm, bottleProduct, setBottleProduct,
    bottleCode, setBottleCode, shots, lossBottle, setLossBottle, lossKind, setLossKind,
    lossMl, setLossMl, lossReason, setLossReason, bottleMoves: BOTTLE_MOVES,
    step, setStep, sheet: step === 'ticket', pendingRemove, setPendingRemove, lossAsk, setLossAsk,
    selectedBottle, catalogError, catalog, orientation, setZone, chooseSpace, addProduct,
    changeItem, requestQty, confirmRemove, charge, applyDiscount: isLocalDemo ? applyDiscount : null,
    changePay, changeAgent, openBottle, askLoss,
    confirmLoss, openSettings: () => setSettingsOpen(true),
  }

  if (!modeReady) return null

  return (
    <>
      {(asking || settingsOpen) && (
        <PosModePicker
          t={t}
          suggested={mode || suggested}
          settings={settingsOpen && !asking}
          onChoose={saveMode}
        />
      )}
      {mode === 'tablet'
        ? <PosTablet t={t} floor={floor} />
        : mode === 'mobile'
          ? <PosMobile t={t} floor={floor} />
          : null}
      {receipt && (
        <div className="demo-receipt" role="dialog" aria-label="DEMO receipt">
          <article>
            <p className="eyebrow">DEMO</p>
            <h2>{receipt.id}</h2>
            <p>{receipt.space} · {receipt.method}</p>
            <ul>
              {receipt.lines.map(line => (
                <li key={`${line.nome}-${line.qtd}`}>{line.nome} × {line.qtd} · {fmtYen(line.total)}</li>
              ))}
            </ul>
            <p>Subtotal {fmtYen(receipt.listSubtotal)}</p>
            <p>Discount {fmtYen(receipt.discount)}</p>
            <p><strong>Total {fmtYen(receipt.total)}</strong></p>
            <p className="work-quiet">{receipt.note}</p>
            <button type="button" className="action-primary" onClick={() => setReceipt(null)}>Close receipt</button>
          </article>
        </div>
      )}
    </>
  )
}
