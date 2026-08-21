/**
 * `rainbow-flow` dictionary namespace (owned by this plugin, registered with
 * the locale service). Product copy is Chinese-first; the en dictionary is
 * the fallback. The `LocaleNamespaceMap` merge is declared at registration
 * (`./index.ts`), which types `t('key')` against these keys.
 *
 * @module @dsh-plugins/client-ui-rainbow-flow/client/locales
 */

/** Dictionary keys of the `rainbow-flow` namespace. */
export type RainbowFlowKey =
  | 'toggleOn'
  | 'toggleOff'
  | 'running'
  | 'idle'
  | 'opacityLabel'
  | 'opacityHint'
  | 'speedLabel'
  | 'speedHint'
  | 'moodLabel'
  | 'moodHint'
  | 'on'
  | 'off'
  | 'percent'
  | 'reset'

/** Simplified Chinese dictionary. */
export const zh: Record<RainbowFlowKey, string> = {
  toggleOn: '关闭彩虹流光',
  toggleOff: '开启彩虹流光',
  running: '运行中',
  idle: '空闲',
  opacityLabel: '光效透明度',
  opacityHint: '整体亮度',
  speedLabel: '速度灵敏度',
  speedHint: '模型输出越快，光晕呼吸得越快',
  moodLabel: '思考冷色调',
  moodHint: '思考/调用工具时光晕偏蓝紫',
  on: '开',
  off: '关',
  percent: '%',
  reset: '重置默认',
}

/** English dictionary. */
export const en: Record<RainbowFlowKey, string> = {
  toggleOn: 'Turn off rainbow flow',
  toggleOff: 'Turn on rainbow flow',
  running: 'running',
  idle: 'idle',
  opacityLabel: 'Opacity',
  opacityHint: 'Overall effect brightness',
  speedLabel: 'Speed sensitivity',
  speedHint: 'How much the halo breathing follows the output-token rate',
  moodLabel: 'Thinking cool tint',
  moodHint: 'Shift the halo blue/violet while thinking or calling tools',
  on: 'On',
  off: 'Off',
  percent: '%',
  reset: 'Reset to defaults',
}
