<script setup>
import { RouterLink } from 'vue-router'
import { tools } from '../router/tools'
</script>

<template>
  <main class="home">
    <section class="home-hero">
      <p class="home-kicker">本地处理 · 文件不会上传</p>
      <h2>选择一个工具开始</h2>
      <p class="home-sub">所有功能都在浏览器里完成，文件不需要传到服务器。</p>
    </section>

    <section class="tool-grid">
      <RouterLink v-for="t in tools" :key="t.path" :to="t.path" class="tool-card">
        <span class="tool-icon">{{ t.icon || '◈' }}</span>
        <span class="tool-badge">{{ t.badge || '工具' }}</span>
        <h3>{{ t.title }}</h3>
        <p>{{ t.description }}</p>
        <span class="tool-go">打开 {{ t.path }} <span aria-hidden="true">→</span></span>
      </RouterLink>

      <div class="tool-card tool-card--placeholder">
        <span class="tool-icon">＋</span>
        <h3>更多工具</h3>
        <p>在 src/router/tools.js 的清单里加一项，新路径、首页卡片和顶部导航会自动出现。</p>
      </div>
    </section>
  </main>
</template>
