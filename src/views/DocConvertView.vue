<script setup>
import { ref, computed, nextTick, onBeforeUnmount } from 'vue'
import {
  detectType,
  renderDocx,
  docxToPdfBlob,
  domToPdfBlob,
  renderXlsx,
  renderPptx,
  extractPdfText,
  ocrPdfToText,
  disposeOcrWorker,
  exportPdfToWord,
  downloadBlob,
  baseName,
} from '../utils/docConvert.js'

const file = ref(null)
const fileType = ref('') // docx | xlsx | pptx | pdf | doc
const busy = ref(false)
const error = ref('')
const toast = ref('')

const previewEl = ref(null) // 承载 docx/xlsx/pptx 渲染的预览容器
const previewReady = ref(false)

const pdfText = ref('')
const pdfPageCount = ref(0)
const ocrProgress = ref(0) // 0-100，OCR 进度
const isOcr = ref(false) // 当前是否在 OCR

const resultBlob = ref(null)
const resultName = ref('')
const resultKind = ref('') // 'pdf' | 'docx'（决定导出行为）

const fileInput = ref(null)

const dragging = ref(false)
let toastTimer = null

const typeMeta = {
  docx: { label: 'Word 文档（.docx）', outExt: '.pdf', outLabel: 'PDF', hint: '按 Word 布局转 PDF，支持表格、图片、页眉页脚' },
  xlsx: { label: 'Excel 表格（.xlsx）', outExt: '.pdf', outLabel: 'PDF', hint: '把每个工作表渲染成 PDF，复杂图表可能简化' },
  pptx: { label: 'PPT 演示（.pptx）', outExt: '.pdf', outLabel: 'PDF', hint: '提取幻灯片文字转 PDF，图片与动画不保留' },
  pdf: { label: 'PDF 文档（.pdf）', outExt: '.docx', outLabel: 'Word', hint: '提取 PDF 文字生成可编辑 Word，复杂排版可能简化' },
}

const typeLabel = computed(() => typeMeta[fileType.value]?.label || '文档')
const outName = computed(() =>
  file.value ? `${baseName(file.value.name)}${typeMeta[fileType.value]?.outExt || '.pdf'}` : '—'
)
const outLabel = computed(() => typeMeta[fileType.value]?.outLabel || 'PDF')
const isToPdf = computed(() => fileType.value !== 'pdf')
const accept = computed(() => '.docx,.doc,.xlsx,.xls,.pptx,.ppt,.pdf')

function notify(msg) {
  toast.value = msg
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 2600)
}

function resetAll() {
  file.value = null
  fileType.value = ''
  error.value = ''
  resultBlob.value = null
  resultName.value = ''
  resultKind.value = ''
  previewReady.value = false
  pdfText.value = ''
  pdfPageCount.value = 0
  ocrProgress.value = 0
  isOcr.value = false
  if (previewEl.value) previewEl.value.innerHTML = ''
}

