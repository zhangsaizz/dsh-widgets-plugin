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
  | 'notInstalled'
  | 'notInstalledHint'
  | 'unknownPackage'
  | 'configNote'
  | 'balanceName'
  | 'balanceDescription'
  | 'tokenCritName'
  | 'tokenCritDescription'
  | 'sessionMonitorName'
  | 'sessionMonitorDescription'

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
  notInstalled: '未安装',
  notInstalledHint: '该小组件尚未安装，无法启用。',
  unknownPackage: '未知来源',
  configNote: '可单独配置',
  balanceName: '余额看板',
  balanceDescription: '把模型提供商的账户余额显示为可缩放、可吸附的浮动看板。',
  tokenCritName: 'Token 暴击挂件',
  tokenCritDescription: '实时显示当前会话累计 token 用量，增长时触发暴击动效。',
  sessionMonitorName: '会话监控看板',
  sessionMonitorDescription: '列出正在执行的会话，完成一轮时主动提醒，点击即可跳转到目标会话。',
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
  notInstalled: 'Not installed',
  notInstalledHint: 'This widget is not installed and cannot be enabled.',
  unknownPackage: 'Unknown source',
  configNote: 'Configurable',
  balanceName: 'Balance dashboard',
  balanceDescription: 'Shows the model provider account balance in a zoomable, dockable floating dashboard.',
  tokenCritName: 'Token crit meter',
  tokenCritDescription: 'Shows the current session token usage in real time with crit animations on growth.',
  sessionMonitorName: 'Session monitor',
  sessionMonitorDescription: 'Lists running sessions, notifies you when a round finishes, and jumps to the target session on click.',
}
