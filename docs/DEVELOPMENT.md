# ObsidianPlanner 开发文档

版本：0.1 · 日期：2026-10-29 · 状态：原始设计基线；当前实现与验收记录见 [PROGRESS.md](PROGRESS.md)。

开发调整：按用户要求保持轻量，首版采用 Swift Package 和本地 JSON 映射；SQLite、完整恢复框架和删除暂缓；冲突绑定界面已实现。公开发布按用户决定暂缓。下文未实现内容仍是设计目标，不代表已经具备。

## 1. 目标与已确认需求

用户在 Mac 的 Obsidian Day Planner 中安排工作，一键导出指定时间段，在 iPhone 的系统日历／提醒事项中查看。Obsidian 为来源，第一版仅单向同步，不要求同步 Vault，也不开发 iPhone App。

已确认：

- 两台设备使用同一个 Apple 账户，已开启 iCloud 日历和提醒事项。
- 每条受支持的日程同时生成日历事件与提醒事项，均归入 DayPlanner。
- 支持本周、下周、自定义起止日期，包括过去与未来；周一开始。
- 首次设置后支持一键同步，可选预览。
- 每次同步可选择是否通知，默认提前 10 分钟。
- App 界面使用英文，未来通过 GitHub Releases 分发。

成功标准：Mac 上新增、修改一条安排并同步后，iPhone 可通过苹果自身同步看到对应安排；再次执行不会重复创建。App 只报告本机 EventKit 写入结果，不把它表述为 iPhone 已接收。

## 2. 已核实的输入与边界

2026-10-29 只读检查了用户指定的日记和插件配置，未修改 Vault，未批量读取其他日记。示例内容以下使用虚构标题，公开仓库不保存真实工作内容或个人绝对路径。

```markdown
# Day planner

- [ ] 10:40 - 11:30 Example work session
```

- 日记位于 Vault 根目录，同级文件命名为 `YYYY-MM-DD.md`。
- 安装的 Day Planner 为 0.28.0。
- `plannerHeading = Day planner`；`plannerHeadingLevel = 1`。
- `timestampFormat = HH:mm`；`firstDayOfWeek = monday`。
- `defaultDurationMinutes = 30`；`extendDurationUntilNext = false`。
- `showCompletedTasks = true`。

以上仅证明该样例和配置，不代表已验证所有历史日记的语法。当前开发机报告 macOS 27.0.1；最低支持版本拟为 macOS 14，需实机或测试环境验证。iPhone 系统版本尚未提供。

## 3. 建议默认值（产品设计，尚非逐项确认）

| 项目 | 第一版建议 |
| --- | --- |
| 默认范围 | This Week；按设置的日程时区计算周一至周日 |
| 日程时区 | 首次采用系统时区并保存，可修改；本用户预期 Asia/Shanghai |
| 同步对象 | 有明确开始和结束时间的日程；其他格式显示跳过原因 |
| 已完成条目 | 默认包含；提醒事项写入完成状态；日历保留事件 |
| 过去条目 | 在所选范围内正常导出，不为已过通知时间生成新的闹钟 |
| 通知渠道 | 默认 Reminders，提前 10 分钟；可选 Calendar、Both、None |
| 删除 | 默认保留；用户启用 Remove missing entries 后必须预览确认 |
| 触发方式 | 手动同步；第一版不包含定时同步、文件监控、菜单栏入口 |
| Vault | 第一版一个；通过系统目录选择器选择，不硬编码路径 |

两端同时创建条目与两端同时通知是两个选项。选择 Both 时明确提示可能产生重复通知。以上默认值应在设置和同步摘要中可见。

## 4. 用户流程与界面

### 首次设置

1. **Choose Vault**：选择目录；默认日记路径为根目录，日期格式固定为 `YYYY-MM-DD`。
2. 读取允许范围内的插件配置，仅用于建议标题和时间格式；缺失时使用上述默认值。未知格式给出提示。
3. **Grant Calendar Access / Grant Reminders Access**：解释需要读取以查找、更新本 App 已创建的条目，并请求权限。
4. **Choose iCloud Destinations**：分别选择可写的 iCloud 日历来源和提醒事项来源，创建或明确选择名为 DayPlanner 的日历／列表。
5. 设置日程时区。保存目录授权与目标标识。

不要依赖系统默认日历，也不要把本地 On My Mac 容器当成可跨设备同步的目标。两类容器需要分别验证可写性；同名容器不等于同一容器。多个同名目标需用户选择，不自动合并。

