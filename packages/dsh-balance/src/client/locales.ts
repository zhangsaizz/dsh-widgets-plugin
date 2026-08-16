/**
 * Locale dictionaries for the balance widget (namespace `balance`).
 * Product copy is Chinese-first; the en dictionary is the paired translation.
 */

/** Dictionary keys of the `balance` namespace (the LocaleNamespaceMap merge is declared at registration). */
export type BalanceKey =
  | 'title'
  | 'noSession'
  | 'noModel'
  | 'unbound'
  | 'unconfigured'
  | 'unsupported'
  | 'loading'
  | 'refresh'
  | 'zoomIn'
  | 'zoomOut'
  | 'resetZoom'
  | 'dock'
  | 'collapse'
  | 'expand'
  | 'updatedAt'
  | 'error'
  | 'flat'
  | 'showAll'
  | 'showCurrent'
  | 'noAccounts'
  | 'current'
  | 'settingsNav'
  | 'noBindings'
  | 'addBinding'
  | 'removeBinding'
  | 'providerField'
  | 'vendorField'
  | 'credentialRefField'
  | 'credentialField'
  | 'credentialInline'
  | 'baseURLField'
  | 'bindingRequired'

/** Simplified Chinese dictionary. */
export const zh: Record<BalanceKey, string> = {
  title: '余额',
  noSession: '无会话',
  noModel: '未选择模型',
  unbound: '未绑定余额查询',
  unconfigured: '未配置 API Key',
  unsupported: '无公开余额接口',
  loading: '刷新中…',
  refresh: '刷新',
  zoomIn: '放大',
  zoomOut: '缩小',
  resetZoom: '重置缩放',
  dock: '吸附',
  collapse: '收起',
  expand: '展开',
  updatedAt: '更新于',
  error: '查询失败',
  flat: '持平',
  showAll: '显示全部账户',
  showCurrent: '只显示当前账户',
  noAccounts: '无可用账户',
  current: '当前',
  settingsNav: '余额供应商',
  noBindings: '尚未绑定余额供应商，可在下方添加。',
  addBinding: '添加绑定',
  removeBinding: '删除',
  providerField: '提供商路由',
  vendorField: '余额供应商类型',
  credentialRefField: '凭据引用（环境变量名）',
  credentialField: '直接输入凭证（API Key，可留空）',
  credentialInline: '已输入凭证',
  baseURLField: 'Base URL（自托管网关，可留空）',
  bindingRequired: '提供商路由与凭据引用不能为空',
}

/** English dictionary. */
export const en: Record<BalanceKey, string> = {
  title: 'Balance',
  noSession: 'No session',
  noModel: 'No model selected',
  unbound: 'No balance provider bound',
  unconfigured: 'API key not configured',
  unsupported: 'No public balance endpoint',
  loading: 'Refreshing…',
  refresh: 'Refresh',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  resetZoom: 'Reset zoom',
  dock: 'Dock',
  collapse: 'Collapse',
  expand: 'Expand',
  updatedAt: 'Updated',
  error: 'Query failed',
  flat: 'Flat',
  showAll: 'Show all accounts',
  showCurrent: 'Show current account only',
  noAccounts: 'No accounts available',
  current: 'Current',
  settingsNav: 'Balance providers',
  noBindings: 'No balance bindings yet — add one below.',
  addBinding: 'Add binding',
  removeBinding: 'Remove',
  providerField: 'Provider route',
  vendorField: 'Balance vendor type',
  credentialRefField: 'Credential reference (env var name)',
  credentialField: 'Inline credential (API key, optional)',
  credentialInline: 'Inline credential',
  baseURLField: 'Base URL (self-hosted gateways, optional)',
  bindingRequired: 'Provider route and credential reference are required',
}
