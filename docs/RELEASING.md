# CI 安装包与市场投稿

0.2.0 候选的变更和兼容范围见 [0.2.0 发布说明](release-0.2.0.md)。当前已发布的双平台包是 0.1.1；后续版本使用实际 manifest、CI 和 Release 回执，不复用已有版本的摘要。

插件 `0.1.1` 使用同一安装 ZIP 支持 macOS Apple 芯片（`darwin-arm64`）和 Windows x64（`win32-x64`），要求含后台 AI、完成回复交付及平台检查接口的桌宠 `0.30.0` 或以上兼容测试版。插件 manifest 和市场条目都须声明这两个平台及最低宿主版本。公开源码和 CI 配置不代表已经上架；先验证 CI 候选，再发布测试 Release，待真实兼容宿主可用且最终包验收完成后提交市场审核。已发布的 `0.1.0` 仍为仅 Mac 版本，不覆盖原有资产。

## 先验证 CI 构建

仓库的 `Build and prerelease plugin` 工作流支持手动运行及专项候选分支推送。候选事件只构建并上传 Actions artifact，不创建 GitHub Release。应先在自己的公开仓库验证候选，再打标签发布。

工作流先分别在 `macos-15` ARM64 和 `windows-2022` x64 runner 核对系统架构，从固定官方源码归档构建 LGPL FFmpeg。Windows 使用 MSYS2 UCRT64，静态链接固定源码构建的 zlib，记录 GCC 与 MinGW-w64 运行库许可及工具链版本。构建检查 Mac 动态库与 Windows DLL 导入，拒绝额外非系统依赖；两个二进制都只保留 `file`、`pipe` 协议。

随后将两个平台目录组装为一个 `bili-<version>.zip`，校验平台、来源与许可证，并记录跨平台 ZIP 文件模式。macOS 和 Windows 验证任务均下载这一个 ZIP，以 `scripts/verify-release.py` 核对文件摘要和包内来源并解包；在各自系统运行完整 `npm test`，再以 `BILI_RELEASE_DIR` 指向解包目录运行 `npm run test:release:native`。后者使用真实本地 HTTP 下载和包内原生 FFmpeg 抽帧，通过模拟宿主 AI 接口检查一次聊天交付，并验证中文及空格缓存路径。两个平台的验证报告随候选保留，缺任一平台成功结果不能发布。

FFmpeg 的许可证、完整对应源码归档、来源摘要和构建脚本均随包提供；Windows 另附 zlib 源码、zlib/GCC runtime/MinGW-w64 许可。开发依赖 `ffmpeg-static` 只生成测试视频，不进入安装包。

产物包括安装 ZIP、对应 `.sha256` 和记录源码提交、CI run、平台、最低宿主要求及摘要的 `release.json`。回执中的 `ci-candidate` 仅说明构建来源，不代表宿主兼容验收或市场登记已经完成。Actions 外层 artifact ZIP 仅用于传递文件，应提取其中的 `bili-<version>.zip` 作为插件安装包。

公开 CI 不访问宿主私有源码、测试账号或下载渠道，因此这里的原生插件测试不能代替宿主中的真实 Electron 验收。对最终 CI ZIP 还需在私有宿主环境通过 `PET_PLUGIN_HOST_DIR`、`PET_BILI_PLUGIN_ZIP` 指定真实宿主和安装包，执行 `npm run test:electron`，验证安装、真实聊天输入、后台抽帧、回复、取消、重启和卸载。B 站账号和模型仍为本地测试夹具；生产扫码及真实模型效果应另外记录。不能复用本机旧 ZIP 的摘要作为新安装包证据。

## 显式标签只发布测试候选

确认版本和发布范围后，提交源码与工作流，再推送与 manifest 完全一致的 `v<version>` 标签。工作流拒绝不匹配的 tag；只有 tag 事件的发布 job 获得 `contents: write`，构建 job 保持只读仓库权限。

标签发布始终标记为 prerelease，且不设为 latest。已有 Release 不会被覆盖；重新构建或改动安装包，应使用新版本和新标签。发布后下载实际 Release ZIP 并复算 SHA-256，以该文件作为后续安装和登记依据。

桌宠市场可以登记带 prerelease 标记的 Release 安装包。该标记表示测试范围；它不会自动登记插件，也不会放宽宿主版本和平台限制。

## 市场登记独立审核

CI Release 成功后，按官方 `pet-plugin-registry` 的当前 schema 和政策准备登记 PR。条目需要实际仓库、Release 下载地址、摘要、完整权限、`nodeAccess: true`、`platforms: ["darwin-arm64", "win32-x64"]` 和已验证的最低宿主要求 `0.30.0`。未经实际发布和校验，不填写下载地址或摘要。源码推送、CI 成功、Release 上传、PR 提交和官方登记合并分别记录；只有登记审核合并、客户端刷新并安装验证后，才可称为市场可用。

投稿说明应提供以下审核信息：

- **来源与安装包**：公开源码提交、成功 CI run、实际 Release、安装 ZIP 的 SHA-256 和大小；明确 `0.1.1` 支持 Apple 芯片 Mac 和 Windows x64，并列出两个原生平台的验收结果。
- **宿主要求**：说明已在兼容的桌宠 `0.30.0` 测试构建验证。列出市场安装、扫码登录、聊天发送 B 站链接、后台抽帧、同一聊天收到回复、停用、重启和卸载的实际结果；未做的步骤如实标明。
- **权限**：逐项复制 manifest 的 `permissions`，再将 `services: ["bili-control"]` 展开为 `service:bili-control`。当前共 40 项，其中网络域名 30 项；以提交版本为准，不能只复制旧版权限列表。
- **本机访问**：明确 `nodeAccess: true`，说明媒体缓存、随机任务目录、随包 FFmpeg 子进程、凭据 `pet.secrets`、卸载后保留数据和默认关闭自主活动。
- **网络访问**：固定域名及用途见 README。插件对 B 站返回的媒体、字幕、图片和直播 WebSocket 地址逐域校验，读取跳转逐跳检查；未知域名拒绝，已登记的备用媒体节点可回退。市场版关闭任意 Webhook。Node.js 直接联网不受宿主逐域名沙箱限制，插件内校验不能宣传为整个 Node 环境的沙箱。GitHub 域名仅用于显式指定公开仓库的素材读取。
- **许可证与安全**：随包 MIT 说明、LGPL FFmpeg 许可证、完整对应源码、构建脚本和来源摘要；二维码只打包实际入口需要的库、元信息和许可证，不包含未使用的 CLI 依赖、开发用 `ffmpeg-static`、测试资料或私人配置，也不在运行时下载可执行程序。最终 ZIP 检查动态加载与求值硬禁；FFmpeg 输入限本地协议。

宿主保持受邀测试渠道，不在插件源码、元信息、Release、CI 日志或投稿 PR 公开其安装包或更新源地址。

参考：[GitHub runner 标签与架构](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job)、[工作流权限](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idpermissions)、[官方插件登记仓库](https://github.com/ShunyuYao/pet-plugin-registry)。
