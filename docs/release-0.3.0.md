# B 站生活 0.3.0

2026-11-01 用户要求更新插件，延续已确认的「只提示结果和需要处理的状态」。0.2.0 已发布资产保持不变。

## 变化

- 手动观看、定时浏览的完整结果和待处理状态统一使用通用 `pet.pet.notify`，对应宠物气泡、聊天记录和驿站入口。
- 完成、失败、取消、待审、审核结果、重启中断、账号及连续监听异常可回看；开始、空轮询和内部阶段保持安静。
- 消息持久重试与稳定 ID 去重，取消、停用、切换身份和重启保护延续；不重复执行 AI 或站外操作。
- 不再通过旧 AI 完成任务接口发送普通消息。权限范围不变，仍为 39 项 manifest 权限及一个展开后的服务权限。

## 兼容与交付边界

同一个 ZIP 支持 `darwin-arm64` 和 `win32-x64`。最低宿主版本提高至 `0.30.2`，需要真实提供 `pet.pet.notify` 的兼容宿主；旧 0.30.0/0.30.1 不应收到此插件更新。宿主仍按受邀渠道分发。

本版本先构建候选并完成双平台原生验证及隐藏真实 Electron 验证，再发布不可变测试 Release。最终 Release ZIP 需下载复核摘要及安装；市场登记仅在兼容宿主实际可用后更新。Windows 原生插件验证不代替 Windows 宿主发版。

## 验证记录

准备中。前一源码候选验证见 [状态通知](status-notifications.md)；旧候选的摘要与绿灯不代表 0.3.0 安装包已验证。真实 B 站发帖、评论、私信和真实模型质量不在夹具测试范围。

## CI timing regression

The first candidate run 41276281673 built both native platforms. Windows checks passed; macOS exposed the existing cross-process spacing regression (85 ms between requests with a 100 ms setting). A deterministic delayed-transport test reproduced a 40 ms gap. Release now advances the shared spacing floor at completion, including failures, so reservation/disk/scheduling delay cannot compress the next request gap. The original process-spacing assertion remains unchanged. All 268 unit tests, including 16 traffic checks, pass locally.

The reusable market acceptance entry is npm run test:market (exact ZIP, local registry); npm run test:market:official reads the default official index and downloads the registered Release. Both exercise the real permission UI without pre-grants, and use an isolated account fixture without Bilibili login.

## Validated CI candidate

CI run 41276996892 (source 8d3be415127fee13fc7681c5e44e6b46db5fe08a) passed all build and verification jobs: 268 unit tests per OS, 12 macOS native checks and 14 Windows native checks. Downloaded candidate ZIP: 36,063,360 bytes, SHA-256 bc1d27be7a77c3e6890d9372d38ba613da09ca69ab484b45bbbd4b33c2145bcb.

The exact CI ZIP passed 81 hidden real Electron checks on a compatible 0.30.2 Test source host, including complete chat, bubble/hub delivery, cancellation, identity separation and restart. The market UI acceptance passed 10 checks with real consent and byte-for-byte installed file verification. Its only source change after the CI commit fixes canvas-window readiness in the market test; runtime package inputs are unchanged. Screenshots were reviewed. This is candidate evidence; the tag build and actual Release bytes require separate readback.
