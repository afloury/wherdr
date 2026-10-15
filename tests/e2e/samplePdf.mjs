// A small valid PDF with neutral text, one line per page (Helvetica, no
// embedded font), with exact cross-reference offsets. Shared by the unit and
// end-to-end tests of the PDF preview.
export function samplePdf(pages = ['Sample document']) {
  const kids = pages.map((_, i) => `${3 + i * 2} 0 R`).join(' ')
  const font = 3 + pages.length * 2
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`]
  pages.forEach((text, i) => {
    const s = `BT /F1 18 Tf 40 100 Td (${text.replace(/[()\\]/g, c => `\\${c}`)}) Tj ET`
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents ${4 + i * 2} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`)
    objs.push(`<< /Length ${s.length} >>\nstream\n${s}\nendstream`)
  })
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  let out = '%PDF-1.4\n'
  const offsets = objs.map((o, i) => {
    const at = out.length
    out += `${i + 1} 0 obj\n${o}\nendobj\n`
    return at
  })
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}
