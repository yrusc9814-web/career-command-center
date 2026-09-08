# Mode: inbox — 处理浏览器 bookmarklet 捕获的 JD

候选人在浏览器用 bookmarklet 一键捕获 JD → 发到本地 inbox/ 服务器 → 落盘成 JSON 文件。
本 mode 读取 `inbox/*.json`，对每个新文件跑完整 auto-pipeline（评估 + report + PDF + tracker），处理完移到 `inbox/processed/`。

## Workflow

### Phase 0 — 本地 Triage（零工具调用）

1. **列文件：** `ls inbox/*.json | sort`（排除 .gitkeep 和 processed/）
2. **如果空：** 告诉用户 inbox 为空，提示安装 / 使用 bookmarklet 的方法
3. **对每个 JSON 提取元信息**（title / company / real_company via HR 反推 / salary / location / deal-breaker flag）
4. **分类到 4 个桶**：
   - **A. 完整评估**：用户确认处理的高优先级
   - **B. 批量 Discarded**：title 过关但用户决定不做完整评估（P3 低优 / 红线关键词误报 / 其他 keep 类）
   - **C. SKIP（Deal-breaker）**：真派遣 / 命中候选人 deal-breaker 的企业 / 明确命中候选人红线
   - **D. Title-skip**：title 过滤不过关（SQE / 跟单员 / 计划员 / 销售 / 实习 等）

### Phase 1 — 交互式确认（Token 控制）

如果桶 A 候选数 ≥ 5，向用户列清单让选：
- `[a] 仅 top 4`（按 priority 排）
- `[b] top 7`
- `[c] 全跑 {N}`
- `[d] 自选编号`

### Phase 2 — 处理（按桶执行，每个桶都要完整闭环）

| 桶 | 处理 | TSV | Report | PDF | 归档 |
|----|------|-----|--------|-----|------|
| **A 完整评估** | A-F 评估 | ✅ 1 行 | ✅ 完整 | 视 Score / 用户决定 | mv processed/ |
| **B 批量 Discarded** | 无评估 | ✅ 1 行 notes=原因 | ❌ 无 | ❌ | **mv processed/** |
| **C SKIP（Deal-breaker）** | 无评估 | ✅ 1 行 notes=派遣方 | ❌ 无 | ❌ | **mv processed/** |
| **D Title-skip** | 无 | ❌ 不进 applications.md | ❌ | ❌ | **mv processed/** |

### 🚨 铁律：inbox 结束时必须清零

**所有被 triage 过（无论哪个桶）的 JSON 都必须 mv 到 `inbox/processed/`。**

- 不能有"看过但不处理"的 JSON 留在 inbox — 那下次 `/career-ops inbox` 会重复 triage 浪费 token
- 不能有"用户选了 top 4 处理，剩下 10 个留原位" — 剩下 10 个按桶 B 批量 Discarded 处理
- 唯一留 inbox 的情况：**该 JSON 从未被 triage 过**（比如正在处理时用户又抓了新 JD）

### Phase 3 — 合并

输出汇总表 + 提示用户跑 `npm run merge`（即 `node tools/merge-tracker.mjs`）

## JSON Schema（inbox 文件格式）

```json
{
  "url": "https://...",
  "page_title": "...",
  "captured_at": "2026-04-14T08:30:00.000Z",
  "platform": "boss-zhipin | liepin | lagou | mokahr | dachang-spa | universal",  // dachang-spa = 企业自有 careers SPA 的采集通道标识（代码层契约，见 tools/bookmarklets/）
  "extracted": {
    "job_title": "采购专员",
    "company": "某工程机械整机厂",
    "location": "示例城市",
    "salary": "6-9K",
    "department": "...",            // optional
    "seniority_experience": "...",  // optional
    "description": "...",           // 优先用这个
    "requirements": "...",          // optional
    "raw_text": "..."               // 兜底，整页 innerText
  }
}
```

**字段使用规则：**

| 优先 | 字段 | 用途 |
|------|------|------|
| 1 | `extracted.description` | 主 JD 内容（如果 bookmarklet 抽到了结构化字段）|
| 2 | `extracted.raw_text` | 兜底，整页文本，从中识别 JD |
| — | `url` | **report 头 `**URL：**` 字段必须填 `json.url` 的真实网页 URL**。不要写 "bookmarklet 文件 xxx.json"、不要写 "Boss 直聘详情页"、不要写本地文件路径 |
| — | `company`, `job_title` | 用于 report 头、PDF 命名、tracker 字段 |
| — | `platform` | 标记来源，写进 report 验证状态段（和 URL 分开，不要混） |

**反面示例（绝对不要）：**
```
**URL：** Boss 直聘详情页（bookmarklet 文件 `jd-20260415-144918-boss-zhipin-xxx.json`）
```
**正面示例：**
```
**URL：** https://www.zhipin.com/job_detail/xxx.html（bookmarklet 捕获的原始网页 URL，完整 securityId 参数原样保留）
**来源：** boss-zhipin (via /career-ops inbox, bookmarklet 捕获 2026-04-15 14:49)
```
原因：报告里的 URL 是给未来的候选人点回去复查岗位用的。JSON 文件名只在本地有意义，换台电脑/下次复查就失效。

**特别注意：** Mokahr / Boss 等反爬平台抓到的 `extracted.*` 可能字段缺失或不准。**永远先看 raw_text** 找 JD 真实内容，不要被空字段误导。

## 输出汇总（用户视角）

```
inbox 处理 — {YYYY-MM-DD}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
处理文件：N
跳过（重复 / 空内容）：N

| # | 公司 | 岗位 | Score | PDF | 来源 |
|---|------|------|-------|-----|------|
| 003 | 某工程机械整机厂 | 采购主管 | 84/100 | ✅ | mokahr |
| 004 | 某贸易公司 | 寻源专员 | 76/100 | ✅ | dachang-spa |
| 005 | 某公司 | XX | 50/100 | ❌ | boss-zhipin |

→ 跑 npm run merge（node tools/merge-tracker.mjs）把 TSV 合并进 applications.md
```

## 服务器使用提醒

如果用户问"怎么用 bookmarklet"：
1. 终端跑 `node tools/jd-inbox-server.mjs`（或 `npm run inbox-server`）
2. 浏览器打开 `tools/install.html`，把按钮拖到书签栏
3. 在 JD 页面点 bookmarklet → 看到 ✓ 提示
4. 回到你正在使用的 Agent，运行 /career-ops inbox（宿主不支持 slash skill 时，直接让 Agent 按 `modes/inbox.md` 执行）

## 去重

**正式岗位 identity 使用 canonical Job Identity contract**（与 tracker / merge-tracker 一致）：
1. `job_id` 精确匹配（Boss 等平台从 URL 或 DOM 提取）
2. 无 job_id 时从 URL 提取 job_id
3. 再无 ID 才 fallback：company normalized + role 精确相等（fuzzy title 匹配不用于岗位 identity）
4. **同公司不同 job_id 是不同岗位**，不得因 title 相近覆盖另一个 posting

处理前先检查（capture-level dedup，保留）：
- 同 URL 是否已在 `data/applications.md` 或 `inbox/processed/`（按 canonical Job Identity 判断是否同一岗位）

如重复 → 询问用户：覆盖评估 / 跳过 / 当作新岗位再评

## 出错处理

- JSON 解析失败 → 移到 `inbox/errors/{file}.json`，记录原因，继续下一个
- raw_text 空（< 100 字）→ 跳过，提示用户重新捕获
- WebSearch / WebFetch 在评估 Block D 失败 → 评估继续，标注"薪酬数据未查到"
