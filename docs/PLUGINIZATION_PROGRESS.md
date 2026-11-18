# 插件化阶段记录

日期：2026-11-18。执行依据：[插件化计划](PLUGINIZATION_PLAN.md)。

## P0：基线冻结

基线版本为已发布的 App 0.2.0 / build 3，对应 v0.2.0-beta.1。当前工作从干净仓库开始；在私有的 `.local/p0-baseline/` 留存源码 bundle 和 App ZIP，避免影响公开历史。

### 已执行与通过

- `./scripts/test-core.sh`：解析、日期／夏令时、去重、改期／改标题／完成状态、手动关联、逐条选择、显式新增副本、旧 JSON 兼容、两端通知历史检查通过。
- `./scripts/build-app.sh`：Release 构建和临时签名验证通过。
- 原生窗口可打开；默认仅提醒事项、日历为可选；已识别当前 Vault 和日程时区。
- 环境：Apple silicon，macOS 27.0.1，Swift 6.4，Node 24.14.1，npm 11.11.0，Day Planner 0.28.0。Obsidian 安装包元数据为 1.12.7；实际运行宿主界面显示 1.15.1，P1 宿主测试以该运行版本为准。

### 账户基线复验通过

用户分别授予提醒事项和日历权限，两项账户选择 iCloud。本轮账户回归在本地 P1 App 0.3.0 / build 4 执行，其同步实现沿用 0.2.0，只新增未确认插件请求时禁止同步的入口检查。

已实际通过：

- 日历未授权且未勾选时，向 iCloud DayPlanner 写入 2 条 P0 假安排：Reminders saved 2、Calendar saved 0、失败 0。
- 重复同步默认两条 Skip：两端写入均为 0，没有新增副本。
- 在苹果提醒事项中看到普通条目和源中已完成的条目，备注为 `Time: HH:mm – HH:mm`。
- 第一条在苹果端变为完成后，修改测试日记的时间并显式选择 Update existing；本次只更新该条、另一条 Skip，苹果端恢复未完成并显示新时间。
- 用户确认 iPhone 提醒事项可见，并在手机勾为完成；Mac 已观察到相应状态，经显式 Update 后恢复源中的未完成状态。
- 将旧格式 `ObsidianPlanner:v1:...`、`ObsidianPlanner source:...` 和一行普通备注实际保存到假条目，再显式更新：两行技术信息被清除，新时间备注正确，普通备注保留。
- 日历授权后，仅第一条选择 Update existing：Calendar saved 1、Reminders saved 1、另一条 Skip、失败 0。Mac 日历中确认它属于 DayPlanner，时间为 2026-11-18 13:16–13:36。
- 用户确认 iPhone 日历可见，并实际收到 13:06 的提醒事项通知，对应提前 10 分钟。
- 日历开启时再次同步默认全部 Skip，两端写入均为 0。
- 测试 Vault 历史始终只有 2 条记录，两个提醒事项身份保留，最终只增加 1 个日历身份，没有新增副本；已有工作 Vault 的历史哈希保持不变。

收尾已恢复 App 的原工作 Vault、本周、Asia/Shanghai、仅提醒事项及提前 10 分钟设置，没有对真实安排执行同步。两条提醒事项和一个日历测试条目保留在 DayPlanner 中，标题带 P0 标记；未清空任何历史。

全部写入使用专用测试 Vault 中带有 P0 标记的假安排。工作 Vault 日记未修改，插件只安装在独立测试 Vault；提醒事项权限和日历权限分别处理。手机端到达与通知结果由用户反馈确认，不由模拟测试代替。

P0 状态：**完成，当前机器的自动检查及真实账户人工验收通过。** 不代表已验证其他系统版本、账户环境或所有异常恢复情形。

## P1：插件外壳与原生唤起

### 已实现

