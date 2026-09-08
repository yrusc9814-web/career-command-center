---
name: career-ops
description: Career Command Center Claude Code compatibility skill — 中国大陆求职指挥中心（Agent-neutral，本 skill 为 Claude 侧接入入口）：评估岗位、生成定制简历、扫描门户、浏览器只读采集、追踪申请
user_invocable: true
argument-hint: "[JD截图/文本/URL] | scan | browser-search | inbox | tracker | offer | offers | pdf | contact | deep | apply | pipeline | batch | training | project | story-sync"
arguments: mode
---

# career-ops — Router（Career Command Center / 中国大陆版）

> 本 skill 是 Career Command Center 的 **Claude Code 兼容入口**；产品本身是 agent-neutral 的，其他宿主以 `AGENTS.md` + `modes/*.md` 为准。

## Mode Routing

根据 `{{mode}}` 决定模式：

| 输入 | Mode |
|------|------|
| (空 / 无参数) | `discovery` — 显示命令菜单 |
| **JD 截图（图片附件）** | **`auto-pipeline`**（推荐主路径，国内 Boss/Mokahr 等风控平台必用） |
| JD 文本（粘贴）| **`auto-pipeline`** |
| 岗位 URL（无子命令） | `auto-pipeline` — 但**国内风控门户 URL 通常抓不到 JD**（登录墙/SPA/验证码），会让用户截图 |
| `offer` | `offer`（单岗位评估 A-F） |
| `offers` | `offers`（多 offer 对比） |
| `contact` | `contact`（脉脉/微信/LinkedIn 触达） |
| `deep` | `deep`（公司调研 prompt） |
| `pdf` | `pdf`（生成定制 PDF） |
| `training` | `training`（评估课程/证书） |
| `project` | `project`（评估 portfolio 项目） |
| `tracker` | `tracker`（查看申请状态） |
| `pipeline` | `pipeline`（处理待办 URL inbox） |
| `apply` | `apply`（实时表单填写助手） |
| `scan` | `scan`（**线索发现**，仅 URL+标题，不取 JD） |
| `browser-search` | `browser-search`（**可选浏览器自动化**：真实浏览器只读岗位采集，宿主需具备 browser-control capability，带风控熔断） |
| `inbox` | `inbox`（处理 bookmarklet 捕获的 JD 文件，自动评估）|
| `story-sync` | `story-sync`（扫 reports/* 抽取 Block F，累积到 story-bank.md）|
| `batch` | `batch`（批量处理） |

**Auto-pipeline 检测：** 如果 `{{mode}}` 不是已知子命令但包含：
- JD 文本（出现关键词："岗位职责"、"任职要求"、"工作描述"、"responsibilities"、"requirements"、公司名 + 岗位名）
- 图片附件（截图）
- 岗位 URL

→ 执行 `auto-pipeline`。

如果 `{{mode}}` 既不是子命令也不像 JD，显示 discovery。

**🇨🇳 中国大陆使用规则：**
> 如果用户给的是国内招聘门户 URL（zhipin.com / liepin.com / lagou.com / mokahr.com / feishu.cn 等），先尝试 WebFetch 一次，**失败就立刻停止自动化尝试**，让用户截图给你。**不要在反爬上反复挣扎**。

---

## Discovery Mode（无参数时）

输出下面这段紧凑 cheatsheet（不要展开成长版菜单；输入框上方已有 argument-hint，正文不需重复列子命令的全部说明）：

```
career-ops — Career Command Center（Agent-neutral 中国大陆求职指挥中心）

🎯 主路径：JD 截图 / 粘贴文本 / 公司+岗位 URL → 直接发给我 → 自动评估 + report + PDF + tracker

⚡ 子命令（/career-ops <name>）：
  线索 & 批处理   scan       browser-search   inbox      pipeline    batch
  单岗位          offer      offers     pdf         contact     deep        apply
  追踪 & 沉淀     tracker    story-sync
  ROI 评估        training   project

⚠️ 国内风控门户（Boss/拉勾/猎聘/Mokahr/飞书）通常抓不到 JD（登录墙/SPA/验证码）→ 截图最快
🔖 bookmarklet：tools/README.md（一次安装，之后任意 JD 页一键 → inbox）
🌐 browser-search：可选浏览器自动化，需宿主具备 browser-control capability（见 modes/browser-search.md）

不确定哪个？直接发 JD 给我（auto-pipeline 默认），或问"<name> 怎么用"。
```

---

## Context Loading by Mode

After determining the mode, load the necessary files before executing:

### Modes that require `_shared.md` + their mode file:
Read `modes/_shared.md` + `modes/{mode}.md`

Applies to: `auto-pipeline`, `offer`, `offers`, `pdf`, `contact`, `apply`, `pipeline`, `scan`, `inbox`, `batch`, `browser-search`

### Standalone modes (only their mode file):
Read `modes/{mode}.md`

Applies to: `tracker`, `deep`, `training`, `project`, `story-sync`

### Domain reference (loaded by `offer` / `batch` via their mode files):
`modes/interview-questions.md` — 采购面试题库（15 主题 × 4 职级），由 Block F 引用，不单独调用

### Modes delegated to subagent:
For `scan`, `apply` (with Playwright), and `pipeline` (3+ URLs): launch as Agent with the content of `_shared.md` + `modes/{mode}.md` injected into the subagent prompt.

```
Agent(
  subagent_type="general-purpose",
  prompt="[content of modes/_shared.md]\n\n[content of modes/{mode}.md]\n\n[invocation-specific data]",
  description="career-ops {mode}"
)
```

Execute the instructions from the loaded mode file.
