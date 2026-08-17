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
  | 'dockToContainer'
  | 'collapse'
  | 'expand'
  | 'updatedAt'
  | 'error'
  | 'flat'
  | 'showAll'
  | 'showCurrent'
  | 'noAccounts'
  | 'current'
  | 'noBindings'
  | 'noCredential'
  | 'sectionBindings'
  | 'sectionEdit'
  | 'addBinding'
  | 'saveChanges'
  | 'saving'
  | 'saved'
  | 'removeBinding'
  | 'edit'
  | 'cancel'
  | 'confirmDelete'
  | 'providerField'
  | 'vendorField'
  | 'credentialRefField'
  | 'credentialField'
  | 'credentialInline'
  | 'storedCredential'
  | 'keepCredentialHint'
  | 'clearCredential'
  | 'willClearCredential'
  | 'credRefMode'
  | 'credKeyMode'
  | 'baseURLField'
  | 'providerRequired'
  | 'credentialRefRequired'
  | 'credentialRequired'
  | 'providerReadonlyHint'
  | 'providerHint'
  | 'noMatch'

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
  dockToContainer: '放入卡片容器',
  collapse: '收起',
  expand: '展开',
  updatedAt: '更新于',
  error: '查询失败',
  flat: '持平',
  showAll: '显示全部账户',
  showCurrent: '只显示当前账户',
  noAccounts: '无可用账户',
  current: '当前',
  noBindings: '尚未绑定余额供应商，可在下方添加。',
  noCredential: '未配置凭据',
  sectionBindings: '已配置的绑定',
  sectionEdit: '编辑绑定',
  addBinding: '添加绑定',
  saveChanges: '保存修改',
  saving: '保存中…',
  saved: '已保存',
  removeBinding: '删除',
  edit: '编辑',
  cancel: '取消',
  confirmDelete: '确认删除？',
  providerField: '提供商路由',
  vendorField: '余额供应商类型',
  credentialRefField: '凭据引用（环境变量名）',
  credentialField: 'API Key',
  credentialInline: '已输入 Key',
  storedCredential: '已保存 Key',
  keepCredentialHint: '留空则保留已保存的 Key',
  clearCredential: '清除已保存的 Key',
  willClearCredential: '保存后将移除已保存的 Key',
  credRefMode: '环境变量引用',
  credKeyMode: '直接粘贴 Key',
  baseURLField: 'Base URL（自托管网关，可留空）',
  providerRequired: '提供商路由不能为空',
  credentialRefRequired: '请填写环境变量引用',
  credentialRequired: '请粘贴 API Key',
  providerReadonlyHint: '提供商路由是绑定的标识，如需更换请删除后重新添加',
  providerHint: '候选中只显示模型列表里的提供商，也可直接输入其他路由',
  noMatch: '无匹配的路由',
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
  dockToContainer: 'Dock into card container',
  collapse: 'Collapse',
  expand: 'Expand',
  updatedAt: 'Updated',
  error: 'Query failed',
  flat: 'Flat',
  showAll: 'Show all accounts',
  showCurrent: 'Show current account only',
  noAccounts: 'No accounts available',
  current: 'Current',
  noBindings: 'No balance bindings yet — add one below.',
  noCredential: 'No credential',
  sectionBindings: 'Configured bindings',
  sectionEdit: 'Edit binding',
  addBinding: 'Add binding',
  saveChanges: 'Save changes',
  saving: 'Saving…',
  saved: 'Saved',
  removeBinding: 'Remove',
  edit: 'Edit',
  cancel: 'Cancel',
  confirmDelete: 'Confirm delete?',
  providerField: 'Provider route',
  vendorField: 'Balance vendor type',
  credentialRefField: 'Credential reference (env var name)',
  credentialField: 'API key',
  credentialInline: 'Key stored',
  storedCredential: 'Stored key',
  keepCredentialHint: 'Leave blank to keep the stored key',
  clearCredential: 'Clear stored key',
  willClearCredential: 'The stored key will be removed on save',
  credRefMode: 'Env var reference',
  credKeyMode: 'Paste API key',
  baseURLField: 'Base URL (self-hosted gateways, optional)',
  providerRequired: 'Provider route is required',
  credentialRefRequired: 'Credential reference is required',
  credentialRequired: 'API key is required',
  providerReadonlyHint: 'The provider route identifies this binding — delete and re-add to change it',
  providerHint: 'Only providers in the model list are shown; you can also type any route',
  noMatch: 'No matching routes',
}
