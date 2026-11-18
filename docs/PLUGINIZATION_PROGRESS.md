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

未测试其他 macOS／Obsidian 版本、Windows/Linux 实机；未真实卸载已安装 App，未安装／旧 App 行为使用传输测试替身验证。P2 的配对凭据、插件内结果视图和 P3 的直接同步不属于本轮；尚未开始，也未 push 或发布新版本。
