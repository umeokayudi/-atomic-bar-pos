/** Tokyo time of day → 'morning' | 'afternoon' | 'evening' | 'night'. */
export function greetingPart(date = new Date()) {
  const h = +new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', hour12: false }).format(date) % 24
  if (h >= 5 && h < 12) return 'morning'
  if (h >= 12 && h < 18) return 'afternoon'
  if (h >= 18 && h < 23) return 'evening'
  return 'night'
}
