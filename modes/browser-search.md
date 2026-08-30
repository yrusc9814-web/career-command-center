# Mode: browser-search — 真实浏览器自动搜索采集岗位（Kimi WebBridge 版）

通过 **Kimi WebBridge** 控制用户**当前真实 Chrome**（复用已有登录态），在招聘平台（当前支持 Boss直聘）
按 `config/profile.yml` 的 `job_search` 配置自动搜索、筛选、逐个打开岗位详情、结构化提取 JD，
去重后写入 career-ops 现有 inbox，再走现有分析链路，最后生成 Markdown 汇总 + Excel 导出。

**职责边界：**
- Kimi WebBridge 只负责浏览器操作和页面信息获取
- career-ops 继续负责岗位分析、CV 匹配、评分、报告和 tracker
- 不重复实现已有能力；不走 Playwright / API / 抓包

---

## 🚨 安全铁律（最高优先级，违反即终止本模式）

### 只读模式 — 任何情况下禁止：

- 自动投递 / 自动发送消息 / 自动打招呼 / 自动回复招聘人
- 自动收藏 / 批量关注 / 批量沟通
- 自动修改简历 / 自动修改个人资料 / 修改任何账号设置

只允许的操作：**搜索、点击、滚动、打开详情、读取、保存、分析。**

### 风控熔断 — 发现以下任一情况立即停止全部浏览器自动化：

验证码 / 滑块验证 / 异常登录 / 访问受限 / 账号异常 / 要求重新认证 / 人机验证 / 大量岗位页返回空壳或安全校验页。

停止后向用户报告：
1. 当前页面 URL + 截图（webbridge_screenshot 存证）
2. 出现什么类型的验证
3. 需要用户做什么（人工完成验证）

用户处理完成后重新运行 `/career-ops browser-search`，根据 history 断点续跑。

**禁止**：自动破解、绕过验证、打码服务、反检测、修改浏览器指纹、切换 UA、重试轰炸。
遇到一次异常就停，不重试。

### 节奏控制：

- **串行** 处理岗位，concurrency 固定为 1，禁止并行标签页浏览
- 每个详情页之间 `wait` 2-4 秒随机间隔，模拟正常人工浏览
- 单次运行岗位数 ≤ `job_search.max_jobs_per_run`（默认 30）

---

## Step 0 — Pre-flight（本地检查，零浏览器调用）

1. 读 `config/profile.yml` 的 `job_search` 块。如果不存在 → 提示用户先配置，展示字段模板并询问条件
2. 读 `data/browser-search-history.json`（如存在）→ 获取已采集岗位 key 列表（断点续跑依据）
3. 若 `config/profile.yml` 含 deal_breakers → 一并加载，供规则层使用
4. 创建本次运行的 results 文件路径：`data/search-results-{YYYYMMDD-HHmm}.json`
5. 打印执行计划（标题/城市/区域/薪资/上限/断点续跑状态）

**去重 key 规则（优先级从高到低）：**
1. Boss `job_id`（从 URL 或 DOM 提取）
2. `job_url` 去查询参数后的稳定部分
3. 兜底：`company|title|location` 归一化拼接

history 中已有且 status ∈ {collected, analyzed, skipped_rule} 且 `force_refresh: false` → 默认跳过。

## Step 1 — 浏览器检查（WebBridge）

1. 用 `webbridge_list_tabs` / `webbridge_find_tab` 查找已打开的 Boss 直聘标签页（URL 含 zhipin.com），有则复用
2. 没有则 `webbridge_navigate` 到 `https://www.zhipin.com/`（session 名统一用 `boss-job-search`）
3. 登录检查：对页面做 snapshot，出现「登录」「扫码登录」主按钮而无用户身份信息 = 未登录
   - **未登录 → 立即停止，告诉用户"请在 Chrome 里登录 Boss 直聘，完成后告诉我继续"**
   - 已登录 → 继续
4. 若导航后发现被风控拦截页（含 安全验证/水印 图案）→ 按🚨铁律熔断

## Step 2 — 设置搜索条件（页面状态驱动，禁止盲点旧 selector）

Boss 的筛选 UI 会变化。**必须每次先 `webbridge_snapshot` 读取当前页面真实结构**，
再根据 accessibility tree / 页面文本定位元素交互。典型流程：

1. 在搜索框 fill 目标职位关键词（`target_titles[0]`）→ 回车或点搜索按钮
2. 确认城市等于 `target_city[0]`；不一致则在城市筛选里选目标城市
3. 区域筛选：展开区域下拉，勾选 `target_districts` 里每个区（多选），确认生效
4. 薪资筛选：在薪资下拉中选中能覆盖 `salary_min_k - salary_max_k` 的档位（如 5-10K 直接选「5-10K」；
   若 Boss 预设档位与配置不完全一致，选择最接近的包含区间并记录实际选择）
5. 截图存档当前筛选结果（可选，便于排查）
6. snapshot 读取列表第一页岗位卡片数量和每张卡片的信息

