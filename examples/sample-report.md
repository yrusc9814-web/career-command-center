# 评估：某工程机械贸易公司 — 品类采购主管

> 本文件是匿名示例报告（演示格式与文案守卫），所有公司、数字均为占位（X / N / 某某）。
> 产出流程与模板见 `modes/offer.md`；数值与档位全部来自运行时引擎（`tools/lib/`），LLM 只解释不重算。

**日期：** 20XX-XX-XX
**Archetype：** strategic_category（战略 / 品类采购）
**Score：** X.X/5（career_ops_score，由 `tools/lib/scoring.mjs` 产出；score_confidence：XX.X% 高）
**CV Match：** XX/100（cv_match_score，由 `tools/lib/cv-match.mjs` 产出；confidence：XX%）
**推荐等级：** 推荐 ——由 `tools/lib/scoring.mjs` `computeRecommendation` 决策链产出，格式恒为五档枚举
**Eligibility / Blocker：** `eligibility_status: eligible_with_gaps`（该品类 HARD_GAP：缺目标品类供应商资源 → 决策链封顶"推荐"；trace[] 摘要：Step 3 矩阵 → Step 4 降档封顶）
**URL：** https://jobs.example.com/example-category-supervisor
**PDF：** output/cv-candidate-example-20XX-XX-XX.pdf

---

## A) 角色摘要

| Field | Value |
|-------|-------|
| **primary_archetype** | strategic_category（战略 / 品类采购）——职责动词分布：品类策略 / 年度降本 / 供应商组合规划为主体；title 判定不进引擎 |
| **Domain** | industrial（工业 / 机械） |
| **Categories** | 机械设备（主）；原材料（辅） |
| **Tags** | production_material / direct / domestic |
| **Function** | 品类策略 + 团队管理 |
| **Seniority** | raw_title：品类采购主管；normalized：主管（JD 暗示：带 N 人小组、背品类降本 KPI） |
| **业务方向** | 生产物料采购 |
| **远程政策** | onsite |
| **Base 城市** | 示例城市 |
| **团队规模** | N 人（JD 提到带小组） |
| **公司类型** | 制造 |
| **TL;DR** | 示例城市制造业集团招品类采购主管，背品类降本 KPI，带 N 人小组 |

## B) CV 匹配

| JD 要求 | 候选人 CV 依据（cv.md 具体行） |
|---------|------------------------------|
| "X 年以上采购经验" | cv.md 工作经历：N 年采购序列经验（连续） |
| "熟悉品类降本方法论" | cv.md：主导某品类年度降本，成本下降 X%（拆解到议价 / 替代导入） |
| "带过团队" | cv.md：带 N 人采购小组，背品类 KPI |
| "ERP/SRM 系统使用" | cv.md：参与采购流程线上化，关键单据流转由 X 小时缩短至 Y 小时 |

### Gaps（四级 + 类型标注）

| Gap | 级别 | 类型 | 缓解策略 |
|-----|------|------|---------|
| 缺目标品类供应商资源 | HARD_GAP | 品类经验 / 供应商资源 | **简历包装不能解决**。具有供应商开发能力，但缺目标品类供应商资源；判断是否仍值得投 + 面试中诚实应对（强调寻源方法论与可迁移品类经验） |
| 行业背景不同（目标行业未做过） | SOFT_GAP | 行业经验 | 改写已有经历，突出相邻品类的可迁移方法论（成本拆解 / 供应商结构管理） |
| JD 要求"熟悉保税贸易模式"，CV 无相关信息 | UNKNOWN | 国际采购 | 当前信息不足 / JD 未披露细节 / 需面试确认 |

### Capability Coverage

| capability | requirement_level | candidate_evidence_strength | coverage_status |
|---|---|---|---|
| category_management | required | strong | matched |
| cost_reduction | required | strong | matched |
| negotiation_contract | required | medium | matched |
| sourcing_development | preferred | medium | matched |
| digital_tools | preferred | weak | partial |
| international_procurement | preferred | no_evidence | no_evidence |

