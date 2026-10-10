import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './Auth'
import { useI18n } from '../lib/i18n'
import { errText } from '../lib/errText'
import { loadBarTeam } from '../lib/barTeam'
import { cancelOrder, listBarOrders, orderStats, ordersInstalled, sendOrders } from '../lib/staffOrders'
import { tokyoClock } from '../lib/staffDayReport'
import { PageHeader } from './ui/PageLayout'
import Icon from './ui/Icon'

const POLL_MS = 20000
const DUE = [0, 10, 30, 60]
const TEMPLATES = ['ice', 'vip', 'door', 'restock', 'clean', 'break']

function minutesAgo(iso, now) {
  return Math.max(0, Math.round((now - Date.parse(iso)) / 60000))
}

/**
 * Owner/manager sends an order to one person or to everyone on the team. Staff see it as an alert on
 * their screen and answer "Got it" / "Done"; this board shows who has seen and finished what.
 */
export default function StaffOrdersTab({ bar }) {
  const { t } = useI18n()
  const { user, perfil } = useAuth()
  const [installed, setInstalled] = useState(null)
  const [team, setTeam] = useState([])
  const [orders, setOrders] = useState([])
  const [to, setTo] = useState([])
  const [text, setText] = useState('')
  const [prio, setPrio] = useState('normal')
  const [due, setDue] = useState(0)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [show, setShow] = useState('open')
  const [now, setNow] = useState(() => Date.now())

  const refresh = useCallback(async (ok = installed) => {
    setNow(Date.now())
    if (!ok) return
    try { setOrders(await listBarOrders(supabase, bar.id)) } catch (e) { setMsg({ tone: 'danger', text: errText(e) }) }
  }, [bar.id, installed])

  useEffect(() => {
    let alive = true
    loadBarTeam().then(r => {
      if (!alive) return
      const staff = (r.staff || []).filter(p => p?.id).map(p => ({ id: p.id, nome: p.nome || '', cargo: p.cargo || '' }))
      setTeam(staff)
    }).catch(() => {})
    ordersInstalled(supabase, bar.id).then(ok => {
      if (!alive) return
      setInstalled(ok)
      refresh(ok)
    }).catch(e => { if (alive) { setInstalled(false); setMsg({ tone: 'danger', text: errText(e) }) } })
    return () => { alive = false }
  }, [bar.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!installed) return undefined
    const id = setInterval(() => { if (document.visibilityState === 'visible') refresh() }, POLL_MS)
    return () => clearInterval(id)
  }, [installed, refresh])

  const everyone = team.length > 0 && to.length === team.length
  const stats = useMemo(() => orderStats(orders, now), [orders, now])
  const shown = orders.filter(o => o.status !== 'cancelled' && (show === 'all' || o.status !== 'done'))

  function toggle(id) {
    setTo(cur => (cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]))
  }

  async function send(e) {
    e.preventDefault()
    if (!text.trim() || !to.length) return
    setBusy(true)
    setMsg(null)
    try {
      const dueAt = due ? new Date(Date.now() + due * 60000).toISOString() : null
      const res = await sendOrders(supabase, {
        barId: bar.id,
        installed,
        to: team.filter(p => to.includes(p.id)),
        mensagem: text,
        prioridade: prio,
        dueAt,
        fromId: user?.id || null,
        fromNome: perfil?.nome || '',
        dueLabel: dueAt ? t('orders.dueBy', { time: tokyoClock(dueAt) }) : '',
      })
      setText('')
      setDue(0)
      setPrio('normal')
      setMsg({ tone: 'success', text: t(res.mode === 'notifications' ? 'orders.sentBell' : 'orders.sent', { n: res.sent }) })
      refresh()
    } catch (err) {
      setMsg({ tone: 'danger', text: errText(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fade-in sord">
      <PageHeader title={t('orders.title')} subtitle={t('orders.lead')} />
      {installed === false && <div className="ui-card desk-note sord-fallback"><Icon name="info" size={15} /> {t('orders.fallback')}</div>}

      <div className="sord-grid">
        <form className="ui-card sord-compose" onSubmit={send}>
          <div className="ui-card-title"><Icon name="ordens" size={16} /> {t('orders.compose')}</div>

          <div className="sord-field">
            <span className="sord-label">{t('orders.to')}</span>
            <div className="sord-people" role="group" aria-label={t('orders.to')}>
              <button type="button" className="sord-chip is-all" aria-pressed={everyone} onClick={() => setTo(everyone ? [] : team.map(p => p.id))}>
                <Icon name="people" size={14} /> {t('orders.everyone')}
              </button>
              {team.map(p => (
                <button key={p.id} type="button" className="sord-chip" aria-pressed={to.includes(p.id)} onClick={() => toggle(p.id)}>
                  <span className="sord-avatar" aria-hidden="true">{(p.nome || '?').slice(0, 1).toUpperCase()}</span>
                  {p.nome}{p.cargo ? <small>{p.cargo}</small> : null}
                </button>
              ))}
              {!team.length && <span className="desk-note">{t('orders.noTeam')}</span>}
            </div>
          </div>

          <label className="sord-field">
            <span className="sord-label">{t('orders.message')}</span>
            <textarea rows={3} maxLength={500} value={text} onChange={e => setText(e.target.value)} placeholder={t('orders.placeholder')} />
          </label>
          <div className="sord-templates" aria-label={t('orders.quick')}>
            {TEMPLATES.map(k => (
              <button key={k} type="button" className="ui-btn is-sm is-ghost" onClick={() => setText(t(`orders.tpl.${k}`))}>{t(`orders.tpl.${k}`)}</button>
            ))}
          </div>

          <div className="sord-row">
            <div className="sord-field">
              <span className="sord-label">{t('orders.priority')}</span>
              <div className="ui-seg" role="radiogroup" aria-label={t('orders.priority')}>
                {['normal', 'urgent'].map(p => (
                  <button key={p} type="button" role="radio" aria-checked={prio === p} onClick={() => setPrio(p)}>
                    {p === 'urgent' && <Icon name="alert" size={14} />}{t(`orders.prio.${p}`)}
                  </button>
                ))}
              </div>
            </div>
            <div className="sord-field">
              <span className="sord-label">{t('orders.due')}</span>
              <div className="ui-seg" role="radiogroup" aria-label={t('orders.due')}>
                {DUE.map(m => (
                  <button key={m} type="button" role="radio" aria-checked={due === m} onClick={() => setDue(m)}>{m ? t('orders.inMin', { n: m }) : t('orders.noDue')}</button>
                ))}
              </div>
            </div>
          </div>

          {msg && <div className={msg.tone === 'success' ? 'ui-badge is-success' : 'ui-error'} role={msg.tone === 'success' ? 'status' : 'alert'}>{msg.text}</div>}
          <button type="submit" className="ui-btn is-primary is-lg" disabled={busy || !text.trim() || !to.length}>
            <Icon name="send" size={16} /> {busy ? t('common.saving') : t('orders.send', { n: to.length })}
          </button>
        </form>

        <section className="ui-card sord-board" aria-label={t('orders.board')}>
          <div className="ui-card-head">
            <div className="ui-card-title">{t('orders.board')}</div>
            <div className="ui-seg" role="radiogroup" aria-label={t('orders.board')}>
              <button type="button" role="radio" aria-checked={show === 'open'} onClick={() => setShow('open')}>{t('orders.showOpen')}</button>
              <button type="button" role="radio" aria-checked={show === 'all'} onClick={() => setShow('all')}>{t('orders.showAll')}</button>
            </div>
          </div>
          <div className="sord-stats">
            <span className="sord-stat is-sent"><b>{stats.sent}</b>{t('orders.st.sent')}</span>
            <span className="sord-stat is-seen"><b>{stats.seen}</b>{t('orders.st.seen')}</span>
            <span className="sord-stat is-done"><b>{stats.done}</b>{t('orders.st.done')}</span>
            <span className={`sord-stat is-late${stats.overdue ? ' is-on' : ''}`}><b>{stats.overdue}</b>{t('orders.overdue')}</span>
          </div>
          {!installed ? <p className="desk-note">{t('orders.boardNeedsSql')}</p> : !shown.length ? (
            <div className="ui-empty-state"><span className="ui-empty-icon"><Icon name="ordens" size={22} /></span><p>{t('orders.empty')}</p></div>
          ) : (
            <ul className="sord-list">
              {shown.map(o => {
                const late = o.status !== 'done' && o.due_at && Date.parse(o.due_at) < now
                return (
                  <li key={o.id} className={`sord-item is-${o.status}${o.prioridade === 'urgent' ? ' is-urgent' : ''}${late ? ' is-late' : ''}`}>
                    <div className="sord-item-main">
                      <strong>{o.staff_nome || team.find(p => p.id === o.staff_id)?.nome || '—'}</strong>
                      <p>{o.mensagem}</p>
                      <small>
                        {t('orders.ago', { n: minutesAgo(o.criado_em, now) })}
                        {o.due_at ? ` · ${t('orders.dueBy', { time: tokyoClock(o.due_at) })}` : ''}
                        {o.from_nome ? ` · ${t('orders.fromBy', { name: o.from_nome })}` : ''}
                      </small>
                    </div>
                    <div className="sord-item-side">
                      <span className={`sord-pill is-${late ? 'late' : o.status}`}>
                        <Icon name={o.status === 'done' ? 'ok' : o.status === 'seen' ? 'eye' : late ? 'warning' : 'send'} size={12} />
                        {late ? t('orders.overdue') : t(`orders.st.${o.status}`)}
                      </span>
                      {o.status !== 'done' && (
                        <button type="button" className="ui-btn is-ghost is-icon is-sm" aria-label={t('orders.cancel')} title={t('orders.cancel')}
                          onClick={async () => { try { await cancelOrder(supabase, o.id); refresh() } catch (e) { setMsg({ tone: 'danger', text: errText(e) }) } }}>
                          <Icon name="close" size={14} />
                        </button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