**如果任何筛选项在当前 UI 上找不到对应入口**：不要猜 selector 盲点，报告实际页面结构，
能设多少设多少，剩余过滤交给规则层兜底（salary/district 也会在采集后本地再验一遍）。

## Step 3 — 岗位采集循环（串行）

对搜索结果列表的每个岗位卡片（跨分页时优先取第 1 页，最多累计 max_jobs_per_run 个）：

```
识别下一条未处理的卡片
→ 从卡片链接拿 job_url（href）与列表摘要（title/company/salary/标签）
→ 去重判断（history）→ 已见过的直接跳过不计入配额
→ 配额内才继续：
→ 用 webbridge_evaluate 取该卡片的完整 href
→ webbridge_navigate 当前标签到详情 URL（同一标签串行，避免开几十个标签）
→ wait 2-4 秒待页面稳定
→ webbridge_snapshot + webbridge_evaluate 提取详情
→ 结构化保存（见下）
→ 返回搜索列表页（navigate back 或重新走一遍相同筛选路径；优先 location.back()）
→ 下一个
```

**详情提取要求（evaluate 主抓 innerText，agent 负责解析）：**

- 岗位名（h1）、薪资横幅、城市/区县、经验、学历标签
- 公司信息侧栏：行业、规模、阶段
- 招聘人卡片：姓名、职位、活跃状态（刚刚活跃/本月活跃/数月前活跃…）
- **JD 正文容器全文**（岗位职责 / 任职要求 / 工作内容 / 福利待遇 / 其他说明）— 必须 ≥ 100 字才算成功
- 发布时间（如有）、company 全称与 brand

**字段完整性（缺的字段填 null，禁止编造）：**

platform, job_id, title, company, salary, salary_min, salary_max, salary_months,
location, city, district, experience, education, description(整段正文),
responsibilities, requirements, benefits, company_industry, company_size,
recruiter_name, recruiter_title, recruiter_active_status, job_url, published_at, collected_at

**解析注意**：salary 文本如 `5-8K·13薪` → min=5 max=8 months=13；`面议` 则三个数值 null。

### 每个岗位落盘两个文件（采集成功后立刻写，崩溃安全）：

1. **inbox JSON**（兼容现有 inbox schema，供 auto-pipeline 使用）：
   `inbox/jd-boss-{job_id 或 timestamp}.json`
```json
{
  "url": "<job_url>",
  "page_title": "{title}-{company}-招聘",
  "captured_at": "<ISO>",
  "platform": "boss",
  "extracted": {
    "job_title": "...", "company": "...", "location": "...",
    "salary": "...", "experience": "...", "education": "...",
    "description": "<JD 正文>",
    "requirements": "...", "raw_text": "<详情页整页兜底文本>"
  }
}
```

2. **history 更新**：`data/browser-search-history.json` 的 jobs map 增加该 key：
```json
{"key":"...", "job_id":"...", "title":"...", "company":"...", "salary":"...",
 "city":"...","district":"...","url":"...","captured_at":"...",
 "inbox_file":"inbox/jd-boss-xxx.json","status":"collected"}
```

**规则层明显不符合的岗位**（见 Step 5）不写 inbox，status 标 `skipped_rule` 并记 skip_reason。

运行计数实时打印：已发现 / 已打开 / 已采集 / 已跳过 / 已分析 / 失败。

## Step 4 — 收尾采集阶段

回到搜索列表顶部，确认没有遗漏的目标岗位；输出采集汇总表（公司｜岗位｜区域｜薪资｜是否写入 inbox）。

## Step 5 — 第一层：规则过滤（零 AI 消耗，本地执行）

对每个 collected 岗位逐条硬性判断，命中任意一条 → `skipped_rule`（SKIP，不进 A-F 分析）：

| 检查项 | 条件 |
|--------|------|
| 城市 | city 与 target_city 完全不匹配 |
| 区域 | district 存在且与 target_districts 任一都不匹配（district 为 null 时保留转人工看） |
| 薪资 | 解析出的 [min,max] 与 [salary_min_k, salary_max_k] 完全无交集 |
| excluded_keywords | title 或 description 命中任一关键词 |
| deal_breakers | title / company / description 命中 profile.yml deal_breakers |

未命中的进入第二层。

## Step 6 — 第二层：career-ops 分析

**前置：** 检查 onboarding 状态 —— `cv.md` 是否还是空白模板、`config/profile.yml` candidate 是否仍是 example 占位值。

### 6a. 已完成 onboarding（cv.md 有真实内容）

