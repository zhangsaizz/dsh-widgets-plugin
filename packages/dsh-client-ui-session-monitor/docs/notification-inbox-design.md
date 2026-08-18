# 桌面端会话监控「通知列表」重构设计

> 状态：**已按本稿实现（Phase 1–3 完成，2026 版）** · 范围：桌面挂件（Tauri 小窗 +
> `/_dsh/session-monitor/widget` 页面）为主，网页端仅做数据共享所需的配合改动。
> 配套原型：`inbox-prototype.html`（320×560 挂件模拟，可点击验证交互）。
> 实现与初稿的偏差见 §12。

---

## 1. 背景与目标

### 1.1 现状

桌面挂件 = **会话状态列表 + 瞬时 toast**：

- 主视图是会话列表（圆点状态、标题、子代理/待审批徽标、相对时间），点击行跳转会话；
- 通知靠「running true→false 边沿」触发的 toast，自动模式 8 秒消失，confirm 模式最多堆 12 条；
- 数据源：`/_dsh/session-monitor/sessions`（2s 轮询快照）+ `/_dsh/session-monitor/status`（3s 轮询 turn/end 原因）。

### 1.2 重构目标

> 主功能从「会话状态列表」重构为**「会话各类通知列表」**，持久、分级、可已读，
> 真正承担「提醒用户去处理」的职责。

- **持久**：窗口隐藏/人离开期间发生的事件，回来打开就能看到；
- **分级**：需要用户处理的（审批/回答/审计划/出错/阻塞/Token 上限）与仅供参考的（完成一轮/子代理完成）区分开；
- **可已读**：未读/已读/忽略/全部已读，已读状态跨重启、跨端（桌面 ↔ 网页）一致；
- **不丢定位**：会话监控本身的能力（看谁在跑、谁空闲）保留为副视图。

### 1.3 非目标

- 不改网页版主界面（网页版保持列表 + toast）；
- 不做跨进程推送（系统通知中心、托盘闪动等）——列为可选的后续阶段；
- 不引入新的 peer 依赖（沿用现有 `ctx.sessions` 事件日志 + webServer 路由模式）。

---

## 2. 现状诊断：为什么必须重构

| # | 缺口 | 后果 |
|---|---|---|
| 1 | **toast 瞬时消失** | 自动模式 8s、confirm 模式窗口内堆叠，离开/隐藏期间的事件零留存，「提醒」不可靠 |
| 2 | **无待办语义** | 没有未读/已读、没有优先级；「等待审批」只是列表里一个小圆点，没有「还有 N 件事没处理」的感知 |
| 3 | **最高价值项反而最弱** | `question` / `plan-review` 是**客户端瞬态状态**，从不进 host 日志（`desktop-snapshot.ts` 注释明确说明），桌面快照拿不到——「等你回答/等你审计划」这类最该提醒用户的事，桌面端完全看不见 |

---

## 3. 核心概念模型

### 3.1 双通道

- **toast = 提醒「响了」**（瞬时、抢眼）——保留现状；
- **inbox 通知列表 = 提醒「还没处理完」**（持久、可已读）——本次重构目标。

两者同源：一次事件既弹 toast（可选）也写入 inbox（按 kind 开关）。toast 负责当下打扰，
inbox 负责事后兜底。

### 3.2 一主一副

窗口 320×560 布局不变，主视图默认落在新通知列表，会话列表降级为第二个 Tab：

```
┌─────────────────────────────┐
│ ● 待处理 [3]  待处理│会话  📌 ⚙ ✕ │  ← 头部：标题 + 未读徽标 + Tab + 按钮
├─────────────────────────────┤
│ ▎⏳ 等待审批                    │  ← 通知行（P0）
│   重构计划 · 3 分钟前    [处理][忽略]│
│ ▎✕ 本轮出错                     │
│   数据迁移脚本 · 12 分钟前 [处理][忽略]│
│ ▎✓ 完成一轮 · 第 5 轮            │
│   余额看板联调 · 1 小时前  [处理]   │
│ …                             │
│ ── 已读 (2) ▸                  │
├─────────────────────────────┤
│ ✓ 没有需要处理的事项（空态）        │
└─────────────────────────────┘
```

### 3.3 通知 = 事件 + 状态

一条通知是**一次可识别的事件**，不是会话的当前状态（同一会话可以有多条未处理通知）。

