# Mode: pdf — ATS 优化 PDF 生成

## 完整 pipeline

1. 读 `cv.md` 作为真理之源
2. 如果上下文里没有 JD，向用户索取（文本或 URL）
3. 从 JD 提取 15-20 个关键词
4. 检测 JD 语言 → 决定 CV 语言
   - 中文 JD → 中文 CV
   - 英文 JD → 英文 CV
   - 双语 JD → 中文优先
5. 检测公司所在地 → 决定纸张：
   - 中国大陆 / 港澳台 / 大多数国家 → `a4`
   - 美国/加拿大 → `letter`
6. 检测 archetype → 适配 framing
7. 重写 Professional Summary：注入 JD 关键词 + exit narrative bridge（"过去 N 年在 X，现在把同样的能力带到 [JD 领域]"）
8. 选 top 3-4 段最相关的经历（品类管理 / 降本专项 / 供应商开发 / 数字化采购等）
9. 按 JD 相关性重新排序工作经历的 bullets
10. 构建 competency grid（6-8 个关键词短语）
11. 把关键词自然注入到现有成就描述中（**永远不要编造新技能**）
12. 用 template + 个性化内容生成完整 HTML
13. 把 HTML 写到 `/tmp/cv-candidate-{company}.html`
14. 执行：`node tools/generate-pdf.mjs /tmp/cv-candidate-{company}.html output/cv-candidate-{company}-{YYYY-MM-DD}.pdf --format={letter|a4}`
15. 报告：PDF 路径、页数、关键词覆盖率

## ATS 规则（保证机器能解析）

- 单栏布局（不要 sidebar、不要平行栏）
- 标准 section 标题：「专业摘要 / Professional Summary」「工作经历 / Work Experience」「教育 / Education」「技能 / Skills」「证书 / Certifications」「项目经历 / Projects」
- 不要在图/SVG 里放文字
- 不要把关键信息放 PDF header/footer（ATS 一般忽略）
- UTF-8、文本可选中（不能是栅格化的图）
- 不要嵌套表格
- 关键词在 Summary（top 5）、每个工作经历的第一个 bullet、Skills section 里都要出现

## 中国大陆 CV 的额外约定

- **学历放在显著位置** — 国内 HR 第一眼就会找学校
- **个人信息**：姓名、电话、邮箱、所在城市、（可选）证件照
  - 互联网大厂一般不要照片
  - 国企/外企 / 偏 ToB 的公司常见放照片
- **是否写出生年月**：默认不写。如果是国企/外企可加。35 岁以上的候选人不建议写
- **工作经历描述模式**：「业务背景 → 我的角色 → 采购动作 → 量化结果」
- **量化结果**（采购证据，越具体越好，全部来自真实经历）：年采购额 / Spend 规模、降本金额与比例、供应商数量（在管 / 新开发 / 淘汰）、RFQ 项目规模、谈判结果（价格 / 账期 / MOQ / Lead Time）、交付改善（OTD / 缺货率）、质量改善（来料合格率 / PPM）、库存下降与呆滞处理、品类规模、合同金额、国际采购与外贸单证闭环、团队人数、ERP·SRM 数字化成果 — **禁止 QPS / p99 / SLA / 高并发等工程话术**
- **专业术语**：用国内采购通用写法（如「寻源」「品类降本」「账期」「MOQ」「Incoterms」「ERP·SRM」），英文缩写术语保留不硬译（见 `modes/_shared.md` 术语规则）

## PDF 设计

- **字体**：Space Grotesk（标题，600-700）+ DM Sans（正文，400-500）+ 中文字体 fallback（PingFang SC / Microsoft YaHei / Noto Sans SC）
- **字体自托管**：`fonts/`
- **Header**：姓名 Space Grotesk 24px bold + 渐变线 `linear-gradient(to right, hsl(187,74%,32%), hsl(270,70%,45%))` 2px + 联系信息行
- **Section 标题**：Space Grotesk 13px，uppercase（中文 section 不 uppercase），letter-spacing 0.05em，颜色 cyan primary
- **正文**：DM Sans 11px（中文用对应 fallback），行高 1.5
- **公司名**：accent purple `hsl(270,70%,45%)`
- **页边距**：0.6in
- **背景**：纯白

