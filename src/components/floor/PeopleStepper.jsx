import { useEffect, useState } from 'react'
import { useI18n } from '../../lib/i18n'
import Icon from '../ui/Icon'

/** Number of people at a table: type it or step it; saved on Enter, on leaving the box or on a step. */
export default function PeopleStepper({ value, onSave }) {
  const { t } = useI18n()
  const [text, setText] = useState(String(value))
  useEffect(() => { setText(String(value)) }, [value])
  const save = n => {
    const v = Math.max(1, Math.min(99, Math.round(+n || 0)))
    setText(String(v))
    if (v !== value) onSave(v)
  }
  return (
    <div className="f3-people" role="group" aria-label={t('tabs.peopleLabel')}>
      <span className="f3-people-label"><Icon name="users" size={14} /> {t('tabs.peopleLabel')}</span>
      <button type="button" className="ui-btn is-sm is-icon" onClick={() => save(value - 1)} disabled={value <= 1} aria-label={t('floor.peopleLess')}><Icon name="minus" size={14} /></button>
      <input
        type="number" inputMode="numeric" min="1" max="99" value={text} aria-label={t('tabs.peopleLabel')}
        onChange={e => setText(e.target.value)} onBlur={() => save(text)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); save(text) } }}
        onPointerDown={e => e.stopPropagation()}
      />
      <button type="button" className="ui-btn is-sm is-icon" onClick={() => save(value + 1)} aria-label={t('floor.peopleMore')}><Icon name="plus" size={14} /></button>
    </div>
  )
}
