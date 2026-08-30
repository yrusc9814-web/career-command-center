# Mode: story-sync — Story Bank 同步器

扫描两类源，抽取 STAR+R 故事 + 实战 refinement，去重 + 按主题分组，写入 `interview-prep/story-bank.md`。

**两类源（按权重）：**

| 源 | 路径 | 性质 | 贡献 |
|----|------|------|------|
| **Primary：** 评估报告 Block F | `reports/{NNN}-{slug}-{YYYY-MM-DD}.md` | 评估时预生成（可能未经实战）| 初始 STAR+R 骨架、Reflection 初稿 |
| **Supplemental：** Mock interview 备战笔记 | `interview-prep/mock-interviews/{NNN}-{slug}-{roundN}-{YYYY-MM-DD}.md` | **gitignored**，本地专属；一面/二面**前后**迭代；有实战信号 | Refined S/T/A/R、实战 Reflection、真实 Q&A、谈判/核价细节、文化深聊话术 |

**为什么 mock-interviews 是关键二级源：**

- 评估报告 Block F 是**冷生成**（Claude 根据 JD 预想面试要点）
- mock-interview 笔记是**热迭代**（一面结束后复盘 + 二面冲刺准备），包含真实问题、踩过的坑、调整过的话术、现场追问过的数字
- 若同一 story 在两处出现差异，**mock 版本更新 / 覆盖 report 版本**（因为是更接近真实面试的打磨版）

**Gitignore 注意：** `interview-prep/mock-interviews/*.md` 和 `interview-prep/story-bank.md` 都在 `.gitignore` 中（story-bank 历史 tracked 但新 diff 忽略）。因此 story-bank 可以安全包含 mock-interview 提炼的候选人专属细节（如薪资底牌、真实对家 offer、私下判断等）不用担心泄漏到 git。

**核心问题：** auto-pipeline / batch worker 生成 Block F 后没有真正把故事追加到 master story bank，且 mock-interview 的实战 refinement 没有系统回流。这个 mode 就是**存量补齐 + 每次评估后增量同步 + 每次面试后 refinement 回流** 的工具。

## 推荐执行方式

作为 **subagent** 跑（避免主 session 读 13+ 份 report 炸 context）：

```
Agent(
    subagent_type="general-purpose",
    prompt="[本文件内容 + 具体参数]",
    run_in_background=True
)
```

---

## Workflow

### Step 1 — 读现状

1. `ls reports/*.md | sort` → 所有已生成的 report
2. `ls interview-prep/mock-interviews/*.md | sort` → 所有 mock interview 备战笔记（gitignored，本地专属）
3. `Read interview-prep/story-bank.md` → 看已有的 master story（找 `## Stories` 段）
4. **tracker # 交叉索引：** 从 mock-interviews/*.md 文件名头 3 位数字（`061-example-round2-...` → tracker #61）对齐到 `data/applications.md` 第 # 列，拿到 company/role，再定位对应的 `reports/{report#}-{slug}-*.md`

### Step 2 — 问候选人：增量 or 重建

如果 `story-bank.md` 已有非模板内容：
```
发现 story-bank.md 已有 N 个故事 + 上次同步是 {YYYY-MM-DD}。
- 增量（recommended）：只追加 {那天之后} 新 report 中的新故事
- 重建：全扫全部 report，生成新 bank（旧的备份成 story-bank.md.bak）
选择？
```

首次运行 / 只有模板 → 默认**全扫**。

### Step 3a — 抽取每份 report 的 Block F（Primary 源）

对每个 `reports/{NNN}-{slug}-{date}.md`：