- `plugin/`：macOS 桌面专用插件，侧栏按钮、四个命令、本周／下周／自定义范围、时区菜单及自定义 IANA 标识；只持久化时区偏好。
- 原生 App 0.3.0 / build 4：注册 `obsidianplanner` scheme；冷启动请求先排队，窗口关闭／最小化时恢复同一主窗口。
- P1 固定目录请求／响应：URL 只包含协议版本和 UUID；JSON 包含日期、时区和 Vault 上下文，不包含日记正文、标题或账户信息。目录 0700、文件 0600，插件完成或超时后仅清理本次文件。
- 仅支持 `action: open`。相同已确认路径保留原有目录授权和历史；不同路径先显示确认界面，不能静默切换来源或同步。同名不作为路径匹配依据。
- `obsidianplanner://sync/...` 仅显示条目引用提示，不执行同步。重复收到相同请求 ID 只重发已有确认。
- 打包保持 MIT + Commons Clause 完整条款；不包含原生可执行文件、依赖目录或私人日记。

为避免在 URL 传私人路径，原计划 P2 的 inbox/outbox 文件传输在 P1 提前实现最小版本；没有提前开放配对、预览结果或写入动作。P1 的 `opened` 只表示范围已应用，不代表同步成功。

### 自动验证通过

- `./scripts/test-core.sh`：原有解析、匹配、逐条选择、历史兼容及通知检查均通过；新增路由、JSON 往返、协议／日期／路径校验、文件权限、大小及符号链接检查通过。
- `./scripts/build-app.sh`：Release 构建和本地临时签名验证通过；`plutil -lint Resources/Info.plist` 通过。
- `cd plugin && npm test`：14 项通过，覆盖跨年周范围、按时区确定当天、夏令时、闰日、自定义区间、四类响应、未安装／旧 App、协议或 ID 不匹配、超时不重发及停用取消。
- `npm run typecheck`、`npm run package` 通过。ZIP 只有插件目录下的 `main.js`、`manifest.json`、`styles.css`、`LICENSE`、`README.md`；宿主实际运行的 JS 与包内 JS 一致。

### 本机原生与 Obsidian 宿主验证通过

- 使用 `scripts/test-bridge-open.mjs` 实测 App 已运行、最小化、关闭窗口和完全退出后冷启动，均收到 `opened` 确认，窗口显示准确日期与时区。
- 不同 Vault 请求返回 `needsVault`，原来源和日期保持不变、Sync 禁用；通过系统文件夹选择框确认测试 Vault 后，日期被应用并预览出 3 条假安排。
- 另建路径不同但同名的 `PluginTestVault` 发起请求，仍返回 `needsVault`，不会依名称误用原来源；Dismiss 正常解除待确认状态，没有执行写入。
- 点击身份 URL 后只显示引用提示，日期不变，不启动同步。
- 用户在独立 `PluginTestVault` 信任并启用插件；未向真实工作 Vault 安装插件或修改其插件配置。
- Obsidian 1.15.1：侧栏弹窗本周为 2026-11-16 至 11-22，原生预览 2 条；命令面板下周为 11-23 至 11-29，预览 1 条；自定义 11-18 至 11-23／UTC，日期和时区准确，预览 3 条。
- 无效时区在插件内显示可读错误，不打开新请求；恢复 Asia/Shanghai 后正常。
- 全部 P1 检查后比较文件哈希：既有同步历史 JSON、测试 Markdown 均未改变。本轮没有通过桥接或插件创建苹果条目。

### 本地交付与复测

- 原生 App：`dist/ObsidianPlanner.app`（尚未发布）。
- 插件包：`plugin/dist/day-planner-apple-sync-0.1.0-P1.zip`（尚未发布）。
- 手动安装与四个命令说明：[插件 README](../plugin/README.md)。
- 只读唤起检查示例；替换为自己的绝对 Vault 路径，首次确认来源时使用 `--expect needsVault`：

```sh
node --experimental-strip-types scripts/test-bridge-open.mjs \
  --vault /absolute/path/to/TestVault \
  --start 2026-11-18 --end 2026-11-23 \
  --zone Asia/Shanghai --expect opened
```

### 边界与后续人工项

P1 状态：**完成，当前机器的自动／原生／Obsidian 宿主测试通过，用户已在测试 Vault 信任并启用插件。** 是否进入 P2，可在用户体验当前入口后另行决定。

