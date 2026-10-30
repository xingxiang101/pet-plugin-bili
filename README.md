# B 站生活：桌宠插件

让当前桌宠浏览 B 站、理解视频、记录经历，并按设置处理评论、主人私信、收藏和动态。沿用宿主当前宠物的人设与记忆，不创建独立鲸鱼角色。

本插件基于 `Alterssss/dsh-bili-whale` 迁移。首包仅支持 **macOS Apple 芯片（`darwin-arm64`）**，要求 **桌宠 0.30.0 或以上的兼容测试版**，包含后台 AI、完成回复交付及平台检查接口。宿主测试版通过受邀渠道提供。Release 和桌宠插件市场的实际状态以对应页面为准；源码或 CI 构建成功不代表已经上架。

## 已迁移的能力

- 推荐、搜索、关注来源选题、收藏夹、本地观看经历与账号诊断。
- 视频下载、字幕、场景抽帧、画面拼图，以及将图片交给当前宠物分析。
- 夜间作息、配额、自主观看、日记和分享评估；长任务等待真实完工后续接分析。
- 评论、主人私信、弹幕、收到的点赞通知、收藏和文字／图片动态；有风险的互动先形成草稿，通过面板核对后发送。
- 二维码登录、设置、任务取消、草稿审批、日记查看和本地通知。

默认关闭自主活动。安装后在「B 站生活」面板连接一次 B 站账号，然后回到桌宠聊天，发送视频链接或 BV 号，也可以附上问题，例如「帮我看看这个视频，讲讲你最喜欢的画面：https://www.bilibili.com/video/BV…」。只有链接时，宠物会概括视频并聊聊看法。单次观看无需填写主人 UID 或开启自主活动。

宠物先受理观看请求，下载和抽帧在后台继续；完成后会在同一桌宠聊天回复。期间可以继续聊天或关闭窗口，结果会保存在聊天历史中。插件使用 FFmpeg 抽取真实画面和字幕带，再交给当前宠物理解。面板只管理账号、设置和任务，不再提供粘贴视频的观看表单；「任务与日记」保留进度、定向取消和完整结果。

聊天观看使用 `bili_watch_video({target, question?})`，受理后立即返回 `taskId`，不会让主聊天等待下载或轮询素材。询问进度或取消时使用 `bili_watch_task({id, cancel?})`。同一宠物和 B 站账号下，相同视频与问题的在途请求复用已有任务；完成或取消后再次发送可以重新观看。任务完成后只交付一次最终回复，不会把早期素材当成看完的结果。

目前接收完整 BV 号或 B 站官方 HTTPS 视频链接，暂不支持短链接和分 P 视频。画面分析依据抽帧采样与可读字幕带，不包含音频转写。单次观看只读取材料，不在 B 站发送评论、私信或动态；若未取得截图则不会调用模型声称已看过。观看失败时显示本地宠物提示，聊天查询可读到失败状态；失败提示不会伪造观看回复或新增模型请求。聊天暂时无法接收成功结果时，仍可在聊天查询任务结果，面板也保留完整回复；日记保存失败不会重新调用模型。

自主浏览和消息互动按「作息与互动」中的开关另行启用。原始功能说明保存在 [UPSTREAM-README.md](UPSTREAM-README.md)；其中 DSH 安装、旧凭据文件和独立角色配置不适用于本插件。「浏览与管理」中的「读取视频素材」提供原始材料，不会自动生成聊天回复。

聊天工具的 `--go` 只返回待审批方案，不会直接执行对外写操作；聊天来源和模型转述的「已批准」都不算审批。评论可先保存为本地待审草稿，由主人在面板核对后批准。AI 创建草稿不会触发通知。面板「现在浏览一次」在自主活动关闭时仅允许读取、分析及本地日记／草稿；开启自主活动后，分享和监听回复仍须符合各自开关、通道及当前事件。收藏、动态发布／编辑／删除和评论删除均由主人在面板明确执行。

## 本地权限与数据

插件在 Node.js 工具进程运行，可以访问本机文件、创建子进程和直接联网。它会连接 B 站接口及视频 CDN，下载媒体、执行 FFmpeg、发送设置中启用的通知。宿主的逐域名网络权限不能沙箱化 Node.js 本身；发布登记必须如实标记 `nodeAccess: true`。

Node.js 文件和进程能力用于媒体流下载、本地缓存、工具子进程及 FFmpeg；宿主 SDK 没有对应的二进制流、媒体处理或通用子进程接口。本地通知还可按主人保存的设置执行指定程序（固定程序与参数数组，不经过 shell），或向指定文件追加通知文本；系统通知调用操作系统通知程序。选择这些通知方式会授予相应的本地执行或写文件能力，通知正文会传给所选程序或文件。

已声明的固定网络域名及用途：

