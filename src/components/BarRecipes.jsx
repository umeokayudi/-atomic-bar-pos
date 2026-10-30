import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from './ui/Icon'
import PhotoField from './ui/PhotoField'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { fmtYen, Spinner, isSupplierProduct } from './utils'
import {
  lineCost, lineFromProduct, marginPct, marginTone, parseRecipe, recipeCost, serializeRecipe, suggestPrices,
} from '../lib/recipe'
import './BarRecipes.css'
import { askConfirm, notify } from './ui/ConfirmDialog'

const SPIRITS = /gin|vodka|rum|tequila|whisk|shochu|spirit|liqueur|brandy|cognac|sake/i
const ML_CHIPS = [15, 30, 45, 60, 90]
const BOTTLE_DRINKS = [1, 8, 12, 16, 25]

function Sheet({ title, onClose, children, footer }) {
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey) }
  }, [onClose])
  return (
    <div className="rb-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="rb-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="rb-sheet-head">
          <div className="rb-sheet-title">{title}</div>
          <button type="button" className="rb-icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
        </div>
        <div className="rb-sheet-body">{children}</div>
        {footer && <div className="rb-sheet-foot">{footer}</div>}
      </div>
    </div>
  )
}

const toneVar = tone => tone === 'good' ? 'var(--c-success)' : tone === 'ok' ? 'var(--c-warning)' : tone === 'low' ? 'var(--c-danger)' : 'var(--text3)'

