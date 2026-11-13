/**
 * Word(.docx) ↔ PDF 本地互转核心逻辑（纯浏览器端，文件不上传）
 *
 *   Word → PDF：docx-preview 按 Word 布局渲染成 DOM → html2canvas 分页截图 → jspdf 拼成 PDF
 *   PDF  → Word：pdfjs-dist 逐页提取文字 → docx 库生成可编辑 .docx
 *
 * 说明：
 *   - Word→PDF 支持页眉页脚、表格、图片、分页符等（docx-preview 的官方布局能力）。
 *   - PDF→Word 是「提取可编辑文本 + 基础段落」，不还原复杂排版（表格/图片/分栏/字体），
 *     这是纯前端方案的能力边界（见 README）。
 */

import { renderAsync } from 'docx-preview'
import { jsPDF } from 'jspdf'
import html2canvas from 'html2canvas'
import { Document, Packer, Paragraph, TextRun, PageBreak } from 'docx'
import { saveAs } from 'file-saver'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerSrc from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import * as XLSX from 'xlsx'
import JSZip from 'jszip'
import { createWorker } from 'tesseract.js'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc

/* ─────────────────────────── 文件类型识别 ─────────────────────────── */

// 文件类型：docx / xlsx / pptx / pdf / doc(旧版，需另存为 docx)
export function detectType(file) {
  const n = file?.name || ''
  const t = file?.type || ''
  if (/\.docx$/i.test(n)) return 'docx'
  if (/\.doc$/i.test(n)) return 'doc' // 旧版 Word 二进制，纯前端无法转换
  if (/\.xlsx$/i.test(n) || /\.xls$/i.test(n)) return 'xlsx'
  if (/\.pptx$/i.test(n) || /\.ppt$/i.test(n)) return 'pptx'
  if (/\.pdf$/i.test(n) || t === 'application/pdf') return 'pdf'
  return 'unknown'
}

export function isWordFile(file) {
  const ty = detectType(file)
  return ty === 'docx' || ty === 'doc'
}

export function isPdf(file) {
  return detectType(file) === 'pdf'
}

function baseName(name) {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(0, i) : name
}

export { baseName }

/* ─────────────────────────── Word → PDF ─────────────────────────── */

/**
 * 渲染 docx 到离屏容器（供预览 / 转 PDF 复用）。
 * 返回 { container, width, height }，调用方需负责把 container 挂载进 DOM。
 */
export async function renderDocx(container, arrayBuffer) {
  container.innerHTML = ''
  await renderAsync(arrayBuffer, container, container, {
    className: 'docx-page',
    inWrapper: false,        // 不套外层 wrapper，页面直接用 <section> 平铺
    breakPages: true,        // 按 Word 的分页切页
    ignoreWidth: false,
    ignoreHeight: false,
    ignoreFonts: false,
    ignoreLastRenderedPageBreak: false,
  })
  // 让浏览器完成字体加载与布局稳定
  try {
    await document.fonts.ready
  } catch (_) {
    /* 忽略 */
  }
  return container
}

/**
 * 通用：把已渲染的 DOM 容器导出为多页 PDF。
 * 对每个分页元素（.docx-page / .sheet-page / .slide-page）：
 *   - 先把目标元素克隆到「绝对定位、脱离文档流」的离屏容器再截图，
 *     规避 html2canvas 在页面 flex 布局下「Unable to find element in cloned iframe」的 bug；
 *   - 若元素高度超过一页 A4 的比例，则按 A4 高度纵向切片成多页；
 *   - 否则单元素整页输出。
 * 这样能稳健处理「单 sheet 内容超长（几十行、大量多行文本）」的 Excel 表格。
 */
export async function domToPdfBlob(container, pageSelector = 'section.docx-page') {
  const pages = Array.from(container.querySelectorAll(pageSelector))
  const targets = pages.length ? pages : [container]

  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  const pageW = 210
  const pageH = 297
  let isFirst = true

  // 离屏容器：绝对定位，脱离文档流，避免与页面 flex/滚动布局相互干扰
  const offscreen = document.createElement('div')
  offscreen.style.cssText =
    'position:absolute;left:-99999px;top:0;width:1000px;background:#fff;'
  document.body.appendChild(offscreen)

  try {
    for (const el of targets) {
      // 克隆目标元素（连同样式）到离屏容器，避免直接对页面元素截图
      const clone = el.cloneNode(true)
      // 强制固定宽度，保证布局稳定
      clone.style.width = (el.scrollWidth || el.clientWidth || 1000) + 'px'
      offscreen.appendChild(clone)

      const canvas = await html2canvas(clone, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
      })

      const imgW = canvas.width
      const imgH = canvas.height
      offscreen.removeChild(clone)

      if (imgW <= 0 || imgH <= 0) continue

      // 该元素按当前宽度在 A4 页里的对应高度（比例换算）
      const ratio = pageW / imgW
      const fitH = pageH / ratio // 一页 A4 能容纳的源像素高度

      let y = 0
      while (y < imgH) {
        const h = Math.min(fitH, imgH - y)
        const slice = document.createElement('canvas')
        slice.width = imgW
        slice.height = Math.ceil(h)
        const sctx = slice.getContext('2d')
        sctx.fillStyle = '#ffffff'
        sctx.fillRect(0, 0, slice.width, slice.height)
        sctx.drawImage(canvas, 0, y, imgW, h, 0, 0, imgW, h)

        if (!isFirst) pdf.addPage()
        pdf.addImage(
          slice.toDataURL('image/jpeg', 0.92),
          'JPEG',
          0, 0,
          pageW,
          (h / imgW) * pageW
        )
        isFirst = false
        y += h
      }
    }
  } finally {
    if (offscreen.parentNode) offscreen.parentNode.removeChild(offscreen)
  }

  return pdf.output('blob')
}