| 域名 | 用途 |
| --- | --- |
| `api.bilibili.com`、`passport.bilibili.com`、`api.vc.bilibili.com` | 视频、账号、二维码登录、私信和动态接口 |
| `api.live.bilibili.com`、`live.bilibili.com` | 直播资料和弹幕接口 |
| `www.bilibili.com`、`comment.bilibili.com` | 页面内容和视频弹幕材料 |
| `i0.hdslb.com`、`i1.hdslb.com`、`i2.hdslb.com` | 封面、图片及人工字幕材料 |
| `aisubtitle.hdslb.com` | AI 字幕材料 |
| `upos-sz-estgcos.bilivideo.com`、`upos-sz-mirrorcos.bilivideo.com`、`upos-sz-mirrorcosb.bilivideo.com`、`upos-sz-mirrorcoso1.bilivideo.com`、`upos-sz-mirrorcosov.bilivideo.com` | 视频 CDN |
| `upos-sz-mirrorali.bilivideo.com`、`upos-sz-mirroralib.bilivideo.com`、`upos-sz-mirroraliov.bilivideo.com` | 视频 CDN |
| `upos-sz-mirrorhw.bilivideo.com`、`upos-sz-mirrorhwb.bilivideo.com`、`upos-sz-mirrorhwfn.bilivideo.com` | 视频 CDN |
| `upos-sz-mirror08c.bilivideo.com`、`upos-sz-mirror08h.bilivideo.com`、`upos-sz-mirror08ct.bilivideo.com`、`upos-hz-mirrorakam.akamaized.net` | 视频 CDN |
| `broadcastlv.chat.bilibili.com`、`broadcast.chat.bilibili.com` | 可选的直播弹幕 WSS 连接，默认仍使用接口轮询 |
| `api.github.com`、`raw.githubusercontent.com` | 仅在读取视频素材时显式指定 `--repo`，补充该公开仓库的信息和 README |

网络层只接受上述精确域名的标准 HTTPS / WSS 地址。每次跳转都重新检查目标域名；跨域读取跳转不转发 Cookie 或认证头，写操作不自动跟随跳转。图片、字幕和视频 CDN 不接收 B 站 Cookie。插件不会因为某个地址来自 B 站接口就自动放行，也不允许通配域名、本机地址或任意端口。

FFmpeg 只读取已下载的本地文件，在每个 `-i` 前设置 `-protocol_whitelist file,pipe`，不会通过媒体中的远程引用自行联网。该参数按 [FFmpeg 协议选项](https://ffmpeg.org/ffmpeg-protocols.html#Protocol-Options)和[输入参数顺序](https://www.ffmpeg.org/ffmpeg.html#Description)配置；用户指定其他 FFmpeg 时同样适用。

视频下载优先使用接口返回的已声明直链或备用地址。B 站可能返回其他地区的 CDN、字幕或直播节点；这些节点会被拒绝，并显示未声明的域名。若没有可用的已声明视频地址，本次观看失败；直播 WebSocket 无可用节点时可改用默认轮询。维护者需审核新域名并通过市场更新后才能支持，不能保证所有视频或地区节点均可用。

**市场版本暂未开放 Webhook 通知**，设置页不可配置，旧设置和命令行调用也不会向 Webhook 地址外发。可选择系统通知、主人 B 站私信或已配置的本地通知方式。
市场权限列表还需包含 `services` 中的 `bili-control` 对应项 `service:bili-control`，用于面板与插件控制服务通信。

登录凭据只存宿主 `pet.secrets`，调用时经内存 IPC 传递，不写普通配置、命令行参数、环境变量或日志。配置和日记按宿主账号／宠物上下文及 B 站账号分仓；媒体存于 `~/.desktop-pet-plugin-data/bilibili/` 下的随机目录。不会自动读取旧版私人账本。卸载保留日记和缓存。

后台 AI 仅开放本插件声明的工具，首屏单次观看使用固定材料且不开放工具。后台任务沿用当前宠物的人设，并把有界摘要写入该宠物的经历。主人发起的多阶段工具任务只将最后一次已完成的 AI 回复交付到桌宠聊天，自主巡视保持静默。切换宿主账号、宠物或 B 站账号时，旧任务停止；取消也会撤销尚未交付的最终回复。重启不会自动重放任务或结果不确定的外部写操作。

## FFmpeg 与安装包

运行时不下载或安装执行程序。首包随包提供 **macOS arm64** 的 FFmpeg n6.1.1 LGPL 构建，包括许可证、完整上游源码归档、源码摘要、配置和构建脚本。插件使用前校验包内二进制摘要；其他平台尚不支持，需各自构建及实机验证后另行发布。`manifest.json` 的 `platforms` 和构建产物的平台列表必须一致。

`scripts/build-ffmpeg.sh` 从固定官方源码编译，关闭 GPL、nonfree 和自动依赖探测。开发依赖 `ffmpeg-static` 仅用于测试素材，不进入发布 ZIP，其本机下载产物不能替代随包构建。

构建时传入已解压源码、输出目录和固定官方源码归档三个绝对路径：

```sh
sh scripts/build-ffmpeg.sh /absolute/FFmpeg-n6.1.1 /absolute/pet-plugin-bili/bin/darwin-arm64 /absolute/ffmpeg-n6.1.1.tar.gz
```

脚本校验源码归档 SHA-256，再生成二进制、完整源码归档、许可证与 SOURCE.json；不在用户运行插件时执行。

## 开发和验证

```sh
npm ci
npm test
npm run build
PET_PLUGIN_HOST_DIR=/absolute/path/to/desktop-pet/demo npm run test:electron
```

`dist/build.json` 记录 ZIP 的 SHA-256、大小和平台。ZIP 只包含新入口、面板、引擎、复用工具和生产依赖，旧 DSH 入口与旧调度器不会加载。

CI 候选、带标签的测试 Release 和桌宠插件市场登记的顺序及审核要求见 [docs/RELEASING.md](docs/RELEASING.md)。测试 Release 可以作为市场安装来源；是否上架取决于官方登记审核和最终安装验收。

自动验证使用隔离宿主资料、本地模拟账号／模型和合成视频，不发送真实 B 站评论、私信或动态。真实 B 站扫码、观看效果及发送后回读仍需单独验收，不能用模拟测试替代。

## 来源

原始提交：`Alterssss/dsh-bili-whale@8b0009f8ce2ebdc421afcb2e727b19ac18912ec6`。原作者 MIT 许可和第三方说明见 [LICENSE](LICENSE) 与 [NOTICE.md](NOTICE.md)。
