# B 站生活 0.3.0

2026-11-01 用户要求更新插件，延续已确认的「只提示结果和需要处理的状态」。0.2.0 已发布资产保持不变。

## 变化

- 手动观看、定时浏览的完整结果和待处理状态统一使用通用 `pet.pet.notify`，对应宠物气泡、聊天记录和驿站入口。
- 完成、失败、取消、待审、审核结果、重启中断、账号及连续监听异常可回看；开始、空轮询和内部阶段保持安静。
- 消息持久重试与稳定 ID 去重，取消、停用、切换身份和重启保护延续；不重复执行 AI 或站外操作。
- 不再通过旧 AI 完成任务接口发送普通消息。权限范围不变，仍为 39 项 manifest 权限及一个展开后的服务权限。

## 兼容与交付边界

同一个 ZIP 支持 `darwin-arm64` 和 `win32-x64`。最低宿主版本提高至 `0.30.2`，需要真实提供 `pet.pet.notify` 的兼容宿主；旧 0.30.0/0.30.1 不应收到此插件更新。宿主仍按受邀渠道分发。

本版本已完成双平台原生验证及隐藏真实 Electron 验证，并发布不可变测试 Release。最终 Release ZIP 已下载复核摘要及安装；市场在兼容 macOS 宿主实际可用后完成更新。Windows 插件及源码宿主集成验证不代替 Windows 宿主发版。

## 验证记录

最终发布证据见下文；前一源码候选验证见 [状态通知](status-notifications.md)。真实 B 站发帖、评论、私信和真实模型质量不在夹具测试范围。

## CI timing regression

The first candidate run 41276281673 built both native platforms. Windows checks passed; macOS exposed the existing cross-process spacing regression (85 ms between requests with a 100 ms setting). A deterministic delayed-transport test reproduced a 40 ms gap. Release now advances the shared spacing floor at completion, including failures, so reservation/disk/scheduling delay cannot compress the next request gap. The original process-spacing assertion remains unchanged. All 268 unit tests, including 16 traffic checks, pass locally.

The reusable market acceptance entry is npm run test:market (exact ZIP, local registry); npm run test:market:official reads the default official index and downloads the registered Release. Both exercise the real permission UI without pre-grants, and use an isolated account fixture without Bilibili login.

## Validated CI candidate

CI run 41276996892 (source 8d3be415127fee13fc7681c5e44e6b46db5fe08a) passed all build and verification jobs: 268 unit tests per OS, 12 macOS native checks and 14 Windows native checks. Downloaded candidate ZIP: 36,063,360 bytes, SHA-256 bc1d27be7a77c3e6890d9372d38ba613da09ca69ab484b45bbbd4b33c2145bcb.

The exact CI ZIP passed 81 hidden real Electron checks on a compatible 0.30.2 Test source host, including complete chat, bubble/hub delivery, cancellation, identity separation and restart. The market UI acceptance passed 10 checks with real consent and byte-for-byte installed file verification. Its only source change after the CI commit fixes canvas-window readiness in the market test; runtime package inputs are unchanged. Screenshots were reviewed. This is candidate evidence; the tag build and actual Release bytes require separate readback.

## Published release verification

- [v0.3.0](https://github.com/xingxiang101/pet-plugin-bili/releases/tag/v0.3.0) is published as a prerelease from `5659409ef6c603ff7d29c732216c2ee3c7f7f252`. [Release CI 41277766762](https://github.com/xingxiang101/pet-plugin-bili/actions/runs/41277766762) passed 268 unit tests per OS, 12 macOS native checks and 14 Windows native checks.
- Actual Release ZIP: 36,063,358 bytes; SHA-256 `99c26f25d63e6684143d93e570dae136911079fe98707a90d1531935f24309ee`. The downloaded bytes, GitHub asset digest, checksum file and release.json agree. This replaces the candidate digest above for delivery; assets and tag remain immutable.
- The final bytes passed 81 macOS and 79 Windows hidden real Electron integration checks, covering complete results, bubble/chat/hub delivery and lifecycle isolation. The two additional macOS checks require POSIX process behavior. Windows reports remain in private host CI; no host source or downloads are included here.
- The same final ZIP also passed all 10 real market UI checks on the merged host source using a local package server: real permission consent, byte-for-byte installed package verification, active anonymous panel, autonomous activity disabled and removal. This verifies the installation path independently from the public network download.
- The official marketplace entry is updated by [registry PR #27](https://github.com/ShunyuYao/pet-plugin-registry/pull/27). Both official index sources return 0.3.0 with this digest and the unchanged permission set. Compatible macOS host 0.30.2 is available through the invited distribution channel.
- An installed macOS 0.30.2 host updated Bili 0.2.0 to 0.3.0 through its actual ZIP installer and reported it active. Previous storage, encrypted secret bytes and grants were preserved; autonomous activity remained disabled. No Bilibili action or AI call was triggered by this acceptance.

The official market test also observes the real UI error while waiting for the host permission dialog. This preserves the download failure reason instead of reporting only a missing dialog. The first online attempt did not complete; a retry identified `net::ERR_NETWORK_CHANGED`. These attempts do not count as a successful official download acceptance.
