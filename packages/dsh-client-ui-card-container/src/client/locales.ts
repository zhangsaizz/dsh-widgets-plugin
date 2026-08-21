/**
 * Locale dictionaries for the card container widget (namespace
 * `card-container`). Product copy is Chinese-first; the en dictionary is the
 * paired translation.
 */

/** Dictionary keys of the `card-container` namespace (the LocaleNamespaceMap merge is declared at registration). */
export type CardContainerKey =
  | 'title'
  | 'collapse'
  | 'expand'
  | 'trayTitle'
  | 'trayEmpty'
  | 'trayHint'
  | 'gridTitle'
  | 'gridEmpty'
  | 'gridEmptyTitle'
  | 'gridHint'
  | 'dockAll'
  | 'countTip'
  | 'undock'
  | 'dock'
  | 'cardMissing'
  | 'cardTokenLabel'
  | 'cardTokenIn'
  | 'cardTokenOut'
  | 'cardBusyLabel'
  | 'cardSessionMeta'
  | 'widgetBalance'
  | 'widgetTokenCrit'
  | 'widgetSessionMonitor'
  | 'columnsLabel'
  | 'columnsAuto'
  | 'columns2'
  | 'columns3'
  | 'columns4'
  | 'resetDocked'
  | 'resetAll'
  | 'manageGroups'
  | 'newGroupPlaceholder'
  | 'renameGroup'
  | 'deleteGroup'
  | 'defaultGroup'
  | 'dropToGroup'
  | 'dropToUndock'
  | 'dropToReorder'

/** Simplified Chinese dictionary. */
export const zh: Record<CardContainerKey, string> = {
  title: '卡片容器',
  collapse: '收起',
  expand: '点击展开',
  trayTitle: '可放入的小组件',
  trayEmpty: '没有可放入的小组件',
  trayHint: '拖入下方网格即可停靠，或点击直接放入',
  gridTitle: '已停靠',
  gridEmpty: '把上方「可放入的小组件」拖进网格，或点击直接放入',
  gridEmptyTitle: '还没有停靠任何小组件',
  gridHint: '拖动卡片可调整顺序，拖出网格可移出容器，点 × 移出',
  dockAll: '一键停靠全部',
  countTip: '本组已停靠 {docked} 个，共 {total} 个小组件',
  undock: '移出容器',
  dock: '放入容器',
  cardMissing: '暂无紧凑卡片视图',
  cardTokenLabel: 'Token',
  cardTokenIn: '输入 {n}',
  cardTokenOut: '输出 {n}',
  cardBusyLabel: '个忙碌中',
  cardSessionMeta: '共 {n} 个会话',
  widgetBalance: '余额看板',
  widgetTokenCrit: 'Token 暴击',
  widgetSessionMonitor: '会话监控',
  columnsLabel: '列数',
  columnsAuto: '自适应',
  columns2: '2 列',
  columns3: '3 列',
  columns4: '4 列',
  resetDocked: '清空停靠',
  resetAll: '重置设置',
  manageGroups: '管理分组',
  newGroupPlaceholder: '新分组名称',
  renameGroup: '重命名分组',
  deleteGroup: '删除分组',
  defaultGroup: '默认',
  dropToGroup: '放入「{name}」',
  dropToUndock: '移出容器',
  dropToReorder: '松手排序',
}

/** English dictionary. */
export const en: Record<CardContainerKey, string> = {
  title: 'Card container',
  collapse: 'Collapse',
  expand: 'Click to expand',
  trayTitle: 'Available widgets',
  trayEmpty: 'No widgets available',
  trayHint: 'Drag into the grid to dock, or click to dock',
  gridTitle: 'Docked',
  gridEmpty: 'Drag widgets from the "Available" tray into the grid, or click to dock',
  gridEmptyTitle: 'No widgets docked yet',
  gridHint: 'Drag cards to reorder, drag out of the grid to undock, click × to undock',
  dockAll: 'Dock all',
  countTip: '{docked} docked in this group, {total} widgets total',
  undock: 'Undock',
  dock: 'Dock',
  cardMissing: 'No compact card view',
  cardTokenLabel: 'Tokens',
  cardTokenIn: 'in {n}',
  cardTokenOut: 'out {n}',
  cardBusyLabel: 'busy',
  cardSessionMeta: '{n} sessions total',
  widgetBalance: 'Balance',
  widgetTokenCrit: 'Token crit',
  widgetSessionMonitor: 'Session monitor',
  columnsLabel: 'Columns',
  columnsAuto: 'Auto',
  columns2: '2 columns',
  columns3: '3 columns',
  columns4: '4 columns',
  resetDocked: 'Clear docked',
  resetAll: 'Reset settings',
  manageGroups: 'Manage groups',
  newGroupPlaceholder: 'New group name',
  renameGroup: 'Rename group',
  deleteGroup: 'Delete group',
  defaultGroup: 'Default',
  dropToGroup: 'Drop into "{name}"',
  dropToUndock: 'Undock',
  dropToReorder: 'Drop to reorder',
}
