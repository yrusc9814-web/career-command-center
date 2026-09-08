# Mode: offers — 多 Offer 比较

## Career Score 十维（与评估引擎同一套维度）

十维 = `tools/lib/scoring.mjs` 的 `SCORING_RUBRIC`（权重合计 100；每维 0/50/100 定义、证据来源与 unknown 规则的唯一权威在该文件，prompt 只列 key + 中文名 + 权重 + 指向，不复制细则）：

| key | 维度 | 权重 |
|---|---|---:|
| compensation | 薪酬竞争力 | 20 |
| workload_workstyle | 工作制与强度 | 15 |
| role_seniority | 职级质量与职责范围 | 13 |
| career_growth | 成长空间 | 10 |
| category_domain_value | 品类与行业价值 | 10 |
| procurement_ownership | 采购自主权 | 9 |
| company_stability | 公司与业务稳定性 | 7 |
| location_fit | 地点与通勤 | 8 |
| digital_tooling | 数字化与工具成熟度 | 5 |
| hiring_process_quality | 招聘流程质量 | 3 |

`career_ops_score`（0-100）= Σ(score × weight) / Σ(valid_weight)，维度分同为 0-100（旧 1-5 制按 (x−1)×25 仿射等价，真 0 起评），unknown 维度不入分母，输出带 `score_confidence`（effective_weight / total_weight，≥85% 高 / ≥60% 中）。分数与档位一律由引擎产出，**LLM 只解释不重算**。

## 多 Offer 比较表 — 三列分离，禁止合成一个总分

CV Match、Career Score、Recommendation 是**三层独立决策**（PROCUREMENT 决策架构：Eligibility / Blocker → CV Match → Career Score → Recommendation），**必须分列展示，禁止加权合并成一个总分**：

| Offer | CV Match（0-100，来自 `tools/lib/cv-match.mjs`） | Career Score（0-100，来自 `tools/lib/scoring.mjs`） | Recommendation（五档，来自 `computeRecommendation` 决策链 + `trace[]`） | 关键解释（LLM 只解释） |
|-------|----------------------------------------------|----------------------------------------------|--------------------------------------------------------------|----------------------|
| Offer A | X / 100 | X.X / 100 | 强烈推荐 / 推荐 / 一般 / 不推荐 / 硬红线跳过 | 决策依据（blocker / 缺口 / trace 摘要） |
| Offer B | X / 100 | X.X / 100 | ... | ... |

规则：
- **三列口径不同、不可互相换算**：CV Match 回答"履历与岗位多匹配"（0-100）；Career Score 回答"岗位本身对候选人的职业价值"（0-100）；Recommendation 是综合硬红线 / blocker / 资格 / 决策矩阵 / 缺口封顶后的五档结论。
- **Recommendation 不是分数的复读机**：高分不推荐是合法状态（现任雇主冲突 / 薪资底线 / 职级倒退 / 硬性资格 / HARD_GAP 封顶等都会覆盖分数）；decision trace 是唯一解释依据，禁止看到高分自动翻案。
- 排序讨论可以分别按某一列排，但**不存在"综合分"**。

## 决策时需要一起考虑的因素（非评分，供讨论）

- 时间到 offer 的成本
- 跨城市搬迁成本
- 现有 offer 的截止时间
- 心理上能否接受拒掉某个 offer

如果 offer 没在上下文中，让用户提供。可以是文本、URL、或者 tracker 里已评估的引用（引用时直接读对应 report 的 cv_match_score / career_ops_score / recommendation，不要凭记忆重算）。
