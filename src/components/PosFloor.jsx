import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './Auth'
import { useI18n } from '../lib/i18n'
import { fmtYen } from './utils'
import { schemaMissing } from '../lib/fulfillment'
import { groupSpaces, previewSale } from '../lib/posFloor'

const PAY = ['cash', 'card', 'credit', 'other']

function newKey() {
  return crypto.randomUUID()
}

export default function PosFloor({ bar, drinks = [], shots = [], agents = [], catalogError = '', onSale }) {
  const { t } = useI18n()
  const { user } = useAuth()
  const [spaces, setSpaces] = useState([])
  const [spaceId, setSpaceId] = useState('')
  const [zone, setZone] = useState('table')
  const [cat, setCat] = useState('all')
  const [lines, setLines] = useState([])
  const [pay, setPay] = useState('cash')
  const [agentId, setAgentId] = useState('')
  const [err, setErr] = useState(catalogError || '')
  const [busy, setBusy] = useState(false)
  const [openForm, setOpenForm] = useState(false)
  const [bottleCode, setBottleCode] = useState('')
  const [bottleProduct, setBottleProduct] = useState('')
  const [bottleMl, setBottleMl] = useState('700')
  const [bottles, setBottles] = useState([])
  const keyRef = useRef(newKey())

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
      kind: 'shot',
    })),
  ]), [drinks, shots])
  const cats = ['all', ...new Set(catalog.map(row => row.categoria).filter(Boolean))]
  const visible = catalog.filter(row => cat === 'all' || row.categoria === cat)
  const agent = agents.find(row => row.id === agentId) || null
  let preview = null
  let previewErr = ''
  try {
    if (lines.length) {
      preview = previewSale({
        items: lines,
        catalog,
        bottles,
        agent,
        payment: pay,
        barId: bar.id,
        employeeId: user?.id,
      })
    }
  } catch (e) {
    previewErr = e.message
  }

  function addProduct(product) {
    setErr('')
    keyRef.current = newKey()
    setLines(prev => {
      const hit = prev.find(row => (row.drink_menu_id || row.produto_id) === product.id)
      if (hit) {
        return prev.map(row => (row.drink_menu_id || row.produto_id) === product.id ? { ...row, qtd: row.qtd + 1 } : row)
      }
      return [...prev, {
        drink_menu_id: product.kind === 'drink' ? product.id : null,
        produto_id: product.kind === 'shot' ? product.id : null,
        qtd: 1,
        forCast: false,
      }]
    })
  }

  function bump(index, delta) {
    keyRef.current = newKey()
    setLines(prev => prev.map((row, i) => i === index ? { ...row, qtd: row.qtd + delta } : row).filter(row => row.qtd > 0))
  }

  async function charge() {
    if (!lines.length || busy) return
    setBusy(true)
    setErr('')
    const saved = await supabase.rpc('pos_save_ticket', {
      p_bar: bar.id,
      p_ticket: null,
      p_space: spaceId || null,
      p_guest: '',
      p_items: lines,
    })
    if (saved.error) {
      setErr(saved.error.message)
      setBusy(false)
      return
    }
    const closed = await supabase.rpc('pos_close_ticket', {
      p_bar: bar.id,
      p_ticket: saved.data,
      p_payment: pay,
      p_key: keyRef.current,
      p_agent: agentId || null,
    })
    setBusy(false)
    if (closed.error) {
      setErr(closed.error.message)
      return
    }
    setLines([])
    setSpaceId('')
    keyRef.current = newKey()
    onSale?.()
  }

  async function openBottle() {
    setErr('')
    const { error } = await supabase.rpc('pos_open_bottle', {
      p_bar: bar.id,
      p_produto: bottleProduct,
      p_code: bottleCode,
      p_volume: Math.round(+bottleMl || 0),
    })
    if (error) {
      setErr(error.message)
      return
    }
    setOpenForm(false)
    const board = await supabase.rpc('pos_bottle_board', { p_bar: bar.id })
    if (!board.error) setBottles(board.data || [])
  }

  const space = spaces.find(row => row.id === spaceId)

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
          <button key={row.id} type="button" className={spaceId === row.id ? 'is-on' : ''} onClick={() => setSpaceId(row.id)}>
            {row.nome}
          </button>
        ))}
        {(groups[zone] || []).length === 0 && <span className="pos-floor-empty">{t('posFloor.noSpaces')}</span>}
      </div>

      <div className="pos-floor-ticket">
        <strong>{space?.nome || t('posFloor.pickSpace')}</strong>
        {lines.length === 0 && <div className="pos-floor-empty">{t('posFloor.emptyTicket')}</div>}
        {lines.map((line, index) => {
          const product = catalog.find(row => row.id === (line.drink_menu_id || line.produto_id))
          const unit = product ? Math.round(+product.preco_venda || +product.preco_drink || 0) : 0
          return (
            <div key={index} className="pos-floor-line">
              <div>
                <div>{product?.nome || t('posFloor.unknown')}</div>
                <button type="button" onClick={() => setLines(prev => prev.map((row, i) => i === index ? { ...row, forCast: !row.forCast } : row))}>
                  {line.forCast ? t('posFloor.sheDrank') : t('posFloor.markGuest')}
                </button>
              </div>
              <div>{fmtYen(unit)} × {line.qtd}</div>
              <div className="pos-floor-qty">
                <button type="button" onClick={() => bump(index, -1)}>-</button>
                <button type="button" onClick={() => bump(index, 1)}>+</button>
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
      </div>

      {(err || previewErr) && <div className="pos-sale-err">{err || previewErr}</div>}

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
        <select value={agentId} onChange={e => setAgentId(e.target.value)}>
          <option value="">{t('posFloor.noCast')}</option>
          {agents.filter(row => row.ativo !== false).map(row => (
            <option key={row.id} value={row.id}>{row.nome}</option>
          ))}
        </select>
        {PAY.map(id => (
          <button key={id} type="button" className={pay === id ? 'is-on' : ''} onClick={() => setPay(id)}>{t(`posFloor.pay_${id}`)}</button>
        ))}
        <button type="button" onClick={() => setOpenForm(v => !v)}>{t('posFloor.openBottle')}</button>
        <button type="button" className="pos-floor-charge" disabled={busy || !lines.length} onClick={charge}>
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
          <input value={bottleMl} onChange={e => setBottleMl(e.target.value)} inputMode="numeric" />
          <button type="button" onClick={openBottle}>{t('posFloor.confirmOpen')}</button>
        </div>
      )}

      <div className="pos-floor-bottles">
        {(Array.isArray(bottles) ? bottles : []).filter(row => row.status === 'opened').slice(0, 6).map(row => (
          <div key={row.id}>{row.code} · {row.volume_atual} ml</div>
        ))}
      </div>
    </div>
  )
}