// ── PRICES PER BOTTLE ────────────────────────────────────────────────────────
export function PricingTab({ bar }) {
  const { t } = useI18n()
  const [produtos, setProdutos] = useState([])
  const [pricing, setPricing] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState(null)
  const [form, setForm] = useState({ drinks: '', preco: '' })
  const [search, setSearch] = useState('')

  useEffect(() => { load() }, [bar]) // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    const [pR, prR] = await Promise.all([
      supabase.from('produtos_public').select('*').eq('ativo', true).order('categoria').order('nome'),
      supabase.from('bar_pricing').select('*').eq('bar_id', bar.id),
    ])
    setProdutos((pR.data || []).filter(isSupplierProduct))
    const pMap = {}
    ;(prR.data || []).forEach(p => { pMap[p.produto_id] = p })
    setPricing(pMap)
    setLoading(false)
  }

  async function savePricing() {
    const drinks = parseFloat(form.drinks)
    const preco = parseFloat(form.preco)
    if (!drinks || !preco) return
    setSaving(true)
    await supabase.from('bar_pricing').upsert(
      { bar_id: bar.id, produto_id: selected, drinks_por_garrafa: drinks, preco_drink: preco },
      { onConflict: 'bar_id,produto_id' }
    )
    setSaving(false)
    setSelected(null)
    setForm({ drinks: '', preco: '' })
    load()
  }

  const list = produtos.map(p => {
    const pr = pricing[p.id]
    const drinks = pr?.drinks_por_garrafa || 0
    const preco = pr?.preco_drink || 0
    const custo_drink = drinks > 0 ? Math.round(p.preco_venda / drinks) : 0
    const margem = preco > 0 && custo_drink > 0 ? Math.round((preco - custo_drink) / preco * 100) : null
    const revenue_garrafa = drinks > 0 ? drinks * preco : 0
    return { ...p, drinks, preco, custo_drink, margem, revenue_garrafa }
  })

  const configured = list.filter(p => p.drinks > 0 && p.preco > 0)
  const notConfigured = list.length - configured.length
  const q = search.trim().toLowerCase()
  const filtered = q ? list.filter(p => p.nome.toLowerCase().includes(q) || String(p.categoria).toLowerCase().includes(q)) : list
  const cats = [...new Set(filtered.map(p => p.categoria))]
  const withMargin = configured.filter(p => p.margem !== null)
  const avg = withMargin.length ? Math.round(withMargin.reduce((a, p) => a + p.margem, 0) / withMargin.length) : 0
  const best = [...withMargin].sort((a, b) => b.margem - a.margem)[0]
  const sel = list.find(p => p.id === selected)

  const fDrinks = parseFloat(form.drinks) || 0
  const fPreco = parseFloat(form.preco) || 0
  const fCost = sel && fDrinks > 0 ? Math.round(sel.preco_venda / fDrinks) : 0
  const fMargin = fCost > 0 && fPreco > 0 ? marginPct(fPreco, fCost) : null

  if (loading) return <Spinner text={t('portal.pricing.loading')} />

  return (
    <div className="fade-in bp-page">
      <div className="rb-head">
        <div>
          <div className="rb-title">{t('portal.pricing.title')}</div>
          <div className="rb-sub">{t('portal.pricing.subtitle')}</div>
        </div>
        <div className="rb-count"><b>{configured.length}</b><span>{t('portal.pricing.configured')}</span></div>
      </div>

      <div className="rb-search">
        <Icon name="search" size={16} />
        <input type="search" placeholder={t('portal.pricing.search')} value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {configured.length > 0 && (
        <div className="rb-kpis">
          <div className="rb-kpi"><span>{t('portal.pricing.avgMargin')}</span><b style={{ color: toneVar(marginTone(avg)) }}>{avg}%</b></div>
          <div className="rb-kpi"><span>{t('portal.pricing.bestMargin')}</span><b className="rb-ellipsis">{best?.nome || '—'}</b></div>
          <div className="rb-kpi"><span>{t('portal.pricing.notSet')}</span><b style={{ color: notConfigured ? 'var(--c-warning)' : 'var(--c-success)' }}>{notConfigured}</b></div>
        </div>
      )}

      {cats.map(cat => (
        <div key={cat} className="rb-group">
          <div className="rb-group-title">{cat}</div>
          <div className="rb-list">
            {filtered.filter(p => p.categoria === cat).map(p => {
              const isSet = p.drinks > 0 && p.preco > 0
              const tone = isSet ? marginTone(p.margem) : 'none'
              return (
                <div key={p.id} className={'bp-card' + (isSet ? '' : ' is-unset')}>
                  <span className="bp-dot" style={{ background: toneVar(tone) }} />
                  <div className="bp-name">
                    <div className="bp-title">{p.nome}</div>
                    <div className="bp-meta">
                      {t('portal.pricing.jbmCost', { amount: fmtYen(p.preco_venda) })}
                      {isSet && <> · {t('portal.pricing.drinksBottle', { count: p.drinks, amount: fmtYen(p.custo_drink) })}</>}
                    </div>
                  </div>
                  {isSet && (
                    <div className="bp-stats">
                      <div><b>{fmtYen(p.preco)}</b><span>{t('portal.pricing.priceDrink')}</span></div>
                      <div><b style={{ color: toneVar(tone) }}>{p.margem}%</b><span>{t('portal.pricing.margin')}</span></div>
                      <div><b style={{ color: 'var(--c-success)' }}>{fmtYen(p.revenue_garrafa)}</b><span>{t('portal.pricing.revBottle')}</span></div>
                    </div>
                  )}
                  <button type="button" className={'bp-edit' + (isSet ? '' : ' is-primary')}
                    onClick={() => { setSelected(p.id); setForm({ drinks: p.drinks || '', preco: p.preco || '' }) }}>
                    {isSet ? t('portal.pricing.edit') : t('portal.pricing.setPrice')}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {sel && (
        <Sheet title={sel.nome} onClose={() => setSelected(null)} footer={
          <div className="rb-foot-actions">
            <button type="button" className="rb-btn" onClick={() => setSelected(null)}>{t('recipes.cancel')}</button>
            <button type="button" className="rb-btn is-primary" onClick={savePricing} disabled={!fDrinks || !fPreco || saving}>
              {saving ? t('recipes.saving') : t('recipes.savePricing')}
            </button>
          </div>
        }>
          <div className="rb-note">{t('portal.pricing.jbmCostBottle')}: <strong>{fmtYen(sel.preco_venda)}</strong></div>
          <label className="rb-label">{t('portal.pricing.drinksPerBottle')}</label>
          <input className="rb-input" type="number" inputMode="numeric" min="1" step="1" value={form.drinks}
            onChange={e => setForm({ ...form, drinks: e.target.value })} placeholder={t('portal.pricing.drinksPlaceholder')} />
          <div className="rb-chips">
            {BOTTLE_DRINKS.map(n => (
              <button key={n} type="button" className={'rb-chip' + (fDrinks === n ? ' is-on' : '')} onClick={() => setForm({ ...form, drinks: n })}>{n}</button>
            ))}
          </div>
          <label className="rb-label">{t('portal.pricing.yourPrice')}</label>
          <input className="rb-input" type="number" inputMode="numeric" min="0" value={form.preco}
            onChange={e => setForm({ ...form, preco: e.target.value })} placeholder={t('portal.pricing.pricePlaceholder')} />
          {fCost > 0 && (
            <div className="rb-chips">
              {suggestPrices(fCost).map(s => (
                <button key={s.price} type="button" className={'rb-chip' + (fPreco === s.price ? ' is-on' : '')} onClick={() => setForm({ ...form, preco: s.price })}>
                  {fmtYen(s.price)} · {s.margin}%
                </button>
              ))}
            </div>
          )}
          {fCost > 0 && (
            <div className="rb-summary">
              <div><span>{t('recipes.cost')}</span><b style={{ color: 'var(--c-danger)' }}>{fmtYen(fCost)}</b></div>
              <div><span>{t('recipes.margin')}</span><b style={{ color: toneVar(marginTone(fMargin)) }}>{fMargin == null ? '—' : fMargin + '%'}</b></div>
              <div><span>{t('portal.pricing.revBottle')}</span><b>{fPreco ? fmtYen(Math.round(fDrinks * fPreco)) : '—'}</b></div>
            </div>
          )}
        </Sheet>
      )}
    </div>
  )
}

// ── RECIPE EDITOR ────────────────────────────────────────────────────────────
function RecipeEditor({ bar, drink, produtos, cats, onClose, onSaved }) {
  const { t } = useI18n()
  const [form, setForm] = useState(() => ({
    nome: drink?.nome || '',
    categoria: drink?.categoria || 'Custom',
    copo: drink?.copo || '',
    preco_venda: drink?.preco_venda ?? '',
    preco_desconto: drink?.preco_desconto ?? '',
    notas: drink?.notas || '',
    imagem_url: drink?.imagem_url || '',
    custo: drink?.custo ?? '',
  }))
  const [lines, setLines] = useState(() => parseRecipe(drink?.receita || '', produtos))
  const [q, setQ] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [moreOpen, setMoreOpen] = useState(() => !!(drink?.copo || drink?.notas || drink?.imagem_url))
  const listEnd = useRef(null)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const setLine = (i, patch) => setLines(ls => ls.map((l, j) => j === i ? { ...l, ...patch } : l))
  const addLine = l => { setLines(ls => [...ls, l]); setQ(''); setTimeout(() => listEnd.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 30) }

  const results = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return []
    return produtos.filter(p => p.nome.toLowerCase().includes(s) || String(p.categoria || '').toLowerCase().includes(s)).slice(0, 8)
  }, [q, produtos])

  const { total: autoCost, complete } = recipeCost(lines)
  const cost = complete ? autoCost : (parseFloat(form.custo) || 0)
  const price = parseFloat(form.preco_venda) || 0
  const margin = marginPct(price, cost)
  const tone = marginTone(margin)
  const savedCost = drink?.custo
  const canSave = form.nome.trim() && price > 0 && !saving

  async function save() {
    if (!canSave) return
    setSaving(true); setErr('')
    const receita = lines.length ? serializeRecipe(lines) : (drink?.receita || '')
    const payload = {
      bar_id: bar.id,
      nome: form.nome.trim(),
      categoria: form.categoria || 'Custom',
      receita,
      copo: form.copo || '',
      preco_venda: price,
      custo: Math.round(cost),
      margem: price > 0 ? (price - cost) / price : 0,
      preco_desconto: +form.preco_desconto || 500,
      notas: form.notas || '',
      custom: drink ? !!drink.custom : true,
    }
    // Only send the photo when there is one: databases without pos_start.sql have no imagem_url column yet.
    if (form.imagem_url?.trim()) payload.imagem_url = form.imagem_url.trim()
    const res = drink?.id
      ? await supabase.from('drink_menu').update(payload).eq('id', drink.id)
      : await supabase.from('drink_menu').insert(payload)
    setSaving(false)
    if (res.error) { setErr(t('recipes.saveErr', { error: res.error.message })); return }
    onSaved()
  }

  const footer = (
    <>
      <div className="rb-summary is-foot">
        <div><span>{t('recipes.cost')}</span><b style={{ color: 'var(--c-danger)' }}>{cost > 0 ? fmtYen(cost) : '—'}</b></div>
        <div><span>{t('recipes.margin')}</span><b style={{ color: toneVar(tone) }}>{margin == null || !(cost > 0) ? '—' : margin + '%'}</b></div>
        <div><span>{t('recipes.profit')}</span><b style={{ color: 'var(--c-success)' }}>{price > 0 && cost > 0 ? fmtYen(price - cost) : '—'}</b></div>
      </div>
      {margin != null && cost > 0 && <div className="rb-bar"><i style={{ width: Math.max(0, Math.min(100, margin)) + '%', background: toneVar(tone) }} /></div>}
      {err && <div className="rb-err">{err}</div>}
      <div className="rb-foot-actions">
        <button type="button" className="rb-btn" onClick={onClose}>{t('recipes.cancel')}</button>
        <button type="button" className="rb-btn is-primary" onClick={save} disabled={!canSave}>
          {saving ? t('recipes.saving') : drink ? t('recipes.saveChanges') : t('recipes.save')}
        </button>
      </div>
    </>
  )

  return (
    <Sheet title={drink ? t('recipes.editRecipe') : t('recipes.newTitle')} onClose={onClose} footer={footer}>
      <label className="rb-label">{t('recipes.name')}</label>
      <input className="rb-input" type="text" value={form.nome} onChange={e => set('nome', e.target.value)} placeholder={t('recipes.namePh')} autoFocus={!drink} />

      <label className="rb-label">{t('recipes.category')}</label>
      <div className="rb-chips is-scroll">
        {cats.map(c => (
          <button key={c} type="button" className={'rb-chip' + (form.categoria === c ? ' is-on' : '')} onClick={() => set('categoria', c)}>{c}</button>
        ))}
      </div>

      <div className="rb-section">
        <div className="rb-section-title">{t('recipes.ingredients')}</div>
        <div className="rb-hint">{t('recipes.ingredientsHint')}</div>

        {lines.map((l, i) => {
          const c = lineCost(l)
          const kindLabel = l.kind === 'jbm' ? t('recipes.kindJbm') : l.kind === 'own' ? t('recipes.kindOwn') : t('recipes.kindFixed')
          return (
            <div key={i} className="rb-ing">
              <div className="rb-ing-top">
                {l.kind === 'jbm'
                  ? <div className="rb-ing-name">{l.nome}</div>
                  : <input className="rb-input is-sm rb-ing-name-input" type="text" value={l.nome}
                      onChange={e => setLine(i, { nome: e.target.value })}
                      placeholder={l.kind === 'own' ? t('recipes.ownNamePh') : t('recipes.fixedNamePh')} />}
                <span className={'rb-tag is-' + l.kind}>{kindLabel}</span>
                <b className="rb-ing-cost" style={{ color: c == null ? 'var(--c-warning)' : 'var(--c-danger)' }}>{c == null ? t('recipes.needsPrice') : fmtYen(c)}</b>
                <button type="button" className="rb-icon-btn is-danger" onClick={() => setLines(ls => ls.filter((_, j) => j !== i))} aria-label={t('recipes.remove')}><Icon name="close" size={15} /></button>
              </div>

              {l.kind !== 'fixed' && (
                <div className="rb-ing-row">
                  <div className="rb-chips is-tight">
                    {ML_CHIPS.map(ml => (
                      <button key={ml} type="button" className={'rb-chip is-sm' + (+l.ml === ml ? ' is-on' : '')} onClick={() => setLine(i, { ml })}>{ml}</button>
                    ))}
                  </div>
                  <label className="rb-mini">
                    <input className="rb-input is-sm" type="number" inputMode="numeric" min="0" value={l.ml} onChange={e => setLine(i, { ml: e.target.value })} placeholder="ml" />
                    <span>ml</span>
                  </label>
                </div>
              )}

              {l.kind === 'jbm' && !(+l.bottleMl > 0) && (
                <label className="rb-mini is-wide">
                  <span>{t('recipes.bottleMl')}</span>
                  <input className="rb-input is-sm" type="number" inputMode="numeric" min="0" value={l.bottleMl} onChange={e => setLine(i, { bottleMl: e.target.value })} placeholder="750" />
                </label>
              )}
              {l.kind === 'jbm' && +l.bottleMl > 0 && (
                <div className="rb-ing-meta">{fmtYen(l.bottlePrice)} / {l.bottleMl}ml</div>
              )}

              {l.kind === 'own' && (
                <div className="rb-ing-grid">
                  <label className="rb-mini is-wide">
                    <span>{t('recipes.bottlePrice')}</span>
                    <input className="rb-input is-sm" type="number" inputMode="numeric" min="0" value={l.bottlePrice} onChange={e => setLine(i, { bottlePrice: e.target.value })} placeholder="2000" />
                  </label>
                  <label className="rb-mini is-wide">
                    <span>{t('recipes.bottleMl')}</span>
                    <input className="rb-input is-sm" type="number" inputMode="numeric" min="0" value={l.bottleMl} onChange={e => setLine(i, { bottleMl: e.target.value })} placeholder="700" />
                  </label>
                </div>
              )}

              {l.kind === 'fixed' && (
                <label className="rb-mini is-wide">
                  <span>{t('recipes.fixedCost')}</span>
                  <input className="rb-input is-sm" type="number" inputMode="numeric" min="0" value={l.fixed} onChange={e => setLine(i, { fixed: e.target.value })} placeholder="20" />
                </label>
              )}
            </div>
          )
        })}
        <div ref={listEnd} />

        <div className="rb-search is-add">
          <Icon name="plus" size={16} />
          <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder={t('recipes.searchPh')} />
        </div>
        {q.trim() && (
          <div className="rb-results">
            {results.map(p => (
              <button key={p.id} type="button" className="rb-result" onClick={() => addLine(lineFromProduct(p, SPIRITS.test(`${p.categoria} ${p.nome}`) ? 30 : ''))}>
                <span className="rb-result-name">{p.nome}</span>
                <span className="rb-result-meta">{fmtYen(p.preco_venda)}{p.volume_ml ? ` / ${p.volume_ml}ml` : ''}</span>
              </button>
            ))}
            {results.length === 0 && <div className="rb-hint">{t('recipes.noMatch', { q: q.trim() })}</div>}
            <button type="button" className="rb-result is-own" onClick={() => addLine({ kind: 'own', nome: q.trim(), ml: 30, bottlePrice: '', bottleMl: '' })}>
              <Icon name="plus" size={14} /> {t('recipes.addAsOwn', { q: q.trim() })}
            </button>
          </div>
        )}
        <div className="rb-add-row">
          <button type="button" className="rb-btn is-soft" onClick={() => addLine({ kind: 'own', nome: '', ml: 30, bottlePrice: '', bottleMl: '' })}>{t('recipes.addOwn')}</button>
          <button type="button" className="rb-btn is-soft" onClick={() => addLine({ kind: 'fixed', nome: '', fixed: '' })}>{t('recipes.addFixed')}</button>
        </div>

        {complete && autoCost > 0 && (
          <div className="rb-auto">
            <Icon name="check" size={15} /> {t('recipes.autoCost')}: <b>{fmtYen(autoCost)}</b>
            {savedCost != null && +savedCost > 0 && Math.round(+savedCost) !== autoCost && <span className="rb-was"> ({t('recipes.wasCost', { amount: fmtYen(savedCost) })})</span>}
          </div>
        )}
        {!complete && (
          <div className="rb-manual">
            <label className="rb-label">{t('recipes.manualCost')}</label>
            <input className="rb-input" type="number" inputMode="numeric" min="0" value={form.custo} onChange={e => set('custo', e.target.value)} placeholder="0" />
            {lines.length > 0 && <div className="rb-hint">{t('recipes.manualHint')}</div>}
          </div>
        )}
      </div>

      <div className="rb-section">
        <div className="rb-section-title">{t('recipes.price')}</div>
        <div className="rb-price-row">
          <span className="rb-yen">¥</span>
          <input className="rb-input is-big" type="number" inputMode="numeric" min="0" value={form.preco_venda} onChange={e => set('preco_venda', e.target.value)} placeholder="1000" />
        </div>
        {cost > 0 && (
          <>
            <div className="rb-hint">{t('recipes.suggest')}</div>
            <div className="rb-chips">
              {suggestPrices(cost).map(s => (
                <button key={s.price} type="button" className={'rb-chip' + (price === s.price ? ' is-on' : '')} onClick={() => set('preco_venda', s.price)}>
                  {fmtYen(s.price)} · {s.margin}%
                </button>
              ))}
            </div>
          </>
        )}
        <label className="rb-label">{t('recipes.vipPrice')}</label>
        <input className="rb-input" type="number" inputMode="numeric" min="0" value={form.preco_desconto} onChange={e => set('preco_desconto', e.target.value)} placeholder="500" />
        {cost > 0 && +form.preco_desconto > 0 && (
          <div className="rb-hint">{t('recipes.vipMargin', { pct: marginPct(form.preco_desconto, cost) })}</div>
        )}
      </div>

      <div className="rb-section">
        <button type="button" className="rb-more" onClick={() => setMoreOpen(o => !o)} aria-expanded={moreOpen}>
          <span>{t('recipes.more')}</span><Icon name={moreOpen ? 'chevUp' : 'down'} size={16} />
        </button>
        {moreOpen && (
          <>
            <label className="rb-label">{t('recipes.glass')}</label>
            <input className="rb-input" type="text" value={form.copo} onChange={e => set('copo', e.target.value)} placeholder={t('recipes.glassPh')} />
            <label className="rb-label">{t('photo.label')}</label>
            <PhotoField value={form.imagem_url || ''} onChange={url => set('imagem_url', url)} scope={bar.id} name={form.nome} />
            <label className="rb-label">{t('recipes.notes')}</label>
            <textarea className="rb-input" rows={2} value={form.notas} onChange={e => set('notas', e.target.value)} placeholder={t('recipes.notesPh')} />
          </>
        )}
      </div>
    </Sheet>
  )
}

// ── MENU (recipes) ───────────────────────────────────────────────────────────
export function MenuTab({ bar }) {
  const { t } = useI18n()
  const [drinks, setDrinks] = useState([])
  const [produtos, setProdutos] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [cat, setCat] = useState('')
  const [sortBy, setSortBy] = useState('margem')
  const [editing, setEditing] = useState(null) // null | 'new' | drink

  useEffect(() => { load() }, [bar]) // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    const [dR, pR] = await Promise.all([
      supabase.from('drink_menu').select('*').eq('bar_id', bar.id).order('categoria').order('nome'),
      supabase.from('produtos_public').select('*').eq('ativo', true).order('nome'),
    ])
    setDrinks(dR.data || [])
    setProdutos(pR.data || [])
    setLoading(false)
  }

  async function deleteDrink(id) {
    if (!(await askConfirm({ title: t('recipes.deleteConfirm'), danger: true }))) return
    await supabase.from('drink_menu').delete().eq('id', id)
    load()
  }

  const cats = [...new Set(drinks.map(d => d.categoria))]
  const allCats = [...new Set(['Custom', ...cats, 'Hennessy', 'Shochu Hai', 'Vodka Base', 'Gin Base', 'Whisky Base', 'Tequila Base', 'Rum Base', 'Shots', 'Liqueurs', 'Champagne', 'Wine', 'Beer', 'Soft Drinks'])]

  const s = search.trim().toLowerCase()
  const filtered = drinks
    .filter(d => (!cat || d.categoria === cat) && (!s || d.nome.toLowerCase().includes(s) || (d.receita || '').toLowerCase().includes(s)))
    .sort((a, b) => {
      if (sortBy === 'margem') return b.margem - a.margem
      if (sortBy === 'custo') return a.custo - b.custo
      if (sortBy === 'preco') return b.preco_venda - a.preco_venda
      return a.nome.localeCompare(b.nome)
    })

  const avg = drinks.length ? Math.round(drinks.reduce((a, d) => a + (+d.margem || 0), 0) / drinks.length * 100) : 0
  const top = [...drinks].sort((a, b) => b.margem - a.margem)[0]
  const low = [...drinks].sort((a, b) => a.margem - b.margem)[0]

  if (loading) return <Spinner text={t('portal.menu.title')} />

  return (
    <div className="fade-in rm-page">
      <div className="rb-head">
        <div>
          <div className="rb-title">{t('portal.menu.title')}</div>
          <div className="rb-sub">{t('portal.menu.drinksMeta', { count: drinks.length })}</div>
        </div>
        <button type="button" className="rb-btn is-primary rb-new" onClick={() => setEditing('new')}>
          <Icon name="plus" size={16} /> {t('recipes.newRecipe')}
        </button>
      </div>

      {drinks.length > 0 && (
        <div className="rb-kpis">
          <div className="rb-kpi"><span>{t('recipes.avgMargin')}</span><b style={{ color: toneVar(marginTone(avg)) }}>{avg}%</b></div>
          <div className="rb-kpi"><span>{t('recipes.best')}</span><b className="rb-ellipsis">{top?.nome}</b><em style={{ color: 'var(--c-success)' }}>{top ? Math.round(top.margem * 100) + '%' : ''}</em></div>
          <div className="rb-kpi"><span>{t('recipes.watch')}</span><b className="rb-ellipsis">{low?.nome}</b><em style={{ color: 'var(--c-danger)' }}>{low ? Math.round(low.margem * 100) + '%' : ''}</em></div>
        </div>
      )}

      <div className="rm-tools">
        <div className="rb-search">
          <Icon name="search" size={16} />
          <input type="search" placeholder={t('recipes.searchList')} value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="rm-sort" value={sortBy} onChange={e => setSortBy(e.target.value)} aria-label="Sort">
          <option value="margem">{t('recipes.sortMargin')}</option>
          <option value="nome">{t('recipes.sortName')}</option>
          <option value="custo">{t('recipes.sortCost')}</option>
          <option value="preco">{t('recipes.sortPrice')}</option>
        </select>
      </div>

      <div className="rb-chips is-scroll">
        <button type="button" className={'rb-chip' + (!cat ? ' is-on' : '')} onClick={() => setCat('')}>{t('recipes.all', { n: drinks.length })}</button>
        {cats.map(c => (
          <button key={c} type="button" className={'rb-chip' + (cat === c ? ' is-on' : '')} onClick={() => setCat(c === cat ? '' : c)}>
            {c} ({drinks.filter(d => d.categoria === c).length})
          </button>
        ))}
      </div>

      <div className="rm-list">
        <div className="rm-row is-head" aria-hidden="true">
          <span>{t('recipes.drink')}</span><span>{t('recipes.priceShort')}</span><span>{t('recipes.cost')}</span><span>{t('recipes.vip')}</span><span>{t('recipes.margin')}</span><span />
        </div>
        {filtered.map(d => {
          const m = Math.round((+d.margem || 0) * 100)
          const vipM = d.preco_desconto && d.custo ? marginPct(d.preco_desconto, d.custo) : null
          return (
            <div key={d.id} className={'rm-row' + (d.custom ? ' is-custom' : '')} onClick={() => setEditing(d)} role="button" tabIndex={0}
              onKeyDown={e => { if (e.key === 'Enter') setEditing(d) }}>
              <div className="rm-name">
                <div className="rm-title">{d.nome} {d.custom && <span className="rb-tag is-custom">{t('recipes.custom')}</span>}</div>
                {(d.receita || d.copo) && <div className="rm-recipe">{d.receita}{d.copo ? ' · ' + d.copo : ''}</div>}
                {d.notas && <div className="rm-notes">{d.notas}</div>}
              </div>
              <div className="rm-num" data-label={t('recipes.priceShort')}><b>{fmtYen(d.preco_venda)}</b></div>
              <div className="rm-num" data-label={t('recipes.cost')}><span style={{ color: 'var(--c-danger)' }}>{fmtYen(d.custo)}</span></div>
              <div className="rm-num" data-label={t('recipes.vip')}><span>{d.preco_desconto ? fmtYen(d.preco_desconto) : '—'}{vipM != null && <small> · {vipM}%</small>}</span></div>
              <div className="rm-num" data-label={t('recipes.margin')}><b className={'rm-pill is-' + marginTone(m)}>{m}%</b></div>
              <div className="rm-actions" onClick={e => e.stopPropagation()}>
                <button type="button" className="rb-icon-btn" onClick={() => setEditing(d)} aria-label={t('recipes.editRecipe')}><Icon name="edit" size={15} /></button>
                <button type="button" className="rb-icon-btn is-danger" onClick={() => deleteDrink(d.id)} aria-label={t('recipes.remove')}><Icon name="trash" size={15} /></button>
              </div>
            </div>
          )
        })}
        {filtered.length === 0 && (
          <div className="rm-empty">
            <div>{drinks.length ? t('recipes.noneFound') : t('recipes.empty')}</div>
            {!drinks.length && <button type="button" className="rb-btn is-primary" onClick={() => setEditing('new')}>{t('recipes.newRecipe')}</button>}
          </div>
        )}
      </div>

      {editing && (
        <RecipeEditor
          bar={bar}
          drink={editing === 'new' ? null : editing}
          produtos={produtos}
          cats={allCats}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }}
        />
      )}
    </div>
  )
}