> 本表是证据覆盖状态，不是 CV Match 分数，不输出百分比。

## C) 级别与策略

1. **JD 暗示级别**：主管档（带小组 + 背品类 KPI）；**候选人自然级别**：主管档（采购序列六档）——对齐。
2. **「不撒谎卖资深」方案**：主讲品类降本闭环（目标拆解 → 议价 / 替代导入 → 结果口径）；把跨部门推动作为 senior signal。
3. **「如果被压级」方案**：若薪酬合理可接受，谈定 N 个月内 review；薪酬底线来自 profile.yml（数值不写进 tracked 示例）。

## D) 薪酬与需求（中文源调研结果，示例占位）

| 维度 | 数据 | 来源 |
|------|------|------|
| 薪资带宽（base + 年终） | XX-XX K × 13 | 看准网 / 职友集 |
| 工时强度 | JD 未披露 → unknown（禁行业刻板印象） | — |
| 公司口碑 | X.X / 5（看准） | 看准网 |
| 业务/团队近况 | 扩产中（示例） | 行业媒体 |
| 这个岗位的市场需求 | 普通 | 脉脉招聘讨论 |

> 查不到的数据一律写"未查到 → unknown"，不编造；薪资 / 公司规模 / 市场排名 / 成立时间 / 品牌地位无可靠数据一律 unknown。

## E) 个性化方案

| # | 部分 | 现状 | 修改建议 | 为什么 |
|---|------|------|---------|--------|
| 1 | Summary | 采购经验罗列 | 改为"X 年品类采购 + 降本闭环 + 带小组"，对齐 JD 关键词 | HR 第一眼匹配 |
| 2 | 降本经历 | 只写动作不写结果 | 补量化结果句式：动作 + 规模 + 结果 + 影响（数字用 cv.md 真实值） | JD 要降本方法论 |
| 3 | 团队经历 | 埋在职责里 | 提前：带 N 人小组、背品类 KPI | 主管档硬信号 |
| 4 | 系统经验 | 一笔带过 | 补 ERP·SRM 叙述（流程线上化、单据流转效率） | JD 加分项 |
| 5 | 行业差距 | 无说明 | Summary 主动点出可迁移品类方法论 | 主动 address SOFT_GAP |

## F) 面试准备

| # | JD 要求 | STAR+R 故事 | S | T | A | R | Reflection |
|---|--------|------------|---|---|---|---|-----------|
| 1 | 品类降本 | 某品类年度降本（cost_down） | 涨价压力 | 背 X% 降本目标 | Spend 拆解 + 议价 + 替代导入 | 成本下降 X% | 降本要拆到动作，面试官会追问构成 |
| 2 | 供应商开发 | 新供应商 0→1（supplier_0to1） | 单一来源风险 | 建 N 家备选 | 寻源 + 验厂 + 打样 + 导入 | 批产导入 N 家 | 验证不充分就导入是最大教训 |
| 3 | 团队管理 | 小组管理与新人培养（team_mgmt） | 新小组组建 | 背 KPI 带新人 | KPI 拆解 + 带教 | 待补充真实案例 | — |

> Evidence-backed：故事 1-2 素材来自 cv.md 已有事实；故事 3 的 R 列缺证据 → 标"待补充真实案例"，禁止编造。

**推荐主讲的 case study**：故事 1（品类降本闭环）— 数字口径背熟，按动作拆解 X% 的构成。
**红线问题预演**：「为什么从上一家离职？」「能接受加班吗？」「家庭情况能不能加班？」——话术见 `modes/story-sync.md` 红线段。

---

## 提取的关键词

品类采购、品类降本、供应商开发、寻源、战略采购、供应商组合、成本拆解、Should-cost、年度议价、账期、MOQ、Lead Time、OTD、来料合格率、ERP、SRM、供应商绩效考核、品类策略、降本 KPI、团队管理
