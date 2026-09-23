/** Position the notification panel so it never hangs off-screen.
 * Header bells open downward. Sidebar bells grow upward from the button.
 * Never assume the panel is maxHeight tall — that left a hole above the bell. */

export function placeNotifPanel({
  rect,
  placement = 'sidebar',
  vw,
  vh,
  panelW = 360,
  maxH = 480,
  pad = 8,
  gap = 8,
} = {}) {
  const width = Math.min(panelW, Math.max(240, (vw || 360) - pad * 2))
  const viewH = vh || 640
  const viewW = vw || 360
  let left = placement === 'header'
    ? Math.min(Math.max(pad, (rect?.right || width) - width), viewW - width - pad)
    : Math.max(pad, rect?.left || pad)
  if (left + width > viewW - pad) left = Math.max(pad, viewW - width - pad)

  const btnTop = rect?.top ?? 0
  const btnBottom = rect?.bottom ?? 40

  if (placement === 'header') {
    const roomBelow = viewH - btnBottom - gap - pad
    const roomAbove = btnTop - gap - pad
    if (roomBelow >= 160 || roomBelow >= roomAbove) {
      const top = btnBottom + gap
      return { left, top, width, maxHeight: Math.max(120, Math.min(maxH, roomBelow)) }
    }
    const maxHeight = Math.max(120, Math.min(maxH, roomAbove))
    return { left, bottom: viewH - btnTop + gap, width, maxHeight }
  }

  const roomAbove = btnTop - gap - pad
  const maxHeight = Math.max(120, Math.min(maxH, roomAbove > 80 ? roomAbove : viewH - btnBottom - gap - pad))
  if (roomAbove > 80) {
    return { left, bottom: viewH - btnTop + gap, width, maxHeight }
  }
  return { left, top: btnBottom + gap, width, maxHeight }
}

export function panelBoxStyle(pos) {
  if (!pos) return null
  const style = {
    left: pos.left,
    width: pos.width,
    maxHeight: pos.maxHeight,
  }
  if (pos.top != null) style.top = pos.top
  if (pos.bottom != null) style.bottom = pos.bottom
  return style
}
