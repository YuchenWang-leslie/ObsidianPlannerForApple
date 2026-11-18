# Obsidian 插件化计划与工作指南

计划日期：2026-10-29 · 实施更新：2026-11-18

当前进度：P0–P2 已完成；P3 的本机真实同步主流程、独立原生同步及用户确认的 iPhone 到达／通知已通过；P4 当前机器的核心日常流程完成，保留额外视觉与版本边界。插件本地测试现为 45 项，类型检查和生产构建通过。P5 修复后的最终打包、签名和安装内容一致性验证已通过，GitHub 分发收尾见阶段记录。远端 CI 因平台／账户配置阻塞未启动，本次以本地验证为准。未经实际检查的故障路径和版本组合不计为通过。逐项证据见 [阶段记录](PLUGINIZATION_PROGRESS.md)。

本文件作为后续开发的任务顺序、范围和验收依据。现有 Mac App 继续可独立使用；插件作为它的 Obsidian 操作入口。先验证本机通信，再逐步迁移操作界面。遵循轻量实现原则，不提前引入服务器、数据库或通用插件框架。

## 1. 产品目标与首版范围

目标体验：用户在 Mac 的 Obsidian 里点击按钮或运行命令，选择日期范围、查看安排，然后同步到苹果提醒事项；日历为可选目标。iPhone 继续使用苹果系统 App，不需要安装插件或本项目的 iPhone App。

第一版包含：

- Mac 专用伴随插件，识别当前 Vault。
- 侧栏按钮及命令面板入口；本周、下周、自定义日期范围。
- 插件调用原生 App；系统权限和账户选择仍由 App 管理。
- 默认提醒事项、日历可选、默认提前 10 分钟、明确的日程时区。
- 来源只读、去重、更新、冲突处理，复用现有 Swift 实现。
- 未安装 App、未授权、版本不兼容等情况给出可操作提示。

首版不包含：iOS／Windows 同步端、双向回写、自动删除、后台常驻服务、定时同步、内置下载执行辅助程序、云端中转、用 Apple 账户密码直连 iCloud。

完成标准：在 Obsidian 发起一次同步后，目标条目在 Mac 正确写入；重复点击不重复创建；用户确认 iPhone 最终可见。不能把“成功唤起 App”或“请求已发送”称为同步成功。

## 2. 已有代码及复用边界

| 当前位置 | 现状 | 接入时怎么处理 |
| --- | --- | --- |
| `Sources/PlannerCore/DayPlannerParser.swift` | Markdown 解析、日期与时区运算 | 保持 Swift 为权威解析器，不在 TypeScript 再实现一套 |
| `Sources/PlannerCore/SyncMatcher.swift` | 匹配、持久记录、手动关联决策 | 保留；App 和插件必须共享历史与任务身份 |
| `Sources/ObsidianPlanner/SyncService.swift` | EventKit 写入、JSON 历史、同步结果 | 逐步从 PlannerModel 扩展中抽出执行层 |
| `Sources/ObsidianPlanner/ObsidianPlannerApp.swift` | UI、Vault 授权、权限、范围、App 生命周期 | 保留原生权限／账户界面；增加明确的插件请求入口 |
| `Resources/Info.plist` | 原生权限说明、Bundle ID | 增加 URL scheme；不能修改 Obsidian 本身的 Info.plist |
| `scripts/` 和 `Tests/` | 构建、打包及独立核心测试 | 保留现有命令，添加必要的桥接和插件检查 |

注意：现有模型把权限、界面消息和业务执行混在一起，不能直接把任意 URL 参数赋给模型后自动执行同步。现有历史根据 Vault 绝对路径的 SHA-256 定位；插件必须使用 App 确认过的同一路径，不能以 Vault 显示名称替代。

已知问题要先做基线验证：外部完成状态导致跳过、旧技术备注迁移、只提醒事项时不应依赖日历权限。过往主流程测试不能替代这些新版行为的验收。

## 3. 技术决策

### 3.1 角色分工

Obsidian 插件负责入口、范围选择、展示结果和用户操作；原生 App 负责解析、系统授权、目标选择、历史、EventKit 与真正写入。没有独立同步服务器。

```mermaid
flowchart LR
    U[Obsidian 按钮／命令] --> P[TypeScript 插件]
    P --> B[本机请求与响应]
    B --> A[Mac App]
    A --> C[Swift 解析／匹配核心]
    C --> E[EventKit]
    E --> R[苹果提醒事项／可选日历]
    R --> I[iCloud → iPhone]
    A --> B
    B --> P
```

