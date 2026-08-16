/**
 * Locale dictionaries for the session monitor widget (namespace
 * `session-monitor`). Product copy is Chinese-first; the en dictionary is the
 * paired translation.
 */

/** Dictionary keys of the `session-monitor` namespace (the LocaleNamespaceMap merge is declared at registration). */
export type SessionMonitorKey =
  | 'title'
  | 'runningCount'
  | 'noSessions'
  | 'noRunning'
  | 'running'
  | 'idle'
  | 'roundDone'
  | 'pendingInput'
  | 'subagent'
  | 'subagentsRunning'
  | 'jobsRunning'
  | 'current'
  | 'collapse'
  | 'expand'
  | 'resizeHint'
  | 'clearDone'
  | 'toastTitle'
  | 'toastBody'
  | 'interactionTitle'
  | 'interactionBody'
  | 'subagentTitle'
  | 'errorTitle'
  | 'errorBody'
  | 'abortedTitle'
  | 'abortedBody'
  | 'blockedTitle'
  | 'blockedBody'
  | 'maxTokensTitle'
  | 'maxTokensBody'
  | 'interruptedTitle'
  | 'interruptedBody'
  | 'jump'
  | 'dismiss'
  | 'justNow'
  | 'minutesAgo'
  | 'hoursAgo'
  | 'notifyLabel'
  | 'notifyDesc'
  | 'notifyModeLabel'
  | 'notifyModeAuto'
  | 'notifyModeConfirm'
  | 'autoDismissSecLabel'
  | 'soundLabel'
  | 'browserNotifyLabel'
  | 'browserNotifyDesc'
  | 'permGranted'
  | 'permDenied'
  | 'permAsk'
  | 'runningOnlyLabel'
  | 'runningOnlyDesc'
  | 'timeWindowLabel'
  | 'timeWindowDesc'
  | 'timeWindowDisabledHint'
  | 'timeWindowAll'
  | 'timeWindow15m'
  | 'timeWindow30m'
  | 'timeWindow1h'
  | 'timeWindow3h'
  | 'timeWindow6h'
  | 'timeWindow24h'
  | 'hiddenRecent'
  | 'showDoneLabel'
  | 'notifyCurrentLabel'
  | 'notifyCurrentDesc'
  | 'showSubagentsLabel'
  | 'showSubagentsDesc'
  | 'resetPos'
  | 'resetAll'

/** Simplified Chinese dictionary. */
export const zh: Record<SessionMonitorKey, string> = {
  title: '会话监控',
  runningCount: '{count} 个运行中',
  noSessions: '暂无会话',
  noRunning: '没有运行中的会话',
  running: '运行中',
  idle: '空闲',
  roundDone: '本轮完成',
  pendingInput: '等待输入',
  subagent: '子代理',
  subagentsRunning: '子×{n}',
  jobsRunning: '后×{n}',
  current: '当前',
  collapse: '收起',
  expand: '点击展开',
  resizeHint: '拖动右下角缩放',
  clearDone: '清除完成标记',
  toastTitle: '会话完成',
  toastBody: '「{title}」已完成一轮',
  interactionTitle: '需要你处理',
  interactionBody: '「{title}」正在等待你的输入或确认',
  subagentTitle: '子代理完成',
  errorTitle: '出错了',
  errorBody: '「{title}」执行出错',
  abortedTitle: '已中止',
  abortedBody: '「{title}」已被中止',
  blockedTitle: '受阻',
  blockedBody: '「{title}」被阻塞',
  maxTokensTitle: '超出 token 上限',
  maxTokensBody: '「{title}」达到输出 token 上限',
  interruptedTitle: '已中断',
  interruptedBody: '「{title}」被中断',
  jump: '跳转',
  dismiss: '知道了',
  justNow: '刚刚',
  minutesAgo: '{n} 分钟前',
  hoursAgo: '{n} 小时前',
  notifyLabel: '自动提醒',
  notifyDesc: '会话完成一轮时弹出提醒条',
  notifyModeLabel: '提醒关闭方式',
  notifyModeAuto: '自动消失',
  notifyModeConfirm: '需确认',
  autoDismissSecLabel: '自动消失秒数',
  soundLabel: '提示音',
  browserNotifyLabel: '浏览器通知',
  browserNotifyDesc: '完成一轮时同时发送系统通知（需授权，点击通知可跳转）',
  permGranted: '已授权',
  permDenied: '已被拒绝——请在浏览器站点设置中允许通知后重试',
  permAsk: '勾选后浏览器会请求通知授权',
  runningOnlyLabel: '只显示运行中',
  runningOnlyDesc: '列表只保留运行中的会话',
  timeWindowLabel: '时间范围',
  timeWindowDesc: '只保留最近一段时间内活跃的会话；运行中的会话始终显示',
  timeWindowDisabledHint: '仅显示运行中时，时间范围暂不生效；关掉「只显示运行中」后立即生效',
  timeWindowAll: '全部',
  timeWindow15m: '最近 15 分钟',
  timeWindow30m: '最近 30 分钟',
  timeWindow1h: '最近 1 小时',
  timeWindow3h: '最近 3 小时',
  timeWindow6h: '最近 6 小时',
  timeWindow24h: '最近 24 小时',
  hiddenRecent: '已隐藏 {n} 个更早的会话',
  showDoneLabel: '显示完成标记',
  notifyCurrentLabel: '提醒当前会话',
  notifyCurrentDesc: '当前会话完成一轮时也提醒',
  showSubagentsLabel: '显示子代理',
  showSubagentsDesc: '默认过滤子代理会话；开启后在列表中显示并提醒',
  resetPos: '重置位置',
  resetAll: '重置设置',
}

