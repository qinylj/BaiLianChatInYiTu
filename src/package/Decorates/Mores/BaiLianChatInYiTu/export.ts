/*
 * @Description: BaiLianChatInYiTu 导出与打包配置
 */
import * as config from './config'

import configVue from './config.vue'
import indexVue from './index.vue'

const component = indexVue
const BaiLianChatInYiTu = {
  component: component,
  config,
  // name / version 由 index.vue 里独立的 <script lang="ts"> 块导出，
  // 打包脚本用正则从该文件正文中提取版本号，两处必须保持一致
  name: component.name,
  version: component.version,
  configVue
}

export { BaiLianChatInYiTu }