### 3.2 分步通信，先做最小验证

**P1：仅唤起与填入范围。** 注册命令型 URL，例如 `obsidianplanner://bridge/open?protocol=1&requestId=<UUID>`。URL 只传协议和请求 ID，不携带标题、日记全文、账户信息或任意文件路径。初步请求不写入 EventKit，用户仍在 App 确认来源并点击 Sync。

**P1 已采用最小请求／响应文件。** 为使 URL 只包含请求 ID，同时可靠传入日期和 Vault 上下文，在固定的 Application Support 子目录建立 inbox/outbox。插件先原子写入 JSON，再通过 URL 唤起 App；App 只从固定目录按合法 UUID 找请求，不接受 URL 指定任意读取路径。P1 只支持 `action: open`，返回 `opened`／`needsVault`／`busy`／`failed`，不回传日程或执行同步。插件限时等待并清理本次文件，不监听 HTTP 端口或常驻轮询。P2/P3 再扩展配对、预览与写入协议，不能把本阶段的来源确认当作配对凭据。

第一版沿用 App 已授权目录读取日记。插件只传日期、时区、通知选项和 Vault 身份；不要复制整篇笔记到通信目录。用户应先保存编辑；实现时核实 Obsidian 保存行为，不能假设 API 读取的最新文本已立即落盘。若磁盘内容不一致，提示重新预览，后续再考虑按文件快照传输。

**P2 已实现配对及预览回传。** 保留协议 1 和 P1 open，新增 pair／preview。配对必须在 App 明确确认，凭据按 Vault 保存于 Mac 私有目录，不进入 Vault；原生 Preview 和插件预览共用 Foundation-only 执行入口及既有历史。插件展示分组结果、匹配／默认跳过状态、格式问题和源日记定位。历史协议见 [P2 本机预览协议](PLUGIN_BRIDGE_P2.md)。

**P3 已实现显式同步和状态查询。** sync／status 使用同一私有文件通道；新配对须明确允许 preview + sync，旧 P2 配对仍只读。App 和插件共用执行器、历史和忙碌状态；预览快照在实际写入前复核。逐条选择、结果收据、超时查询和恢复边界见 [P3 协议](PLUGIN_BRIDGE_P3.md)。

**已有 URL 命名冲突：** 当前条目 URL 使用 `obsidianplanner://sync/<vaultKey>/<taskId>` 保存身份。新增 scheme 注册后，这些链接可能被用户点击。只有 `bridge` 主机及受支持动作才允许进入请求流程；`sync` 仅识别为条目链接，不触发同步、不创建或删除对象。两类 URL 必须有分开的测试。

### 3.3 首次配对与权限

- App 为当前 Vault 做一次明确配对，由用户确认来源；保留已有目录授权和历史。
- 配对获得的随机凭据仅存在本机 App 配置与插件本地配置，不硬编码、不写入公开日志或 Git。
- 通信目录使用用户私有权限；插件使用明确的 macOS 数据目录定位方式。
- 新 Vault、凭据不符或未经配对请求不能直接写苹果账户，转到 App 设置处理。
- 深链接只负责唤起，持有某个 URL 不等于获得写入权限。
- 提醒事项与日历权限独立。仅提醒事项时无需日历权限；系统拒绝／撤销后给出相应设置路径。
- 首版采用用户主动同步；不增加与当前任务无关的权限和批准步骤。

这不是对恶意 Obsidian 插件的强隔离机制：同用户进程通常可访问用户文件。这里只避免任意网页深链接直接触发账户写入，不宣称建立完整安全边界。

## 4. 已实现的协议安排

当前协议以 [P3 协议](PLUGIN_BRIDGE_P3.md) 为准。保留 P1/P2 入口；冲突决策随 sync 传入，没有单独的 resolve 动作。

主要请求字段：

