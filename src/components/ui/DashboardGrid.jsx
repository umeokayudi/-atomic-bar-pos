import { useState } from 'react'
import { useDashboardLayout } from '../../lib/dashboardLayout'
import { useI18n } from '../../lib/i18n'
import Icon from './Icon'

/**
 * Configurable dashboard. Each widget: { id, title, icon?, size: 'full'|'half', defaultHidden?, empty?, render() }.
 * Pass `layout` (from useDashboardLayout) when the page needs to know what is visible.
 * renderHead(customizeButton) puts the page header (with the Customize button) inside the grid.
 * "Customize" lets the person show/hide cards, drag or arrow them into order and pick full or half width.
 */
export default function DashboardGrid({ id, widgets, layout, renderHead }) {
  const { t } = useI18n()
  const own = useDashboardLayout(id, widgets)
  const { items, toggle, setSize, move, reset } = layout || own
  const [editing, setEditing] = useState(false)
  const [dragFrom, setDragFrom] = useState(null)
  const [dragOver, setDragOver] = useState(null)
  const byId = Object.fromEntries(widgets.map(w => [w.id, w]))
  const hidden = items.filter(i => i.hidden)
  const shown = items.filter(i => !i.hidden)

  function drop(toIdx) {
    if (dragFrom != null) move(dragFrom, toIdx)
    setDragFrom(null)
    setDragOver(null)
  }

  const customizeBtn = (
    <button type="button" className={`ui-btn is-sm${editing ? ' is-primary' : ''}`} onClick={() => setEditing(v => !v)} aria-pressed={editing}>
      <Icon name={editing ? 'check' : 'customize'} size={15} /> {editing ? t('dash.done') : t('dash.customize')}
    </button>
  )

  return (
    <div className={`dash${editing ? ' is-editing' : ''}`}>
      {renderHead?.(customizeBtn)}
      {(editing || !renderHead) && (
        <div className="dash-bar">
          {editing && <span className="dash-hint">{t('dash.hint')}</span>}
          {editing && (
            <button type="button" className="ui-btn is-ghost is-sm" onClick={reset}>
              <Icon name="reopen" size={15} /> {t('dash.reset')}
            </button>
          )}
          {!renderHead && customizeBtn}
        </div>
      )}

      {editing && hidden.length > 0 && (
        <div className="dash-tray" aria-label={t('dash.hiddenCards')}>
          <span className="dash-tray-label">{t('dash.hiddenCards')}</span>
          {hidden.map(i => (
            <button key={i.id} type="button" className="dash-tray-chip" onClick={() => toggle(i.id)}>
              <Icon name="plus" size={14} /> {byId[i.id].title}
            </button>
          ))}
        </div>
      )}

      <div className="dash-grid">
        {shown.map(item => {
          const w = byId[item.id]
          const idx = items.indexOf(item)
          if (!editing && w.empty) return null
          const prevIdx = items.slice(0, idx).map(x => !x.hidden).lastIndexOf(true)
          const nextIdx = items.findIndex((x, j) => j > idx && !x.hidden)
          return (
            <section
              key={item.id}
              className={`dash-cell is-${item.size}${dragOver === idx ? ' is-over' : ''}${dragFrom === idx ? ' is-dragging' : ''}`}
              onDragOver={editing ? e => { e.preventDefault(); setDragOver(idx) } : undefined}
              onDrop={editing ? e => { e.preventDefault(); drop(idx) } : undefined}
              aria-label={w.title}
            >
              {editing && (
                <div className="dash-edit-bar">
                  <span
                    className="dash-grip" draggable
                    onDragStart={e => { setDragFrom(idx); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', item.id) }}
                    onDragEnd={() => { setDragFrom(null); setDragOver(null) }}
                    title={t('dash.drag')}
                  >
                    <Icon name="grip" size={16} />
                  </span>
                  <span className="dash-edit-title">{w.icon && <Icon name={w.icon} size={15} />}{w.title}</span>
                  <span className="dash-edit-actions">
                    <button type="button" className="ui-btn is-ghost is-icon is-sm" disabled={prevIdx < 0} onClick={() => move(idx, prevIdx)} aria-label={t('dash.moveUp', { name: w.title })} title={t('dash.moveUp', { name: w.title })}><Icon name="up" size={15} /></button>
                    <button type="button" className="ui-btn is-ghost is-icon is-sm" disabled={nextIdx < 0} onClick={() => move(idx, nextIdx)} aria-label={t('dash.moveDown', { name: w.title })} title={t('dash.moveDown', { name: w.title })}><Icon name="downArrow" size={15} /></button>
                    <button type="button" className="ui-btn is-ghost is-icon is-sm dash-size-btn" onClick={() => setSize(item.id, item.size === 'full' ? 'half' : 'full')} aria-label={item.size === 'full' ? t('dash.makeHalf') : t('dash.makeFull')} title={item.size === 'full' ? t('dash.makeHalf') : t('dash.makeFull')}><Icon name={item.size === 'full' ? 'sizeHalf' : 'sizeWide'} size={15} /></button>
                    <button type="button" className="ui-btn is-ghost is-icon is-sm" onClick={() => toggle(item.id)} aria-label={t('dash.hide', { name: w.title })} title={t('dash.hide', { name: w.title })}><Icon name="hide" size={15} /></button>
                  </span>
                </div>
              )}
              <div className="dash-body">
                {editing && w.empty ? <div className="dash-empty">{t('dash.nothingNow')}</div> : w.render()}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