## Section 顺序（"6 秒 HR 扫描"优化）

1. Header（大字姓名、渐变线、联系方式、portfolio 链接）
2. Professional Summary / 专业摘要（3-4 行，关键词密集）
3. Core Competencies / 核心能力（6-8 个关键词短语 flex-grid）
4. Work Experience / 工作经历（倒序）
5. Projects / 项目经历（top 3-4）
6. Education / 教育 & Certifications / 证书
7. Skills / 技能（语言 + ERP·SRM 等采购工具）

## 关键词注入策略（基于事实，不编造）

合理改写示例（句式 = 动作 + 规模 + 结果 + 业务影响，数值全部为占位）：
- JD 说 "品类降本" 而 CV 写 "每年和供应商议价 + 找替代料" → 改成 "负责某品类年度降本：通过年度议价与替代供应商导入实现成本下降 X%"
- JD 说 "供应商开发" 而 CV 写 "找新厂家、打样、导入" → 改成 "新供应商开发与导入：完成从寻源、验厂、样品确认到批产导入的 0→1 闭环，年开发导入 N 家"
- JD 说 "ERP·SRM 数字化采购" 而 CV 写 "公司在系统里下单、对账" → 改成 "ERP·SRM 采购流程线上化：订单、对账、供应商主数据全流程线上运行，关键单据流转由 X 小时缩短至 Y 小时"

**绝不添加候选人没有的技能。只用 JD 的精确措辞重写真实经历。**

## HTML Template

用 `templates/cv-template.html`。把 `{{...}}` placeholder 替换成个性化内容：

| Placeholder | 内容 |
|-------------|------|
| `{{LANG}}` | `zh-CN` 或 `en` |
| `{{PAGE_WIDTH}}` | `8.5in`（letter）或 `210mm`（A4） |
| `{{NAME}}` | （from profile.yml） |
| `{{EMAIL}}` | （from profile.yml） |
| `{{LINKEDIN_URL}}` | （from profile.yml） |
| `{{LINKEDIN_DISPLAY}}` | （from profile.yml） |
| `{{PORTFOLIO_URL}}` | （from profile.yml） |
| `{{PORTFOLIO_DISPLAY}}` | （from profile.yml） |
| `{{LOCATION}}` | （from profile.yml） |
| `{{SECTION_SUMMARY}}` | `专业摘要` 或 `Professional Summary` |
| `{{SUMMARY_TEXT}}` | 关键词注入后的 summary |
| `{{SECTION_COMPETENCIES}}` | `核心能力` 或 `Core Competencies` |
| `{{COMPETENCIES}}` | `<span class="competency-tag">关键词</span>` × 6-8 |
| `{{SECTION_EXPERIENCE}}` | `工作经历` 或 `Work Experience` |
| `{{EXPERIENCE}}` | 工作经历 HTML |
| `{{SECTION_PROJECTS}}` | `项目经历` 或 `Projects` |
| `{{PROJECTS}}` | top 3-4 项目 HTML |
| `{{SECTION_EDUCATION}}` | `教育背景` 或 `Education` |
| `{{EDUCATION}}` | 教育 HTML |
| `{{SECTION_CERTIFICATIONS}}` | `证书` 或 `Certifications` |
| `{{CERTIFICATIONS}}` | 证书 HTML |
| `{{SECTION_SKILLS}}` | `技能` 或 `Skills` |
| `{{SKILLS}}` | 技能 HTML |

## 生成后

如果这个岗位已经在 tracker 里：把 PDF 列从 ❌ 改成 ✅。
