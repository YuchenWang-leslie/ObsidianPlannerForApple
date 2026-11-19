<p align="center">
  <img src="Resources/Brand/AppIcon.png" width="128" alt="ObsidianPlanner app icon">
</p>

# Day Planner Apple Sync

把 Obsidian Day Planner 安排同步到苹果提醒事项和可选日历：使用 Obsidian 插件及一次手动安装的 helper，或独立使用 Mac App。在 Mac 计划，iPhone 通过 iCloud 查看，无需同步整个 Vault。

Export saved Day Planner schedules to Apple Reminders and optional Calendar events from Obsidian. Plugin 0.4.2 uses a separately downloaded helper 0.4.0 that you install once by hand; it does not install or update native code. The full ObsidianPlanner App is a separate option and is not required.

**插件要求 Obsidian 1.15.1+；helper 要求 Apple silicon / macOS 14+。helper 为 ad-hoc 签名、未经 Apple 公证。MIT + Commons Clause，source-available。**

| 产品 | 版本与状态 | 安装方式 |
| --- | --- | --- |
| 独立 Mac App | 已发布 App 0.5.0 / build 6；本次不改动 | [v0.5.0-beta.1](https://github.com/YuchenWang-leslie/ObsidianPlannerForApple/releases/tag/v0.5.0-beta.1) 中的 App ZIP |
| 社区插件 | 0.4.2 干净源码／官方 lint／69 项测试／只读宿主 QA 通过；社区未批准 | [社区 Release 0.4.2](https://github.com/YuchenWang-leslie/ObsidianPlannerForApple/releases/tag/0.4.2)，仅 main.js／manifest.json／styles.css |
| 手动安装包 | 插件 0.4.2 + 不变的 helper 0.4.0 | [manual-v0.4.2](https://github.com/YuchenWang-leslie/ObsidianPlannerForApple/releases/tag/manual-v0.4.2)，插件 ZIP、helper ZIP、双 ZIP 校验和 |

原 App 0.5.0/build 6、插件 0.3.0 和 0.4.0 及既有发行附件保持原样。**已用 0.4.0 的用户只升级插件，保留现有 helper、授权、账户、令牌和历史。** 新用户需完成一次下述手动 helper 安装；不需要完整 App。

[手动下载](https://github.com/YuchenWang-leslie/ObsidianPlannerForApple/releases/tag/manual-v0.4.2) · [社区三文件](https://github.com/YuchenWang-leslie/ObsidianPlannerForApple/releases/tag/0.4.2) · [0.4.2 说明](docs/releases/0.4.2.md) · [Helper 安装](docs/HELPER_SETUP.md) · [审核回应](docs/COMMUNITY_REVIEW.md)

## Obsidian 插件 0.4.2

在 Obsidian 内连接 Vault、授予所需苹果权限、选择提醒事项／日历账户、预览并逐条同步，查看本机结果及上次请求状态。插件只检查和调用已安装的 `DayPlannerAppleSyncHelper.app` 0.4.0，不下载、复制、安装或更新 helper。该组件无主窗口和 Dock 项，完整 Mac App 不参与。

**0.4.2 本地验证通过。** git archive 导出的干净源码通过 npm ci、官方 ESLint（0 错误／0 警告）、69 项测试、build 和元数据检查，三个标准输出与当前工作构建逐字节一致，npm audit 为 0。Obsidian 1.15.1 测试 Vault 的标题／指南／Use system、保存刷新和全局搜索已实测；旧凭据、完成记录与 helper 0.4.0 可用，只读预览为 5 条 Unchanged／Skipped，2 项既有重叠警告保留。测试日记和共用历史字节不变，1 份 completed 运行指针因状态刷新而变化。工作 Vault、App 和 native 未改，也未执行 Apple 同步。发行附件核对见本版记录；远端任务因 GitHub 账户账单锁定而无执行步骤，未生成可验证 attestation，解除限制后须重跑。[本版记录](docs/releases/0.4.2.md)和[审核回应矩阵](docs/COMMUNITY_REVIEW.md)保留准确边界；社区未批准。

### 安装和连接

1. **新用户先手动安装 helper。** 从 [manual-v0.4.2](https://github.com/YuchenWang-leslie/ObsidianPlannerForApple/releases/tag/manual-v0.4.2) 下载 `day-planner-apple-sync-helper-0.4.0-macOS-arm64.zip`，解压后把其中的 `.app` 拖到 `~/Library/Application Support/ObsidianPlanner/PluginRuntime/0.4.0/`。准确位置、Finder 打开命令及系统限制见 [Helper setup](docs/HELPER_SETUP.md)。不要替换整个 `ObsidianPlanner` 文件夹，历史和凭据也在其中。
2. 已有 0.4.0 helper 的用户跳过上一步，只升级插件。保留相同 helper 文件及其原系统授权、账户和 `PluginBridge/` 数据。
3. 在社区条目实际审核发布前，从 [manual-v0.4.2](https://github.com/YuchenWang-leslie/ObsidianPlannerForApple/releases/tag/manual-v0.4.2) 下载 `day-planner-apple-sync-0.4.2.zip`，停用旧插件，把其中的 `day-planner-apple-sync/` 放入 `<Vault>/.obsidian/plugins/`。包内只有 main.js、manifest.json、styles.css、README.md、LICENSE，没有 native bundle。
4. 在 Settings → Community plugins 启用插件；未发现文件夹时重启 Obsidian。社区 Browse 安装须等审核发布后才可用；标准 tag 和附件不是审核通过的证明。
5. 点击侧栏或运行 **Open Apple sync**。新连接核对准确 Vault 路径，再点 **Connect this vault**；已有 0.4.0 连接保持使用。点击连接不会自动同步，也不复制旧完整 App 的配对。
6. 新用户为 helper 授予 **Grant Reminders Access** 并选择 **Reminders account**。需要日历时另用 **Grant Calendar Access**／**Calendar account**；两项权限和来源独立。**Refresh connection** 刷新状态，**Disconnect this vault** 撤销配对且保留苹果条目及历史。

手动 Release 的 `SHA256SUMS-manual-0.4.2.txt` **只覆盖两个 ZIP**。将插件 ZIP、helper ZIP 和校验文件放在同一目录，运行 `shasum -a 256 -c SHA256SUMS-manual-0.4.2.txt`。社区 `0.4.2` Release 只放三个标准文件，不附加 ZIP 或校验文件。

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

插件功能见 [插件 README](plugin/README.md)；缺失／不兼容 helper 的人工处理见 [Helper setup](docs/HELPER_SETUP.md)，插件不会自动修复安装。

## 已发布的独立 Mac App

App 0.5.0 / build 6 继续按原方式独立使用，本次不重建或替换其发行包。下载 [v0.5.0-beta.1](https://github.com/YuchenWang-leslie/ObsidianPlannerForApple/releases/tag/v0.5.0-beta.1) 的 `ObsidianPlanner-…-macOS-arm64.zip`，解压后拖入 Applications。该 App 为 ad-hoc 签名且未公证；首次打开的系统限制见 [Apple 官方说明](https://support.apple.com/en-us/102445)。原本机真实写入／iPhone 验收范围见 [阶段记录](docs/PLUGINIZATION_PROGRESS.md)，不作为插件 0.4.2 回归证据。


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
- 插件在 Vault 外的私有 `PluginBridge/` 保存配对凭据、请求、近期预览和结果，并检查用户安装于 `PluginRuntime/0.4.0/` 的 helper；这是本机通信、状态恢复及 Apple 访问所需。helper 读取保存的日记与共用历史并执行显式写入。旧 App 的 `Bridge/` 保持独立。令牌、账户 ID、预览与运行指针不进入 Vault 的 `data.json`。
- 请求含路径、日期、时区、选项和凭据，结果可含标题与源位置；不复制整篇日记到通信目录。URL 只有协议版本和 UUID。无自建服务器、监听端口、遥测或自动网络下载原生程序。本机机制不能隔离同用户的恶意进程。
- 导出的标题、时间、备注和身份 URL 会进入所选苹果账户，选用 iCloud 时由苹果同步到其他设备。停用插件或撤销配对不删除这些对象或历史。
- 需要 Apple silicon、macOS 14+、Obsidian 1.15.1+；最低已实测宿主是 Obsidian 1.15.1。helper 旧版验收运行于 macOS 27.0.1；macOS 14 是构建目标，其他系统组合和 Intel 未测。本轮没有在用户 Vault 实际升级或重做 Apple 写入。
- 社区审核状态不由本仓库的 manifest 或 tag 决定；当前不保证审核接受外部原生依赖或当前许可证。iPhone 不需要插件；没有 iOS／Windows／Linux 同步端。

### Vault 外文件和本机进程

插件需要 Node `fs` 和 `child_process` 能力来验证已手动安装的组件、传递本地请求和恢复结果；相关能力警告不隐藏，也不等于已获审核批准。

| Vault 外位置 | 用途 |
| --- | --- |
| `~/Library/Application Support/ObsidianPlanner/PluginRuntime/0.4.0/DayPlannerAppleSyncHelper.app` | 只检查固定 helper 的 plist、可执行文件和签名，再调用；不安装／更新 |
| `~/Library/Application Support/ObsidianPlanner/PluginBridge/` | 凭据、原请求指针、inbox／outbox、原生配对、预览、结果收据和执行锁 |
| `~/Library/Application Support/ObsidianPlanner/<vaultKey>.json` | helper 与 App 顺序复用的去重历史 |
| `~/Library/Preferences/com.obsidianplanner.pluginhelper.plist` | helper 的账户选择等本机偏好 |

调用只使用固定 `/usr/bin/plutil`、`/usr/bin/codesign` 和 `/usr/bin/open`，通过 `execFile` 的 argv 数组传参，未启用 shell、eval 或下载／安装命令。`plutil` 读 plist 到 stdout，`codesign` 核验固定 bundle ID，`open -g -a` 调用同一已验证的 helper 和只含协议／UUID 的请求 URL。准确 argv、数据文件和边界见 [Helper setup](docs/HELPER_SETUP.md#local-access-and-shared-history)。

## 从源码构建

从仓库根目录使用 Node.js 24+ 运行 workspace 检查：

```sh
npm ci
npm run lint
npm test
npm run build
npm run check:release
```

发行打包使用：

```sh
./scripts/package-plugin-release.sh 0.4.2
```

标准 GitHub tag `0.4.2` 与 manifest.version 相同，仅放三个标准文件。`manual-v0.4.2` 单独提供五文件插件 ZIP、helper 0.4.0 ZIP 和仅覆盖两个 ZIP 的校验和。不把 native 放进插件 ZIP，不改旧 App、helper 或旧 Release，也不为用户安装依赖。

原 App 的源码构建方式保留：`./scripts/test-core.sh`、`./scripts/build-app.sh`。本次插件发布不用它重建 App。`test-core.sh` 使用 swiftc 运行独立核心测试；`swift test` 另需提供 XCTest 的开发环境。

## English quick start

Plugin 0.4.2 requires Obsidian 1.15.1+, Apple silicon and macOS 14+. New users manually install the separately downloaded helper 0.4.0 once, then install the five-file plugin ZIP. Existing 0.4.0 users keep their helper, permissions, accounts and history and only upgrade the plugin. No full App is required; the plugin does not download, install or update native code. See [Helper setup](docs/HELPER_SETUP.md).

The existing standalone App 0.5.0/build 6 and its published release assets stay unchanged. App and helper share local deduplication history for sequential use; use one sync entry point at a time. Status queries never resubmit an uncertain job. Inspect Apple items before a partial/interrupted retry, and use Update existing for linked incomplete items. Local saves do not confirm iPhone delivery, and no cross-process/crash exactly-once guarantee is made.

A clean tracked-source export passed install, official lint (zero errors/warnings), 69 tests, build, metadata checks and audit (zero findings); its three standard outputs match the working build. Real Obsidian 1.15.1 read-only QA verified settings/search, existing credentials/completed status and a five-plan preview. Notes/history stayed unchanged; one completed run pointer refreshed. No work-vault upgrade or Apple sync occurred. Release attachment checks are recorded in the release notes; remote jobs had no steps because of a GitHub account billing lock, so no actual attestation is claimed. Other systems/Intel and community approval remain unverified. Helper 0.4.0 is ad-hoc signed and not Apple-notarized.

## 社区目录与许可

根目录现在按插件仓库提供 README、LICENSE、manifest，发布使用与 manifest 一致的 `0.4.2` tag 及单独 main.js／manifest.json／styles.css。目录读取默认分支 HEAD；这些解决可识别性与发行格式，不表示审核通过。[官方提交流程](https://docs.obsidian.md/plugins/releasing/submit-plugin)。

提交者在 [Community portal](https://community.obsidian.md) 关联 GitHub 后重试条目提交／检查，按反馈处理。已有条目可用 **Review branch** 预检；新 release 尚未识别时可用 **Check for new releases**。只有实际审核并发布后才可从 Obsidian Browse 安装。[官方 FAQ](https://docs.obsidian.md/community-directory/faq)。

许可仍为完整 **MIT + Commons Clause v1.0**，保留 No Sell。官方要求附带并说明 LICENSE，这些政策没有指定必须纯 MIT；自定义许可证可能触发识别警告，能否接受须由审核方判断。插件的人工依赖安装、Vault 外访问与本地数据用途已在上文及 helper guide 披露，不保证因此获得批准。[开发政策](https://docs.obsidian.md/community-directory/developer-policies)、[许可警告说明](https://docs.obsidian.md/community-directory/faq)。

## License and project notes


**MIT + Commons Clause v1.0 — source-available, not OSI open source.**

允许免费使用、学习、修改和分享，包括个人工作用途及企业内部使用。未经另行授权，不得销售本软件，或提供全部或实质价值来自本软件功能的收费产品／服务；仅改名、轻微修改后出售也受到限制。条款中的 Sell 包括符合上述条件的收费托管、咨询和支持服务；这不等于禁止所有商业活动。再分发须保留完整许可证及声明。

Free use, modification and sharing are permitted, including personal work and internal business use. Selling a product or service whose value derives entirely or substantially from this software requires separate permission. The definition includes applicable hosting, consulting and support fees. Preserve the complete license when redistributing. The [LICENSE](LICENSE) is authoritative; this summary does not replace it.

本仓库当前提供的版本均按上述组合条款分发；这不追溯撤销此前已经合法取得的授权。详见 [授权说明](docs/LICENSING.md)。

Not affiliated with Apple or Obsidian. The icon was generated with AI; [asset notes](Resources/Brand/README.md).

[开发设计](docs/DEVELOPMENT.md) · [App 阶段记录](docs/PROGRESS.md) · [Obsidian 插件化计划](docs/PLUGINIZATION_PLAN.md) · [插件阶段记录](docs/PLUGINIZATION_PROGRESS.md)
