# career-ops 浏览器 bookmarklets（JD 采集路线 B：Local Bookmarklet）

在你自己的浏览器里，把**你已经打开的 JD 页面**结构化捕获到本地 inbox（bookmarklet 会解除当前页面的反复制样式、读取 DOM 后抽取字段），供 Career Command Center / 你的 AI Agent 后续分析。它不负责、也不需要"绕过登录" — 你本来就在登录态下查看页面。

## 工作原理

```
浏览器（你看到的 JD 页面）
    │
    │ 1. 点 bookmarklet 按钮
    ▼
本地 HTTP 服务器（localhost:8787）
    │
    │ 2. 收到 POST，写 inbox/*.json
    ▼
inbox/jd-{时间戳}-{平台}-{标题}.json
    │
    │ 3. 你跑 /career-ops inbox
    ▼
AI Agent / Career Command Center 分析 → report + PDF + tracker
```

## 一次性安装（5 分钟）

### Step 1 — 启动本地服务器（每次开机后跑一次）

```bash
cd /path/to/career-ops
npm run inbox-server
# 或 node tools/jd-inbox-server.mjs
```

服务器跑在 `http://localhost:8787`。**保持终端开着**，关了就要重启。

如果想后台跑：
```bash
nohup node tools/jd-inbox-server.mjs > logs/inbox-server.log 2>&1 &
```

### Step 2 — 安装 bookmarklets

1. 终端跑：`npm run build-bookmarklets`（生成 `tools/install.html`）
2. 浏览器打开 `tools/install.html`（直接 `open tools/install.html`）
3. 显示书签栏：Chrome/Edge/Safari `⌘+Shift+B`
4. 把彩色按钮 **拖** 到书签栏

推荐至少装这 3 个：
- 🌐 **JD Capture (通用)** — 80% 场景用这个
- 💼 **Boss 直聘** — Boss 详情页专用
- 🏢 **大厂 Careers SPA** — 字节/阿里/腾讯/美团 等

## 日常使用（每次抓 JD 5 秒）

1. 浏览器打开任意 JD 页（Boss / 猎聘 / 拉勾 / 公司 careers / Mokahr）
2. 点书签栏对应的 bookmarklet
3. 看到 `✓ JD captured` 弹窗 → 收工
4. 回到你使用的 Agent 跑 `/career-ops inbox` 自动评估全部待处理

## 5 个 bookmarklets 怎么选

| Bookmarklet | 适合的页面 |
|-------------|-----------|
| 🌐 通用 | V2EX 招聘 / GitHub README / 公司自有 careers 静态页 / 不确定时先试这个 |
| 💼 Boss 直聘 | `zhipin.com` 详情页（专门处理 Boss 反复制）|
| 🎯 猎聘 | `liepin.com` 详情页 |
| 🛒 拉勾 | `lagou.com` 详情页 |
| 🔑 Mokahr ATS | DeepSeek / 部分独角兽 ATS（`mokahr.com`、`app.mokahr.com`、`*.mokahr.com`）|
| 🏢 大厂 SPA | 字节 / 阿里 / 蚂蚁 / 腾讯 / 美团 / 快手 / 小红书 careers / B 站 / 网易 / 京东 / 拼多多 / 百度 / 滴滴 / 智谱 / MiniMax / 阶跃 / 面壁 等 careers SPA |

## 常见问题

**Q: 弹窗说"❌ 服务器没启动"**
A: 先跑 `node tools/jd-inbox-server.mjs`。

**Q: Boss 直聘点了 bookmarklet 但抽到的内容不对 / 太少**
A: 确保你已经登录 Boss + 完整看到 JD（拉到底部）再点。Boss 有时会懒加载详情。

**Q: Mokahr 抽到的是 iframe 外壳，没有 JD 内容**
A: Mokahr 多数嵌在公司主域名的 iframe 里，跨域 → 无法读取。**右键 iframe → 在新 tab 打开 iframe URL**，然后再点 Mokahr bookmarklet。

**Q: 公众号文章 / 小红书笔记里的 JD 抓不到**
A: 微信/小红书 ToC 端 DOM 经过加密 / 反爬，bookmarklet 不能搞。请用截图给你的 Agent。

**Q: 怎么知道服务器收到了？**
A: 启动服务器的终端会实时打印每次收到的 payload（platform、URL、文本长度）。

**Q: 想看 inbox 里有什么？**
A: `ls -lt inbox/*.json` 看时间倒序的待处理文件，或 `cat inbox/{文件名}` 看 JSON 内容。

**Q: 想自己改某个 bookmarklet 的 selector？**
A: 编辑 `tools/bookmarklets/{name}.js`，重跑 `npm run build-bookmarklets`，再次拖到书签栏（覆盖旧版）。

## 安全 & 隐私（两阶段语义，务必分清）

- 服务器只监听 `127.0.0.1`（localhost），外网访问不到
- `inbox/*.json` 是你的本地 JD 数据，已 gitignore
- **捕获阶段（本页描述的 bookmarklet 流程）：** bookmarklet 本身只把当前页面的提取结果发送到用户本机 `localhost`，不经过任何第三方
- **分析阶段（你后续主动发起）：** 当你随后要求所选 AI Agent 分析 inbox 内容时，相关内容会由对应 Agent / model provider 按其自身数据处理方式处理 — 不要理解为"整个工作流的数据永远不会进入任何模型服务"

## 文件清单

```
tools/
├── jd-inbox-server.mjs          # 本地 HTTP 服务器（端口 8787）
├── build-bookmarklets.mjs       # 生成 install.html
├── install.html                 # 浏览器打开拖按钮（自动生成）
├── README.md                    # 本文件
└── bookmarklets/
    ├── universal.js             # 通用
    ├── boss-zhipin.js           # Boss 直聘
    ├── liepin.js                # 猎聘
    ├── lagou.js                 # 拉勾
    ├── mokahr.js                # Mokahr ATS
    └── dachang-spa.js           # 大厂 careers SPA

inbox/                           # bookmarklet 写入的 JSON 落地（gitignored）
├── jd-{ts}-{platform}-{slug}.json
└── processed/                   # Claude 处理完移到这里
```
