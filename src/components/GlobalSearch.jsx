import { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../lib/i18n'
import Icon from './ui/Icon'

function norm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/**
 * "Search the system" box from the top bar (Ctrl/Cmd+K). Finds screens by name and, once loaded,
 * records such as bars, products or suppliers. `screens`: [{ id, label, icon }]; `loadRecords`: async () =>
 * [{ key, label, sub, icon, tab }]. Picking a result calls onGo(tab).
 */
export default function GlobalSearch({ screens = [], loadRecords, onGo, compact = false }) {
  const { t } = useI18n()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [records, setRecords] = useState(null)
  const [active, setActive] = useState(0)
  const inputRef = useRef(null)
  const boxRef = useRef(null)

  useEffect(() => {
    const onKey = e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(true)
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!open) return undefined
    const onDoc = e => { if (!boxRef.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  function warm() {
    setOpen(true)
    if (records === null && loadRecords) {
      setRecords([])
      loadRecords().then(r => setRecords(r || [])).catch(() => setRecords([]))
    }
  }

  const results = useMemo(() => {
    const n = norm(q).trim()
    const sc = screens.map(s => ({ key: `s-${s.id}`, label: s.label, sub: t('search.screen'), icon: s.icon || s.id, tab: s.id }))
    if (!n) return sc.slice(0, 8)
    const score = item => {
      const l = norm(item.label)
      if (l.startsWith(n)) return 0
      if (l.split(/\s+/).some(w => w.startsWith(n))) return 1
      if (l.includes(n)) return 2
      if (norm(item.sub).includes(n)) return 3
      return 9
    }
    return [...sc, ...(records || [])]
      .map(item => ({ item, s: score(item) }))
      .filter(x => x.s < 9)
      .sort((a, b) => a.s - b.s)
      .slice(0, 12)
      .map(x => x.item)
  }, [q, screens, records, t])

  useEffect(() => { setActive(0) }, [q])

  function pick(item) {
    if (!item) return
    setOpen(false)
    setQ('')
    inputRef.current?.blur()
    onGo?.(item.tab)
  }

  return (
    <div ref={boxRef} className={`gsearch${compact ? ' is-compact' : ''}${open ? ' is-open' : ''}`}>
      <Icon name="search" size={16} className="gsearch-icon" />
      <input
        ref={inputRef}
        type="search"
        value={q}
        onChange={e => { setQ(e.target.value); setOpen(true) }}
        onFocus={warm}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, results.length - 1)) }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
          if (e.key === 'Enter') { e.preventDefault(); pick(results[active]) }
          if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur() }
        }}
        placeholder={t('search.placeholder')}
        aria-label={t('search.placeholder')}
        role="combobox"
        aria-expanded={open}
        aria-controls="gsearch-list"
        aria-autocomplete="list"
      />
      <kbd className="gsearch-kbd">⌘K</kbd>
      {open && (
        <ul id="gsearch-list" className="gsearch-list" role="listbox">
          {results.length === 0 && <li className="gsearch-empty">{t('search.none')}</li>}
          {results.map((r, i) => (
            <li key={r.key} role="option" aria-selected={i === active}>
              <button type="button" className={`gsearch-item${i === active ? ' is-active' : ''}`} onMouseEnter={() => setActive(i)} onClick={() => pick(r)}>
                <span className="gsearch-item-icon"><Icon name={r.icon} size={15} /></span>
                <span className="gsearch-item-main"><strong>{r.label}</strong>{r.sub && <small>{r.sub}</small>}</span>
                <Icon name="next" size={14} className="gsearch-item-go" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