/** 兼容旧名（Word→PDF 调用） */
export const docxToPdfBlob = (container) => domToPdfBlob(container, 'section.docx-page')

/* ─────────────────────────── Excel → PDF ─────────────────────────── */

/**
 * 用 SheetJS 读取 xlsx，把每个工作表渲染成一张 HTML 表格。
 * 写入 container，返回 { sheetNames, rowCount } 供预览展示。
 */
export async function renderXlsx(container, arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: 'array' })
  const sheetNames = wb.SheetNames
  container.innerHTML = ''
  let totalRows = 0

  sheetNames.forEach((name, idx) => {
    const ws = wb.Sheets[name]
    const html = XLSX.utils.sheet_to_html(ws, { header: '', footer: '' })
    const page = document.createElement('section')
    page.className = 'sheet-page'
    page.innerHTML = html

    // 工作表标题
    const title = document.createElement('div')
    title.className = 'sheet-title'
    title.textContent = name
    page.prepend(title)

    container.appendChild(page)
    totalRows += (ws['!ref'] || 'A1').split(':').length > 1
      ? XLSX.utils.decode_range(ws['!ref']).e.r + 1
      : 1
  })

  return { sheetNames, rowCount: totalRows }
}

/* ─────────────────────────── PPT → PDF ─────────────────────────── */

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** 解析 pptx 一张幻灯片的 XML，提取文本框内容，拼成简单的幻灯片 DOM */
function parseSlideXml(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml')
  const shapes = doc.getElementsByTagName('p:sp')
  const texts = []

  for (const sp of shapes) {
    const runs = sp.getElementsByTagName('a:t')
    const parts = []
    for (const r of runs) {
      if (r.textContent) parts.push(r.textContent)
    }
    const line = parts.join('')
    if (line.trim()) texts.push(line.trim())
  }

  // 也抓取表格里的文字
  const tableCells = doc.getElementsByTagName('a:t')
  return texts
}

/**
 * 用 jszip 解压 pptx，解析每张幻灯片文本，渲染成幻灯片 DOM。
 * 返回 { slideCount }。
 */
export async function renderPptx(container, arrayBuffer) {
  const zip = await JSZip.loadAsync(arrayBuffer)
  // 找到所有 slideN.xml
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => {
      const na = parseInt(a.match(/slide(\d+)\.xml/i)?.[1] || '0', 10)
      const nb = parseInt(b.match(/slide(\d+)\.xml/i)?.[1] || '0', 10)
      return na - nb
    })

  container.innerHTML = ''
  let count = 0

  for (const slideFile of slideFiles) {
    const xmlText = await zip.files[slideFile].async('string')
    const texts = parseSlideXml(xmlText)
    count++

    const slide = document.createElement('section')
    slide.className = 'slide-page'
    const num = document.createElement('div')
    num.className = 'slide-num'
    num.textContent = `幻灯片 ${count}`
    slide.appendChild(num)

    if (!texts.length) {
      const empty = document.createElement('p')
      empty.className = 'slide-empty'
      empty.textContent = '（本页无可提取的文字内容）'
      slide.appendChild(empty)
    } else {
      texts.forEach((t) => {
        const p = document.createElement('p')
        p.className = 'slide-text'
        p.textContent = t
        slide.appendChild(p)
      })
    }
    container.appendChild(slide)
  }

  return { slideCount: count }
}

/* ─────────────────────────── PDF → Word ─────────────────────────── */

/**
 * 提取 PDF 每页文本，按「行内合并 + 段落间距」拼成段落数组。
 * 返回 [{ text, page }]。
 */
