import { useEffect, useState } from 'react'
import { useI18n } from '../../lib/i18n'

const LOCALES = { ja: 'ja-JP', en: 'en-GB', pt: 'pt-BR', es: 'es-ES' }

/** Full date and the time with seconds, in the account's language. Pure, so it can be tested. */
export function clockParts(now = new Date(), lang = 'ja') {
  const locale = LOCALES[lang] || LOCALES.ja
  const date = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }).format(now)
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(now)
  return { date, time }
}

/**
 * The header clock: full date + live time with seconds. It is in every header (HQ, bar portal, staff app,
 * supplier portal) and only this small component re-renders each second.
 */
export default function LiveClock({ className = '' }) {
  const { lang } = useI18n()
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    let timer
    const tick = () => {
      setNow(new Date())
      timer = setTimeout(tick, 1000 - (Date.now() % 1000) + 5)
    }
    timer = setTimeout(tick, 1000 - (Date.now() % 1000) + 5)
    return () => clearTimeout(timer)
  }, [])
  const { date, time } = clockParts(now, lang)
  return (
    <time className={`live-clock ${className}`.trim()} dateTime={now.toISOString()} aria-label={`${date} ${time}`}>
      <span className="live-clock-date">{date}</span>
      <span className="live-clock-time">{time}</span>
    </time>
  )
}
