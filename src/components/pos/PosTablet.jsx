import { fmtYen } from '../utils'

export default function PosTablet({ t, floor }) {
  const {
    zone, zones, spaces, space, spaceId, cats, cat, visible, lines, preview, blocked, err, busy,
    pay, payments, agents, agentId, bottles, openForm, bottleProduct, bottleCode, shots,
    lossBottle, lossKind, lossMl, lossReason, bottleMoves, pendingRemove, lossAsk, selectedBottle, catalogError,
  } = floor

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
          <input aria-label="Search drinks" className="demo-search" placeholder="Search drinks" value={floor.query || ''} onChange={event => floor.setQuery?.(event.target.value)} />
          <div className="pos-t-cats">
            {cats.map(id => (
              <button key={id} type="button" className={cat === id ? 'is-on' : ''} onClick={() => floor.setCat(id)}>{id}</button>
            ))}
          </div>
          <div className="pos-t-grid">
            {visible.map(product => (
              <button key={product.id} type="button" className="pos-t-product" onClick={() => floor.addProduct(product)}>
                <span>{product.nome}</span>
                <strong>{+product.preco_venda > 0 ? fmtYen(product.preco_venda) : '—'}</strong>
              </button>
            ))}
            {visible.length === 0 && <p className="pos-floor-empty">{catalogError || t('posFloor.noProducts')}</p>}
          </div>
        </section>

        <aside className="pos-t-ticket">
          <h3>{t('posFloor.navTicket')}</h3>
          {lines.length === 0 && <p className="pos-floor-empty">{t('posFloor.emptyTicket')}</p>}
          <div className="pos-t-lines">
            {lines.map(line => {
              const shown = (preview?.lines || []).find(row => row.id === line.id)
              const product = floor.catalog.find(row => row.id === (line.drink_menu_id || line.produto_id))
              return (
                <div key={line.id} className="pos-t-line">
                  <div>
                    <strong>{shown?.nome || product?.nome || t('posFloor.unknown')}</strong>
                    <button type="button" onClick={() => floor.changeItem(line, line.qtd, !line.for_cast)}>
                      {line.for_cast ? t('posFloor.sheDrank') : t('posFloor.markGuest')}
                    </button>
                    {shown?.mode === 'ml' && (
                      <p className="pos-floor-meta">{t('posFloor.recipe')} {shown.required_ml || 0} ml · {t('posFloor.available')} {shown.available_ml || 0} ml</p>
                    )}
                  </div>
                  <div className="pos-t-qty">
                    <button type="button" onClick={() => floor.requestQty(line, line.qtd - 1)}>-</button>
                    <span>{line.qtd}</span>
                    <button type="button" onClick={() => floor.requestQty(line, line.qtd + 1)}>+</button>
                    {floor.applyDiscount && (
                      <button type="button" onClick={() => floor.applyDiscount(shown?.discountRate === 0.1 ? 0 : 0.1, line.id)}>
                        {shown?.discountRate === 0.1 ? 'Line off' : 'Line 10%'}
                      </button>
                    )}
                  </div>
                  <span>{fmtYen((shown?.unit_price || 0) * line.qtd)}</span>
                </div>
              )
            })}
          </div>
          <div className="pos-t-pay">
            <div className="pos-m-total">
              <span>{t('posFloor.total')}</span>
              <strong>{lines.length ? fmtYen(preview?.subtotal || 0) : '—'}</strong>
            </div>
            {!lines.length && <p className="pos-floor-meta">{t('posFloor.noOpenTicket')}</p>}
            {lines.length > 0 && preview && (
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
            {floor.applyDiscount && (
              <div className="pos-t-pays" aria-label="Discount">
                <button type="button" disabled={!lines.length} onClick={() => floor.applyDiscount(0)}>No discount</button>
                <button type="button" disabled={!lines.length} onClick={() => floor.applyDiscount(0.1)}>10%</button>
                <button type="button" disabled={!lines.length} onClick={() => floor.applyDiscount(0.2)}>20%</button>
              </div>
            )}
            {lines.length > 0 && preview && (
              <p className="pos-floor-meta">Subtotal {fmtYen(preview.listSubtotal)} · Discount {fmtYen(preview.discount || 0)} · Tax included {fmtYen(preview.tax || 0)}</p>
            )}
            {floor.allowDiscount === false && <p className="pos-floor-meta">Discounts require a manager.</p>}
            {floor.drawer && (
              <p className="pos-floor-meta">
                Register {floor.drawer.status}{floor.drawer.status === 'open' ? ` · ${fmtYen(floor.drawer.expected)}` : ''}
                {floor.openRegister && <button type="button" onClick={floor.openRegister}>Register</button>}
              </p>
            )}
            <div className="pos-t-pays">
              {payments.map(id => (
                <button key={id} type="button" className={pay === id ? 'is-on' : ''} onClick={() => floor.changePay(id)}>{t(`posFloor.pay_${id}`)}</button>
              ))}
            </div>
            {blocked && <div className="pos-sale-err">{blocked}</div>}
            <button type="button" className="pos-t-charge" disabled={busy || !lines.length || !!blocked} onClick={floor.charge}>
              {busy ? t('posFloor.saving') : lines.length ? t('posFloor.charge') : t('posFloor.chargeEmpty')}
            </button>
            <button type="button" onClick={() => floor.setOpenForm(v => !v)}>{t('posFloor.openBottle')}</button>
            {openForm && (
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
                <button type="button" onClick={floor.openBottle}>{t('posFloor.confirmOpen')}</button>
              </div>
            )}
            <div className="pos-t-bottles">
              {(Array.isArray(bottles) ? bottles : []).filter(row => row.status === 'opened').slice(0, 8).map(row => (
                <button key={row.id} type="button" className={lossBottle === row.id ? 'is-on' : ''} onClick={() => floor.setLossBottle(row.id)}>
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
