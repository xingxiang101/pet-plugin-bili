# CI 安装包与市场投稿

当前插件需要宿主尚未发布的后台 AI 和完成回复交付接口。`manifest.json` 中的版本下限不能单独证明兼容；公开源码和 CI 配置也不代表已经上架。市场登记需等待真实兼容宿主发布，核对安装包和权限，并按官方登记仓库要求提交审核。

## 先验证 CI 构建

仓库的 `Build and prerelease plugin` 工作流支持手动运行。手动运行只构建候选、上传 Actions artifact，不创建 GitHub Release。应先在自己的公开仓库运行成功，再讨论打标签发布。

工作流使用 GitHub 的 `macos-15` ARM64 runner，启动后再次核对系统与架构。它按锁文件安装依赖，从固定官方源码归档构建 LGPL FFmpeg，校验二进制架构和动态库依赖，运行插件测试，再使用项目现有构建器生成完整安装 ZIP。FFmpeg 的许可证、完整源码归档、来源摘要和构建脚本均随包提供；开发依赖 `ffmpeg-static` 不进入安装包。

产物包括安装 ZIP、对应 `.sha256` 和记录源码提交、CI run、平台及摘要的 `release.json`。Actions 外层 artifact ZIP 仅用于传递文件，应提取其中的 `bili-<version>.zip` 作为插件安装包。

公开 CI 不访问宿主私有源码、测试账号或下载渠道，因此这里的 `npm test` 和包内容校验不能代替宿主中的真实 Electron 验收。对最终 CI ZIP 还需在受邀测试环境验证安装、功能、停用、重启和卸载，不能复用本机旧 ZIP 的摘要作为 CI 安装包证据。

## 显式标签只发布测试候选

确认版本和发布范围后，提交源码与工作流，再推送与 manifest 完全一致的 `v<version>` 标签。工作流拒绝不匹配的 tag；只有 tag 事件的发布 job 获得 `contents: write`，构建 job 保持只读仓库权限。

标签发布始终标记为 prerelease，且不设为 latest。已有 Release 不会被覆盖；重新构建或改动安装包，应使用新版本和新标签。发布后下载实际 Release ZIP 并复算 SHA-256，以该文件作为后续安装和登记依据。

## 市场登记独立审核

CI Release 成功后，按官方 `pet-plugin-registry` 的当前 schema 和政策准备登记 PR。条目需要实际仓库、Release 下载地址、摘要、完整权限、`nodeAccess: true` 和已验证的最低宿主要求。源码推送、CI 成功、Release 上传、PR 提交和官方登记合并分别记录；只有登记审核合并、客户端刷新并安装验证后，才可称为市场可用。

宿主保持受邀测试渠道，不在插件源码、元信息、Release、CI 日志或投稿 PR 公开其安装包或更新源地址。

参考：[GitHub runner 标签与架构](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job)、[工作流权限](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idpermissions)、[官方插件登记仓库](https://github.com/ShunyuYao/pet-plugin-registry)。
