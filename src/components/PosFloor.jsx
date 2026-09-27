import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { fmtYen } from './utils'
import { schemaMissing } from '../lib/fulfillment'
import { groupSpaces } from '../lib/posFloor'

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

  useEffect(() => { setErr(catalogError || '') }, [catalogError])

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

  async function charge() {
    if (!ticket?.id || !lines.length || busy || blocked) return
    setBusy(true)
    setErr('')
    const key = closeKey(ticket.id)
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
    sessionStorage.removeItem(`pos-close:${ticket.id}`)
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

  return (
    <div className="pos-floor">
      <div className="pos-floor-zones">
        {['table', 'vip', 'floor', 'counter'].map(id => (
          <button key={id} type="button" className={zone === id ? 'is-on' : ''} onClick={() => setZone(id)}>
            {t(`posFloor.zone_${id}`)}
          </button>
        ))}
      </div>
      <div className="pos-floor-spaces">
        {(groups[zone] || []).map(row => (
          <button key={row.id} type="button" className={spaceId === row.id ? 'is-on' : ''} onClick={() => chooseSpace(row.id)}>
            {row.nome}
          </button>
        ))}
        {(groups[zone] || []).length === 0 && <span className="pos-floor-empty">{t('posFloor.noSpaces')}</span>}
      </div>

      <div className="pos-floor-ticket">
        <strong>{space?.nome || t('posFloor.pickSpace')}</strong>
        {lines.length === 0 && <div className="pos-floor-empty">{t('posFloor.emptyTicket')}</div>}
        {lines.map(line => {
          const shown = (preview?.lines || []).find(row => row.id === line.id)
          const product = catalog.find(row => row.id === (line.drink_menu_id || line.produto_id))
          return (
            <div key={line.id} className="pos-floor-line">
              <div>
                <div>{shown?.nome || product?.nome || t('posFloor.unknown')}</div>
                <button type="button" onClick={() => changeItem(line, line.qtd, !line.for_cast)}>
                  {line.for_cast ? t('posFloor.sheDrank') : t('posFloor.markGuest')}
                </button>
              </div>
              <div>
                {fmtYen(shown?.unit_price || 0)} × {line.qtd}
                {shown?.mode === 'ml' && (
                  <div className="pos-floor-meta">
                    {t('posFloor.recipe')} {shown.required_ml || 0} ml · {t('posFloor.available')} {shown.available_ml || 0} ml
                  </div>
                )}
              </div>
              <div className="pos-floor-qty">
                <button type="button" onClick={() => changeItem(line, line.qtd - 1)}>-</button>
                <button type="button" onClick={() => changeItem(line, line.qtd + 1)}>+</button>
              </div>
            </div>
          )
        })}
        <div className="pos-floor-total">
          <span>{t('posFloor.total')}</span>
          <strong>{fmtYen(preview?.subtotal || 0)}</strong>
        </div>
        {preview && (
          <div className="pos-floor-meta">
            {t('posFloor.fee')} {fmtYen(preview.fee)} · {t('posFloor.net')} {fmtYen(preview.net)} · {t('posFloor.commission')} {fmtYen(preview.commission)}
          </div>
        )}
        {blocked && <div className="pos-sale-err">{blocked}</div>}
      </div>

      {err && <div className="pos-sale-err">{err}</div>}

      <div className="pos-floor-cats">
        {cats.map(id => (
          <button key={id} type="button" className={cat === id ? 'is-on' : ''} onClick={() => setCat(id)}>{id}</button>
        ))}
      </div>
      <div className="pos-floor-grid">
        {visible.map(product => (
          <button key={product.id} type="button" className="pos-floor-card" onClick={() => addProduct(product)}>
            <span>{product.nome}</span>
            <strong>{fmtYen(product.preco_venda || product.preco_drink || 0)}</strong>
          </button>
        ))}
        {visible.length === 0 && <div className="pos-floor-empty">{catalogError ? catalogError : t('posFloor.noProducts')}</div>}
      </div>

      <div className="pos-floor-pay">
        <select value={agentId} onChange={e => changeAgent(e.target.value)}>
          <option value="">{t('posFloor.noCast')}</option>
          {agents.filter(row => row.ativo !== false).map(row => (
            <option key={row.id} value={row.id}>{row.nome}</option>
          ))}
        </select>
        {PAY.map(id => (
          <button key={id} type="button" className={pay === id ? 'is-on' : ''} onClick={() => changePay(id)}>{t(`posFloor.pay_${id}`)}</button>
        ))}
        <button type="button" onClick={() => setOpenForm(v => !v)}>{t('posFloor.openBottle')}</button>
        <button type="button" className="pos-floor-charge" disabled={busy || !lines.length || !!blocked} onClick={charge}>
          {busy ? t('posFloor.saving') : t('posFloor.charge')}
        </button>
      </div>

      {openForm && (
        <div className="pos-floor-open">
          <select value={bottleProduct} onChange={e => setBottleProduct(e.target.value)}>
            <option value="">{t('posFloor.product')}</option>
            {shots.map(row => (
              <option key={row.produto_id} value={row.produto_id}>{row.produtos?.nome || row.produto_id}</option>
            ))}
          </select>
          <input value={bottleCode} onChange={e => setBottleCode(e.target.value)} placeholder={t('posFloor.bottleCode')} />
          <span className="pos-floor-meta">
            {selectedBottle?.produtos?.volume_ml
              ? `${selectedBottle.produtos.volume_ml} ml`
              : t('posFloor.volumeCatalog')}
          </span>
          <button type="button" onClick={openBottle}>{t('posFloor.confirmOpen')}</button>
        </div>
      )}

      <div className="pos-floor-bottles">
        {(Array.isArray(bottles) ? bottles : []).filter(row => row.status === 'opened').slice(0, 6).map(row => (
          <button key={row.id} type="button" className={lossBottle === row.id ? 'is-on' : ''} onClick={() => setLossBottle(row.id)}>
            {row.produto_nome ? `${row.produto_nome} · ` : ''}{row.code} · {row.volume_atual}/{row.volume_original} ml
            {row.remaining_pct != null ? ` · ${row.remaining_pct}%` : ''}
          </button>
        ))}
      </div>
      {lossBottle && (
        <div className="pos-floor-open">
          <select value={lossKind} onChange={e => setLossKind(e.target.value)}>
            {BOTTLE_MOVES.map(kind => (
              <option key={kind} value={kind}>{t(`posFloor.move_${kind}`)}</option>
            ))}
          </select>
          <input value={lossMl} onChange={e => setLossMl(e.target.value)} inputMode="numeric" placeholder={t('posFloor.moveMl')} />
          <input value={lossReason} onChange={e => setLossReason(e.target.value)} placeholder={t('posFloor.moveReason')} />
          <button type="button" onClick={postBottleLoss}>{t('posFloor.moveSave')}</button>
        </div>
      )}
    </div>
  )
}
