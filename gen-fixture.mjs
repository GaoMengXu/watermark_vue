import fs from 'node:fs'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

const pdf = await PDFDocument.create()
for (let i = 1; i <= 2; i++) {
  const page = pdf.addPage([420, 595])
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  page.drawText(`TEST LICENSE  PAGE ${i}`, {
    x: 42, y: 530, size: 18, font, color: rgb(0.12, 0.15, 0.2),
  })
  page.drawRectangle({
    x: 42, y: 330, width: 336, height: 150,
    borderWidth: 1, borderColor: rgb(0.8, 0.83, 0.88),
  })
  page.drawText('UNIFIED SOCIAL CREDIT CODE  91110111MAE0JGCT72', {
    x: 50, y: 440, size: 9, font, color: rgb(0.3, 0.33, 0.38),
  })
}
const bytes = await pdf.save()
fs.mkdirSync('public', { recursive: true })
fs.writeFileSync('public/_test.pdf', bytes)
console.log('fixture written:', bytes.length, 'bytes')