1. `Read` 整个文件
2. 定位 `## F) 面试准备` 段，一直读到下一个 `## ` 或 `---` 为止
3. Block F 的**两种常见格式**要都能处理：

   **格式 A（表格 — 较旧 report）：**
   ```markdown
   | # | JD 要求 | 故事 | S | T | A | R | Reflection |
   |---|--------|------|---|---|---|---|-----------|
   | 1 | 品类降本 | 某品类年度议价 | 原材料涨价压力 | 主导年度降本 | 议价 + 替代供应商导入 | 成本下降 X% | 降本要拆到动作，不能只盯单价 |
   ```

   **格式 B（列表 — 较新 report）：**
   ```markdown
   ### 1. 某品类年度降本 → 成本下降 X%
   - **Theme:** 降本谈判
   - **S:** 某品类原材料涨价、客户压价...
   - **T:** 主导该品类年度降本目标（降本比例 X%）...
   - **A:** Spend 拆解 + 年度议价 + 替代供应商开发导入...
   - **R:** 成本下降 X%，账期从 Y 天延长到 Z 天...
   - **Reflection:** 降本要拆到具体动作，不能只盯单价
   - **Best for:** 降本谈判 / 品类管理 / 成本拆解
   ```

   **格式 C（自由叙述）：** 回落到语义抽取 — 识别 S/T/A/R/Reflection 对应的自然语言段。

4. 为每个故事生成 **candidate record**：
   ```json
   {
     "source_type": "report",
     "source_file": "001-example-2026-04-07.md",
     "source_company": "某工程机械整机厂",
     "source_role": "采购主管（某品类）",
     "theme_tags": ["降本谈判", "议价", "供应商开发"],
     "story_title": "某品类年度降本 → 成本下降 X%",
     "canonical_key": "cost_down",  // 用于跨 report 去重
     "S": "...", "T": "...", "A": "...", "R": "...",
     "Reflection": "...",
     "best_for": ["降本谈判", "品类管理", "成本拆解"]
   }
   ```

### Step 3b — 抽取每份 mock-interview 笔记（Supplemental 源）

对每个 `interview-prep/mock-interviews/{NNN}-{slug}-{round}-{date}.md`：

1. `Read` 整个文件
2. **不存在 Block F 固定结构** — 按自由格式，按类型分拣：

   | 内容类型 | 识别信号 | 贡献到 story-bank |
   |---------|---------|------------------|
   | **Refined 故事段落**（如"某品类降本复盘"、"谈判让步设计"）| 出现 canonical_key 的关键词（降本 / 议价 / 验厂 / 导入 / 断供 等）| 更新对应 master story 的 S/T/A/R（取字数更长或更新近的版本） |
   | **新的 Reflection / 踩坑心得** | "为什么 / 如果改 X 会 / 踩过 / 教训" 等问答对 | 追加到对应 story 的 `Reflection` 段，标签 `from mock prep (Round N · tracker #NN · YYYY-MM-DD)` |
   | **真实 Q&A（场景题 / 追问数字 / 红线题）** | "问：... / 答：..." 或 trade-off 表格 | 加入新段 `## 实战 Q&A 清单` 按 canonical_key 分组 |
   | **文化深聊 / 红线问题话术** | "能接受加班吗 / 为什么离职 / 期望薪资" 等 | 更新 `## 红线问题应对` 表（合并新话术）|
   | **数字与话术备忘** | 出现"背数字 / 关键数字 / 核价口径"等标注 | 加入 `## 数字与话术备忘`（新段）按 canonical_key 索引，条数 ≤ 20 |

3. 生成 **candidate record**：
   ```json
   {
     "source_type": "mock",
     "source_file": "061-example-round2-prep-2026-04-20.md",
     "tracker_num": 61,
     "company": "某工程机械贸易公司",
     "round": "round2",
     "date": "2026-04-20",
     "contributions": [
       {"type": "refined_story", "canonical_key": "cost_down", "field": "A", "new_text": "..."},
       {"type": "reflection_add", "canonical_key": "cost_down", "lesson": "议价前先拆成本结构，不然只有单一杠杆..."},
       {"type": "real_qa", "canonical_key": "cost_down", "question": "...", "answer": "..."},
       {"type": "number_memo", "canonical_key": "cost_down", "title": "该品类降本 X% 的构成口径", "memo": "..."},
       {"type": "red_line", "issue": "期望薪资", "answer_template": "..."}
     ]
   }
   ```

