<script setup>
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import {
  DEFAULTS,
  FONT_SCALE_RANGE,
  clampFontScale,
  effectiveFontSize,
  isPDFFile,
  applyWatermarkToImage,
  applyWatermarkToPDF,
  renderPDFPage,
  downloadBlob,
} from '../utils/watermark.js'

const file = ref(null)
const text = ref(DEFAULTS.text)
const color = ref(DEFAULTS.color)
const opacity = ref(DEFAULTS.opacity)
const fontScale = ref(DEFAULTS.fontScale)

const dragging = ref(false)
const busy = ref(false)
const error = ref('')
const toast = ref('')
const result = ref(null)
const imageUrl = ref('')
const pageCount = ref(1)
const pageNo = ref(1)

// Worker 不可用（受限环境 / 企业策略）时降级用浏览器原生 PDF 查看器
const pdfWorkerBroken = ref(false)
const pdfEmbedUrl = ref('')

const fileInput = ref(null)
const pdfCanvas = ref(null)
const stage = ref(null)

const presets = [
  { hex: '#B8B8B8', label: '浅灰' },
  { hex: '#8A93A6', label: '深灰' },
  { hex: '#2F6BFF', label: '蓝' },
  { hex: '#D9534F', label: '红' },
  { hex: '#000000', label: '黑' },
]

const isPDF = computed(() => (file.value ? isPDFFile(file.value) : false))
const outName = computed(() => (result.value ? result.value.out.name : '—'))
const opacityPct = computed(() => Math.round(opacity.value * 100))
const fontScaleLabel = computed(() => `${clampFontScale(fontScale.value).toFixed(1)}×`)
const fontSizeLabel = computed(() =>
  effectiveFontSize(
    {
      isPDF: isPDF.value,
      width: result.value?.width,
      height: result.value?.height,
    },
    fontScale.value
  )
)

const acceptRe = /\.(pdf|jpe?g|png|tiff?|heic|heif|gif|webp|bmp)$/i

let debounce = null
let imageObjectUrl = null
let toastTimer = null

function currentOpts() {
  return {
    text: text.value,
    color: color.value,
    opacity: opacity.value,
    fontScale: fontScale.value,
  }
}

function clearResult() {
  result.value = null
  setImageUrl(null)
  revokeEmbedUrl()
  pageCount.value = 1
}

function setImageUrl(blob) {
  if (imageObjectUrl) {
    URL.revokeObjectURL(imageObjectUrl)
    imageObjectUrl = null
  }
  imageUrl.value = blob ? URL.createObjectURL(blob) : ''
  if (blob) imageObjectUrl = imageUrl.value
}

function revokeEmbedUrl() {
  if (pdfEmbedUrl.value) {
    URL.revokeObjectURL(pdfEmbedUrl.value)
    pdfEmbedUrl.value = ''
  }
}

function ensureEmbedUrl() {
  if (!result.value) return
  revokeEmbedUrl()
  pdfEmbedUrl.value = URL.createObjectURL(result.value.blob)
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('预览渲染超时')), ms)
    ),
  ])
}

function notify(msg) {
  toast.value = msg
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 2600)
}

async function drawPdfPage() {
  if (!result.value) return
  // 已降级：直接用原生查看器，不再等待 Worker
  if (pdfWorkerBroken.value) {
    ensureEmbedUrl()
    return
  }
  if (!pdfCanvas.value) return
  const available = (stage.value?.clientWidth || 900) - 72
  try {
    const count = await withTimeout(
      renderPDFPage(
        result.value.blob,
        pageNo.value,
        pdfCanvas.value,
        Math.max(320, Math.min(available, 940))
      ),
      8000
    )
    pageCount.value = count
    if (pageNo.value > count) pageNo.value = count
  } catch (e) {
    // Worker 拿不到 / 超时 → 降级到浏览器内置 PDF 查看器（同样所见即所得）
    pdfWorkerBroken.value = true
    ensureEmbedUrl()
  }
}