```ts
interface InboxNotification {
  id: string            // 稳定 ID（幂等键派生），ack 用
  sessionId: string
  kind: NotifyKind      // 见 §4
  title: string         // 事件时刻的会话标题（快照，不随会话改名而变）
  round?: number        // 第几轮（turn/end 类）
  at: number            // 事件发生时间（epoch ms）
  ackedAt?: number      // 已读时间；无 = 未读
  resolved?: boolean    // 已消散（如审批已决定），仍保留供查看
}
```

---

## 4. 通知类型与优先级

| kind | 中文标签 | 优先级 | 数据来源 | 默认 |
|---|---|---|---|---|
| `approval` | 等待审批 | **P0 需要处理** | host 日志 `approval/asked`→`approval/decided`（现有） | 开 |
| `question` | 等待回答 | **P0 需要处理** | host 检测 `ask_user_question` 工具调用（+ 网页 relay 备份） | 开 |
| `plan-review` | 等待审阅计划 | **P0 需要处理** | host 检测 `exit_plan_mode` 工具调用（+ 网页 relay 备份） | 开 |
| `error` | 本轮出错 | **P0 需要处理** | turn/end reason | 开 |
| `blocked` | 已阻塞 | **P0 需要处理** | turn/end reason | 开 |
| `max-tokens` | Token 上限 | **P0 需要处理** | turn/end reason | 开 |
| `subagent` | 子代理完成 | P1 值得看 | host 推导（运行中子代理数下降） | 开 |
| `done` | 完成一轮 | P1 值得看 | turn/end reason（completed/未知） | 开 |
| `aborted` / `interrupted` | 已中止 / 已中断 | P1 值得看 | turn/end reason | 开 |
| `title` | 标题变更 | P2 信息流 | host 日志 `session/title` | 关 |
| `new-session` | 新会话创建 | P2 信息流 | host 日志 会话创建 | 关 |

**排序**：P0 → P1 → P2，同档内按时间倒序（新在上）；可选「按会话分组」。

**颜色**：直接沿用现有 10 套 toast accent 配色（`approval` 橙 / `question` 蓝 / `plan-review` 紫 /
`error` 红 / `blocked` 橙 / `max-tokens` 青 / `done` 黄 / `subagent` 紫 / `aborted` 灰 / `interrupted` 蓝灰），
视觉零学习成本。

---

## 5. 数据层设计（关键决策）：Host 权威通知日志

**不要**在桌面端 diff 快照自行推导通知：webview 重启即丢、没有已读、且 desktop 与浏览器
存储分区不互通。改为 **Host 半持有权威通知存储**，桌面与网页都从它读。

### 5.1 存储

- 内存环形缓冲（上限 ~200 条）+ 持久化到 harness settings 文档（与现有
  `desktop-settings.ts` 的 `session-monitor` 命名空间同源，`ctx.settings` 读写），
  重启不丢、已读不丢；
- 幂等键 `(sessionId, kind, round)`：同一轮同一种类只产生一条，轮询/重复事件天然去重；
- 自动归档：已读超过 N 天（默认 7）或总量超上限时裁剪。

### 5.2 事件来源（5 路）

| 来源 | 事件 | 说明 |
|---|---|---|
| 现有监听 | turn/end reason | 升级现有 `session/event` 监听：把 reason 表扩展为**通知记录**（`done`/`error`/`aborted`/`blocked`/`max-tokens`/`interrupted`） |
| 现有日志 | `approval/asked` / `approval/decided` | 生成 `approval` 通知；`decided` 时置 `resolved`（不删除，保留查看） |
| **新增：host 检测** | `ask_user_question` / `exit_plan_mode` 的 `tool/call` → `tool/result` | question / plan-review 的权威来源（见 §5.3） |
| **新增：网页端 relay** | `question` / `plan-review` open/closed | 冗余备份（`pushInteraction` 幂等，不重复） |
| host 推导 | `subagent` 完成 | 子代理最后一个回合结束（turn 深度归零 → 父会话通知） |

### 5.3 补盲区：question / plan-review 的检测

`question` / `plan-review` 是客户端 `useSessions` 投影里的瞬态状态，不写会话日志。
但这两类等待**必然经由模型工具调用进入**，所以 Host 可以自己看到（不依赖网页开着）：

- `ask_user_question` 的 `tool/call` → 记一条 `question`；`arguments` 里的
  `intent.kind === 'plan-review'` 时记 `plan-review`（与客户端同一判定）；