未测试其他 macOS／Obsidian 版本、Windows/Linux 实机；未真实卸载已安装 App，未安装／旧 App 行为使用传输测试替身验证。P1 阶段未包含配对和结果回传；其后实现情况见下方 P2 记录。该阶段未 push 或发布新版本。

## P2：本机配对与预览回传

状态：**完成，自动检查及当前机器的原生／Obsidian 宿主验收通过。** 用户已确认测试 Vault 的配对。协议冻结在 [本机预览协议](PLUGIN_BRIDGE_P2.md)。App 0.4.0 / build 5，插件 0.2.0，协议仍为 1，以新增动作扩展并保留 P1 open。

### 已实现

- Foundation-only `PlannerPreviewEngine` 统一读取日记、Day Planner 标题配置和历史，复用现有解析、匹配与默认选择。原生 Preview 与 bridge preview 均使用此入口。
- `PlannerHistoryStore` 沿用 Vault 标准化绝对路径 SHA-256 和原 `[SyncRecord]` JSON；不迁移或清空既有历史。
- 原生明确确认配对，按 Vault 保存随机凭据及目录 bookmark；再次配对轮换凭据，撤销只移除配对。
- 插件凭据存放在私有 `Application Support/ObsidianPlanner/Bridge/clients/`，不写入 Obsidian `data.json`；本地文件权限 0600、目录 0700。
- 插件展示日期分组、Create／Update／Unchanged／Conflict 与默认 Skipped、统计和格式问题，并可打开源日记的对应行。
- 仅开放 open／pair／preview；preview 按凭据及实际路径授权，不依 Vault 名称识别，P3 sync 仍不支持。

### 已通过的自动检查

- `./scripts/test-core.sh`：原测试及新增 P2 检查通过，包含旧 JSON 兼容、已知路径哈希、标题配置、所有匹配状态／默认跳过、同名路径隔离、预览内容及修改时间均不变、ISO-8601 DTO、配对轮换／撤销、错误凭据、文件权限。
- `./scripts/build-app.sh`：Release 构建和临时签名验证通过。
- `cd plugin && npm test`：26 项通过，涵盖原有范围／传输、配对 pending／取消／超时、私有存储、同名隔离、令牌失效、响应身份／选项／统计／源定位校验及停用清理。
- `npm run typecheck`、`npm run package` 通过。安装到宿主的 JS 与 ZIP 一致，包内仅五项分发文件，包含完整组合许可；未包含实际凭据或日记。
- 原生实测：App 0.4.0 拒绝未配对的预览，返回 `needsSetup / VAULT_NOT_PAIRED`。

### 本机与宿主实测通过

- 用户确认测试 Vault 配对，原生选定其文件夹、完成明确配对后，插件收到并私有保存凭据；文件夹选择本身没有创建凭据。
- 本周预览：4 条安排、1 项格式问题，包含 2 条 P0 既有安排（Unchanged + Skipped）及 2 条新安排（Create）；原生显示相同标题、时间、完成状态和默认操作。
- 点击 `2026-11-19.md:3`，Obsidian 打开该日记并定位目标任务行；文件内容校验值未改变。
- 临时修改假安排，验证 Update／Skipped 和 Conflict 展示与原生一致；之后恢复假安排原始内容。
- 自定义 2026-11-18 至 11-19 正确包含两天；UTC、Calendar 可选、Both／提前 20 分钟均正确传到 App。随后恢复 Asia/Shanghai、仅 Reminders、提前 10 分钟。
- 在测试 Vault 临时使用 `## Focus` 配置，原生 bridge 正确解析 1 条第 3 行安排，测试后恢复原配置。
- 完整桥接 payload 与单独运行的共享 Swift 核心比较一致（只排除每次生成的 previewId），覆盖普通、改动／冲突、自定义标题三组输入。
- 同名但不同路径的 Vault 携带原 Vault 凭据请求时被拒绝，原历史不变。
- 相同 UUID 和输入重复请求返回同一预览；更改该 UUID 的输入后返回 INVALID_REQUEST，不返回旧 payload。
- App 完全退出并确认进程结束后，通过 preview URL 冷启动，保存的配对仍可用，返回 4 条安排／1 项格式问题。
- 原生撤销配对后，插件预览收到拒绝、清除失效凭据并禁用 Preview；在同一已确认测试范围内重新配对后可正常预览。令牌已轮换、vaultKey 不变。
- 配对存储和客户端凭据权限为 0600，目录为 0700；Vault 插件配置只有时区／选项；源码及 ZIP 中未发现实际令牌。
- 全轮检查后，既有历史 JSON 集合及内容校验值完全不变；P0 假日记已恢复，P2 源定位没有修改日记。工作 Vault 未安装插件或修改笔记。