/** 重新生成带水印文件（文案 / 颜色 / 透明度变化时会防抖调用） */
async function regenerate() {
  if (!file.value) {
    clearResult()
    return
  }
  busy.value = true
  error.value = ''
  try {
    if (isPDF.value) {
      const r = await applyWatermarkToPDF(file.value, currentOpts())
      result.value = r
      pageCount.value = r.pageCount
      if (pageNo.value > r.pageCount) pageNo.value = 1
      await nextTick()
      await drawPdfPage()
    } else {
      const r = await applyWatermarkToImage(file.value, currentOpts())
      result.value = r
      setImageUrl(r.blob)
    }
  } catch (e) {
    error.value = e?.message || '处理失败，请换个文件重试'
    clearResult()
  } finally {
    busy.value = false
  }
}

function pickFile(f) {
  if (!f) return
  if (!acceptRe.test(f.name) && !f.type.startsWith('image/')) {
    error.value = '仅支持 PDF、JPG、PNG、TIFF、HEIC、WebP 等图片格式'
    return
  }
  file.value = f
  pageNo.value = 1
  pageCount.value = 1
  pdfWorkerBroken.value = false
  revokeEmbedUrl()
  error.value = ''
  regenerate()
}

function onInputChange(e) {
  pickFile(e.target.files?.[0])
  e.target.value = ''
}

function onDrop(e) {
  dragging.value = false
  pickFile(e.dataTransfer?.files?.[0])
}

function onDragOver(e) {
  e.preventDefault()
  dragging.value = true
}

function onDragLeave(e) {
  if (!e.currentTarget.contains(e.relatedTarget)) dragging.value = false
}

function openPicker() {
  fileInput.value?.click()
}

function doExport() {
  if (!result.value || busy.value) return
  downloadBlob(result.value.blob, result.value.out.name)
  notify(`已导出 ${result.value.out.name}`)
}

function changePage(delta) {
  const next = pageNo.value + delta
  if (next >= 1 && next <= pageCount.value) pageNo.value = next
}

watch([text, color, opacity, fontScale], () => {
  clearTimeout(debounce)
  debounce = setTimeout(regenerate, 280)
})

watch(pageNo, () => {
  if (isPDF.value && result.value) drawPdfPage()
})

