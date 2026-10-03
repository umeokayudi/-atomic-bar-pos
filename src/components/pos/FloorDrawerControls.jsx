import { isLocalDemo } from '../../lib/supabase'
import { tokyoNightKey } from '../../lib/tokyo'
import { fmtYen } from '../utils'

export default function FloorDrawerControls({ t, floor }) {
  if (isLocalDemo) {
    return <p className="pos-floor-meta">{t('atomicPos.drawerDemoBlocked')}</p>
  }
  return (
    <div className="pos-close-actions">
      <p className="pos-floor-meta">
        {t('atomicPos.nightOpen', { date: tokyoNightKey() })}
        {floor.ledgerExpected == null ? '' : ` · ${fmtYen(floor.ledgerExpected)}`}
      </p>
      <select value={floor.moveKind} onChange={e => floor.setMoveKind(e.target.value)} aria-label={t('atomicPos.drawerKind')}>
        <option value="sangria">{t('atomicPos.drawerSangria')}</option>
        <option value="suprimento">{t('atomicPos.drawerSuprimento')}</option>
      </select>
      <input type="number" min="1" placeholder={t('atomicPos.drawerAmount')} value={floor.moveAmount} onChange={e => floor.setMoveAmount(e.target.value)} />
      <input type="text" maxLength={500} placeholder={t('atomicPos.drawerNote')} value={floor.moveNote} onChange={e => floor.setMoveNote(e.target.value)} />
      <button type="button" disabled={floor.busy} onClick={floor.recordDrawerMove}>{t('atomicPos.drawerMove')}</button>
      <input type="number" min="0" placeholder={t('atomicPos.cashCounted')} value={floor.countedCash} onChange={e => floor.setCountedCash(e.target.value)} />
      <button type="button" className="btn-primary" disabled={floor.busy} onClick={floor.closeLedgerNight}>{t('atomicPos.closeNight')}</button>
      {floor.drawerMsg && <div className="pos-close-msg">{floor.drawerMsg}</div>}
    </div>
  )
}
