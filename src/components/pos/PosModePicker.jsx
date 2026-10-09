export default function PosModePicker({ t, suggested = 'mobile', settings = false, onChoose }) {
  return (
    <div className="pos-mode-picker" role="dialog" aria-modal="true" aria-labelledby="pos-mode-title">
      <div className="pos-mode-card">
        <h2 id="pos-mode-title">{settings ? t('posFloor.layoutTitle') : t('posFloor.askDevice')}</h2>
        <p>{settings ? t('posFloor.layoutHint') : t('posFloor.askHint')}</p>
        <div className="pos-mode-choices">
          <button type="button" className={suggested === 'mobile' ? 'is-suggested' : ''} onClick={() => onChoose('mobile')}>
            <span aria-hidden="true">📱</span>
            {t('posFloor.phone')}
          </button>
          <button type="button" className={suggested === 'tablet' ? 'is-suggested' : ''} onClick={() => onChoose('tablet')}>
            <span aria-hidden="true">📲</span>
            {t('posFloor.tablet')}
          </button>
        </div>
      </div>
    </div>
  )
}