### 日常同步

- 主界面：范围选择 `This Week / Next Week / Custom`、日期选择器、通知开关与提前分钟数、渠道选择、`Preview`、`Sync`。
- 自定义起止日期均包含；结束早于开始时阻止执行。
- `Preview` 展示日期、时间、标题、来源文件／行号、Create／Update／Unchanged／Skipped／Conflict，以及拟删除项。
- 普通新增和确定更新可一键执行。身份匹配不确定、覆盖手机修改、删除等情况进入预览处理。
- 结果分别显示 Calendar 和 Reminders 的成功／失败数量，提供 `Retry Failed`。
- 展示最近一次本机同步时间和范围，说明 iCloud 交付受系统和网络状态影响。

## 5. Markdown 解析规范

第一版严格支持根目录下有效的 `YYYY-MM-DD.md` 文件。只解析配置标题所在节，遇到同级或更高级标题结束；排除代码块和注释内容。重复同名目标节报告歧义，不默默混合。

支持：`- [ ] HH:mm - HH:mm Title` 和 `- [x] HH:mm - HH:mm Title`（兼容大写 X）。允许常规空白；标题必须非空。保留 UTF-8 标题，源文件只读。预览可保留 Markdown 原文，第一版不承诺富文本或链接转换。

- 日期必须有效，时间必须为 00:00–23:59。
- 结束时间必须晚于开始时间；跨午夜、零时长、只有开始时间、无时间任务、嵌套任务、其他复选框状态第一版跳过并解释。
- 不根据插件默认 30 分钟擅自补全缺失时间。上述变体可在后续版本独立支持。
- 相互重叠的有效安排允许导出，同时提示重叠；同一内容重复出现不能擅自合并。
- 某日无文件或无目标节可视为没有可导出的安排，但不能据此自动删除已有远端条目。
- 文件读取失败、编码错误、解析异常单独报告，该文件不可参与删除推断。
- 日期范围转为日程时区中的半开时间区间 `[startOfFirstDay, startOfDayAfterLastDay)`，通过 Calendar 日期运算处理，禁止简单加固定 86400 秒。
- 夏令时不存在或重复的本地时间进入冲突提示，不默默调整。

建议解析结果：`relativePath, date, lineNumber, rawText, title, start, end, isCompleted, timezone`。文件和行号仅用于定位，不能充当稳定身份。

## 6. 数据映射

| 来源 | Calendar（EKEvent） | Reminders（EKReminder） |
| --- | --- | --- |
| 标题 | title | title |
| 日期与时间 | startDate、endDate、timeZone | startDateComponents、dueDateComponents 取安排开始时间并包含时区 |
| 结束时间 | 事件结束 | 附加到受管理的 notes 信息中 |
| 完成状态 | 不伪造事件完成状态 | isCompleted；未知实际完成时间不声称来自日记 |
| 来源标记 | notes 中的 App 标记和任务 UUID | 同样标记 |
| 通知 | 选中该渠道时开始前 N 分钟 | 选中该渠道时开始前 N 分钟 |
| 容器 | DayPlanner 日历 | DayPlanner 提醒事项列表 |

不创建参与人、邀请、重复规则或任务优先级。Reminder 到期时间选开始时间是为了在计划开始时提示，而不是声称有截止期限。系统可能仍有自身通知行为，需验收实际设备表现。

## 7. 同步身份、修改与删除

### 核心约束

同一来源条目对应一对目标对象，重复同步应幂等。不写入或改造 Markdown。日历和提醒事项写入不能假定具备跨两类对象的原子性。

### 本地状态

建议本地 SQLite 保存版本化状态与操作日志，位于 Application Support。保存 Vault UUID、任务 UUID、相对来源路径、上次规范化内容与哈希、两个目标 ID、目标容器 ID、上次写入字段快照、各目标状态、操作批次 UUID。目录授权以 security-scoped bookmark 保存。该状态和真实日记不进入 Git。

远端 notes 使用可识别的版本化命名空间标记，例如 `ObsidianPlanner:v1:<vaultUUID>:<taskUUID>`；标记之外的用户备注应保留。不上传完整日记或本机绝对路径。

### 无源文件稳定 ID 的匹配限制

标题和时间都可被编辑，因此内容哈希不能单独当永久身份；行号也会变化。

