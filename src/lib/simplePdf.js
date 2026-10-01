/** Small text PDF. Helvetica only. Japanese glyphs are not embedded. */

function ascii(value) {
  return String(value ?? '').replace(/[^\x20-\x7e]/g, '?')
}

function escapePdf(value) {
  return ascii(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

export function pdfFromPages(pages) {
  const sheets = (pages || []).map(page => (Array.isArray(page) ? page : String(page).split('\n')).map(ascii))
  if (!sheets.length) sheets.push(['Empty report'])
  const objects = []
  function add(body) {
    objects.push(body)
    return objects.length
  }
  const fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  const pageIds = []
  const contentIds = []
  sheets.forEach((lines, index) => {
    const commands = ['BT', '/F1 11 Tf', '14 TL', '48 790 Td']
    lines.slice(0, 46).forEach((line, lineIndex) => {
      const text = `(${escapePdf(line)}) Tj`
      commands.push(lineIndex === 0 ? text : `T* ${text}`)
    })
    commands.push(`T* (Page ${index + 1} of ${sheets.length}) Tj`, 'ET')
    const stream = commands.join('\n')
    const contentId = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
    contentIds.push(contentId)
    pageIds.push(null)
  })
  const pageObjectIds = sheets.map((_, index) => add(
    `<< /Type /Page /Parent PAGES /MediaBox [0 0 595 842] /Contents ${contentIds[index]} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`,
  ))
  const pagesId = add(`<< /Type /Pages /Kids [${pageObjectIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageObjectIds.length} >>`)
  const catalogId = add('<< /Type /Catalog /Pages PAGES >>')
  const bodyObjects = objects.map(body => body.replaceAll('PAGES', `${pagesId} 0 R`))
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  bodyObjects.forEach((body, index) => {
    offsets.push(pdf.length)
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${offsets.length}\n`
  pdf += '0000000000 65535 f \n'
  offsets.slice(1).forEach(offset => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  })
  pdf += `trailer\n<< /Size ${offsets.length} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF`
  return pdf
}