| 字段 | 含义 |
| --- | --- |
| `protocolVersion` | 独立于 App／插件版本的协议版本，首版为 1 |
| `requestId` | 每次用户操作生成的 UUID；重发沿用相同 ID |
| `action` | `open`、`pair`、`preview`、`sync`、`status` |
| `vaultKey` | 来自配对，必须匹配 App 已确认的来源 |
| `pairingToken` | 本机配对凭据，不进入回显、日志或 URL |
| `startDate`, `endDate` | YYYY-MM-DD，起止均包含 |
| `timeZone` | IANA 标识，例如 Asia/Shanghai |
| `allowSync` | pair 明确申请同步权限，缺省 false；以原生保存的授权为准 |
| `options.includeCalendar` | 默认 false |
| `options.notification` | 渠道和提前分钟数，默认 Reminders / 10 |
| `previewId` | sync 引用已审阅预览，30 分钟或 App 重启后过期 |
| `choices` | 逐条 Add／Skip／Update／Add again |
| `resolutions` | 冲突条目的关联／新建／跳过选择 |
| `syncRequestId` | status 查询的原同步 UUID；查询本身使用新的 requestId |

相对周范围在点击时转为日程时区的绝对日期。通知选项和 App 使用同一组合法值，日历关闭时不能选择 Calendar-only 通知。

响应公共字段为 `protocolVersion, requestId, status, appVersion, message`，按动作携带 pairing／preview／job，不把 App 的完整历史暴露给插件。

- 状态区别：`pending`、`paired`、`needsSetup`、`previewReady`、`running`、`completed`、`partial`、`failed`、`busy`、`interrupted`、`notFound`。
- 明确错误码：`APP_SETUP_REQUIRED`、`PERMISSION_REQUIRED`、`VAULT_NOT_PAIRED`、`UNSUPPORTED_PROTOCOL`、`SOURCE_CHANGED`。
- 每条预览返回稳定的本次定位、标题、日期时间、动作和冲突原因；仍以 Swift 的判断为准。
- 执行中按请求 ID 标记；同一请求不重复执行。App 和插件共用一个执行队列，忙时返回状态。
- 超时显示“结果尚未确认”，不自动以新 ID 再写一次；先查询原请求状态。
- 不把跨崩溃的严格 exactly-once 当成首版承诺；沿用任务映射，必要时人工检查后重试。
- 请求／响应只保留有限的近期数据。清理策略简单可解释，不能删除去重历史。

## 5. 阶段任务与验收门槛

### P0：基线与设计冻结

任务：保留当前可构建版本；确认现有测试命令；用临时 Vault 复核提醒事项默认、可选日历、去重、完成状态和备注。记录 App、Obsidian、Day Planner 与系统版本。把已知问题与插件新增问题分开。

验收：基线记录明确，原生版能正常使用；会阻塞日常同步的问题先修复。不要用清空 JSON 历史来“解决”重复或冲突。

### P1：插件外壳与原生唤起

任务：建立 TypeScript 插件，侧栏按钮、命令面板和范围弹窗；Mac 平台检查；增加 App URL scheme 及明确路由。先只唤起 App 并填入日期，不自动写入。

建议命令：`Open Apple sync`、`Preview this week`、`Preview next week`、`Choose sync range`。快捷键由用户在 Obsidian 中设置。

验收：冷启动、已运行、窗口关闭和最小化时都能打开正确窗口；未安装／旧 App 有清楚说明；点日历里的身份 URL 不触发写入。原生独立入口仍正常。

**Human in loop：** 用户在测试 Vault 安装插件，体验一次范围选择与唤起，确认这条路线值得继续。

### P2：配对、单一执行核心与预览回传

任务：从 PlannerModel 抽出无 SwiftUI 依赖的请求值类型和执行入口；保留现有 Swift 解析器；实现本地配对、请求文件、预览响应；读取当前 Vault 的正确路径及插件配置。

插件展示日期分组、安排、Create／Update／Unchanged／Conflict／Skipped。点击条目可定位源日记，但不改写内容。App 与插件显示一致的时区和选项。

验收：同一输入两端预览一致；同名 Vault 不串数据；根目录和已有受支持标题正确；不支持格式解释清楚；配对沿用已有去重历史；预览零 EventKit 写入。

### P3：插件内同步与结果

任务：在插件内提供 Sync；先预览再提交明确的同步请求；复用 App 执行逻辑和历史；按条目显示冲突并支持关联／新建／跳过。权限和账户未就绪时跳转 App 处理。

验收：创建、重复执行、改期、改标题、完成状态、部分失败重试和手动关联至少各跑一次；双击及超时不会盲目重复创建；源改变后要求刷新预览；结果区分本机写入和 iPhone 到达。

**Human in loop：** macOS 首次权限弹窗、目标账户选择，以及 iPhone 上的实际到达和通知时间。每阶段总结真实通过项和未验证项，不把模拟测试当实机结果。

