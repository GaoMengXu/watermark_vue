<script setup>
import { computed } from 'vue'
import { useRoute, RouterLink, RouterView } from 'vue-router'
import { tools } from './router/tools'

const route = useRoute()
const pageTitle = computed(() => route.meta.title || '工具箱')
const privacy = computed(() =>
  route.name === 'home'
    ? '本地处理 · 文件不会上传'
    : `${pageTitle.value} · 本地处理，文件不会上传`
)
</script>

<template>
  <div class="app">
    <header class="topbar">
      <RouterLink to="/" class="brand brand-link" title="返回首页">
        <span class="mark">◈</span>
        <h1>工具箱</h1>
      </RouterLink>

      <nav class="mainnav" aria-label="功能导航">
        <RouterLink
          v-for="t in tools"
          :key="t.path"
          :to="t.path"
          class="nav-link"
        >
          {{ t.shortTitle || t.title }}
        </RouterLink>
      </nav>

      <span class="privacy">{{ privacy }}</span>
    </header>

    <RouterView v-slot="{ Component }">
      <component :is="Component" />
    </RouterView>
  </div>
</template>
