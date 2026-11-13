import WatermarkView from '../views/WatermarkView.vue'
import DocConvertView from '../views/DocConvertView.vue'

/**
 * 工具清单 —— 全站唯一的扩展点。
 *
 * 新增一个功能时，只要：
 *   1. 在 src/views/ 下新建页面组件；
 *   2. 在下面数组里加一项。
 * 首页卡片、顶部导航、URL 路由、浏览器标题都会自动生成，不需要改其他文件。
 *
 * 字段说明：
 *   path        访问路径（必填，需以 / 开头且唯一）
 *   name        路由名（必填，唯一）
 *   component   页面组件（必填）
 *   title       页面标题 / 卡片标题
 *   shortTitle  顶部导航文字（可选，默认取 title）
 *   description 首页卡片描述
 *   icon        首页卡片图标（字符）
 *   badge       首页卡片右上角标签
 */
export const tools = [
  {
    path: '/watermark',
    name: 'watermark',
    component: WatermarkView,
    title: '文件水印工具',
    shortTitle: '文件水印',
    description: '给图片或 PDF 叠加斜向平铺水印，可调文案、颜色、透明度与字号。',
    icon: '◈',
    badge: 'PDF / 图片',
  },
  {
    path: '/doc-convert',
    name: 'doc-convert',
    component: DocConvertView,
    title: '文档互转工具',
    shortTitle: '文档互转',
    description: 'Word 与 PDF 互转，支持表格、图片、页眉页脚，本地处理不上传。',
    icon: '⇄',
    badge: 'Word / PDF',
  },
]
