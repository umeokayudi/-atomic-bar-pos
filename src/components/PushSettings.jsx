import { useEffect, useMemo, useState } from 'react'
import { useAuth } from './Auth'
import { useI18n } from '../lib/i18n'
import { errText } from '../lib/errText'
import { supabase } from '../lib/supabase'
import Icon from './ui/Icon'
import {
  aiPushText, disablePush, enablePush, loadPushStyle, mySubscription, pushSupport, savePrefs, savePushStyle, testPush,
} from '../lib/push'
import { DEFAULT_STYLE, PUSH_TYPES, SAMPLE_VARS, TONES, cleanPrefs, cleanStyle, cleanVars, defaultPrefs, renderPush } from '../lib/pushTemplates'
import './pushSettings.css'

const GROUPS = ['ops', 'team', 'close', 'money']

/**
 * Notifications on this phone: turn on, on/off per kind, test. The owner (and JBM) also set the bar's message
 * style: tone, emoji, "congratulations" on money, their own texts, with the AI writing a suggestion.
 * `hq` = JBM admin screen (HQ → Bars): picks which bar's style to edit.
 */
export default function PushSettings({ hq = false }) {
  const { t, lang } = useI18n()
  const { perfil } = useAuth()
  const owner = hq || perfil?.role === 'cliente'
  const support = useMemo(() => pushSupport(), [])
  const [sub, setSub] = useState(null)
  const [prefs, setPrefs] = useState(defaultPrefs())
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState(null)
  const [bars, setBars] = useState([])
  const [barId, setBarId] = useState(hq ? '' : perfil?.bar_id || '')
  const [style, setStyle] = useState(DEFAULT_STYLE)
  const [look, setLook] = useState({ name: '', color: '' })
  const [dirty, setDirty] = useState(false)
  const [aiFor, setAiFor] = useState('')
  const [hint, setHint] = useState('')
  const [openStyle, setOpenStyle] = useState(false)

  useEffect(() => {
    let live = true
    mySubscription().then(s => { if (live && s) { setSub(s); setPrefs(cleanPrefs(s.prefs)) } }).catch(() => null)
    return () => { live = false }
  }, [])

  useEffect(() => {
    if (!hq) return
    supabase.from('bars').select('id,nome').order('nome').then(({ data }) => {
      setBars(data || [])
      if (data?.length) setBarId(b => b || data[0].id)
    })
  }, [hq])

  useEffect(() => {
    if (!owner || !barId) return
    let live = true
    loadPushStyle(barId).then(j => {
      if (!live) return
      setStyle(cleanStyle(j.style))
      setLook(j.look || { name: '', color: '' })
      setDirty(false)
    }).catch(() => null)
    return () => { live = false }
  }, [owner, barId])

  const say = (tone, text) => setMsg({ tone, text })

  async function turnOn() {
    setBusy('on'); setMsg(null)
    try {
      const r = await enablePush({ prefs, lang })
      setSub(r.saved)
      say('success', t('push.onOk'))
    } catch (e) {
      say('danger', e.message === 'denied' ? t('push.denied') : e.message === 'ios_home' ? t('push.iosHome') : errText(e))
    } finally { setBusy('') }
  }

  async function turnOff() {
    setBusy('off'); setMsg(null)
    try { await disablePush(); setSub(null); say('success', t('push.offOk')) } catch (e) { say('danger', errText(e)) } finally { setBusy('') }
  }

  async function flip(id) {
    const next = { ...prefs, [id]: !prefs[id] }
    setPrefs(next)
    if (!sub) return
    try { await savePrefs(next, lang) } catch (e) { say('danger', errText(e)) }
  }

  async function test(type = 'sale') {
    setBusy('test'); setMsg(null)
    try {
      const r = await testPush(type, style)
      say(r.sent ? 'success' : 'danger', r.sent ? t('push.testSent') : t('push.testNone'))
    } catch (e) { say('danger', errText(e)) } finally { setBusy('') }
  }

  const setS = patch => { setStyle(s => ({ ...s, ...patch })); setDirty(true) }
  const setText = (id, v) => setS({ texts: { ...style.texts, [id]: v } })

  async function saveStyle() {
    setBusy('style'); setMsg(null)
    try {
      const j = await savePushStyle(style, barId)
      setStyle(cleanStyle(j.style)); setDirty(false)
      say('success', t('push.styleSaved'))
    } catch (e) { say('danger', errText(e)) } finally { setBusy('') }
  }

  async function askAi(id) {
    setBusy(`ai-${id}`); setMsg(null)
    try {
      const j = await aiPushText({ type: id, tone: style.tone, lang, hint, current: style.texts[id] || '' })
      if (j.text) setText(id, j.text)
      setAiFor('')
      setHint('')
    } catch (e) { say('danger', errText(e)) } finally { setBusy('') }
  }

  const preview = id => renderPush({ type: id, vars: cleanVars(id, SAMPLE_VARS[id]), lang, style, barName: look.name || perfil?.nome || 'Bar' })
  const iconSrc = barId ? `/api/bar/push?action=icon&bar=${encodeURIComponent(barId)}` : '/icons/icon-192.png?v=2'

  return (
    <section className="ui-card push-card" aria-labelledby="push-title">
      <div className="push-head">
        <Icon name="bell" size={18} />
        <div>
          <h3 id="push-title">{t('push.title')}</h3>
          <p className="desk-note">{t('push.lead')}</p>
        </div>
      </div>

      {!support.ok ? (
        <p className="push-hint">{support.reason === 'ios_home' ? t('push.iosHome') : t('push.noBrowser')}</p>
      ) : (
        <div className="push-actions">
          {sub ? (
            <>
              <span className="ui-badge is-success"><Icon name="check" size={13} /> {t('push.onHere')}</span>
              <button type="button" className="ui-btn is-sm" disabled={!!busy} onClick={() => test()}>{busy === 'test' ? t('common.saving') : t('push.test')}</button>
              <button type="button" className="ui-btn is-ghost is-sm" disabled={!!busy} onClick={turnOff}>{t('push.turnOff')}</button>
            </>
          ) : (
            <button type="button" className="ui-btn is-primary" disabled={!!busy} onClick={turnOn}>
              <Icon name="bell" size={15} /> {busy === 'on' ? t('common.saving') : t('push.turnOn')}
            </button>
          )}
          {support.ios && !support.standalone && <p className="push-hint">{t('push.iosHome')}</p>}
        </div>
      )}

      <div className="push-groups">
        {GROUPS.map(g => (
          <div key={g} className="push-group">
            <h4>{t(`push.group.${g}`)}</h4>
            {PUSH_TYPES.filter(x => x.group === g).map(x => (
              <label key={x.id} className="push-row">
                <input type="checkbox" checked={prefs[x.id] !== false} onChange={() => flip(x.id)} />
                <span>{t(`push.type.${x.id}`)}</span>
              </label>
            ))}
          </div>
        ))}
      </div>
      {!sub && support.ok && <p className="desk-note">{t('push.prefsAfter')}</p>}

      {owner && (
        <div className="push-style">
          <button type="button" className="ui-btn is-ghost is-sm push-style-toggle" aria-expanded={openStyle} onClick={() => setOpenStyle(o => !o)}>
            <Icon name="edit" size={14} /> {t('push.styleTitle')}
          </button>
          {openStyle && (
            <>
              {hq && (
                <label className="ui-field"><span>{t('push.bar')}</span>
                  <select value={barId} onChange={e => setBarId(e.target.value)}>
                    {bars.map(b => <option key={b.id} value={b.id}>{b.nome}</option>)}
                  </select>
                </label>
              )}
              <p className="desk-note">{t('push.styleLead')}</p>
              <div className="ui-seg" role="radiogroup" aria-label={t('push.tone')}>
                {TONES.map(tone => (
                  <button key={tone} type="button" role="radio" aria-checked={style.tone === tone} onClick={() => setS({ tone })}>{t(`push.tones.${tone}`)}</button>
                ))}
              </div>
              <div className="push-checks">
                <label className="push-row"><input type="checkbox" checked={style.emoji} onChange={e => setS({ emoji: e.target.checked })} /> <span>{t('push.emoji')}</span></label>
                <label className="push-row"><input type="checkbox" checked={style.congrats} onChange={e => setS({ congrats: e.target.checked })} /> <span>{t('push.congrats')}</span></label>
              </div>
              {style.congrats && (
                <label className="ui-field"><span>{t('push.congratsText')}</span>
                  <input type="text" maxLength={80} value={style.congratsText} placeholder={t('push.congratsPh')} onChange={e => setS({ congratsText: e.target.value })} />
                </label>
              )}

              <div className="push-texts">
                {PUSH_TYPES.map(x => {
                  const p = preview(x.id)
                  return (
                    <div key={x.id} className="push-text">
                      <div className="push-text-head">
                        <strong>{t(`push.type.${x.id}`)}</strong>
                        <button type="button" className="ui-btn is-ghost is-sm" disabled={!!busy} onClick={() => setAiFor(f => (f === x.id ? '' : x.id))}>
                          <Icon name="ai" size={14} /> {t('push.ai')}
                        </button>
                      </div>
                      {aiFor === x.id && (
                        <div className="push-ai">
                          <input type="text" maxLength={300} value={hint} placeholder={t('push.aiPh')} onChange={e => setHint(e.target.value)} />
                          <button type="button" className="ui-btn is-sm is-primary" disabled={!!busy} onClick={() => askAi(x.id)}>{busy === `ai-${x.id}` ? t('push.aiBusy') : t('push.aiGo')}</button>
                        </div>
                      )}
                      <textarea rows={2} maxLength={200} value={style.texts[x.id] || ''} placeholder={t('push.defaultPh')} onChange={e => setText(x.id, e.target.value)} />
                      <small className="desk-note">{t('push.fields')}: {x.vars.map(v => `{${v}}`).join(' ')}</small>
                      <div className="push-preview" style={look.color ? { '--push-accent': look.color } : undefined}>
                        <img src={iconSrc} alt="" width={36} height={36} />
                        <div>
                          <b>{p.title}</b>
                          <span>{p.body}</span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="vault-actions">
                <button type="button" className="ui-btn is-primary" disabled={!!busy || !dirty} onClick={saveStyle}>
                  <Icon name="check" size={15} /> {busy === 'style' ? t('common.saving') : t('push.saveStyle')}
                </button>
                <button type="button" className="ui-btn is-ghost" disabled={!!busy} onClick={() => setS({ ...DEFAULT_STYLE, texts: {} })}>{t('push.reset')}</button>
              </div>
            </>
          )}
        </div>
      )}

      {msg && <div className={msg.tone === 'success' ? 'ui-badge is-success' : 'ui-error'} role={msg.tone === 'success' ? 'status' : 'alert'}>{msg.text}</div>}
    </section>
  )
}
