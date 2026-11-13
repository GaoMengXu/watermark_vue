# watermark-vue

浏览器端文件工具箱。所有处理都在本地完成，文件不会上传。

## 访问路径

| 路径 | 功能 |
| --- | --- |
| `/` | 首页，自动列出所有工具 |
| `/watermark` | 文件添加水印（图片 / PDF） |

## 新增一个功能

只需两步，**不用改路由文件、导航或首页**：

1. 在 `src/views/` 下新建页面组件，例如 `src/views/CompressView.vue`；
2. 在 `src/router/tools.js` 的 `tools` 数组里加一项：

```js
import CompressView from '../views/CompressView.vue'

export const tools = [
  // ...已有工具
  {
    path: '/compress',
    name: 'compress',
    component: CompressView,
    title: '文件压缩',
    shortTitle: '压缩',
    description: '一句话说明这个工具做什么。',
    icon: '▣',
    badge: 'PDF / 图片',
  },
]
```

首页卡片、顶部导航、URL 路由和浏览器标题会自动生成。未知路径统一回首页。

## 本地开发

```bash
npm install
npm run dev       # http://127.0.0.1:5173/watermark
npm run build
npm run preview
```

## 部署注意事项

- 默认是 **history 模式**，URL 为真实路径（`/watermark`）。静态服务器必须把找不到的路径回退到 `index.html`：
  - nginx：`try_files $uri $uri/ /index.html;`
  - Vercel / Netlify / Cloudflare Pages：配置 rewrite 到 `/index.html`
  - Vite 的 `dev` / `preview` 已自带该回退，本地直接刷新 `/watermark` 正常。
- 如果托管环境不能配置回退，或要部署到任意子目录，可切到 hash 模式（地址为 `.../#/watermark`）：

```bash
VITE_ROUTER_MODE=hash VITE_BASE=./ npm run build
```

- 部署在固定子路径时，可以指定 base，并保持 history 模式：

```bash
VITE_BASE=/tools/ npm run build
```
