# 项目长期笔记

- 项目是浏览器端「文件工具箱」，所有处理本地完成、文件不上传；核心算法在 `src/utils/watermark.js`（与 macOS Swift 版对齐）。
- 路由扩展点：`src/router/tools.js` 的 `tools` 数组。新增功能 = 新建 `src/views/XxxView.vue` + 在数组加一项，路由/首页卡片/顶部导航/标题自动生成，不要另写路由配置。
- 当前路径：`/` 首页（工具列表）、`/watermark` 文件水印（图片 / PDF）。
- 部署：默认 history 模式，静态托管需 SPA 回退到 index.html；无法配置回退时用 `VITE_ROUTER_MODE=hash VITE_BASE=./ npm run build`。
