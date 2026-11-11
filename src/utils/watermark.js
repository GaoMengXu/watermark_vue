/**
 * 水印核心逻辑 —— 与 macOS 版 watermark.swift 一比一对应
 *
 *  Swift 参数 / 本文件参数：
 *    watermarkColor  CGColor(0.72,0.72,0.72,alpha 0.32) → DEFAULTS.color #B8B8B8 + opacity 0.32
 *    pdfFontSize     32 pt                              → DEFAULTS.pdfFontSize 32
 *    fontScale       1.0（网页版新增：字号倍率）         → DEFAULTS.fontScale 1
 *    angleDeg        -45                               → DEFAULTS.angleDeg -45
 *    stepX           textW + fontSize * 2.2            → 同
 *    stepY           fontSize + fontSize * 1.9         → 同
 *    平铺范围        以对角线 diag 为边长，从 -diag/2 起 → 同
 *    图片字号        max(24, shortSide * 0.022)        → 同
 *    PDF 水印图      scale 2.0                         → 同
 *    JPEG 质量       0.9                               → 同
 *    输出文件名      原名_水印.扩展名                   → 同
 *
 *  实现差异（浏览器平台限制，非逻辑差异）：
 *    - 浏览器 Canvas 只能输出 PNG / JPEG，故 TIFF、HEIC、GIF、WebP、BMP 输入统一导出 PNG
 *      （Swift 版可保留 TIFF）。这一规则与 Swift 版「其余格式统一转 PNG」一致。
 *    - PDF 用 pdf-lib 把「整页半透明水印图」叠到每一页，等价于 Swift 的
 *      CGPDFContext + draw(wm, in: box)，原 PDF 页面内容保持矢量不重绘。
 *    - 中文水印由浏览器系统字体渲染成位图，无需嵌入字体文件。
 */

import { PDFDocument } from 'pdf-lib'
import * as pdfjsLib from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc

export const DEFAULTS = {
  text: '仅供项目及合同使用',
  color: '#B8B8B8',      // 0.72 * 255 ≈ 184 = B8
  opacity: 0.32,
  angleDeg: -45,
  pdfFontSize: 32,
  fontScale: 1,          // 1.0× = 与 Swift 版完全一致
  jpegQuality: 0.9,
}

export const FONT_SCALE_RANGE = { min: 0.5, max: 3, step: 0.1 }

/** 限制字号倍率，防止异常值（0 / NaN / 过大）撑爆画布 */
export function clampFontScale(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return DEFAULTS.fontScale
  return Math.min(FONT_SCALE_RANGE.max, Math.max(FONT_SCALE_RANGE.min, n))
}

/** 图片基准字号（Swift: max(24, shortSide * 0.022)） */
export function imageBaseFontSize(width, height) {
  return Math.max(24, Math.min(width, height) * 0.022)
}

/** 当前设置下的实际字号，供界面显示 */
export function effectiveFontSize(meta, fontScale) {
  const k = clampFontScale(fontScale)
  if (meta?.isPDF) return `${Math.round(DEFAULTS.pdfFontSize * k)} pt`
  if (meta?.width && meta?.height) {
    return `${Math.round(imageBaseFontSize(meta.width, meta.height) * k)} px`
  }
  return `自适应（×${k.toFixed(1)}）`
}

const FONT_STACK =
  '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC", sans-serif'

/** #RRGGBB → rgba() 字符串 */
export function rgba(hex, alpha) {
  const h = (hex || DEFAULTS.color).replace('#', '')
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h
  const r = parseInt(full.slice(0, 2), 16) || 0
  const g = parseInt(full.slice(2, 4), 16) || 0
  const b = parseInt(full.slice(4, 6), 16) || 0
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** 生成整页斜向平铺的水印图层（对应 Swift 的 makeWatermarkImage） */
export function makeWatermarkCanvas(width, height, opts) {
  const {
    text = DEFAULTS.text,
    color = DEFAULTS.color,
    opacity = DEFAULTS.opacity,
    fontSize = DEFAULTS.pdfFontSize,
    angleDeg = DEFAULTS.angleDeg,
    scale = 1,
  } = opts || {}

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const ctx = canvas.getContext('2d')
  ctx.scale(scale, scale)

  // 字号与间距绑定：改字号时平铺密度等比变化，保持 Swift 版的视觉节奏
  const size = Math.max(1, Number(fontSize) || DEFAULTS.pdfFontSize)
  ctx.translate(width / 2, height / 2)
  ctx.rotate((angleDeg * Math.PI) / 180)
  ctx.font = `${size}px ${FONT_STACK}`
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = rgba(color, opacity)

  const label = text && text.trim() ? text : DEFAULTS.text
  const textW = ctx.measureText(label).width
  const stepX = textW + size * 2.2
  const stepY = size + size * 1.9
  const diag = Math.sqrt(width * width + height * height)
  const start = -diag / 2

  for (let y = start; y < diag / 2; y += stepY) {
    for (let x = start; x < diag / 2; x += stepX) {
      ctx.fillText(label, x, y)
    }
  }
  return canvas
}

export function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      b => (b ? resolve(b) : reject(new Error('画布导出失败'))),
      type,
      quality
    )
  })
}

