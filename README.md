<p align="center">
  <img src="Resources/Brand/AppIcon.png" width="128" alt="ObsidianPlanner app icon">
</p>

# ObsidianPlannerForApple

把 Obsidian Day Planner 安排同步到苹果提醒事项和可选日历：可以独立使用 Mac App，也可以只安装 Obsidian 插件。在 Mac 计划，iPhone 通过 iCloud 查看，无需同步整个 Vault。

Export saved Day Planner schedules to Apple Reminders and optional Calendar events. Choose the standalone Mac App or an independent Obsidian plugin. The new plugin includes its own small macOS background component and does not require the full App.

**Apple silicon · macOS 14+ 构建目标 · ad-hoc 签名，未经 Apple 公证 · MIT + Commons Clause，source-available。**

| 产品 | 版本与状态 | 安装方式 |
| --- | --- | --- |
| 独立 Mac App | 已发布 App 0.5.0 / build 6；本次不改动 | [v0.5.0-beta.1](https://github.com/YuchenWang-leslie/ObsidianPlannerForApple/releases/tag/v0.5.0-beta.1) 中的 App ZIP |
| 独立 Obsidian 插件 | 插件/helper 0.4.0；本地及实机验收通过 | [plugin-v0.4.0-beta.1](https://github.com/YuchenWang-leslie/ObsidianPlannerForApple/releases/tag/plugin-v0.4.0-beta.1) 中的插件 ZIP 与校验和 |

原 v0.5.0-beta.1 的 App、0.3.0 伴随插件及发行附件保持原样。0.3.0 的“另装完整 App”要求不适用于新的独立插件。

[全部已发布版本](https://github.com/YuchenWang-leslie/ObsidianPlannerForApple/releases) · [插件 0.4.0 说明](docs/releases/plugin-v0.4.0-beta.1.md) · [更新记录](CHANGELOG.md)

## 独立插件 0.4.0

在 Obsidian 内连接当前 Vault、授予所需苹果权限、选择提醒事项／日历账户、预览和逐条同步，查看本机结果及上次请求状态。无需打开完整 Mac App。插件 ZIP 附带 `native/DayPlannerAppleSyncHelper.app`，按需作为无主窗口、无 Dock 图标的本机后台组件运行；它不是从网络临时下载的可执行文件。

**本机实测通过。** 59 项插件测试、Swift 核心检查、30 项 helper 检查、签名组件启动及独立 ZIP 打包通过。新组件的权限、iCloud 账户、真实逐条同步、空闲退出后的预览／结果恢复、插件重载及 iPhone 提醒事项／日历检查均已完成；完整 App 全程未启动。详见 [独立插件记录](docs/PLUGIN_STANDALONE.md)。远端 CI 未运行通过，本次按维护者选择以本地验证为准。

### 安装和连接

1. 从 [插件 release](https://github.com/YuchenWang-leslie/ObsidianPlannerForApple/releases/tag/plugin-v0.4.0-beta.1) 获取 `day-planner-apple-sync-0.4.0.zip` 与 `SHA256SUMS-plugin-0.4.0.txt`。在下载目录运行 `shasum -a 256 -c SHA256SUMS-plugin-0.4.0.txt` 核对附件。
2. 停用旧插件，将 ZIP 中的 `day-planner-apple-sync/` 放入 `<Vault>/.obsidian/plugins/`。保留 `main.js`、manifest、样式、README、LICENSE 和完整 `native/` 文件夹。
3. 在 Obsidian Settings → Community plugins 启用 Day Planner Apple Sync。尚未提交社区目录，当前采用 GitHub 手动安装；如未发现文件夹，重启 Obsidian。先用独立测试 Vault 和少量假安排验证。
4. 插件把随包的 helper 安装到此 Mac 的私有版本目录并按需唤起。它有自己的系统授权；以前给完整 App 或 Obsidian 的权限不会自动转移。当前为 ad-hoc 签名、无 Developer ID 或 Apple 公证；若系统阻止打开，在核对来源后按 [Apple 官方说明](https://support.apple.com/en-us/102445) 处理。不要全局关闭 Gatekeeper，也不修改 Obsidian 的 Info.plist。
5. 点击侧栏或运行 **Open Apple sync**，核对当前 Vault 的准确路径并点击 **Connect this vault**。这是明确的本地 preview + sync 授权，不会自动写入苹果条目。旧伴随插件凭据不复制到新 helper；原去重历史保留。
6. 在插件点击 **Grant Reminders Access** 并选择 **Reminders account**。只有需要日历时才另点 **Grant Calendar Access**、选择 **Calendar account**；两种权限和账户独立。**Refresh connection** 可刷新状态，**Disconnect this vault** 撤销该 helper 配对且保留苹果条目及历史。

macOS 默认隐藏 `.obsidian` 等点号开头的文件夹。在 Finder 或文件夹选择窗口中按 **⌘⇧G** 输入完整路径，或按 **⌘⇧.** 显示隐藏文件夹。

### 预览、逐条选择和恢复

**先保存编辑。** 原生核心读取磁盘上的日记，插件不强制保存或改写笔记。选择本周／下周／自定义范围（含两端、周一开始）、IANA 日程时区和通知选项；默认仅提醒事项、提前 10 分钟。预览按日期分组并显示格式问题与源日记位置。

- 新安排默认 **Add**；旧安排即使源内容变化也默认 **Skip**。
- **Update existing** 把源标题、时间、完成状态和本次通知设置重新应用到关联条目，会覆盖对应的苹果端修改。
- **Add again** 保留旧条目并新建副本；后续更新指向最新副本。不要用它做普通失败重试。
- 冲突默认跳过，可明确选择 **New** 或 **Link** 到已有记录。

点击 **Sync selected** 提交所审阅的一批。源、Day Planner 配置、历史、账户或选项改变须重新预览；预览有效期为 30 分钟。helper 的空闲退出保留近期预览和结果。执行后清除选择，没有自动／定时同步。

结果分别报告提醒事项和日历的本机保存、跳过、失败和未解决。**Mac 保存成功不代表 iPhone 已收到**，实际到达与通知需使用同一 Apple 账户、开启 iCloud 后另行核对。

超时、关闭窗口或停用插件不保证中止已开始的写入。**Check last sync** 查询原请求，不重提。部分失败／中断／未确认时先检查苹果条目，再重新预览，对已关联未完成条目用 Update existing 补写。提醒事项、日历和本机 JSON 不是同一事务，没有跨进程／跨崩溃严格 exactly-once 保证。

完整安装、开发包 runtime 不匹配修复和恢复操作见 [插件 README](plugin/README.md)。

## 已发布的独立 Mac App

App 0.5.0 / build 6 继续按原方式独立使用，本次不重建或替换其发行包。下载 [v0.5.0-beta.1](https://github.com/YuchenWang-leslie/ObsidianPlannerForApple/releases/tag/v0.5.0-beta.1) 的 `ObsidianPlanner-…-macOS-arm64.zip`，解压后拖入 Applications。该 App 为 ad-hoc 签名且未公证；首次打开的系统限制见 [Apple 官方说明](https://support.apple.com/en-us/102445)。原本机真实写入／iPhone 验收范围见 [阶段记录](docs/PLUGINIZATION_PROGRESS.md)，不自动适用于新 helper。


1. **Choose Vault…**：选择 Obsidian Vault。第一版读取根目录下的 `YYYY-MM-DD.md` 日记。
2. **Grant Reminders Access**：在系统弹窗中允许访问提醒事项，然后选择 iCloud 提醒事项账户。
3. 如需日历事件，勾选 **Also create calendar events**，再点击 **Grant Calendar Access** 并选择 iCloud 日历账户。两种权限独立。
4. 选择 **This Week / Next Week / Custom**，并确认 **Time zone**。选择范围包含起止两天。
5. 设置 **Notify via** 和提前分钟数。`None` 表示关闭本 App 创建的通知；`Both` 可能让两个 App 同时提醒。
6. 点击 **Preview**，逐条选择本次操作，再点 **Sync to DayPlanner**：
   - **New plan → Add**：未添加过的默认添加，也可选 **Skip**。
   - **Added before → Skip**：已添加过的默认跳过，包括日记中有修改的条目。
   - **Update existing**：更新已关联的苹果条目，用当前日记的标题、时间、完成状态和本次通知设置覆盖对应字段。只想保留手机端修改时选 Skip。
   - **Add again (new copy)**：保留旧条目并创建一份新的；之后更新会关联到最新副本，不会在普通重复同步时继续新增。旧副本不再自动更新。
   - **Needs matching**：不能唯一识别时，在下方选择关联旧条目、作为新条目创建或跳过。
7. Mac 和 iPhone 使用同一 Apple 账户，并开启 iCloud 提醒事项／日历后，等待苹果系统完成同步。

若同步按钮不可用，查看附近的提示，确认已选 Vault、已授予所需权限、已选择可写的 iCloud 账户。授权后可点 **Refresh Accounts** 刷新。选择日历账户之前必须先授予日历权限。

完成设置后，可以直接选择日期范围、预览并同步。App 与插件沿用同一 Vault 路径身份和本机历史，交替使用时无需另建数据。

### 支持的 Markdown

```markdown
# Day planner

- [ ] 09:00 - 10:30 Read papers
- [x] 11:00 - 11:30 Team meeting
```

- 日期来自文件名，时间使用 24 小时制，必须明确给出当天开始和结束时间。
- 会读取 Day Planner 配置中的标题和标题层级；默认 `# Day planner`。
- 无时间、仅开始时间、跨午夜、嵌套任务和其他非标准任务格式暂不支持，会提示跳过。
- 代码块、注释及目标标题节之外的内容不导出。重叠安排保留并提示。
- App 生成的备注显示 `Time: 09:00 – 10:30`；同步身份使用条目 URL 和本地历史维护。

## 共用历史、隐私与限制

App 和新插件使用相同的 Vault 标准化绝对路径身份及本机去重历史，可顺序切换并复用已有苹果身份。**同一时间只使用一个同步入口。** helper 的写入锁只协调 helper 实例，旧 App 不参与；不要同时点 App 和插件同步。

- **单向 Obsidian → 苹果。** 不回写日记，不因源删除、缩小范围或关闭日历而自动删除旧条目。保留苹果端编辑时选 Skip。
- 保留 `~/Library/Application Support/ObsidianPlanner/`。检测依赖此 Mac 的历史，换 Mac、改变 Vault 路径或丢失历史没有透明迁移保证；不要清空历史来解决冲突。
- 新插件在私有 `PluginBridge/` 保存独立凭据、请求、近期预览和结果；随包 helper 安装于 `PluginRuntime/0.4.0/`。旧 App 的 `Bridge/` 保持独立。插件偏好可在 Vault，但令牌、账户 ID、预览与运行指针不进入 `data.json`。
- 请求含路径、日期、时区、选项和凭据，结果可含标题与源位置；不复制整篇日记到通信目录。URL 只有协议版本和 UUID。无自建服务器、监听端口、遥测或自动网络下载原生程序。本机机制不能隔离同用户的恶意进程。
- 导出的标题、时间、备注和身份 URL 会进入所选苹果账户，选用 iCloud 时由苹果同步到其他设备。停用插件或撤销配对不删除这些对象或历史。
- Apple silicon、macOS 14 和 Obsidian manifest 最低 1.5.0 是本版目标／声明；实际测试环境为 macOS 27.0.1 / Obsidian 1.15.1，其他系统组合和 Intel 未测。
- 当前未提交 Obsidian 社区目录，不保证审核接受带原生组件的分发方式或当前许可证。iPhone 不需要安装插件；没有 iOS／Windows／Linux 同步端。

## 从源码构建

新插件的 JavaScript 检查可使用 Node.js 24+：

```sh
cd plugin
npm ci
npm test
npm run build
```

完整独立插件包还需要 Apple silicon Mac 和 Apple Swift 命令行工具。在仓库根目录运行：

```sh
./scripts/package-plugin-release.sh 0.4.0-beta.1
```

该脚本执行 npm 干净安装／测试／构建，仅构建新 helper，再生成 `plugin/dist/day-planner-apple-sync-0.4.0.zip` 与独立校验和。不调用旧 App 构建或 `package-release.sh`，不替换旧 App ZIP，不上传或安装任何内容。普通 `npm run build` 只输出 JS；缺 helper 时插件打包会报错。

原 App 的源码构建方式保留：`./scripts/test-core.sh`、`./scripts/build-app.sh`。本次插件发布不用它重建 App。`test-core.sh` 使用 swiftc 运行独立核心测试；`swift test` 另需提供 XCTest 的开发环境。

## English quick start

Plugin 0.4.0 is an independent macOS Obsidian plugin. Its ZIP includes a background native helper, so no full ObsidianPlanner App is required. Connect the vault, grant the helper's separate Reminders/optional Calendar permissions and choose accounts in Obsidian. Save notes before previewing, review per-plan choices, and sync explicitly. Local automated checks and this helper's real-account, recovery, host-reload and iPhone acceptance passed; see the validation record for scope and limits.

The existing standalone App 0.5.0/build 6 and its published release assets stay unchanged. App and helper share local deduplication history for sequential use; use one sync entry point at a time. Status queries never resubmit an uncertain job. Inspect Apple items before a partial/interrupted retry, and use Update existing for linked incomplete items. Local saves do not confirm iPhone delivery, and no cross-process/crash exactly-once guarantee is made.

Manual GitHub distribution, Apple silicon/macOS 14+ target, ad-hoc signing and no Apple notarization. Other systems/Intel and community-directory acceptance are unverified. The [plugin README](plugin/README.md) and [independent-plugin record](docs/PLUGIN_STANDALONE.md) contain setup and validation details.

## License and project notes


**MIT + Commons Clause v1.0 — source-available, not OSI open source.**

允许免费使用、学习、修改和分享，包括个人工作用途及企业内部使用。未经另行授权，不得销售本软件，或提供全部或实质价值来自本软件功能的收费产品／服务；仅改名、轻微修改后出售也受到限制。条款中的 Sell 包括符合上述条件的收费托管、咨询和支持服务；这不等于禁止所有商业活动。再分发须保留完整许可证及声明。

Free use, modification and sharing are permitted, including personal work and internal business use. Selling a product or service whose value derives entirely or substantially from this software requires separate permission. The definition includes applicable hosting, consulting and support fees. Preserve the complete license when redistributing. The [LICENSE](LICENSE) is authoritative; this summary does not replace it.

本仓库当前提供的版本均按上述组合条款分发；这不追溯撤销此前已经合法取得的授权。详见 [授权说明](docs/LICENSING.md)。

Not affiliated with Apple or Obsidian. The icon was generated with AI; [asset notes](Resources/Brand/README.md).

[开发设计](docs/DEVELOPMENT.md) · [App 阶段记录](docs/PROGRESS.md) · [Obsidian 插件化计划](docs/PLUGINIZATION_PLAN.md) · [插件阶段记录](docs/PLUGINIZATION_PROGRESS.md)