**本机验收状态：** 测试 Vault 的同步配对及提醒事项／日历权限已获用户批准。已实测创建、逐条 Update／Skip、标题／时间／完成状态修改、Add again、手动 Link、全 Skip 零写入、请求重用保护、源与历史变化拦截、可选日历、冷启动 status 和独立原生同步；用户确认本版 iPhone 提醒事项／日历及通知。真实部分失败、拒绝／撤销权限没有人为制造，仅有假后端证据；不得据此称所有故障路径或严格 exactly-once 通过。

### P4：日常体验和兼容性

任务：整理英文设置页、连接状态、首次安装引导；保存插件范围等偏好；卸载／停用时结束计时器和事件监听。检查 Obsidian 主题和窗口宽度，不把原生 App 的大表单照搬进编辑器。

验收：重新加载插件、重启 Obsidian、重新启动 App、拒绝权限和撤权后行为明确；旧 App 检测、协议版本不兼容提示有效；未完成配对不展示虚假的 Connected 状态；原生版单独同步不受影响。

**本机核心日常流程完成：** 插件选择字段与 Obsidian Modal 内部 selection 的冲突已修复，并新增先失败后通过的生命周期回归；Skipped 徽标修复已在最终 CSS 重载后的宿主确认。测试 Vault 窗口关闭重开、插件停用／启用后，配对、偏好及上次结果保留，Check last sync 查回原结果且不重提。原生独立同步与 App 重启查询通过。完整退出／重启 Obsidian、额外浅色主题、600px 窄窗和本版源链接新宿主复测未完成；P2 源定位已有历史实测。以上额外检查不作为核心同步阻塞。系统撤权仍仅由自动替身覆盖；既有三份同步历史最终摘要不变，App 已恢复原工作来源及默认选项。

### P5：打包、文档与分发

任务：先 GitHub 手动安装测试，验证后再考虑社区目录。写清“插件需要另装 Mac App”、平台限制、权限、通信数据和许可证。插件版本、App 版本、协议版本分别管理。

验收：从下载附件开始安装并完成一次端到端同步；安装资料齐全，无私人测试数据、配对凭据或真实日记。App 仍按未经 Apple 公证的实际状态描述。

**Human in loop：** 测试版反馈、社区提交账户操作、许可条款调整，以及任何付费签名／公证账户设置。当前计划不代表社区审核保证通过。

**当前分发状态：** 宿主修复后的最终包已重新构建，全部发行文件与实机安装逐字节一致。App 0.5.0 / build 6、插件 0.3.0、tag v0.5.0-beta.1；GitHub 附件和下载复核结果以阶段记录为准。远端 CI 未启动，不计为通过，本次使用用户已确认的本地验收路线。

## 6. 建议目录与版本安排

先在现有仓库开发 `plugin/`，便于一起验证协议，不立刻创建新仓库。示意：

```text
plugin/
  src/main.ts
  src/settings.ts
  src/range-modal.ts
  src/sync-view.ts
  src/bridge-client.ts
  manifest.json
  package.json
  tsconfig.json
  styles.css
Sources/PlannerCore/               # 解析、匹配、共享请求值类型
Sources/ObsidianPlanner/Bridge/    # 原生路由、配对、请求响应
Tests/                            # 核心与桥接测试
scripts/                          # 现有脚本与后续插件构建脚本
```

实际文件按需要创建，避免为简单功能预先建立大量空层。

社区分发前建议另设插件专用仓库：官方目录读取默认分支根目录的 manifest，插件 tag 必须与 manifest 的 x.y.z 一致；App 当前使用 v0.1.0-beta.2 一类标签，不能直接套用为社区插件版本。拆分时只带当前组合许可的插件代码，不重新引入已经移除的公开历史。创建新仓库、迁移及发布须在相应工作阶段执行，不在本计划阶段创建。

拟议 ID 为 `day-planner-apple-sync`，名称为 `Day Planner Apple Sync`；唯一性及最终命名需提交前检查。`isDesktopOnly: true` 不等于仅限 Mac，插件仍须做 macOS 检查，在其他桌面系统显示不支持而非执行本机桥接。

## 7. 测试工作指南

先保持现有检查可运行：

```sh
./scripts/test-core.sh
./scripts/build-app.sh
```

P1 已提供以下插件检查与本地打包命令（Node 24+）：

```sh
cd plugin
npm ci
npm test
npm run typecheck
npm run package
```

原生唤起还可使用 `scripts/test-bridge-open.mjs` 做只读集成检查；参数和手动安装步骤见 [插件 README](../plugin/README.md) 及 [阶段记录](PLUGINIZATION_PROGRESS.md)。