对每个规则通过的岗位跑标准 A-F 评估：读 `modes/_shared.md` + `modes/auto-pipeline.md` 的完整流程
（引用 cv.md 具体行做 CV 匹配、中文源薪酬调研、级别策略等），产出正式 report
`reports/{NNN}-{slug}-{date}.md` + tracker TSV。同时把结论回填进本模式的 results JSON
（score / cv_match_score / strengths / gaps / recommendation 等；cv_match_score 为 0-100 整数，
由 CV Match 层 `tools/lib/cv-match.mjs` 产出，结果 JSON 的 `cv_match` 字段填同一 0-100 值，
禁止 LLM 自算百分比）。recommendation 恒为五档枚举，来自 `tools/lib/scoring.mjs`
`computeRecommendation` 决策链 + `trace[]`，LLM 只解释不重算。

### 6b. 未完成 onboarding（当前默认状态）

诚实降级模式 —— **不允许编造 CV 信息**。这是 onboarding 完成前的临时路径（不接评分引擎）；
cv.md 配好之后一律走 6a 的引擎链路。只做基于客观事实的评估：

- salary_fit：实际薪资 vs 配置区间
- location_fit：区县 vs target_districts
- hard_redline：deal_breakers / 明显风险词核对（外包、派遣、劳务等）
- rule_score（初筛分 0-5，公式透明）：
  - 薪资区间完全落在期望范围内 +1.5，部分重叠 +0.75
  - district 精确命中 +1.5，city 命中但区不确定 +0.75
  - title 精确匹配 +1.0（仅关键词相关 +0.5）
  - 无 excluded/redline 命中 +1.0
- recommendation 映射：rule_score≥4.5 强烈推荐；≥3.5 推荐；≥2.5 一般；<2.5 不推荐；红线命中 → 硬红线跳过
- cv_match_score / score(A-F) / gaps / cv_advice / interview_focus 等依赖个人简历的字段标记 `"待填写cv.md"`
- recommendation_reason 写清判定所依据的事实（薪资、区县、JD 关键信号）

每岗写一条 tracker TSV 吗？——**此模式默认不写 applications.md TSV**（那是投递导向的 pipeline 领域），
只有 6a 全流程评估的岗位按 auto-pipeline 常规写入。避免把大量初筛岗位塞进申请追踪表。

## Step 7 — 生成汇总与导出

1. 把最终 results 数组写入 `data/search-results-{YYYYMMDD-HHmm}.json`（Step 0 定义的那份）
2. 运行：
```bash
npm run search:report -- data/search-results-{YYYYMMDD-HHmm}.json
```
   生成：
   - `reports/browser-search-YYYY-MM-DD-HHmm.md`（汇总表 + TOP 10 最值得投岗位）
   - `output/boss-jobs-YYYY-MM-DD-HHmm.xlsx`（Excel，列规格由脚本保证）
3. 向用户汇报：计数器终值、TOP 推荐、两个产出文件路径、遇到的异常（含风控事件）

---

## 断点续跑

会话中断 / WebBridge 断开 / 页面异常后，直接再次运行 `/career-ops browser-search`：

- history 里 status∈{collected, analyzed, skipped_rule} 的岗位自动跳过（force_refresh=false 时）
- 新一轮 results 文件包含：本轮新采岗位 + 可从上轮 results 合并的历史条目（用于汇总完整性）
- 只有从未成功采集的岗位会重新浏览

## Schema — run results（data/search-results-*.json）

顶层：
```json
{ "run_at": "ISO", "config": {"target_titles":[], "target_city":[], "target_districts":[],
   "salary_min_k":5,"salary_max_k":10},
  "counters": {"discovered":0,"opened":0,"collected":0,"skipped":0,"analyzed":0,"failed":0},
  "jobs": [ { ...per_job } ] }
```

per_job（analysis 段字段名是 Excel/MD 生成的契约，脚本 tools/generate-search-summary.mjs 依赖它们）：

```json
{
  "platform": "boss", "job_id": "", "title": "", "company": "",
  "salary": "", "salary_min": null, "salary_max": null, "salary_months": null,
  "city": "", "district": "", "experience": "", "education": "",
  "description": "", "benefits": "", "company_industry": "", "company_size": "",
  "recruiter_name": "", "recruiter_title": "", "recruiter_active_status": "",
  "job_url": "", "published_at": null, "collected_at": "",
  "analysis": {
    "rule_filter": "pass | skip",
    "skip_reason": null,
    "hard_redline": false,
    "salary_fit": "", "location_fit": "",
    "rule_score": 0.0,
    "cv_match": "待填写cv.md 或 0-100 整数（= cv_match_score，由 tools/lib/cv-match.mjs 产出；禁止 x.x/5 或百分比自算）",
    "cv_match_score": null,
    "score": null,
    "strengths": [], "gaps": [],
    "recommendation": "强烈推荐 | 推荐 | 一般 | 不推荐 | 硬红线跳过",
    "recommendation_reason": "",
    "cv_advice": "", "interview_focus": ""
  }
}
```

skipped_rule 的岗位 analysis.recommendation = "硬红线跳过" 仅当红/deal_breaker 命中；
普通规则不符用「不推荐」+ skip_reason（如 "区域不符：目标区以外"）。