- `exit_plan_mode` 的 `tool/call` → 记一条 `plan-review`（计划审阅是 plan-mode 经
  `ctx.userQuestions.ask()` 发起的提问，入口正是 `exit_plan_mode` 工具）；
- 对应 `tool/result`（用户已回答/已决定）或 `turn/end`（回合结束 = 等待终结）→ resolve。

网页客户端半的 relay 保留为**冗余备份**（`pushInteraction` 按 `(sessionId, kind)`
幂等，双路径不重复）。**纯桌面使用（网页未开）也能看到这两类 P0**，初稿盲区已关闭。

### 5.4 已读状态共享

`ackedAt` 存 Host → 桌面 webview 重启不丢，且天然与网页版共享（与现有「设置经 Host 中转」
是同一模式）。网页版后续可加同源未读角标，数据同一份。

---

## 6. API 设计

沿用现有路由的宽松 CORS 与 `{ ok, value }` envelope 约定：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/_dsh/session-monitor/notifications` | 全量快照 `{ seq, unread, notes }`（v1 不做增量；客户端按记录签名 diff） |
| POST | `/_dsh/session-monitor/notifications/ack` | body `{ ids?: string[] }` / `{ sessionId?: string }` / `{ all?: true }`，返回 `{ ok, count }` |
| POST | `/_dsh/session-monitor/events` | 网页端 relay：body `{ sessionId, kind: 'question'\|'plan-review'\|'new-session', state: 'open'\|'closed', title? }`，host 幂等落库（open 时有未决记录则 no-op，closed 时 resolve） |
| GET | `/_dsh/session-monitor/status` | 不变（原因表仍供 toast 用） |
| GET | `/_dsh/session-monitor/sessions` | 不变（会话 Tab 用） |

桌面轮询节奏：通知 2s 全量拉取（与现状一致），ack 即时 POST；全部无状态、可重试。

---

## 7. UI 设计（桌面挂件）

### 7.1 头部

- 标题「待处理」+ **未读徽标**（如 `[3]`，0 时隐藏）；
- Tab 分段控件：「待处理」|「会话」（会话 Tab = 现有列表原样迁入，含筛选/排序/跳转）；
- 保留 📌 置顶 / ⚙ 设置 / ✕ 隐藏。

### 7.2 通知行（待处理 Tab）

```
[3px accent 条] [图标] 等待审批                      ← kind 标签（accent 色）
                重构计划 · 3 分钟前       [处理] [忽略] ← 会话标题快照 · 相对时间