/** 同步取 PNG 字节（供嵌入 PDF，避免 toBlob 的异步编码回调） */
function canvasToPngBytes(canvas) {
  const dataUrl = canvas.toDataURL('image/png')
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

export function isPDFFile(file) {
  return /\.pdf$/i.test(file?.name || '') || file?.type === 'application/pdf'
}

function extOf(name) {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i + 1).toLowerCase() : ''
}

/** 输出文件名 / 格式（对应 Swift 的 imageFormat + autoOutputPath） */
export function outputInfo(file) {
  const name = file.name
  const i = name.lastIndexOf('.')
  const base = i > 0 ? name.slice(0, i) : name
  const ext = extOf(name)

  if (isPDFFile(file)) {
    return { name: `${base}_水印.pdf`, ext: 'pdf', mime: 'application/pdf' }
  }
  if (ext === 'jpg' || ext === 'jpeg') {
    return { name: `${base}_水印.jpg`, ext: 'jpg', mime: 'image/jpeg' }
  }
  // png 保持 png；tiff/heic/gif/webp/bmp 等在浏览器端统一转 PNG
  return { name: `${base}_水印.png`, ext: 'png', mime: 'image/png' }
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('无法解码该图片，请换成 JPG / PNG / WebP 后重试'))
    }
    img.src = url
  })
}

/** 图片加水印（对应 Swift 的 processImage） */
export async function applyWatermarkToImage(file, opts) {
  const img = await loadImage(file)
  const w = img.naturalWidth || img.width
  const h = img.naturalHeight || img.height
  if (!w || !h) throw new Error('图片尺寸无效')

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0, w, h)

  // 图片按短边自适应字号（Swift: max(24, shortSide * 0.022)），再乘界面上的倍率
  const fontSize = imageBaseFontSize(w, h) * clampFontScale(opts?.fontScale)
  const wm = makeWatermarkCanvas(w, h, { ...opts, fontSize, scale: 1 })
  ctx.drawImage(wm, 0, 0, w, h)

  const out = outputInfo(file)
  const isJpeg = out.ext === 'jpg'
  const blob = await canvasToBlob(
    canvas,
    out.mime,
    isJpeg ? DEFAULTS.jpegQuality : undefined
  )
  return { blob, out, width: w, height: h }
}

/** PDF 加水印（对应 Swift 的 processPDF，逐页叠加整页水印图） */
export async function applyWatermarkToPDF(file, opts) {
  const bytes = await file.arrayBuffer()
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const pages = pdf.getPages()
  if (!pages.length) throw new Error('PDF 没有可处理的页面')

  for (const page of pages) {
    const { width, height } = page.getSize()
    // PDF 按点数排版，水印图 2x 密度（Swift: fontSize 32, scale 2.0）
    const wm = makeWatermarkCanvas(width, height, {
      ...opts,
      fontSize: DEFAULTS.pdfFontSize * clampFontScale(opts?.fontScale),
      scale: 2,
    })
    const pngBytes = canvasToPngBytes(wm)
    const png = await pdf.embedPng(pngBytes)
    page.drawImage(png, { x: 0, y: 0, width, height })
  }

  const saved = await pdf.save()
  const out = outputInfo(file)
  return {
    blob: new Blob([saved], { type: 'application/pdf' }),
    out,
    pageCount: pages.length,
  }
}

/** 把导出后的 PDF 指定页渲染到预览 canvas（所见即所得） */
export async function renderPDFPage(blob, pageNo, canvas, maxWidth = 900) {
  const data = new Uint8Array(await blob.arrayBuffer())
  const task = pdfjsLib.getDocument({ data })
  const pdf = await task.promise
  const pageNoSafe = Math.min(Math.max(1, pageNo), pdf.numPages)
  const page = await pdf.getPage(pageNoSafe)
  const base = page.getViewport({ scale: 1 })
  const scale = Math.min(2, maxWidth / base.width)
  const viewport = page.getViewport({ scale })
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  const ctx = canvas.getContext('2d')
  await page.render({ canvasContext: ctx, viewport }).promise
  return pdf.numPages
}

/** 触发浏览器下载 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
