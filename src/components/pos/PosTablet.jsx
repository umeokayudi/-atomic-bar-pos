import { useState } from 'react'
import { fmtYen } from '../utils'

export default function PosTablet({ t, floor }) {
  const {
    zone, zones, spaces, space, spaceId, cats, cat, visible, lines, preview, blocked, err, busy,
    pay, payments, agents, agentId, bottles, bottleProduct, bottleCode, shots,
    lossBottle, lossKind, lossMl, lossReason, bottleMoves, pendingRemove, lossAsk, selectedBottle, catalogError,
  } = floor
  const [bottlesOpen, setBottlesOpen] = useState(false)
  const openBottles = (Array.isArray(bottles) ? bottles : []).filter(row => row.status === 'opened').slice(0, 8)
  const total = preview?.subtotal || 0

  return (
    <div className={`pos-mode-tablet pos-orient-${floor.orientation}`} data-pos-mode="tablet">
      <header className="pos-t-top">
        <strong>{space?.nome || t('posFloor.pickSpace')}</strong>
        <button type="button" onClick={floor.openSettings}>{t('posFloor.layout')}</button>
      </header>
      {err && <div className="pos-sale-err">{err}</div>}
      <div className="pos-t-board">
        <aside className="pos-t-spaces">
          <div className="pos-t-zones">
            {zones.map(id => (
              <button key={id} type="button" className={zone === id ? 'is-on' : ''} onClick={() => floor.setZone(id)}>
                {t(`posFloor.zone_${id}`)}
              </button>
            ))}
          </div>
          <div className="pos-t-space-list">
            {spaces.map(row => (
              <button key={row.id} type="button" className={spaceId === row.id ? 'is-on' : ''} onClick={() => floor.chooseSpace(row.id)}>
                {row.nome}
              </button>
            ))}
            {spaces.length === 0 && <p className="pos-floor-empty">{t('posFloor.noSpaces')}</p>}
          </div>
        </aside>

        <section className="pos-t-products">
          <div className="pos-t-cats">
            {cats.map(id => (
              <button key={id} type="button" className={cat === id ? 'is-on' : ''} onClick={() => floor.setCat(id)}>{id}</button>
            ))}
          </div>
          <div className="pos-t-grid">
            {visible.map(product => (
              <button key={product.id} type="button" className="pos-t-product" onClick={() => floor.addProduct(product)}>
                <span>{product.nome}</span>
                <strong>{fmtYen(product.preco_venda || product.preco_drink || 0)}</strong>
              </button>
            ))}
            {visible.length === 0 && <p className="pos-floor-empty">{catalogError || t('posFloor.noProducts')}</p>}
          </div>
        </section>

        <aside className="pos-t-ticket">
          <div className="pos-t-ticket-head">
            <h3>{t('posFloor.navTicket')}</h3>
            <button type="button" className={bottlesOpen ? 'is-on' : ''} onClick={() => setBottlesOpen(v => !v)}>
              {t('posFloor.bottlesPanel')}{openBottles.length ? ` · ${openBottles.length}` : ''}
            </button>
          </div>
          <div className="pos-t-scroll">
            {bottlesOpen && (
              <div className="pos-t-bottle-panel">
                <div className="pos-m-form">
                  <select value={bottleProduct} onChange={e => floor.setBottleProduct(e.target.value)}>
                    <option value="">{t('posFloor.product')}</option>
                    {shots.map(row => (
                      <option key={row.produto_id} value={row.produto_id}>{row.produtos?.nome || row.produto_id}</option>
                    ))}
                  </select>
                  <input value={bottleCode} onChange={e => floor.setBottleCode(e.target.value)} placeholder={t('posFloor.bottleCode')} />
                  <span className="pos-floor-meta">
                    {selectedBottle?.produtos?.volume_ml ? `${selectedBottle.produtos.volume_ml} ml` : t('posFloor.volumeCatalog')}
                  </span>
                  <button type="button" disabled={!bottleProduct} onClick={floor.openBottle}>{t('posFloor.confirmOpen')}</button>
                </div>
                <div className="pos-t-bottles">
                  {openBottles.map(row => (
                    <button key={row.id} type="button" className={lossBottle === row.id ? 'is-on' : ''} onClick={() => floor.setLossBottle(lossBottle === row.id ? '' : row.id)}>
                      {row.produto_nome ? `${row.produto_nome} · ` : ''}{row.code} · {row.volume_atual}/{row.volume_original} ml
                    </button>
                  ))}
                  {lossBottle && (
                    <div className="pos-m-form">
                      <select value={lossKind} onChange={e => floor.setLossKind(e.target.value)}>
                        {bottleMoves.map(kind => (
                          <option key={kind} value={kind}>{t(`posFloor.move_${kind}`)}</option>
                        ))}
                      </select>
                      <input value={lossMl} onChange={e => floor.setLossMl(e.target.value)} inputMode="numeric" placeholder={t('posFloor.moveMl')} />
                      <input value={lossReason} onChange={e => floor.setLossReason(e.target.value)} placeholder={t('posFloor.moveReason')} />
                      <button type="button" onClick={floor.askLoss}>{t('posFloor.moveSave')}</button>
                    </div>
                  )}
                </div>
              </div>
            )}
            {lines.length === 0 && <p className="pos-floor-empty">{space ? t('posFloor.emptyTicket') : t('posFloor.pickSpaceHint')}</p>}
            <div className="pos-t-lines">
              {lines.map(line => {
                const shown = (preview?.lines || []).find(row => row.id === line.id)
                const product = floor.catalog.find(row => row.id === (line.drink_menu_id || line.produto_id))
                return (
                  <div key={line.id} className="pos-t-line">
                    <div className="pos-t-line-name">
                      <strong>{shown?.nome || product?.nome || t('posFloor.unknown')}</strong>
                      <button type="button" className={line.for_cast ? 'is-on' : ''} onClick={() => floor.changeItem(line, line.qtd, !line.for_cast)}>
                        {line.for_cast ? t('posFloor.sheDrank') : t('posFloor.markGuest')}
                      </button>
                      {shown?.mode === 'ml' && (
                        <p className="pos-floor-meta">{t('posFloor.recipe')} {shown.required_ml || 0} ml · {t('posFloor.available')} {shown.available_ml || 0} ml</p>
                      )}
                    </div>
                    <div className="pos-t-qty">
                      <button type="button" aria-label="-1" onClick={() => floor.requestQty(line, line.qtd - 1)}>−</button>
                      <span>{line.qtd}</span>
                      <button type="button" aria-label="+1" onClick={() => floor.requestQty(line, line.qtd + 1)}>+</button>
                    </div>
                    <span className="pos-t-line-total">{fmtYen((shown?.unit_price || 0) * line.qtd)}</span>
                  </div>
                )
              })}
            </div>
          </div>
          <div className="pos-t-pay">
            <div className="pos-m-total">
              <span>{t('posFloor.total')}</span>
              <strong>{fmtYen(total)}</strong>
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
            <div className="pos-t-pays">
              {payments.map(id => (
                <button key={id} type="button" className={pay === id ? 'is-on' : ''} onClick={() => floor.changePay(id)}>{t(`posFloor.pay_${id}`)}</button>
              ))}
            </div>
            {blocked && <div className="pos-sale-err">{blocked}</div>}
            <button type="button" className="pos-t-charge" disabled={busy || !lines.length || !!blocked} onClick={floor.charge}>
              {busy ? t('posFloor.saving') : `${t('posFloor.charge')}${lines.length ? ` · ${fmtYen(total)}` : ''}`}
            </button>
          </div>
        </aside>
      </div>

      {pendingRemove && (
        <div className="pos-mode-picker" role="dialog" aria-modal="true">
          <div className="pos-mode-card">
            <h2>{t('posFloor.removeLine')}</h2>
            <div className="pos-mode-choices">
              <button type="button" onClick={() => floor.setPendingRemove(null)}>{t('posFloor.removeNo')}</button>
              <button type="button" className="is-danger" onClick={floor.confirmRemove}>{t('posFloor.removeYes')}</button>
            </div>
          </div>
        </div>
      )}
      {lossAsk && (
        <div className="pos-mode-picker" role="dialog" aria-modal="true">
          <div className="pos-mode-card">
            <h2>{t('posFloor.confirmLoss')}</h2>
            <div className="pos-mode-choices">
              <button type="button" onClick={() => floor.setLossAsk(false)}>{t('posFloor.removeNo')}</button>
              <button type="button" className="is-danger" onClick={floor.confirmLoss}>{t('posFloor.moveSave')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