export async function extractPdfText(arrayBuffer) {
  // slice 出独立副本，避免 getDocument transfer 底层 buffer 后 detach 原始数据
  const data = new Uint8Array(arrayBuffer.slice(0))
  const task = pdfjsLib.getDocument({ data })
  const pdf = await task.promise
  const paragraphs = []

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const content = await page.getTextContent()
    const items = content.items
      .filter((it) => typeof it.str === 'string' && it.str.trim())
      .map((it) => ({ str: it.str, y: it.transform?.[5] ?? 0 }))

    if (!items.length) {
      paragraphs.push({ text: '', page: p })
      continue
    }

    // 按 y 坐标分组为「行」
    const lines = []
    let cur = null
    for (const it of items) {
      if (!cur || Math.abs(it.y - cur.y) > 3) {
        cur = { y: it.y, text: it.str }
        lines.push(cur)
      } else {
        cur.text += (cur.text.endsWith(' ') ? '' : ' ') + it.str
      }
    }

    // 行合并：按 y 间距推断段落（间距 > 行高阈值视为换段）
    const lineGaps = []
    for (let i = 1; i < lines.length; i++) {
      lineGaps.push(lines[i].y - lines[i - 1].y)
    }
    const avgGap = lineGaps.length
      ? lineGaps.reduce((a, b) => a + b, 0) / lineGaps.length
      : 0

    let para = lines[0]?.text || ''
    const flush = () => {
      if (para.trim()) paragraphs.push({ text: para.trim(), page: p })
      para = ''
    }
    for (let i = 1; i < lines.length; i++) {
      const gap = lines[i].y - lines[i - 1].y
      if (avgGap > 0 && gap > avgGap * 1.6) {
        flush()
        para = lines[i].text
      } else {
        para += (para ? '\n' : '') + lines[i].text
      }
    }
    flush()
  }

  return { paragraphs, pageCount: pdf.numPages }
}

/* ─────────────────────────── 扫描件 OCR（PDF → Word） ─────────────────────────── */

/**
 * 把 PDF 指定页渲染成高清 canvas 图片（供 OCR 使用）。
 * 对扫描件，pdfjs 无文字层，需要把页面画出来再 OCR。
 */
export async function renderPdfPageToCanvas(arrayBuffer, pageNo, scale = 3) {
  const data = new Uint8Array(arrayBuffer.slice(0))
  const task = pdfjsLib.getDocument({ data })
  const pdf = await task.promise
  const page = await pdf.getPage(pageNo)
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  const ctx = canvas.getContext('2d')
  await page.render({ canvasContext: ctx, viewport }).promise
  return { canvas, numPages: pdf.numPages }
}

// 复用同一个 OCR worker，避免每页重复加载语言包
let ocrWorker = null

/** 初始化（懒加载）中文+英文 OCR worker，返回 worker */
async function getOcrWorker(onProgress) {
  if (ocrWorker) return ocrWorker
  const base = import.meta.env.BASE_URL || '/'
  ocrWorker = await createWorker('chi_sim+eng', 1, {
    // 语言包、worker、core 全部走本地 static 资源（语言包为 gzip 格式）
    workerPath: `${base}tess-core/worker.min.js`,
    corePath: `${base}tess-core/`,
    langPath: `${base}tessdata/`,
    gzip: true,
    logger: (m) => {
      if (m.status === 'recognizing text' && onProgress) {
        onProgress(m.progress)
      }
    },
  })
  return ocrWorker
}

/**
 * 对扫描型 PDF 逐页 OCR，返回 { paragraphs, pageCount, usedOcr }。
 * 调用方应先确认文字层为空再调用（extractPdfText 返回空）。
 */
export async function ocrPdfToText(arrayBuffer, onProgress) {
  // 独立副本，避免 transfer detach 原始数据
  const data = new Uint8Array(arrayBuffer.slice(0))
  const task = pdfjsLib.getDocument({ data })
  const pdf = await task.promise
  const worker = await getOcrWorker(onProgress)

  const paragraphs = []
  for (let p = 1; p <= pdf.numPages; p++) {
    if (onProgress) onProgress((p - 1) / pdf.numPages * 0.1) // 渲染阶段占前 10%
    const page = await pdf.getPage(p)
    const viewport = page.getViewport({ scale: 3 })
    const canvas = document.createElement('canvas')
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    const ctx = canvas.getContext('2d')
    await page.render({ canvasContext: ctx, viewport }).promise

    const { data: result } = await worker.recognize(canvas)
    const text = (result.text || '').trim()
    // 按行拆成段落
    const lines = text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    // 逐行作为一个段落（保留表格/单据的换行结构）
    lines.forEach((line) => paragraphs.push({ text: line, page: p }))
    if (onProgress) onProgress(p / pdf.numPages)
  }
  return { paragraphs, pageCount: pdf.numPages, usedOcr: true }
}

/** 释放 OCR worker（页面卸载时调用） */
export async function disposeOcrWorker() {
  if (ocrWorker) {
    try {
      await ocrWorker.terminate()
    } catch (_) {
      /* 忽略 */
    }
    ocrWorker = null
  }
}

/** 把提取出的段落写成 .docx 并下载 */
export async function exportPdfToWord(paragraphs, fileName) {
  const children = []
  paragraphs.forEach((p, idx) => {
    if (idx > 0 && paragraphs[idx - 1].page !== p.page) {
      children.push(new Paragraph({ children: [new PageBreak()] }))
    }
    const text = p.text || ''
    children.push(
      new Paragraph({
        children: text ? [new TextRun(text)] : [new TextRun('')],
        spacing: { after: 120 },
      })
    )
  })

  const doc = new Document({
    sections: [{ properties: {}, children }],
  })
  const blob = await Packer.toBlob(doc)
  saveAs(blob, fileName)
}

/* 通用下载（供 Word→PDF 导出用） */
export function downloadBlob(blob, filename) {
  saveAs(blob, filename)
}
