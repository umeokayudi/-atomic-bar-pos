import { fmtYen } from '../utils'

export default function PosMobile({ t, floor }) {
  const {
    zone, zones, spaces, space, spaceId, cats, cat, visible, lines, preview, blocked, err, busy,
    pay, payments, agents, agentId, bottles, openForm, bottleProduct, bottleCode, shots,
    lossBottle, lossKind, lossMl, lossReason, bottleMoves, step, sheet, pendingRemove, lossAsk,
    selectedBottle, catalogError,
  } = floor

  return (
    <div className={`pos-mode-mobile pos-orient-${floor.orientation}`} data-pos-mode="mobile">
      <header className="pos-m-top">
        <div>
          <strong>{space?.nome || t('posFloor.pickSpace')}</strong>
          <span>{fmtYen(preview?.subtotal || 0)}</span>
        </div>
        <button type="button" onClick={floor.openSettings}>{t('posFloor.layout')}</button>
      </header>

      {err && <div className="pos-sale-err">{err}</div>}

      {step === 'tables' && (
        <section className="pos-m-panel">
          <div className="pos-m-zones">
            {zones.map(id => (
              <button key={id} type="button" className={zone === id ? 'is-on' : ''} onClick={() => floor.setZone(id)}>
                {t(`posFloor.zone_${id}`)}
              </button>
            ))}
          </div>
          <div className="pos-m-cards">
            {spaces.map(row => (
              <button key={row.id} type="button" className={`pos-m-card${spaceId === row.id ? ' is-on' : ''}`} onClick={() => floor.chooseSpace(row.id)}>
                {row.nome}
              </button>
            ))}
            {spaces.length === 0 && <p className="pos-floor-empty">{t('posFloor.noSpaces')}</p>}
          </div>
        </section>
      )}

      {step === 'products' && (
        <section className="pos-m-panel">
          <div className="pos-m-cats">
            {cats.map(id => (
              <button key={id} type="button" className={cat === id ? 'is-on' : ''} onClick={() => floor.setCat(id)}>{id}</button>
            ))}
          </div>
          <div className="pos-m-grid">
            {visible.map(product => (
              <button key={product.id} type="button" className="pos-m-product" onClick={() => floor.addProduct(product)}>
                <span>{product.nome}</span>
                <strong>{fmtYen(product.preco_venda || product.preco_drink || 0)}</strong>
              </button>
            ))}
            {visible.length === 0 && <p className="pos-floor-empty">{catalogError || t('posFloor.noProducts')}</p>}
          </div>
        </section>
      )}

      {(step === 'ticket' || sheet) && (
        <section className={`pos-m-sheet${step === 'ticket' ? ' is-open' : ''}`}>
          <button type="button" className="pos-m-sheet-handle" onClick={() => floor.setStep('ticket')}>{t('posFloor.navTicket')}</button>
          <TicketLines t={t} floor={floor} lines={lines} preview={preview} />
          {blocked && <div className="pos-sale-err">{blocked}</div>}
        </section>
      )}

      {step === 'pay' && (
        <section className="pos-m-panel pos-m-pay-panel">
          <div className="pos-m-total">
            <span>{t('posFloor.total')}</span>
            <strong>{fmtYen(preview?.subtotal || 0)}</strong>
          </div>
          {preview && (
            <p className="pos-floor-meta">
              {t('posFloor.fee')} {fmtYen(preview.fee)} · {t('posFloor.net')} {fmtYen(preview.net)} · {t('posFloor.commission')} {fmtYen(preview.commission)}
            </p>
          )}
          <select value={agentId} onChange={e => floor.changeAgent(e.target.value)}>
            <option value="">{t('posFloor.noCast')}</option>
            {agents.filter(row => row.ativo !== false).map(row => (
              <option key={row.id} value={row.id}>{row.nome}</option>
            ))}
          </select>
          <div className="pos-m-pays">
            {payments.map(id => (
              <button key={id} type="button" className={pay === id ? 'is-on' : ''} onClick={() => floor.changePay(id)}>{t(`posFloor.pay_${id}`)}</button>
            ))}
          </div>
          <button type="button" onClick={() => floor.setOpenForm(v => !v)}>{t('posFloor.openBottle')}</button>
          {openForm && <BottleForm t={t} floor={floor} shots={shots} bottleProduct={bottleProduct} bottleCode={bottleCode} selectedBottle={selectedBottle} />}
          <BottleLoss t={t} floor={floor} bottles={bottles} lossBottle={lossBottle} lossKind={lossKind} lossMl={lossMl} lossReason={lossReason} bottleMoves={bottleMoves} />
          {blocked && <div className="pos-sale-err">{blocked}</div>}
        </section>
      )}

      <div className="pos-m-dock">
        <button type="button" className="pos-m-charge" disabled={busy || !lines.length || !!blocked} onClick={floor.charge}>
          {busy ? t('posFloor.saving') : `${t('posFloor.charge')} ${fmtYen(preview?.subtotal || 0)}`}
        </button>
        <nav className="pos-m-nav" aria-label={t('posFloor.layout')}>
          {[
            ['tables', 'posFloor.navTables'],
            ['products', 'posFloor.navProducts'],
            ['ticket', 'posFloor.navTicket'],
            ['pay', 'posFloor.navPay'],
          ].map(([id, key]) => (
            <button key={id} type="button" className={step === id ? 'is-on' : ''} onClick={() => floor.setStep(id)}>
              {t(key)}
              {id === 'ticket' && lines.length > 0 ? ` ${lines.length}` : ''}
            </button>
          ))}
        </nav>
      </div>

      {pendingRemove && (
        <Confirm
          title={t('posFloor.removeLine')}
          yes={t('posFloor.removeYes')}
          no={t('posFloor.removeNo')}
          onYes={() => floor.confirmRemove()}
          onNo={() => floor.setPendingRemove(null)}
        />
      )}
      {lossAsk && (
        <Confirm
          title={t('posFloor.confirmLoss')}
          yes={t('posFloor.moveSave')}
          no={t('posFloor.removeNo')}
          onYes={() => floor.confirmLoss()}
          onNo={() => floor.setLossAsk(false)}
        />
      )}
    </div>
  )
}

