import { createRouter, createWebHistory, createWebHashHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'
import { tools } from './tools'

// 路由表由工具清单生成；首页固定为 /，未知路径回首页
const routes = [
  { path: '/', name: 'home', component: HomeView, meta: { title: '工具箱' } },
  ...tools.map(({ path, name, component, title }) => ({
    path,
    name,
    component,
    meta: { title },
  })),
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

// 默认用真实 URL 路径（/watermark）。
// 静态托管无法配置 history 回退，或需要部署到任意子目录时，用
//   VITE_ROUTER_MODE=hash npm run dev / build
// 即可切换成 /#/watermark，业务代码无需改动。
const history =
  import.meta.env.VITE_ROUTER_MODE === 'hash'
    ? createWebHashHistory()
    : createWebHistory(import.meta.env.BASE_URL)

const router = createRouter({
  history,
  routes,
  scrollBehavior: () => ({ top: 0 }),
})

router.afterEach((to) => {
  document.title = to.meta.title && to.name !== 'home'
    ? `${to.meta.title} · 工具箱`
    : '工具箱'
})

export default router
