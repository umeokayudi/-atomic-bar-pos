/** Tokyo time of day → 'morning' | 'afternoon' | 'evening' | 'night'. */
export function greetingPart(date = new Date()) {
  const h = +new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', hour12: false }).format(date) % 24
  if (h >= 5 && h < 12) return 'morning'
  if (h >= 12 && h < 18) return 'afternoon'
  if (h >= 18 && h < 23) return 'evening'
  return 'night'
}

/** The bar owner's home greeting: always English, always "Boss" (owner asked for it). */
export const BOSS_GREETING = {
  morning: 'Good morning, Boss',
  afternoon: 'Good afternoon, Boss',
  evening: 'Good evening, Boss',
  night: 'Good evening, Boss',
}
