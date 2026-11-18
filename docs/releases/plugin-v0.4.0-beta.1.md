# plugin-v0.4.0-beta.1 — 独立 Obsidian 插件候选

Plugin/helper **0.4.0** · bridge protocol **1** · 开发与验收中，尚未公开发布

只安装 Obsidian 插件即可连接 Vault、选择提醒事项／日历账户、预览并逐条同步，无需另装完整 ObsidianPlanner App。插件 ZIP 附带小型 macOS 后台原生组件，用于系统权限和 EventKit；连接、账户、通知与结果均在 Obsidian 操作。

**本版尚待真实验收。** 新 helper 的系统权限、账户选择、实际写入、空闲退出／重启后的预览与状态恢复、宿主交互及 iPhone 到达需逐项记录。旧 App／0.3.0 伴随插件的通过结果不等于新 helper 已通过。实施状态见 [独立插件记录](https://github.com/YuchenWang-leslie/ObsidianPlannerForApple/blob/main/docs/PLUGIN_STANDALONE.md)；最终构建、附件与发布结果由本版后续证据补充。

## 独立发行附件

| 附件 | 用途 |
| --- | --- |
| `day-planner-apple-sync-0.4.0.zip` | 五个常规插件文件及 `native/DayPlannerAppleSyncHelper.app` |
| `SHA256SUMS-plugin-0.4.0.txt` | 仅覆盖此独立插件 ZIP 的 SHA-256 |

在下载目录运行 `shasum -a 256 -c SHA256SUMS-plugin-0.4.0.txt`。将 ZIP 中的 `day-planner-apple-sync/` 放入 `<Vault>/.obsidian/plugins/`，保留完整 native 文件夹，再在 Community plugins 启用。GitHub 手动分发；尚未提交社区目录，不保证目录审核接受当前原生组件或许可方案。

原 `v0.5.0-beta.1` 的 App 0.5.0/build 6、伴随插件 0.3.0 和附件不变。新包与新 tag 独立，不重建或替换旧 App 发行物。

## 安装与权限

随包的 helper 是 `LSUIElement` 后台 agent，无主窗口和 Dock 项，按需安装到同一 Mac 的私有版本目录。它从本地可信 ZIP 提供，不在后台自动从网络下载可执行文件。

点击 **Connect this vault** 明确授权当前路径的 preview + sync；这一步不写入苹果条目。旧 App 的 Bridge 配对和系统权限不复制到 helper。随后在插件使用 **Grant Reminders Access**／**Reminders account**；需要日历时另用 **Grant Calendar Access**／**Calendar account**。权限与来源身份按实体独立，切换账户须重新预览。**Disconnect this vault** 撤销 helper 配对，但保留历史、收据和苹果条目。

当前目标为 Apple silicon/macOS 14+、Obsidian manifest 最低 1.5.0；最低版本声明不代表已验证所有组合。新 helper 为 ad-hoc 签名，没有 Developer ID 或 Apple 公证；若 macOS 阻止打开，在确认来源后参考 [Apple 官方说明](https://support.apple.com/en-us/102445)。不修改 Obsidian 的 Info.plist，不要求全局削弱 Gatekeeper。其他系统、Intel、社区审核和公证均不在本次已验证范围。

## 行为、共用历史与恢复

先保存编辑。仅解析磁盘上的根目录 `YYYY-MM-DD.md` 日记和 Day Planner 标题中的当天明确时间段任务，例如 `- [ ] 09:00 - 10:00 Title`。新安排默认 Add，已导出默认 Skip；Update existing 会重写对应源字段，Add again 明确保留旧条目并创建新副本。冲突须明确选择新建、关联或跳过。单向同步，不改写笔记，不自动删除苹果条目。

helper 复用原 Swift 核心及 EventKit 后端、既有路径身份和去重历史；App 的源代码、版本和发布包保持原样。可顺序切换 App／插件，**同步时只使用一个入口**：helper 的锁不覆盖旧 App，不能同时写入共享历史。

预览在私有目录持久化，30 分钟过期；空闲退出保留近期预览和结果。源、配置、历史、选项或账户变化须重新预览。超时后用 **Check last sync** 查询原任务，不自动重提；部分失败／中断先检查苹果条目，再重新预览并对已关联未完成条目选 Update existing。没有跨进程／跨崩溃严格 exactly-once 保证，Mac 保存也不表示 iPhone 已接收。

偏好存于 Vault 设置；账户 ID、凭据、预览和运行指针不进入 `data.json`。helper 位于 `PluginRuntime/0.4.0/`，独立私有凭据与收据位于 `PluginBridge/`；旧 App 的 `Bridge/` 及共享历史保留。不把整个日记复制到通信目录，URL 只有协议版本和 UUID。本机凭据不能隔离同用户恶意进程。

开发包同版本 runtime 不匹配时，先确认任务结束并检查结果，再退出 Obsidian／helper，只移除对应 `PluginRuntime/0.4.0/DayPlannerAppleSyncHelper.app` 后重开可信新版插件；不得删除 PluginBridge 或历史，也不要把此操作当成未知结果的重试。详见 [插件 README](https://github.com/YuchenWang-leslie/ObsidianPlannerForApple/blob/main/plugin/README.md)。

## 构建与验证边界

`./scripts/package-plugin-release.sh 0.4.0-beta.1` 运行插件干净依赖安装、测试、JS 构建、新 helper 构建和独立打包，不调用旧 App 构建／发布脚本。打包检查精确文件清单、签名、版本、agent／隐私字段、私人路径／本地真实凭据、Apple 元数据及校验和。Linux 上 `npm run build` 仍只构建 JS；缺 helper 时不能发行完整 ZIP。

已通过：59 项插件测试、TypeScript 检查和正式 JS 构建、共享 Swift 核心检查、30 项 helper 协议／存储检查、真实签名 agent 启动、独立 ZIP 打包及校验和。实际 helper 通信和空闲退出后的冷启动也已通过，完整 App 未启动。新增回归检查覆盖启动时的设置域错误、无 state 的账户错误，以及查询被拒绝时仍保留原任务的恢复门禁。

新 helper 的真实权限、账户、写入、持久预览／任务恢复、宿主交互和 iPhone 到达仍待本版实机验收。CI 不计为通过；其他机器首次打开和其他系统版本也未验证。旧版验收不替代上述待测项。

**MIT + Commons Clause v1.0 保持不变：source-available，非 OSI 开源。** 插件及 helper 都附带完整许可；[LICENSE](https://github.com/YuchenWang-leslie/ObsidianPlannerForApple/blob/main/LICENSE) 为准，没有自行变更法律条款。