onBeforeUnmount(() => {
  clearTimeout(debounce)
  clearTimeout(toastTimer)
  setImageUrl(null)
  revokeEmbedUrl()
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
            <template v-if="isPDF"> · 共 {{ pageCount }} 页</template>
          </span>
          <span v-else class="filechip muted">尚未添加文件</span>
          <span v-if="busy" class="state busy">处理中…</span>
          <span v-else-if="result" class="state ok">水印已应用</span>
        </div>

        <div ref="stage" class="stage" :class="{ dragging }">
          <!-- 空状态 -->
          <div v-if="!file" class="empty">
            <div class="empty-icon">＋</div>
            <p class="empty-title">把图片或 PDF 拖进来</p>
            <p class="empty-sub">也可以点击右侧「添加文件」选择</p>
          </div>

          <!-- 图片预览 -->
          <img v-else-if="!isPDF && imageUrl" :src="imageUrl" class="preview-img" alt="带水印预览" />

          <!-- PDF 预览：Worker 不可用时用原生查看器 -->
          <embed
            v-else-if="isPDF && result && pdfWorkerBroken"
            :src="pdfEmbedUrl"
            type="application/pdf"
            class="preview-embed"
          />
          <canvas v-else-if="isPDF && result" ref="pdfCanvas" class="preview-pdf"></canvas>

          <!-- 加载 / 错误 -->
          <div v-if="busy" class="overlay"><span class="spinner"></span>正在生成预览…</div>
          <div v-if="error" class="error-box">{{ error }}</div>
        </div>

        <div v-if="isPDF && result && !pdfWorkerBroken" class="pager">
          <button class="page-btn" :disabled="pageNo <= 1" @click="changePage(-1)">上一页</button>
          <span>第 {{ pageNo }} / {{ pageCount }} 页</span>
          <button class="page-btn" :disabled="pageNo >= pageCount" @click="changePage(1)">下一页</button>
          <span class="pager-hint">预览即导出结果</span>
        </div>
        <div v-else class="pager pager-static">
          <span class="pager-hint">预览显示的就是最终导出文件</span>
        </div>
      </section>

      <!-- 从属区域：控制面板 -->
      <aside class="panel">
        <div class="step">
          <div class="step-title"><span class="num">01</span> 添加文件</div>
          <button class="dropzone" :class="{ active: dragging }" @click="openPicker">
            <span class="plus">＋</span>
            <span class="drop-main">点击或拖入 图片 / PDF</span>
            <span class="drop-sub">PDF · JPG · PNG · TIFF · HEIC · WebP</span>
          </button>
          <input
            ref="fileInput"
            type="file"
            class="hidden-input"
            accept=".pdf,.jpg,.jpeg,.png,.tif,.tiff,.heic,.heif,.gif,.webp,.bmp,image/*,application/pdf"
            @change="onInputChange"
          />
          <div v-if="file" class="file-meta">
            <span class="file-dot" :class="{ pdf: isPDF }"></span>
            <span class="file-name" :title="file.name">{{ file.name }}</span>
            <span class="file-size">{{ (file.size / 1024).toFixed(0) }} KB</span>
          </div>
        </div>

        <div class="step">
          <div class="step-title"><span class="num">02</span> 水印文案</div>
          <input v-model="text" class="text-input" type="text" placeholder="留空将使用默认文案" />
          <p class="field-hint">留空时默认「{{ DEFAULTS.text }}」</p>
        </div>

        <div class="step">
          <div class="step-title"><span class="num">03</span> 水印颜色</div>
          <div class="color-row">
            <label class="color-picker" :style="{ background: color }">
              <input v-model="color" type="color" />
            </label>
            <span class="hex">{{ color.toUpperCase() }}</span>
            <div class="presets">
              <button
                v-for="p in presets"
                :key="p.hex"
                class="preset"
                :class="{ selected: color.toLowerCase() === p.hex.toLowerCase() }"
                :style="{ background: p.hex }"
                :title="`${p.label} ${p.hex}`"
                @click="color = p.hex"
              ></button>
            </div>
          </div>

          <div class="slider-row">
            <label for="op">透明度</label>
            <input id="op" v-model.number="opacity" type="range" min="0.05" max="0.8" step="0.01" />
            <span class="slider-val">{{ opacityPct }}%</span>
          </div>
          <p class="field-hint">默认 -45° 斜向平铺</p>
        </div>

        <div class="step">
          <div class="step-title"><span class="num">04</span> 水印字号</div>
          <div class="slider-row">
            <label for="fs">字号</label>
            <input
              id="fs"
              v-model.number="fontScale"
              type="range"
              :min="FONT_SCALE_RANGE.min"
              :max="FONT_SCALE_RANGE.max"
              :step="FONT_SCALE_RANGE.step"
            />
            <span class="slider-val">{{ fontScaleLabel }}</span>
          </div>
          <div class="font-meta">
            <span>实际字号 <b>{{ fontSizeLabel }}</b></span>
            <button
              class="link-btn"
              :disabled="fontScale === DEFAULTS.fontScale"
              @click="fontScale = DEFAULTS.fontScale"
            >
              恢复默认
            </button>
          </div>
          <p class="field-hint">1.0× 与原版工具一致 · 平铺间距随字号等比变化</p>
        </div>

        <div class="panel-spacer"></div>

        <div class="export-block">
          <button class="export-btn" :disabled="!result || busy" @click="doExport">
            导出带水印文件
          </button>
          <p class="export-hint">输出：{{ outName }}</p>
          <p v-if="toast" class="toast">{{ toast }}</p>
        </div>
      </aside>
    </main>
  </div>
</template>