### 本地交付与复测

- `dist/ObsidianPlanner.app`：0.4.0 / build 5。
- `plugin/dist/day-planner-apple-sync-0.2.0-P2.zip`：插件 0.2.0。
- 使用已配对的测试 Vault，执行只读集成及核心一致性检查：

```sh
node --experimental-strip-types scripts/test-bridge-preview.mjs \
  --vault /absolute/path/to/TestVault \
  --start 2026-11-18 --end 2026-11-19 --zone Asia/Shanghai \
  --output /private/path/native-preview.json
./scripts/test-preview-parity.sh /absolute/path/to/TestVault /private/path/native-preview.json
```

结束时恢复 App 原工作 Vault、本周、Asia/Shanghai、仅提醒事项及提前 10 分钟。测试插件仍只安装在独立测试 Vault，可在其中查看 P2 预览。

### 测试边界与后续

本轮没有调用 Sync／连接测试或 EventKit 写入入口；预览核心无 EventKit 依赖，不需要重新授权苹果账户。重编译的临时签名使当前 App 显示提醒事项需重新授权；未来使用原生实际同步时仍需处理该权限。P0 的 iPhone／通知通过记录保留，不把它算成本轮的新写入测试。

沿用既有 Swift 匹配器的保守规则：区间内存在未关联历史时，部分新安排也可能标为 Conflict；两端返回一致，本轮未改写匹配策略。P3 实现逐条决策时应继续覆盖此情况。

P2 阶段尚未验证其他系统／Obsidian 版本，未真实卸载旧 App；超时、停用和格式错误的多数组合由自动测试替身覆盖。当时的预览 ID 仅标识结果，源快照复核和显式写入确认留到 P3；该阶段没有 push 或发布新版本。P3 后续结果见下文。

## P3：插件同步与共享执行器

版本：App 0.5.0 / build 6、插件 0.3.0、协议 1。**实现、本机真实同步主流程及下述 iPhone 人工确认已通过。** 用户已批准测试 Vault 的同步配对与两项系统权限；真实故障路径仍按下文区分自动测试和实机证据。P4 本机核心日常流程及 P5 最终打包已完成，分发状态见下文。实现协议见 [P3 协议](PLUGIN_BRIDGE_P3.md)。

### 实现与自动验证

- 原生入口和插件入口复用 `PlannerSyncExecutor`、原有匹配器及相同路径身份的 JSON 历史。EventKit 独立为后端；提交前及异步读取目标后，再次核对源文件、配置和历史快照。准备阶段只读，新列表在实际保存阶段才创建。
- 插件逐条提供 Add／Skip／Update existing／Add again；冲突可选 Skip／New／Link。新安排默认 Add，已有安排和冲突默认 Skip。结果分开报告提醒事项、日历、跳过、失败和未解决条目。
- 配对增加明确的 preview + sync 范围，旧 P2 凭据缺省只读；原生按保存的授权复核，不能通过客户端布尔值提升权限。
- sync UUID 和预览认领收据在实际执行前持久保存；相同 ID／输入返回原结果，异参复用拒绝，同一预览不能另起 ID 重做。插件先保存不含令牌的请求指针，再提交一次；后续 status 用新的传输 ID 查询原任务。
- 收据查询可跨 App 重启，未结束任务标为 interrupted，不自动补写。不承诺跨崩溃严格只写一次；提醒事项／日历／本机 JSON 不是同一事务。
- `./scripts/test-core.sh` 通过：既有 9 项解析／日期用例及匹配、选择、通知历史、桥接、P2、执行器、任务收据测试组全部通过。
- 执行器假后端实际覆盖创建、重复跳过、改标题、改时间、完成状态、最新副本、手动关联、日历成功但提醒事项失败及稳定身份重试、权限失败、非法选择、源／配置／缺失文件／历史在准备前后的变化导致零写入。
- 任务收据测试覆盖重复 ID、异参冲突、预览重用、重启中断、清理及私有权限；不能把假后端保存计数称为真实 EventKit 保存。