P2 另提供 `scripts/test-bridge-preview.mjs` 验证已配对的原生预览及历史不变，`scripts/test-preview-parity.sh` 比较完整预览响应与共享 Swift 核心。它们不会点击 Sync 或授权 EventKit；具体命令见阶段记录。

新增高价值检查：协议序列化、范围及时区、URL 路由、非法／重复请求、源变化、同一任务由 App 与插件交替同步、历史兼容与冲突决策。桥接文件用临时目录、EventKit 用测试替身；权限和真实账户另做手动验收。

手动测试矩阵：

| 场景 | 期待结果 |
| --- | --- |
| App 未安装或协议不支持 | 给出安装／升级入口，不假报完成 |
| App 冷启动／窗口已关闭 | 打开预览并处理同一请求 |
| 只提醒事项，日历未授权 | 可以同步提醒事项 |
| 勾选日历但未授权 | 转到原生授权，不误报没有 iCloud |
| 两个同名 Vault | 身份和历史独立 |
| 从 App 切到插件再同步相同安排 | 沿用映射，不重复创建 |
| 编辑未保存或预览后再次编辑 | 明确使用的快照，变化则重新预览 |
| 插件停用、重载、超时 | 停止观察；保留可查询的原请求状态 |
| 快速双击、App 已在执行 | 一次执行或明确 busy，不并发写历史 |
| 点击已导出的条目 URL | 不产生同步副作用 |
| 日志与发行包检查 | 没有真实日记、私人路径、配对凭据 |

每完成一阶段，记录：改了什么、真实执行的命令／场景、通过结果、未验证项、下一阶段依赖。无需为视觉间距等低影响修改编写机械测试。

## 8. 分发、许可与待确认事项

当前仓库采用 MIT + Commons Clause；插件沿用当前组合条款，并随包保留完整许可。不要把插件宣传为仅 MIT 或 OSI 开源。社区目录的具体政策、所需权限说明和外部 App 依赖应在提交前复核，不假定其一定接受当前方案或当前条款。若发生冲突，向用户说明后再决定分发路线，不自行改许可证。

依赖尽量使用官方 Obsidian API、TypeScript 和少量构建工具。运行时依赖及素材要核对其许可证；不得把本项目限制错误地覆盖第三方自身的授权。

P0 的账户基线、P1 唤起、P2 配对和只读预览，以及 P3 的上述本机真实同步与本版 iPhone 反馈均已有证据；故障注入与兼容性边界见阶段记录。当前仍要求先保存编辑；没有跨崩溃严格只执行一次的保证。其他 macOS／Obsidian 版本、最低系统组合和其他机器的首次打开仍待验证。是否把账户设置搬到插件、是否自动同步，均不属于本次范围。

## 9. 当前交付与后续范围

1. 已记录设置收尾及既有历史摘要不变。P4 本机核心日常流程已完成，额外视觉与跨版本检查保留为未验证边界。
2. 最终包已完成签名、ZIP、SHA-256 及实机安装内容一致性检查；分发和下载记录见阶段记录及 GitHub Release。
3. 分发采用现有 GitHub 仓库的手动安装测试版；社区目录、新仓库、付费签名和公证不在本次范围。远端 CI 外部限制解除后再重跑；当前不声称它通过。
4. 继续保留既有历史及匹配器的保守规则，不通过重置历史解决冲突。后续匹配策略改动单独验证。

插件仍只在独立测试 Vault 安装，未改动工作 Vault 的插件配置。App 0.5.0 / build 6、插件 0.3.0、协议 1；发布状态见阶段记录及 GitHub Release。

## 10. 官方参考

以下资料于 2026-10-29 核对；具体 API 与政策在相应阶段再次验证。

- [Obsidian：提交插件](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin)：根目录 manifest、版本/tag 对应、发行附件与社区审核。
- [Obsidian：移动端开发](https://docs.obsidian.md/Plugins/Getting%20started/Mobile%20development)：Node/Electron 移动端限制、桌面声明和平台检测。
- [Apple：EventKit 访问](https://developer.apple.com/documentation/eventkit/accessing-the-event-store)：原生日历／提醒事项权限模型。

上述资料不代表社区目录已接受本项目的外部原生组件。当前实现协议见 [P3 协议](PLUGIN_BRIDGE_P3.md)，P2 文档保留为历史兼容性记录。