### Step 4 — 语义去重 + 多源合并（关键）

候选人的故事库**不是** 13 份 report × 7 故事 = 91 条流水账，而是 **5-10 个 master story 被多次复用**。去重按 Story Bank 18 类（见 `modes/offer.md` Block F / `modes/interview-questions.md`）归到 canonical_key：

| canonical_key | 识别关键词 | 对应故事类型 |
|---------------|----------|------------|
| `cost_down` | 降本、议价、成本下降、年度降价、成本拆解 | 1 降本谈判 |
| `supplier_0to1` | 新供应商、开发导入、验厂、打样、0→1、源头工厂 | 2 供应商 0→1 开发 |
| `price_hike` | 涨价、涨价函、涨价应对、成本传导 | 3 供应商涨价 |
| `urgent_delivery` | 紧急插单、紧急交付、缺料抢货、插单 | 4 紧急交付 |
| `supply_interrupt` | 断供、停供、供应中断、火灾 / 停产 | 5 供应中断 |
| `single_source` | 单一来源、独家、垄断货源 | 6 单一来源风险 |
| `multi_supplier` | 二供、多供应商、供应商组合、导入二供 | 7 多供应商导入 |
| `quality_incident` | 质量异常、批量不良、来料不合格、8D、PPM | 8 供应商质量事故 |
| `supplier_exit` | 淘汰、退出、末位、砍供应商 | 9 供应商淘汰 |
| `contract_risk` | 合同、违约、条款、账期、商务风险 | 10 合同 / 商务风险 |
| `high_inventory` | 库存、呆滞预防、库存下降、安全库存 | 11 库存过高 |
| `dead_stock` | 呆滞料、呆滞处理、报废 | 12 呆滞料 |
| `moq_lt` | MOQ、Lead Time、交期优化、批量 | 13 MOQ / Lead Time 优化 |
| `cross_func` | 跨部门、跨部门冲突、研发 / 销售 / 生产协调 | 14 跨部门冲突 |
| `erp_srm` | ERP、SRM、数字化采购、系统上线 | 15 ERP·SRM 数字化采购 |
| `intl_logistics` | 外贸、国际物流、清关、信用证、海运空运异常 | 16 国际物流 / 外贸异常 |
| `team_mgmt` | 带团队、带新人、小组管理、绩效 | 17 团队管理带新人 |

**合并规则：** 同 `canonical_key` 的多个 candidate 合并为一个 master：
- **S/T/A/R 文本：** 优先级 **mock（实战） > report（冷生成）**。若 mock 版本存在且字数 ≥ report 版本的 70% → 采用 mock 版本；否则仍按最详细原则
- **Reflection：** 保留**所有**不同版本（区分来源：`from Report #NNN` vs `from Mock #NN (RoundN · date)`），因为 reflection 在不同语境下可能不同
- **theme_tags：** 所有出现过的 tags 去重并集
- **sources：** 分两列：`Reports:` 列出所有 report #NNN；`Mock Interviews:` 列出所有 mock 文件（tracker # + round）
- **best_for：** 所有出现过的并集（mock 版本贡献的通常更精准，因为含真实 Q&A）
- **数字口径：** 同一故事在不同 report 里的量化数字不一致时，以候选人最近确认的为准；不确定就标"待确认"，**禁止挑一个大的用**

### Step 5 — 按主题分组

主题桶（按国内采购面试高频行为题）：