1. 首先按已有映射和内容快照精确匹配，哈希仅用于变化检测。
2. 唯一候选且仅时间改变或仅标题改变时可提出更新；重复条目、标题和时间同时改变、跨日移动等进入歧义处理。
3. 预览提供 `Link to existing` 或 `Create as new`，确认后维护任务 UUID。
4. 完全相同的重复条目保留独立身份；若无法确定哪个被修改，要求解决冲突，不能静默猜测。

这是只读 Markdown 方案的明确局限。未来可选择性支持用户已有的 Obsidian block ID，但不作为第一版前提。

### 目标查找与恢复

目标 ID 是快速查找线索。查找失败时检查原受管容器和已知日期范围内的归属标记，必要时执行有界分段恢复扫描；不得仅凭标题认领用户事件。重装、清空状态或外部删除标记时不能保证自动恢复，需要恢复向导或人工确认，不能盲目重建全部任务。

### 更新和手机修改

- Obsidian 的字段变化更新已确定匹配的两个目标。
- 来源未变化时不重新写入目标，避免每次同步重置手机上的完成状态。
- 如果本次拟写字段与上次 App 写入值不同，且手机端也发生变化，预览明确展示冲突，由用户选择覆盖或暂时跳过；不回写 Markdown。
- 修改通知选项时仅更新本 App 管理的通知，避免丢失用户添加的其他闹钟。
- 手机删除受管对象、目标容器消失或被替换时提示修复，不静默重建或切换容器。

### 删除

默认不删除。开启删除功能时只允许删除：属于当前 Vault、具有有效归属标记、来自本次成功解析范围、并且已在预览确认的条目。跳过／过滤条目不能视为删除。文件缺失、标题节缺失、解析失败及身份不明都禁止自动推断删除。取消或缩小日期范围不删除范围外条目。

## 8. EventKit 与系统集成