### 已执行的新版原生检查

- 从候选 App ZIP 解压并启动 App 0.5.0，签名严格验证通过。
- 已配对的 P2 测试 Vault 预览返回 4 条安排、1 项格式问题；所有原有历史文件逐字节摘要保持不变。
- `scripts/test-preview-parity.sh` 比较完整原生预览 DTO 与共享 Swift 核心，通过；仅排除随机预览 ID 和配对授权范围字段。
- 向新版原生入口提交旧只读凭据的 sync，收到 `needsSetup / SYNC_NOT_ALLOWED`，没有任务收据或 EventKit 写入。

### 本机真实同步与 iPhone 验收通过

本轮写入仅使用忽略跟踪的 `.local/ReleaseAcceptanceVault` 中的 P3 假安排，初始两条，随后增加第三条以检查新安排默认 Add。用户信任并启用该测试 Vault 的插件，明确批准 preview + sync 配对，以及候选 App 的提醒事项和日历权限。没有把旧签名或 P0 权限视作本版授权。

| 场景 | 实际结果与边界 |
| --- | --- |
| 插件逐条选择 | 在真实插件 UI 选择 Update 1／Skip 1，结果只保存选定的提醒事项。后续第三条假安排默认 Add、旧两条默认 Skip，真实创建 1 条。 |
| 手机到达、通知与完成 | 用户确认 iPhone 提醒事项可见，收到 15:31 通知，之后在手机勾为完成。Mac 实际观察到完成及 `Time: …` 备注；后续显式 Update 恢复源中的未完成状态。这是本版新验证，不沿用 P0 的结论。 |
| 标题、时间、源完成状态 | 真实改标题、改时间、源完成状态 true／false 均保存成功，并通过稳定 Apple 身份断言确认更新同一关联对象。 |
| 再次添加与后续更新 | Add again 创建新副本、旧条目保留；随后 Update 指向最新副本，稳定 Apple 身份断言通过。 |
| 手动关联 | 同时改标题和时间触发 Conflict；插件 UI 明确 Link 到最新副本，结果 Reminder 1／Skip 2，没有产生第 5 条历史记录。 |
| 重放与预览认领 | 同 UUID／同输入返回原 receipt；异参同 UUID 返回 `REQUEST_ID_REUSED`；同预览另起 UUID 返回 `PREVIEW_USED`。这些检查中历史不变，没有再次执行目标写入。 |
| 默认跳过 | 新预览默认全 Skip，两端写入均为 0。 |
| 来源／历史变化 | 故意修改测试日记、仅修改测试历史的空白，分别返回 `SOURCE_CHANGED`，目标零写入；之后恢复测试文件。没有使用清空历史处理冲突。 |
| 可选日历 | 插件 UI 开启日历、只对第一条选择 Update，结果 Calendar 1 + Reminder 1／Skip 2。用户确认 iPhone 日历中 15:51–16:11 的 `P3 acceptance — linked` 测试事件可见，时间正确。 |
| 冷启动查询 | 停止全部原生 App、确认无存活进程后，仅通过 status URL 冷启动解压后的候选 App，取得原 completed 收据；历史不变。重启前生成的 preview 提交得到 `PREVIEW_EXPIRED`、零写入。 |
| 独立原生同步 | 原生 UI 对第二条选择 Update，结果 Reminder 1／Calendar 0／Skip 2，所有 Apple 身份及已有 Calendar 关联保留；再次同步默认全 Skip，零写入／Skip 3。 |
| 假安排通知收尾 | 最后对第一和第三条以 Calendar off／None 显式 Update，结果 Reminder 2／Calendar 0／Skip 1；所有 Apple 身份及已有日历关联保留，并清除未来假安排通知。 |