async function handleFile(f) {
  if (!f) return
  const ty = detectType(f)

  // 旧版 .doc：纯前端无法转换，提示另存为
  if (ty === 'doc') {
    resetAll()
    file.value = f
    error.value = '检测到旧版 .doc（Word 97-2003）格式，浏览器无法直接转换。请在 Word 里「另存为」.docx 后再上传。'
    return
  }

  if (ty === 'unknown') {
    error.value = '仅支持 Word(.docx)、Excel(.xlsx)、PPT(.pptx)、PDF 格式'
    return
  }

  resetAll()
  file.value = f
  fileType.value = ty
  busy.value = true
  error.value = ''

  try {
    await nextTick()
    const viewport = previewEl.value
    if (!viewport) throw new Error('预览容器未就绪，请重试')

    if (ty === 'docx') {
      await renderDocx(viewport, await f.arrayBuffer())
      previewReady.value = true
      await nextTick()
      const blob = await docxToPdfBlob(viewport)
      resultBlob.value = blob
      resultKind.value = 'pdf'
      resultName.value = `${baseName(f.name)}.pdf`
    } else if (ty === 'xlsx') {
      await renderXlsx(viewport, await f.arrayBuffer())
      previewReady.value = true
      await nextTick()
      const blob = await domToPdfBlob(viewport, 'section.sheet-page')
      resultBlob.value = blob
      resultKind.value = 'pdf'
      resultName.value = `${baseName(f.name)}.pdf`
    } else if (ty === 'pptx') {
      const { slideCount } = await renderPptx(viewport, await f.arrayBuffer())
      previewReady.value = true
      pdfPageCount.value = slideCount
      await nextTick()
      const blob = await domToPdfBlob(viewport, 'section.slide-page')
      resultBlob.value = blob
      resultKind.value = 'pdf'
      resultName.value = `${baseName(f.name)}.pdf`
    } else if (ty === 'pdf') {
      // 只读一次 ArrayBuffer，避免重复读取导致 detached buffer
      const pdfBuf = await f.arrayBuffer()
      const { paragraphs, pageCount } = await extractPdfText(pdfBuf)
      pdfPageCount.value = pageCount

      // 判断是否有文字层：无文字 → 扫描件，自动走 OCR
      const hasText = paragraphs.some((p) => p.text.trim())
      if (!hasText) {
        isOcr.value = true
        pdfText.value = ''
        notify('检测到扫描件，正在进行本地 OCR 识别…')
        const ocrResult = await ocrPdfToText(pdfBuf, (prog) => {
          ocrProgress.value = Math.round(prog * 100)
        })
        pdfText.value = ocrResult.paragraphs.map((p) => p.text).filter(Boolean).join('\n\n')
        if (!ocrResult.paragraphs.length || !ocrResult.paragraphs.some((p) => p.text.trim())) {
          error.value = 'OCR 未能识别出文字，图片可能过于模糊或为纯图形'
        }
        resultBlob.value = ocrResult.paragraphs
        resultKind.value = 'docx'
        isOcr.value = false
      } else {
        pdfText.value = paragraphs.map((p) => p.text).filter(Boolean).join('\n\n')
        resultBlob.value = paragraphs
        resultKind.value = 'docx'
      }
    }
  } catch (e) {
    console.error('[doc-convert] 处理失败:', e)
    error.value = e?.message || '处理失败，请换一个文件重试'
  } finally {
    busy.value = false
  }
}

function onInputChange(e) {
  handleFile(e.target.files?.[0])
  e.target.value = ''
}

function onDrop(e) {
  dragging.value = false
  handleFile(e.dataTransfer?.files?.[0])
}

function onDragOver(e) {
  e.preventDefault()
  e.dataTransfer.dropEffect = 'copy'
  dragging.value = true
}

function onDragLeave(e) {
  if (!e.currentTarget.contains(e.relatedTarget)) dragging.value = false
}

function openPicker() {
  fileInput.value?.click()
}

function doExport() {
  if (busy.value) return
  if (resultKind.value === 'pdf') {
    if (!resultBlob.value) return
    downloadBlob(resultBlob.value, resultName.value)
  } else if (resultKind.value === 'docx') {
    if (!file.value || !Array.isArray(resultBlob.value)) return
    exportPdfToWord(resultBlob.value, `${baseName(file.value.name)}.docx`)
  } else {
    return
  }
  notify(`已导出 ${outName.value}`)
}

onBeforeUnmount(() => {
  clearTimeout(toastTimer)
  disposeOcrWorker()
})
</script>