使用 SwiftUI + EventKit 原生 macOS App，无服务器或自建 iCloud 同步层。EventKit 访问日历与提醒事项；苹果系统处理账户同步。读取以实现去重和更新，因此日历仅写权限不足。采用支持完整访问权限 API 的系统版本，初始最低目标拟为 macOS 14。[Apple：Accessing the event store](https://developer.apple.com/documentation/eventkit/accessing-the-event-store)

计划使用 `requestFullAccessToEvents` 与 `requestFullAccessToReminders`，配置相应隐私说明。沙盒构建检查 `com.apple.security.personal-information.calendars` 和用户选择目录的只读访问能力；最终 Info.plist、权限与 entitlement 组合必须以 Xcode SDK 和签名 App 实测为准。

来源选择和目标创建必须分别验证：不假定所有来源都支持两个实体类型，也不靠名称文本等于 iCloud 来做唯一判断。[Apple：EKCalendar.source](https://developer.apple.com/documentation/eventkit/ekcalendar/source)

实现时重新验证目标 ID 的有效性，不能假设永久不变。[Apple：calendarItemIdentifier](https://developer.apple.com/documentation/eventkit/ekcalendaritem/calendaritemidentifier)

权限拒绝时显示设置入口。首次同步默认在两个权限和目标均就绪后再写入；执行中撤权或保存失败仍按部分失败处理。

## 9. 架构与失败恢复

建议代码结构（后续创建，当前没有实现）：

```text
ObsidianPlanner/
  App/                  # SwiftUI lifecycle and navigation
  Features/Setup/       # Vault, permissions, destinations
  Features/Sync/        # Range, preview, result
  Domain/               # ScheduleEntry, SyncPlan, matching rules
  Infrastructure/
    Vault/              # Authorized read access and Markdown parsing
    EventKit/           # Calendar/reminder adapter
    Persistence/        # Settings, mapping, operation journal
Tests/
  ParserTests/
  SyncPlannerTests/
  RecoveryTests/
```

同步顺序：读取快照 → 解析校验 → 比对本地映射与远端对象 → 生成计划 → 必要的冲突确认 → 持久化待执行操作 → 写入每个目标并记录结果 → 汇总。执行前检查源快照是否改变，改变则重新生成计划。单次仅允许一个同步批次运行。

每个目标分开记录 pending／succeeded／failed，失败重试前先按归属标记重新查找，以覆盖“远端已保存但本地状态未落盘”的崩溃窗口。禁止整批无条件重建。数据库迁移须备份并有失败恢复路径。EventKit 实体留在受控串行执行上下文，业务层使用值类型数据。

## 10. 隐私与发布

只读取选定 Vault 的必要文件。首次读取路径由系统授权，运行时日志默认不包含标题、全文、个人绝对路径或账户信息；诊断导出必须脱敏。没有分析 SDK、服务端或独立账户。用户选择导出的标题、时间和来源标记会进入苹果账户数据，不承诺这些信息仅停留本机。

GitHub Release 计划使用签名并公证的 `.dmg` 或 `.zip`，附版本说明、校验和和最低系统版本。公开顺畅分发需要准备 Developer ID 签名、公证所需开发者账户及凭据，相关 Apple 开发者计划可能产生费用；这与是否付费同步 Obsidian 无关。[Apple：Developer ID](https://developer.apple.com/developer-id/)、[Apple：Notarizing macOS software](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)

发布流程：运行测试 → Release archive → Developer ID 签名与 Hardened Runtime → 公证 → 验证并附加公证票据 → 打包 → 干净环境安装验证 → GitHub Release。首版手动检查更新，不集成自动更新器。签名证书、密钥和账户凭据只能放本机 Keychain 或 CI secrets。许可证、GitHub 仓库归属和支持的 CPU 架构在首次公开发布前决定；建议验证 Apple silicon 与 Intel 的 Universal 构建。

## 11. 开发阶段与验收

| 阶段 | 交付物 | 完成条件 |
| --- | --- | --- |
| M0 当前 | 需求文档、README、Git 初始化 | 明确已确认需求与设计假设 |
| M1 技术验证 | 原生 App 骨架、权限和 iCloud 目标验证 | 实机创建测试事件与提醒，iPhone 可见；记录实际系统版本 |
| M2 解析与预览 | 只读扫描、范围计算、预览 UI | 虚构样例覆盖支持语法、非法输入、时区和边界 |
| M3 同步核心 | 身份映射、更新、冲突处理、操作日志 | 重复执行不重复创建，部分失败和崩溃可恢复 |
| M4 产品流程 | 英文设置、通知选项、结果和删除预览 | 首次设置后可一键完成普通同步 |
| M5 发布 | 签名、公证、安装包、发行说明 | 从浏览器下载安装并完成端到端验收 |

必须通过的检查：

1. 示例 10:40–11:30 条目生成一个 50 分钟事件及一个提醒事项，均在正确的 DayPlanner 容器。
2. 同一范围执行两次，第二次无多余创建；插入其他行不会导致重复。
3. 标题单独修改、时间单独修改可定位更新；相同标题多条、同时修改多个字段、跨日移动进入可解释的冲突流程。
4. 本周、下周、跨年、闰日、自定义过去范围正确；夏令时边界有确定的处理。
5. 完成条目正确映射；无变化的同步不会重置手机完成状态。
6. 通知默认提前 10 分钟，关闭不创建 App 闹钟；Both、过去时间、历史提醒和系统默认通知在实机验证。
7. 一端保存失败后重试只修复失败项；模拟保存成功后崩溃不重复创建。
8. 权限拒绝、撤销、目录移走、无 iCloud 来源、目标只读／删除、文件损坏均提供明确错误，不误删。
9. 删除仅作用于用户确认的本 App 受管对象；普通用户事件、范围外事件和解析失败日期不受影响。
10. 使用临时 Vault 和专用测试日历／列表；测试前后校验源文件内容未改变，不在真实工作安排中自动创建测试数据。
11. Mac 本机成功与 iPhone 到达分开记录；离线和联网后最终可见情况人工验收，不假设即时同步。

单元测试使用虚构 fixtures 和可注入的 EventKit adapter；实际权限、iCloud、通知、签名和分发行为必须做手动集成验证。当前没有运行 App 测试，因为尚未实现 App。

## 12. 下一步优先级与尚未验证事项

1. 优先做 M1：验证真实 iCloud 来源、双目标创建和通知时机，避免在未验证系统能力前扩展 UI。
2. 实现严格解析器和预览，再做身份匹配及可恢复写入。
3. 公开发布前决定许可证、Developer ID／账户、GitHub 仓库和支持架构。

尚未验证：用户其他日记格式、iPhone 系统版本与端到端同步、macOS 14 兼容性、提醒事项实际通知行为、签名／公证凭据。技术参考于 2026-10-29 查阅 Apple 官方页面；部分正文访问受页面渲染限制，具体 SDK 签名和可用性应在实现阶段复核。