| 主题 | 适用故事 | 高频问题映射 |
|------|---------|------------|
| **降本与成本管理** | cost_down / moq_lt | "最有成就感的项目" / "降本 X% 怎么做到的" / "成本怎么拆" |
| **供应商开发与寻源** | supplier_0to1 / multi_supplier | "从 0 到 1 开发过供应商吗" / "怎么找源头工厂" |
| **谈判与商务** | cost_down / price_hike / contract_risk | "讲一次艰难的谈判" / "供应商涨价怎么办" |
| **交付与异常处理** | urgent_delivery / supply_interrupt / moq_lt | "交期出过什么问题" / "断供了怎么办" |
| **质量与供应商绩效** | quality_incident / supplier_exit | "供应商质量出过什么事故" / "怎么淘汰供应商" |
| **风险与韧性** | single_source / supply_interrupt | "单一来源风险怎么管" / "供应保障怎么建预案" |
| **库存与计划协同** | high_inventory / dead_stock | "库存高了怎么处理" / "呆滞料怎么减" |
| **跨部门协作** | cross_func | "和研发 / 销售冲突怎么处理" / "怎么推动别人配合" |
| **数字化与流程** | erp_srm | "ERP / SRM 上线做过什么" / "流程优化案例" |
| **国际采购 / 外贸** | intl_logistics | "国际采购经验" / "外贸异常处理" |
| **团队管理** | team_mgmt | "带过几个人" / "新人怎么带" |
| **离职 / 转方向叙事** | （从 profile.yml 读，不是 STAR） | "为什么离开上家" / "为什么转品类采购" |
| **红线问题应对** | （话术，不是 STAR） | "加班接受吗 / 婚育计划 / 频繁跳槽" |

同一个故事可以归多个主题（用 `theme_tags` 表达）。

### Step 6 — 写 story-bank.md

完全覆盖重写（把原来的模板 + 占位符全部替换）。新结构：

