/**
 * Locale dictionaries for the widget manager page (namespace `widgets`).
 * Product copy is Chinese-first; the en dictionary is the paired translation.
 */

/** Dictionary keys of the `widgets` namespace (the LocaleNamespaceMap merge is declared at registration). */
export type WidgetManagerLocaleKey =
  | 'navLabel'
  | 'pageTitle'
  | 'pageSubtitle'
  | 'add'
  | 'close'
  | 'configure'
  | 'closeDialog'
  | 'enabled'
  | 'disabled'
  | 'docked'
  | 'undock'
  | 'notInstalled'
  | 'notInstalledHint'
  | 'unknownPackage'
  | 'configNote'
  | 'installGuide'
  | 'installGuideTitle'
  | 'installGuideIntro'
  | 'installStep1'
  | 'installStep1Note'
  | 'installStep2'
  | 'installStep2Note'
  | 'installStep3'
  | 'installStep3Note'
  | 'installPatchNote'
  | 'balanceName'
  | 'balanceDescription'
  | 'tokenCritName'
  | 'tokenCritDescription'
  | 'sessionMonitorName'
  | 'sessionMonitorDescription'
  | 'cardContainerName'
  | 'cardContainerDescription'
  | 'rainbowFlowName'
  | 'rainbowFlowDescription'

/** Simplified Chinese dictionary. */
export const zh: Record<WidgetManagerLocaleKey, string> = {
  navLabel: '小组件管理',
  pageTitle: '小组件',
  pageSubtitle: '本项目的小组件列表：添加（启用）会把挂件挂到页面上，停用（禁用）会把它从页面上移除。带配置的挂件可通过「配置」按钮在弹窗中单独设置。状态保存在本机浏览器，刷新后保持。',
  add: '添加',
  close: '停用',
  configure: '配置',
  closeDialog: '关闭',
  enabled: '已启用',
  disabled: '已停用',
  docked: '已停靠',
  undock: '移出容器',
  notInstalled: '未安装',
  notInstalledHint: '该小组件尚未安装，无法启用。点击「安装指引」查看安装步骤。',
  unknownPackage: '未知来源',
  configNote: '可单独配置',
  installGuide: '安装指引',
  installGuideTitle: '安装指引',
  installGuideIntro: '该小组件尚未安装，无法从本页直接启用。按下面步骤把它装到部署里，再回到本页即可启用。',
  installStep1: '1. 安装包',
  installStep1Note: '把 <name> 换成你的 profile 名（如 web）后执行：',
  installStep2: '2. 挂载插件',
  installStep2Note: '把下面的挂载行加进组成文件（cordis.yml 或 bundle 的 cordis.patch.yml）：',
  installStep3: '3. 重启服务',
  installStep3Note: '重启 web 服务（如 dsh web），再刷新本页。浏览器端 bundle 由插件表重扫加载，无需重新构建。',
  installPatchNote: '直接写在 cordis.yml 时去掉「- insert:」包装——每条 - id / name 就是一行插件。',
  balanceName: '余额看板',
  balanceDescription: '把模型提供商的账户余额显示为可缩放、可吸附的浮动看板。',
  tokenCritName: 'Token 暴击挂件',
  tokenCritDescription: '实时显示当前会话累计 token 用量，增长时触发暴击动效。',
  sessionMonitorName: '会话监控看板',
  sessionMonitorDescription: '列出正在执行的会话，完成一轮时主动提醒，点击即可跳转到目标会话。',
  cardContainerName: '卡片容器',
  cardContainerDescription: '把其他小组件拖进一个整齐、等间距的卡片网格中集中摆放，浮窗自动收起。',
  rainbowFlowName: '彩虹流光',
  rainbowFlowDescription: '输入框变成通透的液态玻璃，一圈柔和的彩虹光晕像呼吸一样明暗脉动，节奏随输出 token 速率变化。',
}

/** English dictionary. */
export const en: Record<WidgetManagerLocaleKey, string> = {
  navLabel: 'Widgets',
  pageTitle: 'Widgets',
  pageSubtitle: 'The project widget list: Add (enable) mounts a widget onto the page, Close (disable) removes it. Widgets with configuration expose it through a "Configure" button in a separate dialog. State is kept in this browser and survives a reload.',
  add: 'Add',
  close: 'Disable',
  configure: 'Configure',
  closeDialog: 'Close',
  enabled: 'Enabled',
  disabled: 'Disabled',
  docked: 'Docked',
  undock: 'Undock',
  notInstalled: 'Not installed',
  notInstalledHint: 'This widget is not installed and cannot be enabled. Click "Install guide" for the install steps.',
  unknownPackage: 'Unknown source',
  configNote: 'Configurable',
  installGuide: 'Install guide',
  installGuideTitle: 'Install guide',
  installGuideIntro: 'This widget is not installed yet and cannot be enabled from this page. Install it into the deployment following the steps below, then come back here to enable it.',
  installStep1: '1. Install the package',
  installStep1Note: 'Replace <name> with your profile name (e.g. web), then run:',
  installStep2: '2. Mount the plugin',
  installStep2Note: 'Add the mount row below to a composition file (cordis.yml or the bundle\'s cordis.patch.yml):',
  installStep3: '3. Restart the service',
  installStep3Note: 'Restart the web service (e.g. dsh web), then reload this page. The browser bundle is picked up by the plugin-table rescan — no rebuild needed.',
  installPatchNote: 'When writing directly into cordis.yml, drop the "- insert:" wrapper — each "- id / name" line is one plugin row.',
  balanceName: 'Balance dashboard',
  balanceDescription: 'Shows the model provider account balance in a zoomable, dockable floating dashboard.',
  tokenCritName: 'Token crit meter',
  tokenCritDescription: 'Shows the current session token usage in real time with crit animations on growth.',
  sessionMonitorName: 'Session monitor',
  sessionMonitorDescription: 'Lists running sessions, notifies you when a round finishes, and jumps to the target session on click.',
  cardContainerName: 'Card container',
  cardContainerDescription: 'Dock other widgets into a tidy, evenly-gapped card grid; their floating panels hide while docked.',
  rainbowFlowName: 'Rainbow flow',
  rainbowFlowDescription: 'Turns the composer into translucent liquid glass with a soft rainbow halo breathing around it, its rhythm sped by the output-token rate.',
}