已执行阶段的对照未发现工作 Vault 或 P2 既有三份历史文件被修改；本轮只对专用测试日记和其历史做受控变更。**最终收尾时仍需再次核验这些既有文件及最终设置状态。**

### 宿主问题与修复证据

- 插件原有 `Modal.selection` 字段与 Obsidian Modal 内部保存 editor selection 的字段重名。DevTools 错误与本地 `Modal.open` 源码确认：宿主覆盖该字段后，Sync 对它执行 `structuredClone`，其中含 Window，导致 `DataCloneError`，尚未进入同步提交。
- 已将插件字段改为 `planSelection`。新增 [宿主生命周期回归测试](../plugin/tests/modal-host.test.mjs)，模拟宿主打开弹窗时覆盖内部 selection，先复现原失败再验证修复通过。修复后真实插件 UI 的上述 Update／Skip／Add／Link 同步通过。
- `.apple-sync-badge` 的 `display: inline-block` 覆盖 hidden，导致不该显示的 Skipped 徽标可见。已移除该 display 声明并重载最终样式；实际宿主中，选择 Update existing 的行显示 Unchanged 匹配状态，不再误显示 Skipped，已通过宿主复核。

真实账户的部分保存失败、拒绝或撤销系统权限未人为制造；相关失败、保留已保存目标及稳定身份重试已有假后端测试，**不称为这些故障路径的实机验收**。本轮未验证跨崩溃中途写入的严格 exactly-once，也未验证其他机器或最低系统版本组合。

## P4：日常体验与兼容性

**当前机器的核心日常流程完成。** 新增宿主生命周期回归后，45 项插件本地测试、TypeScript 类型检查及生产构建通过。测试 Vault 已启用并完成真实同步、窗口重开、插件停用／启用、结果查询及徽标修复的宿主验收；以下视觉、版本与故障边界保留为未验证项，不冒充全部兼容性通过。

- 英文紧凑弹窗，日期分组、逐条操作、源日记定位、可折叠连接／通知选项、执行结果及上次同步查询。
- 日期范围、时区、通知选项存入插件偏好；凭据、请求指针和结果不进入 Vault 配置。更改选项或执行批次后清除本次预览与选择。
- 关闭窗口、停用或重载插件会终止等待，不重提原请求，不声称撤销已开始的原生写入。未确认请求阻止新批次，需先查询或明确检查苹果条目后确认。
- 自动测试覆盖卸载／关闭中止、缺 App、旧 App 超时、协议／身份／结果不一致、旧只读授权、状态恢复、busy／权限／来源失败、无盲目重试、持久文件字段白名单及私有权限。
- 旧 App 不支持同步配对时明确提示安装 0.5.0；原生提醒事项与日历权限独立，未授权日历时不误报没有 iCloud。
- 独立原生同步、App 完全退出后 status 冷启动和预览失效已在本机通过；不能由此推定写入中进程崩溃恢复通过。
- 关闭并重新打开 `ReleaseAcceptanceVault` 窗口，保留用户工作 Vault 的窗口；没有完整退出 Obsidian 进程。配对、This Week／Asia/Shanghai／Calendar + None 偏好及上次结果保留，Check last sync 成功查回原结果，没有重新提交写入。插件停用后重新启用也已在宿主实测。
- 最终 CSS 重载后，Update existing 行的 AX 显示 Unchanged、不再误显示 Skipped。此项已在真实宿主通过，不只依赖静态样式检查。
- **未完成的额外宿主检查：** 完整退出／重启 Obsidian 进程、额外浅色主题、600px 窄窗口及本版源日记链接的新宿主复测。为避免打断用户正在使用的工作 Vault，停止额外前台视觉切换；这些列为边界，不作为核心同步阻塞。P2 已实测过源链接定位且文件不变，不能据此声称本版已重测。
- 通知收尾只更新专用假安排，保留所有 Apple 身份和已有日历关联。最终复核：既有三份同步历史的 SHA-256 全部保持不变，只新增一份测试 Vault 历史；同步器未改写工作 Vault 的笔记或插件配置。
- App 已恢复原工作 Vault、本周、Asia/Shanghai、仅提醒事项和提前 10 分钟。测试 Vault 保留 Calendar + None 偏好便于查看；假安排的后续测试通知已通过显式 Update 关闭。
- 未验证其他 macOS／Obsidian 版本；拒绝／撤销系统权限未实机制造，失败行为由假后端及协议测试覆盖，不视为系统弹窗实测。

