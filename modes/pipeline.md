# Mode: pipeline — URL 收件箱（Second Brain）

处理 `data/pipeline.md` 中累积的待评估 URL。用户随时把 URL 加进去，然后跑 `/career-ops pipeline` 一次性全部处理。

## Workflow

1. **读** `data/pipeline.md` → 找 "待处理" 段里的 `- [ ]` 条目
2. **对每个待处理 URL：**
   a. 计算下一个 `REPORT_NUM`（读 `reports/`，找最大序号 + 1）
   b. **先判断域名** — 如果命中"国内门户硬跳过规则"，直接标 `- [!]` 跳过，**不调用任何工具**
   c. **提取 JD** — **单次尝试**：国内大厂 careers 域用 Playwright `browser_navigate` + `browser_snapshot`；公开页（V2EX / GitHub / 公众号）用 WebFetch。**失败就停**，不要 fallback 到下一级工具
   d. 不可访问 / 反爬 / 登录墙 → 标 `- [!] 需人工取 JD（截图/复制）`，继续下一个
   e. JD 拿到后跑完整 auto-pipeline：A-F 评估 → Report .md → PDF（score ≥ 3.0）→ Tracker
   f. **从 "待处理" 移到 "已处理"**：`- [x] #NNN | URL | 公司 | 岗位 | Score/100 | PDF ✅/❌`
3. **串行处理**：Playwright 不能并行（共享浏览器）；WebFetch 也不建议并行 — 串行便于出错时停下、便于看 token 消耗。
4. **结束时**显示汇总表：

```
| # | 公司 | 岗位 | Score | PDF | 推荐动作 |
```

## pipeline.md 格式

```markdown
## 待处理
- [ ] https://careers.example-oem.com/positions/123
- [ ] https://careers.example-trader.com/jobs/procurement-specialist | 某工程机械贸易公司 | 采购专员
- [!] https://liepin.com/job/xxx — Error: 需要登录

## 已处理
- [x] #143 | https://careers.example-oem.com/positions/789 | 某工程机械整机厂 | 采购专员 | 84/100 | PDF ✅
- [x] #144 | https://www.zhipin.com/job_detail/xxx | 某贸易公司 | 寻源专员 | 42/100 | PDF ❌
```

## 国内门户硬跳过规则（2026-04 新增，节流关键）

**下列域名一律不自动化 JD 提取** — 直接在 pipeline.md 标 `[!] 需人工取 JD`，让用户 bookmarklet / 截图 / 复制后走 inbox 流程。**不要调用 Playwright / WebFetch / WebSearch 里的任何一个。**

| 域名 | 原因 |
|------|------|
| `zhipin.com`（Boss直聘） | 反爬 + 登录墙 |
| `lagou.com` | 反爬 + 登录墙 |
| `liepin.com` | 登录墙 |
| `mokahr.com` / `*.mokahr.com` | SPA + 反爬，电商 / 新消费 / 供应链服务企业常用 |
| `feishu.cn` / `*.feishu.cn` | 飞书表单反爬 |
| `maimai.cn`（脉脉招聘） | 必须登录 |
| `linkedin.com/jobs` | 登录墙 |
| `mp.weixin.qq.com`（部分） | 公众号动态页，看情况可 WebFetch，失败就立即 yield |

**实现要点：** 走到 Step 2b 先做 URL 域名匹配。命中 → 跳到 2d 标 `[!]`，**本条目不产生任何工具调用**。

## JD 提取规则（非硬跳过域名）

对不在上表里的 URL（企业自有招聘域、V2EX、GitHub、公众号公开页等）：

1. **企业自有招聘域**（如 `careers.{某公司}.com` / `join.{某公司}.com` 等）：Playwright `browser_navigate` + `browser_snapshot`，**一次**
2. **公开静态页**（V2EX / GitHub / `*.xxx.com/jobs/`）：WebFetch，**一次**
3. 其余陌生域：WebFetch 试**一次**

**所有情况下：一次失败立即 yield**。
- **禁止** Playwright → WebFetch 自动 fallback
- **禁止** WebFetch → WebSearch 自动 fallback
- **禁止** 同一 URL 换参数 / 换 User-Agent / 换路径重试

失败写 `[!]`，用户需要时会明确说"再试一次"或"用截图"。

**特殊情况（沿用）：**
- **PDF URL**：用 Read tool 读
- **`local:` 前缀**：读本地文件。例：`local:jds/某工程机械整机厂-采购专员.md` → 读 `jds/某工程机械整机厂-采购专员.md`

## 自动编号

1. 列出 `reports/` 所有文件
2. 提取前缀的数字（如 `142-bytedance-...` → 142）
3. 新编号 = 找到的最大值 + 1

## 源同步检查

处理任何 URL 之前，检查同步状态：
```bash
node tools/cv-sync-check.mjs
```
如果有 desync，警告用户后再继续。