function TicketLines({ t, floor, lines, preview }) {
  return (
    <div className="pos-m-lines">
      {lines.length === 0 && <p className="pos-floor-empty">{t('posFloor.emptyTicket')}</p>}
      {lines.map(line => {
        const shown = (preview?.lines || []).find(row => row.id === line.id)
        const product = floor.catalog.find(row => row.id === (line.drink_menu_id || line.produto_id))
        return (
          <div key={line.id} className="pos-m-line">
            <div>
              <strong>{shown?.nome || product?.nome || t('posFloor.unknown')}</strong>
              <button type="button" onClick={() => floor.changeItem(line, line.qtd, !line.for_cast)}>
                {line.for_cast ? t('posFloor.sheDrank') : t('posFloor.markGuest')}
              </button>
              {shown?.mode === 'ml' && (
                <p className="pos-floor-meta">{t('posFloor.recipe')} {shown.required_ml || 0} ml · {t('posFloor.available')} {shown.available_ml || 0} ml</p>
              )}
            </div>
            <div className="pos-m-qty">
              <button type="button" onClick={() => floor.requestQty(line, line.qtd - 1)}>-</button>
              <span>{line.qtd}</span>
              <button type="button" onClick={() => floor.requestQty(line, line.qtd + 1)}>+</button>
            </div>
            <span>{fmtYen(shown?.unit_price || 0)}</span>
          </div>
        )
      })}
    </div>
  )
}

function BottleForm({ t, floor, shots, bottleProduct, bottleCode, selectedBottle }) {
  return (
    <div className="pos-m-form">
      <select value={bottleProduct} onChange={e => floor.setBottleProduct(e.target.value)}>
        <option value="">{t('posFloor.product')}</option>
        {shots.map(row => (
          <option key={row.produto_id} value={row.produto_id}>{row.produtos?.nome || row.produto_id}</option>
        ))}
      </select>
      <input value={bottleCode} onChange={e => floor.setBottleCode(e.target.value)} placeholder={t('posFloor.bottleCode')} onFocus={focusField} />
      <span className="pos-floor-meta">
        {selectedBottle?.produtos?.volume_ml ? `${selectedBottle.produtos.volume_ml} ml` : t('posFloor.volumeCatalog')}
      </span>
      <button type="button" onClick={floor.openBottle}>{t('posFloor.confirmOpen')}</button>
    </div>
  )
}

function BottleLoss({ t, floor, bottles, lossBottle, lossKind, lossMl, lossReason, bottleMoves }) {
  const open = (Array.isArray(bottles) ? bottles : []).filter(row => row.status === 'opened').slice(0, 6)
  if (!open.length && !lossBottle) return null
  return (
    <div className="pos-m-form">
      {open.map(row => (
        <button key={row.id} type="button" className={lossBottle === row.id ? 'is-on' : ''} onClick={() => floor.setLossBottle(row.id)}>
          {row.produto_nome ? `${row.produto_nome} · ` : ''}{row.code} · {row.volume_atual}/{row.volume_original} ml
        </button>
      ))}
      {lossBottle && (
        <>
          <select value={lossKind} onChange={e => floor.setLossKind(e.target.value)}>
            {bottleMoves.map(kind => (
              <option key={kind} value={kind}>{t(`posFloor.move_${kind}`)}</option>
            ))}
          </select>
          <input value={lossMl} onChange={e => floor.setLossMl(e.target.value)} inputMode="numeric" placeholder={t('posFloor.moveMl')} onFocus={focusField} />
          <input value={lossReason} onChange={e => floor.setLossReason(e.target.value)} placeholder={t('posFloor.moveReason')} onFocus={focusField} />
          <button type="button" onClick={floor.askLoss}>{t('posFloor.moveSave')}</button>
        </>
      )}
    </div>
  )
}

function Confirm({ title, yes, no, onYes, onNo }) {
  return (
    <div className="pos-mode-picker" role="dialog" aria-modal="true">
      <div className="pos-mode-card">
        <h2>{title}</h2>
        <div className="pos-mode-choices">
          <button type="button" onClick={onNo}>{no}</button>
          <button type="button" className="is-danger" onClick={onYes}>{yes}</button>
        </div>
      </div>
    </div>
  )
}

function focusField(event) {
  const node = event.currentTarget
  window.setTimeout(() => node.scrollIntoView({ block: 'center' }), 80)
}