## P5：打包、文档与分发

**完成：最终打包、本机真实同步验收、GitHub 公开测试版发布和公开附件重新下载验证均已通过。** 分发入口为 [v0.5.0-beta.1](https://github.com/YuchenWang-leslie/ObsidianPlannerForApple/releases/tag/v0.5.0-beta.1)。本次按维护者确认使用本地验证；远端 CI 未启动，额外兼容性边界仍保留。

- 宿主字段／样式修复后重新执行 `./scripts/package-release.sh 0.5.0-beta.1`，Swift release 构建、插件干净依赖安装／构建、ad-hoc 签名、ZIP 完整性和双包 SHA-256 检查全部通过。
- 最终附件：`ObsidianPlanner-0.5.0-beta.1-macOS-arm64.zip`、`day-planner-apple-sync-0.3.0.zip`、`SHA256SUMS.txt`。
- 将两个最终 ZIP 解压到另一个私有目录：App 的全部五个文件与实机验收 App 逐字节一致，签名严格验证通过；插件的全部五个发行文件与实际重载并验收的测试 Vault 安装逐字节一致，包含宿主字段和样式修复。
- App 包仅含 plist、可执行文件、图标、完整组合许可和签名；插件包仅含 main.js、manifest、样式、README、完整组合许可。排除 Vault、凭据、运行收据、缓存及 Apple 元数据。
- 发现 release Mach-O 的调试符号包含构建机器路径；构建脚本现先 `strip -S` 再签名，候选包精确私人主目录扫描通过。没有修改许可或引入旧版仅 MIT 历史。
- README、插件说明、更新记录、版本说明及协议文档已更新；明确另装 App、Apple silicon 范围、未公证状态、手动安装、单向同步、数据位置及恢复限制。
- 新增 GitHub Actions：macOS 上验证共享核心并构建原生 App；Node 24 上测试和构建插件。首次远端运行因平台／账户配置阻塞，两个任务均未启动、无步骤日志；这不是远端测试通过。待外部限制解除后重跑。
- 最终修复包已替换草稿的全部三个附件，并于 2026-11-18 15:55（Asia/Shanghai）公开发布为 prerelease，已不是草稿。发行 tag 指向实现与实机验收提交 `c2492aa`；没有强制改写历史或更改许可。
- 匿名请求 GitHub Release API 成功，确认无需登录可见、非草稿、包含三个附件。公开发布后重新下载全部附件：两个 ZIP 的 SHA-256 均通过，两个 ZIP 和校验清单还分别与本地最终文件逐字节一致。校验值见发行附件 `SHA256SUMS.txt`。

本轮新增验证命令：

```sh
./scripts/test-core.sh
cd plugin
npm test
npm run typecheck
npm run build
cd ..
./scripts/package-release.sh 0.5.0-beta.1
cd dist
shasum -a 256 -c SHA256SUMS.txt
```

本次以本地验证作为验收依据；远端 CI 的平台／账户配置阻塞仍未解除，未获得远端测试结果。尚未验证 Gatekeeper 在其他机器下载后的首次打开、Intel、最低系统版本组合及真实账户故障下的部分失败。当前仅做现有 GitHub 仓库的手动分发，不提交社区目录，也不申请付费 Apple 账户。
