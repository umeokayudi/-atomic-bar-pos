// Turn a self-contained HTML document (receipts, reports) into a real PDF file,
// then download it and open it so it can be sent to a chat group right away.
// The PDF libraries are loaded on demand to keep them out of the main bundle.

/** Opens an empty tab now, while the click still counts as a user gesture (Safari blocks it after an await). */
export function reservePdfTab() {
  try {
    const win = window.open('', '_blank')
    if (win) win.document.write('<p style="font:16px system-ui;padding:24px">PDF…</p>')
    return win
  } catch {
    return null
  }
}

export function pdfName(base) {
  const safe = String(base || 'document').replace(/[\\/:*?"<>|\s]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  return `${safe || 'document'}.pdf`
}

async function renderHtml(html) {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px;height:1123px;border:0;visibility:hidden'
  document.body.appendChild(frame)
  const doc = frame.contentDocument
  doc.open()
  doc.write(html)
  doc.close()
  await new Promise(r => setTimeout(r, 300))
  if (doc.fonts?.ready) await doc.fonts.ready.catch(() => {})
  return { frame, doc }
}

/** HTML string -> PDF Blob (A4, multi-page when the content is tall). */
export async function htmlToPdfBlob(html) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')])
  const { frame, doc } = await renderHtml(html)
  try {
    const body = doc.body
    body.style.background = '#fff'
    const canvas = await html2canvas(body, { scale: 2, backgroundColor: '#ffffff', windowWidth: 794, useCORS: true })
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
    const pageW = pdf.internal.pageSize.getWidth()
    const pageH = pdf.internal.pageSize.getHeight()
    const imgH = (canvas.height * pageW) / canvas.width
    const img = canvas.toDataURL('image/jpeg', 0.92)
    let y = 0
    pdf.addImage(img, 'JPEG', 0, y, pageW, imgH)
    while (imgH + y > pageH + 0.5) {
      y -= pageH
      pdf.addPage()
      pdf.addImage(img, 'JPEG', 0, y, pageW, imgH)
    }
    return pdf.output('blob')
  } finally {
    frame.remove()
  }
}

/** Saves the PDF to the device and shows it in the reserved tab (or a new one). */
export function deliverPdf(blob, filename, tab = null) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  if (tab && !tab.closed) tab.location.href = url
  else window.open(url, '_blank')
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** One call for click handlers: reserve the tab first, then build, download and open. */
export async function downloadHtmlAsPdf(html, filename) {
  const tab = reservePdfTab()
  try {
    const blob = await htmlToPdfBlob(html)
    deliverPdf(blob, pdfName(filename), tab)
    return { ok: true }
  } catch (error) {
    if (tab && !tab.closed) tab.close()
    return { ok: false, error }
  }
}

/** A page element as a standalone HTML document with the app's styles (light theme, tools hidden). */
export function elementToHtml(el, { hide = [] } = {}) {
  const styles = [...document.querySelectorAll('style, link[rel="stylesheet"]')].map(n => n.outerHTML).join('\n')
  const clone = el.cloneNode(true)
  hide.forEach(sel => clone.querySelectorAll(sel).forEach(n => n.remove()))
  return `<!DOCTYPE html><html data-theme="light" lang="${document.documentElement.lang || 'en'}"><head><meta charset="utf-8"><base href="${location.origin}/">${styles}
<style>body{margin:0;padding:24px;background:#fff}</style></head><body>${clone.outerHTML}</body></html>`
}