```markdown
# Story Bank — Master STAR+R Stories

**最后同步：** {YYYY-MM-DD}  
**故事总数：** {N} 个 master story  
**源报告：** {M} 份（reports/*.md）

---

## 主题快速导航

- **降本与成本管理** → [cost_down](#cost-down)
- **供应商开发与寻源** → [supplier_0to1](#supplier-0to1), [multi_supplier](#multi-supplier)
- **谈判与商务** → [cost_down](#cost-down), [price_hike](#price-hike)
- **交付与异常** → [urgent_delivery](#urgent-delivery), [supply_interrupt](#supply-interrupt)
- **风险与韧性** → [single_source](#single-source)
- **跨部门协作** → [cross_func](#cross-func)
- **数字化与流程** → [erp_srm](#erp-srm)
- **团队管理** → [team_mgmt](#team-mgmt)
- **离职 / 转方向叙事** → [narrative](#narrative)
- **红线问题** → [red-lines](#red-lines)

---

## 自我介绍 / Big Three 的组合建议

| 面试问题 | 推荐组合 |
|---------|---------|
| "自我介绍" | cost_down（当前主线破冰）→ supplier_0to1（能力证据）→ cross_func（协作面） — 3 min 版本 |
| "最有成就感的项目" | **cost_down**（目标拆解 + 谈判 + 结果闭环，数字口径背熟）|
| "讲一次失败 / 改进" | supplier_0to1 Reflection（验证不充分就导入的教训）或 quality_incident（异常响应复盘）|
| "跨部门冲突" | cross_func（与研发 / 销售在交期 / 成本上的取舍与协调）|
| "为什么离职" | narrative.exit_story — 从 profile.yml 生成 |

---

## Stories

### <a id="cost-down"></a>[降本谈判 · 品类管理 · 议价] 某品类年度降本 — 成本下降 X%

**Sources — Reports:** #001 (某工程机械整机厂 采购主管), #003 (某贸易公司 寻源), #005 (某零售集团 品类采购)...  
**Sources — Mock Interviews:** #61 Round2 (某工程机械贸易公司, 2026-04-20)  
**Theme tags:** 降本谈判, 议价, 成本拆解, 品类管理  
**Canonical key:** `cost_down`

**S (Situation):** {若 Mock 有更新版本用 Mock；否则取最详细 report 版本}

**T (Task):** {同上}

**A (Action):** {同上，重点写 Spend 拆解 / 年度议价 / 替代供应商导入 / 需求优化几条杠杆}

**R (Result):** {只用 CV/profile 已有事实的数字；没有就写"结果口径待补充真实数据"，禁止编造}

**Reflection（按来源分别列出）：**
- *From Report #001 (某工程机械整机厂):* 降本要拆到动作（议价 / 替代 / 需求），不能只盯单价
- *From Report #003 (某贸易公司):* 议价前先做成本结构拆解，才有多个杠杆可用
- *From Mock #61 Round2 (某工程机械贸易公司, 2026-04-20):* 面试官会追问"X% 怎么构成的" — 按动作拆开讲，每个动作对应多少个点

**Best for questions about:** 降本 / 谈判 / 品类管理 / 成本拆解 / 最有成就感的项目 / 抗压

---

### <a id="supplier-0to1"></a>[供应商开发 · 寻源 · 0→1] 新供应商 0→1 开发与导入

{... 同样结构 ...}

---

（继续所有 master story — 每个都对应 Story Bank 18 类之一；**只能基于 CV/profile 已有事实整理，缺证据的类别标"待补充真实案例"，禁止编造数字与经历**）

---

## <a id="real-qa"></a>实战 Q&A 清单（from mock interviews）

**来源：** `interview-prep/mock-interviews/*.md`（gitignored，本地专属实战打磨）。每条记录**真实被问过或高概率被问**的问题 + 打磨过的答案。按 canonical_key 索引。

### [cost_down] 降本谈判相关

- **Q（Mock #61 Round2, 2026-04-20）：** 降本 X% 是怎么构成的？拆开讲讲。
  **A：** 按动作拆 — 年度议价贡献约 X1 个点、替代供应商导入约 X2 个点、需求 / 规格优化约 X3 个点（口径以真实数据为准）
- **Q：** {其他从 mock 抽出来的真实问题}
  **A：** {对应答案}

### [supplier-0to1] 供应商开发相关

{...同上结构...}

### [supply-interrupt] 供应中断相关

{...}

---

## <a id="number-memos"></a>数字与话术备忘（blind recall）

**来源：** `interview-prep/mock-interviews/*.md` 中的 "背数字 / 关键数字 / 核价口径" 段落。每条 ≤ 20 行，面试前 1 晚复习。**所有数字必须来自 cv.md / article-digest.md / profile.yml 的真实事实，禁止编造。**

### [cost_down] 某品类降本 X% 的构成口径（Mock #61 Round2）

```
{从 mock 文件抽取的数字口径备忘，≤20 行}
```

### [supplier-0to1] 年开发导入 N 家的筛选漏斗

```
{...}
```

---

## <a id="narrative"></a>Narrative — 转方向叙事（非 STAR，但面试必问）

**问题模板：**
- 「为什么从上家离职？」
- 「为什么从执行采购转品类采购 / 寻源？」
- 「gap 期间在做什么？」

**标准答话（从 `config/profile.yml → narrative.exit_story` 生成）：**

{profile.yml 的 exit_story 内容 + 个性化润色}

---

## <a id="red-lines"></a>红线问题应对

国内 HR 常问但涉嫌歧视 / 与岗位无关的问题，事先准备得体应对：

| 问题 | 应对要点 |
|------|--------|
| 能接受加班吗 | 「旺季 / 项目阶段冲刺 OK，希望团队用产出衡量价值。可以了解团队过去 3 个月真实工时吗？」|
| 最晚能到几点 | 同上 |
| 婚育计划 | 「这是个人问题，咱们能聚焦岗位本身吗？」|
| 为什么频繁跳槽 | （按候选人真实履历准备；履历短就讲稳定性与目标感）|
| 期望薪资 | 「结合市场行情和岗位要求，区间是 X-Y。结构可谈，看 total package。」|
| 还有其他 offer 吗 | 诚实 — 但不透露具体数字 |

---

## 维护

- **如何新增：**
  - 评估新岗位后，跑 `/career-ops story-sync` 增量更新（从 `reports/*.md` 抽）
  - **面试前/后写了 mock interview 备战笔记**（`interview-prep/mock-interviews/{tracker#}-{slug}-{round}-{date}.md`）后，再跑一次 `/career-ops story-sync`，系统会把 mock 中的 refined S/T/A/R、实战 Reflection、真实 Q&A、数字备忘回流到 story-bank
- **如何纠错：** 故事抽取不准？直接编辑本文件，下次 `story-sync` 会**检测到人工修改**并保留（不会覆盖你改的内容，只追加新来的）
- **如何删除：** 过时故事直接删除，story-sync 不会主动加回（只基于 source 新增）
- **gitignore 注意：** `story-bank.md` 和 `mock-interviews/*.md` 都在 gitignore 中。可以安全存候选人专属内容（薪资底牌、真实对家、私下判断、fresh 的面试官原话）不用担心泄漏到 git
```

### Step 7 — 备份 + 写入

1. 如果 `interview-prep/story-bank.md` 有非模板内容 → 备份为 `story-bank.md.bak.{YYYYMMDD-HHMMSS}`
2. `Write interview-prep/story-bank.md` 新内容
3. 如果 `story-bank.md` 有用户手动加的段（通过 `<!-- MANUAL: -->` 标记识别），保留这些段

### Step 8 — 输出汇总

```
Story Bank 同步完成 — {YYYY-MM-DD}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
扫描 reports：N 份
扫描 mock-interviews：N_mock 份（gitignored，本地专属）
原始候选故事：M 条
语义去重后：K 个 master story
分组主题：T 个

Master stories:
  1. cost_down (降本谈判 · 品类管理)
     — Reports: 4 份 / Mock: 1 份（#61 Round2）
  2. supplier_0to1 (供应商开发 · 寻源)
     — Reports: 8 份 / Mock: 0 份
  3. cross_func (跨部门冲突)
     — Reports: 5 份 / Mock: 0 份
  ...

Mock-only contributions（不对应任何 master story 的独立素材）:
  - 实战 Q&A：{N} 条（from Mock #61 Round2）
  - 数字与话术备忘：{N} 条
  - 红线问题话术更新：{N} 条

输出：interview-prep/story-bank.md ({行数} 行)
{如果有备份} 旧版备份：story-bank.md.bak.{ts}
```

---

## 规则

### 永远要
1. 用**语义去重**，不要机械按 story title 去重（同一段经历在不同 report 里叫法不同）
2. **保留多个 Reflection** — 这是 story bank 相对单份 report 的真正价值（同一故事在不同面试语境下的不同 lesson）
3. 每个 story 必须有 `Sources:` 列出所有引用 report，方便用户回溯
4. 按主题分组 + 加锚点跳转 — 面试前 5 分钟要能快速定位故事
5. **只用 CV / profile 已有的事实**整理故事；缺证据的类别如实标"待补充真实案例"

### 永远不要
1. 覆盖用户手动加的段（用 `<!-- MANUAL START -->` / `<!-- MANUAL END -->` 识别）
2. 重复录入同一个 canonical_key 的故事（去重失败会产生 5 个"cost_down"条目）
3. **编造不存在于 source 中的 STAR 字段或数字**（如果原 report/mock 的 A 段写得短，就保留短的，不要脑补；没有量化结果就写"待补充真实案例"）
4. 删除 narrative / red-lines 等非 STAR 段 — 这些是从 profile.yml 来的，不受 source 变化影响
5. **把 mock-interview 的内容回流到 `reports/*.md`** — reports 已 commit 到 git，不要把候选人专属细节（薪资底牌、对家 offer、实时面试官原话）写回 reports；这类信息只保留在 story-bank.md（gitignored）和 mock-interviews/（gitignored）
6. **扫 mock-interviews 时不要 `Read` 进主 session 的 context** — 用 subagent 扫完后只回传结构化的 candidate records；mock 文件可能很长（100-200 行）且含大量细节，直接进主 session 会炸 context
