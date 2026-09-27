/*
 * @Description: BaiLianChatInYiTu 组件文本信息
 */
import { ConfigType, PackagesCategoryEnum, ChartFrameEnum } from '@/package/index.d'
import { ChatCategoryEnum, ChatCategoryEnumName } from '@/package/public/index.d'

export const BaiLianChatInYiTuConfig: ConfigType = {
  key: 'BaiLianChatInYiTu',
  chartKey: 'VBaiLianChatInYiTu',
  conKey: 'VCBaiLianChatInYiTu',
  title: 'AI对话',
  category: ChatCategoryEnum.MORE,
  categoryName: ChatCategoryEnumName.MORE,
  package: PackagesCategoryEnum.DECORATES,
  chartFrame: ChartFrameEnum.COMMON,
  // 聊天界面按面板尺寸自适应，不跟随平台的等比缩放
  noScale: true
}