```

- 未读：accent 条亮 + 左侧小圆点；已读：accent 变淡、整体降透明，可折叠进「已读 (N) ▸」区；
- 操作：「处理」→ 走现有 jump 队列跳转会话（approval 场景用户到网页端点批准），
  默认**跳转后自动已读**；「忽略」→ ack 单条；
- 底部「全部已读」（P0 清零是核心反馈）。
- 相对时间沿用现有 `relTime`（刚刚 / N 分钟前 / N 小时前 / 日期）。

### 7.3 空态

「✓ 没有需要处理的事项」——空态本身即 inbox 的价值证明。

### 7.4 新增设置

**共享设置**（经 Host，`MonitorSettingsWire` 新增两字段；网页配置面板同步提供）：

| 字段 | 默认 | 说明 |
|---|---|---|
| `ackOnJump` | true | 点「处理」跳转后自动已读 |
| `autoAckOnOpen` | false | 打开窗口时自动全部已读（默认关——打开即提示是核心价值） |

**桌面独有**（localStorage 缓存，同刷新间隔）：三个**级别开关**（而非逐 kind）——
「需要处理（P0）/ 值得看（P1）/ 信息流（P2）」默认 P0+P1 开、P2 关。
归档保留时长是 Host 常量（7 天），不做设置项。

---

## 8. 与现有功能的关系 / 迁移

| 现状 | 重构后 |
|---|---|
| 会话列表（主视图） | 迁入「会话」Tab（副视图），逻辑零改动 |
| toast（瞬时） | 保留；事件发生时同时写入 inbox（按 kind 开关） |
| turn/end reason 表（内存） | 升级为通知存储（持久化 + ack） |
| 设置经 Host 共享 | 不变；已读状态同模式新增共享 |
| 桌面独有刷新间隔设置 | 不变 |

---

## 9. 实施路径（阶段划分，供后续执行）

- **Phase 1 — Host 通知存储**：新 `src/desktop-notifications.ts`（存储 + 幂等 + 归档 +
  ack），4 条路由挂进现有 apply（`webServer` 可选注入）；升级 turn/end 监听写入通知；
  扩展 `MonitorSettings` 与 schema 增加 §7.4 字段。
- **Phase 2 — 网页端 relay**：`src/client/index.ts` 检测 `pendingInteraction` 出现边沿，
  debounce POST `/_dsh/session-monitor/events`（约 20~40 行）。
- **Phase 3 — 桌面 UI 重构**：`widget-page.html` 增加 Tab 结构 + 通知列表渲染 + ack 交互 +
  未读徽标 + 新增设置项；会话列表逻辑原样迁入副 Tab。
- **Phase 4 — 可选**：网页版同源未读角标；Tauri 托盘图标未读数（需 host 提供 unread count
  端点 + tray 图标动态更新）。

---

## 10. 风险与权衡

- **question/plan-review 检测依赖工具调用事件**（host 检测路径）：`tool/call` 一定会
  写入会话日志（这是事件溯源的核心），故纯桌面可见；若未来这两类等待改走非工具入口，
  relay 备份仍覆盖网页场景；
- **通知量噪声**：P2 默认关 + 自动归档兜底；完成一轮高频会话可关掉 P1 的 `done`；
- **存储写入频率**：通知存储的持久化用 debounce（如 1s），避免 2s 轮询写放大；
- **冷会话（cold）**：已持久化会话的事件不产生新通知（没有新活动）；通知只反映
  当前进程内观察到的事件，与现有快照语义一致。

---

## 12. 实现与初稿的偏差

1. **逐 kind 开关 → 三个级别开关**（§7.4）：UI 更紧凑，级别与优先级模型一一对应；
   逐 kind 细粒度留待有真实需求再加。
2. **`inboxRetentionDays` 设置项 → Host 常量 7 天**：归档时长对用户价值低，少一个设置项。
3. **增量拉取（`since` 游标）→ v1 全量快照**：记录上限 200、本机回环，
   全量 + 客户端签名 diff（与会话列表同款机制）足够；`since` 留给未来网页端角标。
4. **relay 补 `state: 'closed'`**：网页端在 `pendingInteraction` 消失边沿上报 closed，
   host 将记录置 `resolved`（显示「已处理」标签），避免「等你回答」的记录永久悬挂。
5. **`subagent` 通知由「运行中子代理数下降」改为「子代理最后一个回合结束」**：
   在 `session/event` 上维护每会话 turn 深度，子代理会话 `turn/end` 使深度归零时才通知其
   父会话——事件驱动、无需轮询快照。
6. 网页端配置面板新增两个共享开关（ackOnJump / autoAckOnOpen）的标签文案。
7. **question / plan-review 从「网页 relay 唯一来源」升级为「host 工具调用检测为主、
   relay 为备份」**（§5.3）：`ask_user_question` / `exit_plan_mode` 的 `tool/call` →
   `tool/result` 边沿即等待的生命周期；初稿 §11.1 的纯桌面盲区由此关闭，relay 保留
   幂等备份（双路径经 `pushInteraction` 去重，不会重复入账）。
8. **网页版落地为「未读徽标」而非完整 inbox**（§11.4）：挂件头部 + 收起胶囊显示
   未读数（5s 轮询 `/notifications`），点击跳到最新一条未读会话；网页版不做完整
   通知列表（处理面在桌面挂件），已读状态仍 Host 同源共享。

---

## 11. 待确认问题（原型评审时逐条过）

1. ~~**question / plan-review relay 依赖网页端在线**~~ —— **已解决**：host 端经
   `ask_user_question` / `exit_plan_mode` 工具调用检测，纯桌面可见；relay 降级为备份。
2. **是否默认按会话分组**（通知多时）还是坚持扁平时间线？（当前实现：扁平时间线）
3. **P1 的 `done`（完成一轮）默认是否进 inbox**？高频会话可能刷屏（当前实现：P1 默认开，
   级别开关可关）;
4. ~~**网页版是否同步加 inbox**~~ —— **已落最小形态**：网页挂件头部与收起胶囊显示
   **未读徽标**（5s 轮询 `/notifications`，点击跳到最新一条未读会话；完整 inbox 不在
   网页版做——桌面挂件是处理面）；已读状态仍经 Host 同源共享。
5. 已读通知保留时长默认 7 天是否合适。