<template>
  <div class="tool-page" @dragover="onDragOver" @drop.prevent="onDrop" @dragleave="onDragLeave">
    <main class="workspace">
      <!-- 主区域：预览 -->
      <section class="preview-card">
        <div class="card-head">
          <h2>预览</h2>
          <span v-if="file" class="filechip" :title="file.name">
            {{ file.name }}
            <template v-if="fileType === 'pdf' && pdfPageCount"> · 共 {{ pdfPageCount }} 页</template>
            <template v-else-if="fileType === 'pptx' && pdfPageCount"> · 共 {{ pdfPageCount }} 页</template>
          </span>
          <span v-else class="filechip muted">尚未添加文件</span>
          <span v-if="busy" class="state busy">处理中…</span>
          <span v-else-if="resultBlob" class="state ok">已就绪，可导出</span>
        </div>

        <!-- 预览区：始终挂载，直接可拖入文件 -->
        <div
          ref="stage"
          class="stage"
          :class="{ dragging }"
          @dragover="onDragOver"
          @drop.prevent="onDrop"
          @dragleave="onDragLeave"
        >
          <!-- 空状态 -->
          <div v-if="!file" class="empty">
            <div class="empty-icon">⇄</div>
            <p class="empty-title">把文档拖到这里</p>
            <p class="empty-sub">支持 Word / Excel / PPT / PDF，自动识别格式</p>
          </div>

          <!-- 可渲染预览（docx / xlsx / pptx） -->
          <div
            v-show="fileType === 'docx' || fileType === 'xlsx' || fileType === 'pptx'"
            ref="previewEl"
            class="docx-viewport"
          ></div>

          <!-- PDF 文本预览 -->
          <div v-show="fileType === 'pdf'" class="pdf-text-viewport">
            <pre v-if="pdfText" class="pdf-text">{{ pdfText }}</pre>
            <p v-else-if="resultBlob" class="pdf-text-empty">已提取文字，可导出 Word</p>
          </div>

          <!-- OCR 进度 -->
          <div v-if="isOcr" class="ocr-overlay">
            <span class="spinner"></span>
            <div class="ocr-info">
              <p class="ocr-title">正在识别扫描件文字（本地 OCR）…</p>
              <p class="ocr-sub">首次使用需加载识别引擎，可能需要十几秒</p>
              <div class="ocr-bar"><span :style="{ width: ocrProgress + '%' }"></span></div>
              <p class="ocr-pct">{{ ocrProgress }}%</p>
            </div>
          </div>

          <!-- 加载 / 错误 -->
          <div v-if="busy && !isOcr" class="overlay"><span class="spinner"></span>正在转换…</div>
          <div v-if="error" class="error-box">{{ error }}</div>
        </div>

        <div class="pager pager-static">
          <span class="pager-hint">{{ typeMeta[fileType]?.hint || '支持 Word / Excel / PPT / PDF 本地互转，文件不会上传' }}</span>
        </div>
      </section>

      <!-- 从属区域：控制面板 -->
      <aside class="panel">
        <div class="step">
          <div class="step-title"><span class="num">01</span> 添加文件</div>
          <button class="dropzone" :class="{ active: dragging }" @click="openPicker">
            <span class="plus">＋</span>
            <span class="drop-main">点击或拖入文档</span>
            <span class="drop-sub">Word · Excel · PPT · PDF</span>
          </button>
          <input
            ref="fileInput"
            type="file"
            class="hidden-input"
            :accept="accept"
            @change="onInputChange"
          />
          <div v-if="file" class="file-meta">
            <span class="file-dot" :class="{ pdf: fileType === 'pdf' }"></span>
            <span class="file-name" :title="file.name">{{ file.name }}</span>
            <span class="file-size">{{ (file.size / 1024).toFixed(0) }} KB</span>
          </div>
        </div>

        <div class="step">
          <div class="step-title"><span class="num">02</span> 转换结果</div>
          <div class="conv-result">
            <span class="conv-type">{{ typeLabel }}</span>
            <span class="conv-arrow">→</span>
            <span class="conv-type conv-out">{{ outLabel }}</span>
          </div>
          <p class="field-hint">自动识别格式并选择转换方向，无需手动切换。</p>
        </div>

        <div class="step">
          <div class="step-title"><span class="num">03</span> 支持格式</div>
          <div class="format-list">
            <span class="fmt">.docx → PDF</span>
            <span class="fmt">.xlsx → PDF</span>
            <span class="fmt">.pptx → PDF</span>
            <span class="fmt">.pdf → Word</span>
          </div>
          <p class="field-hint">旧版 .doc 请先在 Word 中另存为 .docx。</p>
        </div>

        <div class="panel-spacer"></div>

        <div class="export-block">
          <button class="export-btn" :disabled="!resultBlob || busy" @click="doExport">
            导出 {{ outLabel }} 文件
          </button>
          <p class="export-hint">输出：{{ outName }}</p>
          <p v-if="toast" class="toast">{{ toast }}</p>
        </div>
      </aside>
    </main>
  </div>
</template>