/** English dictionary. */
export const en: Record<SessionMonitorKey, string> = {
  title: 'Session monitor',
  runningCount: '{count} running',
  noSessions: 'No sessions',
  noRunning: 'No running sessions',
  running: 'Running',
  idle: 'Idle',
  roundDone: 'Round done',
  pendingInput: 'Waiting for input',
  subagent: 'Subagent',
  subagentsRunning: 'sub×{n}',
  jobsRunning: 'bg×{n}',
  current: 'Current',
  collapse: 'Collapse',
  expand: 'Click to expand',
  resizeHint: 'Drag the corner to zoom',
  clearDone: 'Clear done marks',
  toastTitle: 'Session finished',
  toastBody: '"{title}" finished a round',
  interactionTitle: 'Needs your attention',
  interactionBody: '"{title}" is waiting for your input or confirmation',
  subagentTitle: 'Subagent finished',
  errorTitle: 'Error',
  errorBody: '"{title}" errored',
  abortedTitle: 'Aborted',
  abortedBody: '"{title}" was aborted',
  blockedTitle: 'Blocked',
  blockedBody: '"{title}" is blocked',
  maxTokensTitle: 'Token limit',
  maxTokensBody: '"{title}" hit the output token limit',
  interruptedTitle: 'Interrupted',
  interruptedBody: '"{title}" was interrupted',
  jump: 'Jump',
  dismiss: 'Got it',
  justNow: 'Just now',
  minutesAgo: '{n} min ago',
  hoursAgo: '{n} h ago',
  notifyLabel: 'Notify',
  notifyDesc: 'Show a toast when a session finishes a round',
  notifyModeLabel: 'Dismissal',
  notifyModeAuto: 'Auto',
  notifyModeConfirm: 'Manual',
  autoDismissSecLabel: 'Auto-dismiss seconds',
  soundLabel: 'Sound',
  browserNotifyLabel: 'Browser notification',
  browserNotifyDesc: 'Also send a system notification on round completion (needs permission; click to jump)',
  permGranted: 'Granted',
  permDenied: 'Denied — allow notifications in the browser site settings, then retry',
  permAsk: 'Enabling will ask the browser for notification permission',
  runningOnlyLabel: 'Running only',
  runningOnlyDesc: 'List only running sessions',
  timeWindowLabel: 'Time window',
  timeWindowDesc: 'Keep only sessions active within the window; running sessions always show',
  timeWindowDisabledHint: 'No effect while "Running only" is on — it applies once that is turned off',
  timeWindowAll: 'All',
  timeWindow15m: 'Last 15 min',
  timeWindow30m: 'Last 30 min',
  timeWindow1h: 'Last 1 hour',
  timeWindow3h: 'Last 3 hours',
  timeWindow6h: 'Last 6 hours',
  timeWindow24h: 'Last 24 hours',
  hiddenRecent: '{n} older sessions hidden',
  showDoneLabel: 'Done marks',
  notifyCurrentLabel: 'Notify current',
  notifyCurrentDesc: 'Also notify when the current session finishes',
  showSubagentsLabel: 'Show subagents',
  showSubagentsDesc: 'Subagent sessions are filtered out by default; enable to list and notify them',
  resetPos: 'Reset position',
  resetAll: 'Reset settings',
}
