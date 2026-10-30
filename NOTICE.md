# NOTICE · 第三方与免责

本桌宠插件基于 `Alterssss/dsh-bili-whale` 迁移，原项目和迁移代码以 **MIT** 许可发布（见 `LICENSE`）；第三方组件分别保留自身许可。

## 它依赖/参考了这些第三方

| 名称 | 用途 | 许可 / 说明 |
|---|---|---|
| **Bilibili API** | 全部功能都调 B 站公开接口 | 非官方；本项目**不包含** B 站任何代码或数据 |
| **bilibili-API-collect** | 上游曾参考的社区接口资料 | 当前源码和市场安装包不包含其原文参考文档；不将这些文档声明为本项目的 MIT 代码 |
| **qrcode / pngjs / dijkstrajs** | 本地生成二维码 PNG | MIT；只包含实际运行入口依赖及各库的许可证，不包含二维码命令行工具及其依赖 |
| **ffmpeg** | 抽帧 / 看画面（`tools/lib/ffmpeg.mjs` 只是**定位并调用**它） | **LGPL v2.1+**（若用 GPL 构建则为 GPL）。随包提供 macOS arm64 和 Windows x64 的 LGPL 构建，关闭 GPL/nonfree；二进制、许可证、完整固定版本源码归档与摘要分别在 bin/darwin-arm64 与 bin/win32-x64，构建脚本在 scripts/build-ffmpeg.sh。源码来自 https://github.com/FFmpeg/FFmpeg/tree/n6.1.1；开发依赖 ffmpeg-static 不随包分发|
| **Node.js** | 运行环境 | MIT |
| **zlib 1.3.2** | Windows FFmpeg 的静态压缩依赖 | Zlib；固定官方源码来自 https://github.com/madler/zlib/releases/tag/v1.3.2，许可证与对应源码分别在 `bin/win32-x64/ZLIB-LICENSE` 和 `zlib-source.tar.xz`，摘要见同目录 `SOURCE.json` |
| **GCC runtime** | Windows FFmpeg 的编译器运行库 | GPL-3.0-or-later WITH GCC-exception-3.1；随包保留 `bin/win32-x64/licenses/gcc-runtime/COPYING3` 和 `COPYING.RUNTIME`。实际 GCC 与 MSYS2 包版本见 `SOURCE.json` 和 `build-toolchain.txt`；来源 https://gcc.gnu.org/ |
| **MinGW-w64 runtime** | Windows FFmpeg 的 Windows 运行库适配 | 按组件保留上游许可；完整许可文件在 `bin/win32-x64/licenses/mingw-runtime`，MSYS2 包版本见 `build-toolchain.txt`；来源 https://www.mingw-w64.org/ |

## 免责

- 本项目是**个人自用工具的公开版**：它用**你自己的账号**在 B 站做评论/回复/发动态等动作，**后果由使用者自负**。
- 不要用于批量刷量、水军、骚扰、绕过风控或任何违反 B 站用户协议的行为。
- 遵循平台规则，撞到风控（验证码 / 限流 / 判刷屏）就该停手，本项目内置了"撞到就停"的护栏。
- 本项目与 B 站、DeepSeek 官方均无隶属关系。
