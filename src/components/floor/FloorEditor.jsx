import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useI18n } from '../../lib/i18n'
import { floorApi, isConflict } from '../../lib/comandas'
import {
  SHAPES, TABLE_COLORS, addSector, addTable, createHistory, duplicateTable, fitZoom, isDirty, pushHistory, redo,
  removeSector, removeTable, toSavePayload, undo, updateTable, validateLayout,
} from '../../lib/floorEditor'
import Icon from '../ui/Icon'

const SHAPE_ICON = { round: 'circle', square: 'square', rect: 'rect', bar: 'move' }

/**
 * Visual floor editor. Drag to move, corner handle to resize, arrows to nudge (Alt = 1px),
 * Delete removes, Ctrl+D duplicates, Ctrl+Z / Ctrl+Y undo/redo. Every field can also be typed in the side panel.
 * Saves the whole layout in one transaction; a stale save (another device saved first) is refused, never merged silently.
 */
export default function FloorEditor({ layout: initialLayout, layouts = [], busyTableIds = new Set(), onSaved, onSwitchLayout, onLayoutsChanged }) {
  const { t } = useI18n()
  const [saved, setSaved] = useState(null)
  const [hist, setHist] = useState(null)
  const [zoom, setZoom] = useState(1)
  const [grid, setGrid] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null) // { tone, text, conflict? }
  const viewRef = useRef(null)
  const dragRef = useRef(null)

  const load = useCallback(async (layoutRow) => {
    setBusy(true)
    try {
      const { sectors, tables } = await floorApi.layout(supabase, layoutRow.id)
      const state = {
        layout: { ...layoutRow, largura: +layoutRow.largura, altura: +layoutRow.altura },
        sectors,
        tables: tables.map(r => ({ ...r, x: +r.x, y: +r.y, largura: +r.largura, altura: +r.altura, rotacao: +r.rotacao || 0, cor: r.cor || '' })),
        selected: null,
      }
      setSaved(state)
      setHist(createHistory(state))
      setMsg(null)
      requestAnimationFrame(() => {
        const v = viewRef.current
        if (v) setZoom(fitZoom(v.clientWidth, v.clientHeight, state.layout))
      })
    } catch (e) {
      setMsg({ tone: 'danger', text: t('floor.errLoad', { error: e.message }) })
    } finally {
      setBusy(false)
    }
  }, [t])

  useEffect(() => { if (initialLayout) load(initialLayout) }, [initialLayout?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const state = hist?.present
  const dirty = useMemo(() => (saved && state ? isDirty(saved, state) : false), [saved, state])
  const sel = state?.tables.find(x => x.id === state.selected) || null

  // Warn before closing the page with unsaved changes.
  useEffect(() => {
    if (!dirty) return undefined
    const onLeave = e => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', onLeave)
    return () => window.removeEventListener('beforeunload', onLeave)
  }, [dirty])

  const commit = useCallback(fn => setHist(h => {
    const next = fn(h.present)
    if (next.error) { setMsg({ tone: 'danger', text: t(next.error) }); return h }
    return pushHistory(h, next)
  }), [t])
  const select = id => setHist(h => ({ ...h, present: { ...h.present, selected: id } }))

  // ── pointer: drag, resize, pan ─────────────────────────────────────────
  function startDrag(e, table, mode) {
    e.stopPropagation()
    e.preventDefault()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    select(table.id)
    dragRef.current = { mode, id: table.id, sx: e.clientX, sy: e.clientY, x: table.x, y: table.y, w: table.largura, h: table.altura, before: hist.present, moved: false }
  }
  function startPan(e) {
    if (e.button !== 0 && e.button !== 1) return
    select(null)
    const v = viewRef.current
    dragRef.current = { mode: 'pan', sx: e.clientX, sy: e.clientY, left: v.scrollLeft, top: v.scrollTop }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  function onMove(e) {
    const d = dragRef.current
    if (!d) return
    const dx = e.clientX - d.sx
    const dy = e.clientY - d.sy
    if (d.mode === 'pan') {
      viewRef.current.scrollLeft = d.left - dx
      viewRef.current.scrollTop = d.top - dy
      return
    }
    if (Math.abs(dx) + Math.abs(dy) > 2) d.moved = true
    const patch = d.mode === 'move'
      ? { x: d.x + dx / zoom, y: d.y + dy / zoom }
      : { largura: Math.max(40, d.w + dx / zoom), altura: Math.max(40, d.h + dy / zoom) }
    setHist(h => ({ ...h, present: updateTable(h.present, d.id, patch, { grid }) }))
  }
  function onUp() {
    const d = dragRef.current
    dragRef.current = null
    if (!d || d.mode === 'pan' || !d.moved) return
    setHist(h => ({ past: [...h.past, d.before].slice(-80), present: h.present, future: [] }))
  }

  // Ctrl/⌘ + wheel zooms around the canvas.
  useEffect(() => {
    const v = viewRef.current
    if (!v) return undefined
    const onWheel = e => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      setZoom(z => Math.max(0.25, Math.min(2, Math.round((z - e.deltaY * 0.0015) * 100) / 100)))
    }
    v.addEventListener('wheel', onWheel, { passive: false })
    return () => v.removeEventListener('wheel', onWheel)
  }, [state?.layout?.id])

  // ── keyboard ───────────────────────────────────────────────────────────
  function onKeyDown(e) {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return
    const mod = e.ctrlKey || e.metaKey
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); setHist(h => (e.shiftKey ? redo(h) : undo(h))); return }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); setHist(redo); return }
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save(); return }
    if (!sel) return
    if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); commit(s => duplicateTable(s, sel.id)); return }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); commit(s => removeTable(s, sel.id, busyTableIds)); return }
    if (e.key === 'Escape') { select(null); return }
    const step = e.altKey ? 1 : 10
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
    if (moves[e.key]) {
      e.preventDefault()
      const [mx, my] = moves[e.key]
      commit(s => updateTable(s, sel.id, { x: sel.x + mx, y: sel.y + my }, { grid: !e.altKey && grid }))
    }
  }

  // ── save / layouts ─────────────────────────────────────────────────────
  async function save() {
    if (!state || busy) return
    const errors = validateLayout(state)
    if (errors.length) { setMsg({ tone: 'danger', text: errors.map(k => t(k)).join(' ') }); return }
    setBusy(true)
    setMsg(null)
    try {
      await floorApi.save(supabase, toSavePayload(state))
      const fresh = (await floorApi.layouts(supabase, state.layout.bar_id)).find(l => l.id === state.layout.id)
      await load(fresh)
      setMsg({ tone: 'success', text: t('floor.saved') })
      onSaved?.()
    } catch (e) {
      setMsg(isConflict(e)
        ? { tone: 'danger', text: t('floor.errStale'), conflict: true }
        : { tone: 'danger', text: /open tab/i.test(e.message) ? t('floor.errBusyTable') : t('floor.errSave', { error: e.message }) })
    } finally {
      setBusy(false)
    }
  }

  async function duplicateLayout() {
    if (dirty && !window.confirm(t('floor.confirmDiscard'))) return
    const nome = window.prompt(t('floor.duplicateName'), `${state.layout.nome} (2)`)
    if (!nome) return
    setBusy(true)
    try {
      const id = await floorApi.duplicate(supabase, state.layout.id, nome)
      await onLayoutsChanged?.(id)
    } catch (e) { setMsg({ tone: 'danger', text: t('floor.errSave', { error: e.message }) }) } finally { setBusy(false) }
  }

  async function activateLayout() {
    setBusy(true)
    try {
      await floorApi.activate(supabase, state.layout.id)
      await onLayoutsChanged?.(state.layout.id)
      setMsg({ tone: 'success', text: t('floor.activated') })
    } catch (e) { setMsg({ tone: 'danger', text: /open tab/i.test(e.message) ? t('floor.errActivateBusy') : t('floor.errSave', { error: e.message }) }) } finally { setBusy(false) }
  }

  async function newLayout() {
    if (dirty && !window.confirm(t('floor.confirmDiscard'))) return
    const nome = window.prompt(t('floor.newLayoutName'), t('floor.newLayoutDefault'))
    if (!nome) return
    setBusy(true)
    try {
      const { data, error } = await supabase.from('floor_layouts').insert({ bar_id: state.layout.bar_id, nome, ativo: false }).select('id').single()
      if (error) throw error
      await onLayoutsChanged?.(data.id)
    } catch (e) { setMsg({ tone: 'danger', text: t('floor.errSave', { error: e.message }) }) } finally { setBusy(false) }
  }

  if (!state) return <div className="ui-skel" style={{ height: 320 }} />
  const L = state.layout
  const sectorOf = id => state.sectors.find(s => s.id === id)

  return (
    <div className="fe" onKeyDown={onKeyDown}>
      <div className="fe-toolbar ui-card">
        <label className="ui-field fe-layout-pick">
          <span className="ui-sr">{t('floor.layout')}</span>
          <select value={L.id} onChange={e => {
            if (dirty && !window.confirm(t('floor.confirmDiscard'))) return
            onSwitchLayout?.(e.target.value)
          }}>
            {layouts.map(l => <option key={l.id} value={l.id}>{l.nome}{l.ativo ? ` · ${t('floor.active')}` : ''}</option>)}
          </select>
        </label>
        <div className="ui-row fe-add" role="group" aria-label={t('floor.addTable')}>
          {Object.keys(SHAPES).map(f => (
            <button key={f} type="button" className="ui-btn is-sm" onClick={() => commit(s => addTable(s, f))} title={t(`floor.shape.${f}`)}>
              <Icon name={SHAPE_ICON[f]} size={14} /> <span className="fe-add-label">{t(`floor.shape.${f}`)}</span>
            </button>
          ))}
        </div>
        <span className="ui-spacer" />
        <div className="ui-row" role="group" aria-label={t('floor.view')}>
          <button type="button" className="ui-btn is-icon is-sm" onClick={() => setHist(undo)} disabled={!hist.past.length} aria-label={t('floor.undo')} title="Ctrl+Z"><Icon name="undo" size={16} /></button>
          <button type="button" className="ui-btn is-icon is-sm" onClick={() => setHist(redo)} disabled={!hist.future.length} aria-label={t('floor.redo')} title="Ctrl+Y"><Icon name="reopen" size={16} /></button>
          <button type="button" className="ui-btn is-icon is-sm" onClick={() => setZoom(z => Math.max(0.25, +(z - 0.1).toFixed(2)))} aria-label={t('floor.zoomOut')}><Icon name="zoomOut" size={16} /></button>
          <span className="fe-zoom num">{Math.round(zoom * 100)}%</span>
          <button type="button" className="ui-btn is-icon is-sm" onClick={() => setZoom(z => Math.min(2, +(z + 0.1).toFixed(2)))} aria-label={t('floor.zoomIn')}><Icon name="zoomIn" size={16} /></button>
          <button type="button" className="ui-btn is-icon is-sm" onClick={() => setZoom(fitZoom(viewRef.current?.clientWidth, viewRef.current?.clientHeight, L))} aria-label={t('floor.fit')}><Icon name="fit" size={16} /></button>
          <button type="button" className="ui-btn is-sm" aria-pressed={grid} onClick={() => setGrid(g => !g)}>{t('floor.grid')}</button>
        </div>
        <button type="button" className="ui-btn is-primary" onClick={save} disabled={busy || !dirty}>
          <Icon name="save" size={16} /> {busy ? t('common.saving') : dirty ? t('floor.save') : t('floor.savedShort')}
        </button>
      </div>

      {msg && (
        <div className={msg.tone === 'success' ? 'ui-badge is-success fe-msg' : 'ui-error fe-msg'} role={msg.tone === 'success' ? 'status' : 'alert'}>
          <Icon name={msg.tone === 'success' ? 'ok' : 'warning'} size={16} />{msg.text}
          {msg.conflict && <button type="button" className="ui-btn is-sm" onClick={() => load(L)}>{t('floor.reload')}</button>}
        </div>
      )}

      <div className="fe-body">
        <div
          ref={viewRef}
          className="fe-viewport"
          tabIndex={0}
          aria-label={t('floor.canvasLabel')}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        >
          <div className="fe-canvas" style={{ width: L.largura * zoom, height: L.altura * zoom }}>
            <div className={`fe-plane${grid ? ' has-grid' : ''}`} style={{ width: L.largura, height: L.altura, transform: `scale(${zoom})` }} onPointerDown={startPan}>
              {state.tables.map(tb => {
                const sector = sectorOf(tb.sector_id)
                const busyHere = busyTableIds.has(tb.id)
                return (
                  <div
                    key={tb.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={state.selected === tb.id}
                    aria-label={t('floor.tableAria', { name: tb.nome, n: tb.capacidade })}
                    className={`fe-table is-${tb.forma}${state.selected === tb.id ? ' is-selected' : ''}${tb.ativo === false ? ' is-off' : ''}`}
                    style={{
                      left: tb.x, top: tb.y, width: tb.largura, height: tb.altura,
                      transform: tb.rotacao ? `rotate(${tb.rotacao}deg)` : undefined,
                      '--fe-color': tb.cor || sector?.cor || 'var(--c-accent)',
                    }}
                    onPointerDown={e => startDrag(e, tb, 'move')}
                    onFocus={() => state.selected !== tb.id && select(tb.id)}
                  >
                    <span className="fe-table-name">{tb.nome}</span>
                    <span className="fe-table-cap"><Icon name="people" size={11} /> {tb.capacidade}</span>
                    {busyHere && <span className="fe-table-busy" title={t('floor.hasOpenTab')}><Icon name="lock" size={11} /></span>}
                    {state.selected === tb.id && (
                      <span className="fe-resize" onPointerDown={e => startDrag(e, tb, 'resize')} aria-hidden="true" />
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <aside className="fe-side">
          {sel ? (
            <section className="ui-card fe-props" aria-label={t('floor.tableProps')}>
              <div className="ui-card-head">
                <div className="ui-card-title">{t('floor.tableProps')}</div>
                <div className="ui-row">
                  <button type="button" className="ui-btn is-icon is-sm" onClick={() => commit(s => duplicateTable(s, sel.id))} aria-label={t('floor.duplicate')} title="Ctrl+D"><Icon name="copy" size={14} /></button>
                  <button type="button" className="ui-btn is-icon is-sm is-danger" onClick={() => commit(s => removeTable(s, sel.id, busyTableIds))} aria-label={t('floor.remove')} disabled={busyTableIds.has(sel.id)} title={busyTableIds.has(sel.id) ? t('floor.errBusyTable') : 'Delete'}><Icon name="trash" size={14} /></button>
                </div>
              </div>
              <label className="ui-field"><span>{t('floor.name')}</span>
                <input value={sel.nome} onChange={e => commit(s => updateTable(s, sel.id, { nome: e.target.value }))} />
              </label>
              <div className="ui-seg" role="radiogroup" aria-label={t('floor.shapeLabel')}>
                {Object.keys(SHAPES).map(f => (
                  <button key={f} type="button" role="radio" aria-checked={sel.forma === f} onClick={() => commit(s => updateTable(s, sel.id, { forma: f }))}>
                    <Icon name={SHAPE_ICON[f]} size={14} />{t(`floor.shape.${f}`)}
                  </button>
                ))}
              </div>
              <div className="fe-grid2">
                {[['x', 'X'], ['y', 'Y'], ['largura', t('floor.width')], ['altura', t('floor.height')], ['rotacao', t('floor.rotation')], ['capacidade', t('floor.capacity')]].map(([k, label]) => (
                  <label key={k} className="ui-field"><span>{label}</span>
                    <input type="number" inputMode="numeric" value={Math.round(sel[k] || 0)} step={k === 'capacidade' ? 1 : k === 'rotacao' ? 15 : 10}
                      onChange={e => commit(s => updateTable(s, sel.id, { [k]: +e.target.value }, { grid: false }))} />
                  </label>
                ))}
              </div>
              <div className="ui-field"><span>{t('floor.color')}</span>
                <div className="fe-swatches" role="radiogroup" aria-label={t('floor.color')}>
                  {TABLE_COLORS.map(c => (
                    <button key={c || 'none'} type="button" role="radio" aria-checked={(sel.cor || '') === c} aria-label={c || t('floor.colorSector')}
                      className={`fe-swatch${c ? '' : ' is-none'}`} style={c ? { background: c } : undefined}
                      onClick={() => commit(s => updateTable(s, sel.id, { cor: c }))} />
                  ))}
                </div>
              </div>
              <label className="ui-field"><span>{t('floor.sector')}</span>
                <select value={sel.sector_id || ''} onChange={e => commit(s => updateTable(s, sel.id, { sector_id: e.target.value || null }))}>
                  <option value="">{t('floor.noSector')}</option>
                  {state.sectors.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
                </select>
              </label>
              <label className="growth-check">
                <input type="checkbox" checked={sel.ativo !== false} disabled={busyTableIds.has(sel.id)}
                  onChange={e => commit(s => updateTable(s, sel.id, { ativo: e.target.checked }))} /> {t('floor.inService')}
              </label>
            </section>
          ) : (
            <section className="ui-card fe-hint">
              <div className="ui-card-title">{t('floor.howTo')}</div>
              <p className="ui-muted">{t('floor.howToBody')}</p>
            </section>
          )}

          <section className="ui-card">
            <div className="ui-card-head">
              <div className="ui-card-title">{t('floor.tables', { n: state.tables.length })}</div>
            </div>
            <ul className="fe-list">
              {state.tables.map(tb => (
                <li key={tb.id}>
                  <button type="button" className={`ai-center-link${state.selected === tb.id ? ' is-on' : ''}`} onClick={() => select(tb.id)}>
                    <Icon name={SHAPE_ICON[tb.forma]} size={14} /> {tb.nome}
                    <span className="ui-muted">{sectorOf(tb.sector_id)?.nome || ''} · {tb.capacidade}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="ui-card">
            <div className="ui-card-head">
              <div className="ui-card-title">{t('floor.sectors')}</div>
              <button type="button" className="ui-btn is-sm" onClick={() => commit(s => addSector(s, ''))}><Icon name="plus" size={14} /> {t('floor.addSector')}</button>
            </div>
            {state.sectors.length === 0 && <p className="ui-muted">{t('floor.noSectors')}</p>}
            <ul className="fe-sectors">
              {state.sectors.map(s => (
                <li key={s.id}>
                  <input type="color" value={s.cor || '#3F7F67'} aria-label={t('floor.color')}
                    onChange={e => commit(st => ({ ...st, sectors: st.sectors.map(x => (x.id === s.id ? { ...x, cor: e.target.value } : x)) }))} />
                  <input value={s.nome} aria-label={t('floor.sectorName')}
                    onChange={e => commit(st => ({ ...st, sectors: st.sectors.map(x => (x.id === s.id ? { ...x, nome: e.target.value } : x)) }))} />
                  <button type="button" className="ui-btn is-ghost is-icon is-sm" aria-label={t('common.delete')} onClick={() => commit(st => removeSector(st, s.id))}><Icon name="trash" size={14} /></button>
                </li>
              ))}
            </ul>
          </section>

          <section className="ui-card fe-layout-card">
            <div className="ui-card-title">{t('floor.layout')}</div>
            <label className="ui-field"><span>{t('floor.name')}</span>
              <input value={L.nome} onChange={e => commit(s => ({ ...s, layout: { ...s.layout, nome: e.target.value } }))} />
            </label>
            <div className="fe-grid2">
              <label className="ui-field"><span>{t('floor.width')}</span>
                <input type="number" min="200" max="10000" step="50" value={L.largura} onChange={e => commit(s => ({ ...s, layout: { ...s.layout, largura: Math.max(200, Math.min(10000, +e.target.value || 200)) } }))} />
              </label>
              <label className="ui-field"><span>{t('floor.height')}</span>
                <input type="number" min="200" max="10000" step="50" value={L.altura} onChange={e => commit(s => ({ ...s, layout: { ...s.layout, altura: Math.max(200, Math.min(10000, +e.target.value || 200)) } }))} />
              </label>
            </div>
            <div className="ui-row fe-layout-actions">
              {!L.ativo && <button type="button" className="ui-btn is-sm" disabled={busy || dirty} onClick={activateLayout} title={dirty ? t('floor.saveFirst') : ''}><Icon name="ok" size={14} /> {t('floor.activate')}</button>}
              <button type="button" className="ui-btn is-sm" disabled={busy} onClick={duplicateLayout}><Icon name="copy" size={14} /> {t('floor.duplicateLayout')}</button>
              <button type="button" className="ui-btn is-sm" disabled={busy} onClick={newLayout}><Icon name="plus" size={14} /> {t('floor.newLayout')}</button>
            </div>
            <p className="ui-muted fe-version">{t('floor.version', { n: L.versao })}{L.ativo ? ` · ${t('floor.active')}` : ''}</p>
          </section>
        </aside>
      </div>
    </div>
  )
}
