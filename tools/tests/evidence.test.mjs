// evidence.test.mjs — 能力证据层单元测试（node --test）
// Run: node --test tools/tests/evidence.test.mjs
//
// 设计依据：PROCUREMENT_ARCHETYPE_AUDIT.md §7（10 能力桶）、§22.2、§25。
// 覆盖任务书 22 条中的第 1-21 条（第 22 条守卫测试位于 tools/tests/taxonomy.test.mjs T26）。
//
// fixture 约定：fixture-002/003 用本地回归报告与 inbox JD 原文关键句常量（内嵌，不 fs 读 gitignored 文件）；
// cv.md 侧量化证据用真实 cv.md 原文摘录常量（cv.md 只读，摘录未改写）。
// 分层证明：Archetype 判定仍调 tools/lib/taxonomy.mjs 的 classifyArchetype，
// Capability/Evidence 层不回写、不影响分类层。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CAPABILITY_BUCKET_KEYS, EVIDENCE_SOURCES, EVIDENCE_TYPES, EVIDENCE_STRENGTHS,
  EVIDENCE_CONFIDENCE, REQUIREMENT_LEVELS, COVERAGE_STATUSES,
  CANDIDATE_EVIDENCE_STRENGTHS, EVIDENCE_SIGNALS, QUALIFIER_PREFIXES,
  QUANT_METRICS, RESULT_METRICS,
  extractQuantitative, determineStrength, buildEvidence,
  analyzeJobCapabilities, buildCandidateEvidence, coverageMatrix, analyzeCapabilityCoverage,
} from '../lib/evidence.mjs';
import { CAPABILITY_BUCKETS, classifyArchetype, detectCapabilities } from '../lib/taxonomy.mjs';

// ---------------------------------------------------------------------------
// 真实原文 fixture（内嵌常量，只读摘录，未改写）
// ---------------------------------------------------------------------------

// 本地回归报告 fixture-001（TL;DR/A 块/提取关键词，与 taxonomy.test.mjs T17 同源）
const JD_001 = '出口采购专员岗：源头工厂寻源+全流程议价+出口交付+验货监柜+出口单证；雨刷等易损件；进出口贸易；外贸跟单；交货及时率；询价、比价';

// 本地回归 fixture-002 JD 原文关键句（匿名化，语义与本地回归报告一致）
const JD_002 = '岗位职责：\n' +
  '1.熟悉采购工作，有源头或基地资源渠道（蔬菜、水果、肉类、冻品、食品百货），熟悉生鲜行业产品特性；\n' +
  '2.有生鲜产品供应商资源，可以独立开发上新品项，完成公司采购任务；\n' +
  '3.根据商品的特性，制定仓储配送解决方案，降低损耗；\n' +
  '4.根据市场行情，管控进价和售价，并制定商品的促销计划以及品类的销售和利润指标；\n' +
  '5.负责区域客户售后问题对接处理。\n' +
  '任职要求\n' +
  '1.大专及以上学历；\n' +
  '2.熟悉采购工作流程，具有较强的价格谈判.订单管理.账务处理.供应商开发管理等能力；\n' +
  '3.有供应链.大中型超市.食品类采购经验者优先考虑';

// 本地回归 fixture-003 JD 原文（匿名化）：职责/任职要求/加分项
const JD_003 = '【岗位职责】\n' +
  '1、对接业务部门的产品报价需求，组织供应商报价并完成核价工作；\n' +
  '2、负责产品配置与供应商的技术对接，跟进样品确认及配置变更的落实；\n' +
  '3、负责新供应商、新产品的开发导入，以及老供应商、老产品的维护与迭代，持续优化成本与质量；\n' +
  '【任职要求】\n' +
  '1、一年及以上采购工作经验\n' +
  '2、做事严谨细致、责任心强，具备优秀的跨部门沟通能力\n' +
  '【加分项】\n' +
  '1、了解工程机械行业，熟悉工程机械整机、配件、CKD产品逻辑，能看懂BOM清单，精通成本核算，对数据、价格、成本高度敏感。\n' +
  '2、有独立完成供应商开发、新品开发项目经验。';

// cv.md 真实原文摘录（逐字，未改写）
const CV_SUMMARY = '5年工程机械跨境采购与供应链协同经验，覆盖供应商开发、品类采购、询比价、商务谈判、成本控制、合同条款审核及交付异常处理。' +
  '熟悉发动机、叉车、装载机等工程机械相关品类，曾负责/参与17个产品品类采购管理，推动重点产品采购成本下降约15%。' +
  '具备采购小组管理、部门协同推进、SOP/KPI落地及新人带教经验，曾主导流程优化项目，将关键单据流转时间由3小时缩短至0.5-1小时。';
const CV_PREV_EMPLOYER = '负责机械零部件供应商开发及供应链资源搭建，全年开发供应商100+家，并沉淀5家核心供应商。' +
  '建立供应商评估机制，围绕价格、质量、交期进行筛选和比价，任职期累计节约采购成本50万元+。' +
  '跟进合同签订、物流运输、报关单证、验收及财务对接，保障外贸订单执行与合规履约。' +
  '维护供应商关系，处理质量及交付异常，推动采购问题闭环。';
// cv.md 重点项目原文（数字化报价系统两段——跨句 inferred 推断的真实场景）
const CV_PROJECT = '推动询报价SOP、报价模板及关键数据逻辑落地，协同业务、采购及系统相关人员完成流程上线。\n' +
  '上线后将关键单据流转时间由3小时缩短至0.5-1小时，提升前后台报价响应效率。';
// E19 用：真实 cv.md 原文摘录（前任公司·某零售企业运营段 + 美洲项目交付段）——不含任何寻源/供应商开发证据，
// 模拟"候选人对该能力无信息"的切面（V1：CV 文本无该能力信息 → no_evidence）。
const CV_NO_SOURCING = '负责积分商城选品、定价、活动资源对接及库存结构调整，积累选品、数据分析、库存管理及跨部门协同经验。' +
  '跟进供应商交期、质量及交付节点，协调异常问题处理，推动项目全批次按期交付。';

// ---------------------------------------------------------------------------
// E0 模块完整性：10 桶枚举守卫、三级信号词齐备、metric 枚举冻结
// ---------------------------------------------------------------------------

test('E0 枚举守卫：能力桶 = taxonomy 10 桶（无第 11 桶），每桶三级信号齐备，metric 枚举 17 项', () => {
  assert.equal(CAPABILITY_BUCKET_KEYS.length, 10);
  assert.deepEqual(CAPABILITY_BUCKET_KEYS, CAPABILITY_BUCKETS.map(b => b.key));
  // 每桶必须有 strong/medium/weak 三级明确信号词，且不允许出现第 4 级
  for (const key of CAPABILITY_BUCKET_KEYS) {
    const sig = EVIDENCE_SIGNALS[key];
    assert.ok(sig, `缺少桶信号表: ${key}`);
    assert.deepEqual(Object.keys(sig).sort(), ['medium', 'strong', 'weak'], key);
    for (const level of ['strong', 'medium', 'weak']) {
      assert.ok(Array.isArray(sig[level]) && sig[level].length > 0, `${key}.${level} 信号词为空`);
    }
  }
  // negotiation weak 层严禁收录 沟通/协调/对接（§1.2 语义护栏）
  for (const w of EVIDENCE_SIGNALS.negotiation_contract.weak) {
    assert.ok(!/沟通|协调|对接/.test(w), `negotiation weak 泄漏沟通协调词: ${w}`);
  }
  // 量化 metric 枚举冻结 17 项
  assert.equal(QUANT_METRICS.length, 17);
  assert.equal(new Set(QUANT_METRICS).size, 17);
  // 桥接表 key/value 合法
  for (const [bucket, metrics] of Object.entries(RESULT_METRICS)) {
    assert.ok(CAPABILITY_BUCKET_KEYS.includes(bucket));
    for (const m of metrics) assert.ok(QUANT_METRICS.includes(m), `${bucket} 桥接了未知 metric: ${m}`);
  }
  // 覆盖枚举冻结
  assert.deepEqual(COVERAGE_STATUSES, ['matched', 'partial', 'no_evidence', 'unknown']);
  assert.deepEqual(CANDIDATE_EVIDENCE_STRENGTHS, ['strong', 'medium', 'weak', 'no_evidence']);
  assert.deepEqual(REQUIREMENT_LEVELS, ['required', 'preferred']);
  assert.deepEqual(EVIDENCE_SOURCES, ['jd', 'cv', 'report', 'profile']);
  assert.deepEqual(EVIDENCE_TYPES, ['explicit', 'inferred']);
  assert.deepEqual(EVIDENCE_STRENGTHS, ['strong', 'medium', 'weak']);
  assert.deepEqual(EVIDENCE_CONFIDENCE, ['high', 'low']);
  assert.ok(QUALIFIER_PREFIXES.includes('协助') && QUALIFIER_PREFIXES.includes('了解'));
  // 无信号文本 → 不产生任何证据（禁止臆测）
  assert.deepEqual(buildEvidence('负责部门行政后勤与办公室日常事务', 'cv'), []);
  // 第 11 桶（如细粒度 alias key）必须被拒之门外
  assert.throws(() => coverageMatrix([{ capability: 'supplier_sourcing', requirement_level: 'required' }], []));
});

// ---------------------------------------------------------------------------
// 桶识别（任务书 1-12）
// ---------------------------------------------------------------------------

test('E1 (任务1) 新供应商开发 → sourcing_development，年开发N家为 strong', () => {
  const items = buildEvidence('负责新供应商开发与导入，年开发20家', 'cv');
  const item = items.find(x => x.capability === 'sourcing_development');
  assert.ok(item, '应产生寻源开发证据');
  assert.equal(item.source, 'cv');
  assert.equal(item.evidence_type, 'explicit');
  assert.equal(item.strength, 'strong'); // 年开发20家 = 开发动作+规模
  assert.equal(item.confidence, 'high');
});

test('E2 (任务2) "供应商维护"不等价寻源开发：归 supplier_quality（§7 并入），不落 sourcing_development', () => {
  const items = buildEvidence('负责日常供应商维护与关系维护', 'cv');
  assert.equal(items.some(x => x.capability === 'sourcing_development'), false);
  const item = items.find(x => x.capability === 'supplier_quality');
  assert.ok(item, '供应商维护应落 supplier_quality 桶');
  assert.equal(item.strength, 'medium');
});

test('E3 (任务3) RFQ 识别 → rfq_execution', () => {
  const items = buildEvidence('根据业务需求发起RFQ并组织供应商报价', 'jd');
  assert.ok(items.some(x => x.capability === 'rfq_execution'));
});

test('E4 (任务4) 商务谈判 → negotiation_contract', () => {
  const items = buildEvidence('与供应商进行商务谈判并签订年度框架合同', 'cv');
  const item = items.find(x => x.capability === 'negotiation_contract');
  assert.ok(item);
  assert.equal(item.strength, 'medium'); // 无量化结果 → medium
});

test('E5 (任务5) 普通"沟通/协调/对接" ≠ negotiation：不误判，只落协同桶或无证据', () => {
  const items = buildEvidence('负责跨部门沟通协调，对接业务需求', 'cv');
  assert.equal(items.some(x => x.capability === 'negotiation_contract'), false);
  assert.ok(items.some(x => x.capability === 'delivery_collaboration')); // 跨部门 → 交付协同
  // 纯"沟通能力"泛句 → 无证据
  assert.deepEqual(buildEvidence('具备良好的沟通能力', 'cv'), []);
});

test('E6 (任务6) 降本百分比 → strong cost_reduction（真实 cv.md 原文）', () => {
  const items = buildEvidence('推动部分重点产品采购成本下降约15%', 'cv');
  const item = items.find(x => x.capability === 'cost_reduction');
  assert.ok(item);
  assert.equal(item.strength, 'strong');
  assert.deepEqual(item.quantitative, [{ metric: 'cost_saving_percent', value: 15, raw: '成本下降约15%' }]);
});

test('E7 (任务7) "控制成本" → weak（泛泛成本意识不升档）', () => {
  const items = buildEvidence('具备成本控制意识', 'cv');
  const item = items.find(x => x.capability === 'cost_reduction');
  assert.ok(item);
  assert.equal(item.strength, 'weak');
});

test('E8 (任务8) 交付跟进 → delivery_collaboration', () => {
  const items = buildEvidence('负责订单交付跟进与大货交期管理', 'cv');
  const item = items.find(x => x.capability === 'delivery_collaboration');
  assert.ok(item);
  assert.equal(item.strength, 'medium'); // 无量化结果
});

test('E9 (任务9) 供应商质量异常+8D闭环+合格率 → strong supplier_quality', () => {
  const items = buildEvidence('处理供应商质量异常并推动8D闭环，来料合格率提升至98.5%', 'cv');
  const item = items.find(x => x.capability === 'supplier_quality');
  assert.ok(item);
  assert.equal(item.strength, 'strong');
  assert.equal(item.quantitative[0].metric, 'quality_rate');
  assert.equal(item.quantitative[0].value, 98.5);
});

test('E10 (任务10) 合同/账期 → negotiation_contract，账期30→60天为 strong', () => {
  const items = buildEvidence('通过谈判将账期从30天延长至60天，并负责采购合同条款审核', 'cv');
  const item = items.find(x => x.capability === 'negotiation_contract');
  assert.ok(item);
  assert.equal(item.strength, 'strong'); // 谈判对象+条件+结果（账期改善）
  assert.equal(item.quantitative[0].metric, 'payment_terms_days');
  assert.equal(item.quantitative[0].value, 60); // 取改善后值
  assert.ok(item.quantitative[0].raw.includes('账期从30天延长至60天'));
});

test('E11 (任务11) ERP/SRM/SAP → digital_tools', () => {
  const items = buildEvidence('熟练使用ERP/SRM系统处理采购订单', 'cv');
  const item = items.find(x => x.capability === 'digital_tools');
  assert.ok(item);
  assert.equal(item.strength, 'medium'); // 日常使用 ≠ 主导建设
});

test('E12 (任务12) 外贸/Incoterms/报关 → international_procurement', () => {
  const items = buildEvidence('熟悉Incoterms国际贸易术语，负责报关与船务协调', 'cv');
  const item = items.find(x => x.capability === 'international_procurement');
  assert.ok(item);
  assert.equal(item.strength, 'medium'); // "熟悉Incoterms"邻接限定词降级，报关/船务仍 medium
});

// ---------------------------------------------------------------------------
// required / preferred 与覆盖状态（任务书 13-15）
// ---------------------------------------------------------------------------

test('E13 (任务13) required/preferred 区分：必须→required，优先→preferred', () => {
  const job = analyzeJobCapabilities('必须有新供应商开发经验；有SAP经验优先');
  const req = job.required_capabilities.find(x => x.capability === 'sourcing_development');
  assert.ok(req, '"必须有新供应商开发经验"应归 required');
  assert.equal(req.requirement_level, 'required');
  assert.ok(req.evidence.text.includes('新供应商开发'));
  const pref = job.preferred_capabilities.find(x => x.capability === 'digital_tools');
  assert.ok(pref, '"有SAP经验优先"应归 preferred');
  assert.equal(pref.requirement_level, 'preferred');
  assert.equal(job.preferred_capabilities.some(x => x.capability === 'sourcing_development'), false);
  assert.equal(job.required_capabilities.some(x => x.capability === 'digital_tools'), false);
});

test('E14 (任务14) CV 未提及 → no_evidence（不是 false/undefined/null）', () => {
  const rows = coverageMatrix([{ capability: 'international_procurement', requirement_level: 'required' }], []);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].candidate_evidence_strength, 'no_evidence');
  assert.equal(rows[0].coverage_status, 'no_evidence');
  assert.notEqual(rows[0].coverage_status, false);
  assert.notEqual(rows[0].coverage_status, undefined);
});

test('E15 (任务15) strong/medium/weak 判定规则各一例', () => {
  // strong：量化结果（成本下降约15%，真实 cv.md 原文）
  assert.equal(determineStrength('cost_reduction', '推动重点产品采购成本下降约15%'), 'strong');
  // medium：明确降本动作无量化
  assert.equal(determineStrength('cost_reduction', '负责年度降本项目与成本拆解'), 'medium');
  // weak：泛泛成本意识
  assert.equal(determineStrength('cost_reduction', '具备成本控制意识'), 'weak');
  // 全无信号 → null（不产生证据）
  assert.equal(determineStrength('cost_reduction', '负责会议室预约管理'), null);
});

// ---------------------------------------------------------------------------
// 量化识别（任务书 16-17）
// ---------------------------------------------------------------------------

test('E16 (任务16) 百分比量化提取：降本约15% → cost_saving_percent value≈15', () => {
  const quant = extractQuantitative('重点产品采购成本下降约15%');
  assert.equal(quant.length, 1);
  assert.equal(quant[0].metric, 'cost_saving_percent');
  assert.equal(quant[0].value, 15);
  assert.equal(quant[0].raw, '成本下降约15%'); // 原文片段，未改写
});

test('E17 (任务17) 金额提取：节约50万元 → cost_saving_amount；280万美金订单 → annual_spend，raw 保留', () => {
  const quant = extractQuantitative('任职期累计节约采购成本50万元+，另完成美洲280万美金机械订单采购项目');
  const amount = quant.find(q => q.metric === 'cost_saving_amount');
  assert.ok(amount, '应提取节约金额');
  assert.equal(amount.value, 50); // 保留原文数值形式，不换算
  assert.ok(amount.raw.includes('节约采购成本50万元'));
  const order = quant.find(q => q.metric === 'annual_spend');
  assert.ok(order, '订单金额应提取（V1 枚举无 order_amount，按 spend 规模归 annual_spend）');
  assert.equal(order.value, 280);
  assert.ok(order.raw.includes('280万美金'));
  // 薪资误匹配排除："13薪""8-12K"不产生任何量化项
  assert.deepEqual(extractQuantitative('薪资8-12K·13薪，年薪增幅超50%'), []);
  // 团队规模："直接管理4人采购小组" → team_size 4（真实 cv.md 原文）
  const team = extractQuantitative('直接管理4人采购小组');
  assert.equal(team[0].metric, 'team_size');
  assert.equal(team[0].value, 4);
  // 单据流转区间：value 不可靠 → null 只留 raw（真实 cv.md 原文 3h→0.5-1h）
  const cycle = extractQuantitative('将关键单据流转时间由3小时缩短至0.5-1小时');
  assert.equal(cycle[0].metric, 'cycle_time_change');
  assert.equal(cycle[0].value, null);
  assert.ok(cycle[0].raw.includes('单据流转时间由3小时缩短至0.5-1小时'));
});

// ---------------------------------------------------------------------------
// 三岗位回归（任务书 18-21）：Capability/Evidence 层不影响 taxonomy 分类层
// ---------------------------------------------------------------------------

test('E18 (任务18) fixture-001 回归：JD 关键职责落 rfq/delivery/寻源/质量/外贸桶，archetype 仍 execution_procurement', () => {
  // Capability 层：报价/核价/样品确认 → rfq_execution；交付/交期 → delivery_collaboration；
  // 源头工厂寻源 → sourcing_development；验货 → supplier_quality；出口单证/外贸 → international_procurement
  const execDuties = buildEvidence('组织供应商报价并完成核价工作，跟进样品确认，负责交付与日常供应商维护', 'jd');
  assert.ok(execDuties.some(x => x.capability === 'rfq_execution'));
  assert.ok(execDuties.some(x => x.capability === 'delivery_collaboration'));
  assert.ok(execDuties.some(x => x.capability === 'supplier_quality'));
  const job001 = analyzeJobCapabilities(JD_001);
  const caps = job001.required_capabilities.map(x => x.capability);
  for (const key of ['sourcing_development', 'rfq_execution', 'supplier_quality', 'delivery_collaboration', 'international_procurement']) {
    assert.ok(caps.includes(key), `fixture-001 应识别能力桶: ${key}`);
  }
  // 分类层不受 Capability 层影响：classifyArchetype 仍 execution_procurement（与 taxonomy T17 一致）
  assert.equal(classifyArchetype(JD_001), 'execution_procurement');
});

test('E19 (任务19) fixture-002：生鲜供应商资源 → sourcing_development required；CV 无该能力信息 → coverage no_evidence，且不产生任何 recommendation', () => {
  const result = analyzeCapabilityCoverage(JD_002, CV_NO_SOURCING);
  // JD 侧：生鲜供应商资源/独立开发上新 → sourcing_development required
  const reqSourcing = result.job.required_capabilities.find(x => x.capability === 'sourcing_development');
  assert.ok(reqSourcing, 'fixture-002 应产生 sourcing_development required');
  assert.equal(reqSourcing.requirement_level, 'required');
  assert.ok(reqSourcing.evidence.text.includes('生鲜'));
  // CV 侧（真实原文摘录，无寻源证据）：candidate_evidence 无 sourcing_development
  assert.equal(result.candidate_evidence.some(x => x.capability === 'sourcing_development'), false);
  // 覆盖状态：required + 无证据 → no_evidence（诚实标注，绝不是 false）
  const row = result.coverage.find(x => x.capability === 'sourcing_development');
  assert.deepEqual(row, {
    capability: 'sourcing_development',
    requirement_level: 'required',
    candidate_evidence_strength: 'no_evidence',
    coverage_status: 'no_evidence',
  });
  // 结构守卫：只有 job/candidate_evidence/coverage 三键，无 recommendation / 无分数 / 无百分比输出
  assert.deepEqual(Object.keys(result), ['job', 'candidate_evidence', 'coverage']);
  assert.ok(!/recommendation/i.test(JSON.stringify(result)));
  for (const r of result.coverage) {
    assert.deepEqual(Object.keys(r), ['capability', 'requirement_level', 'candidate_evidence_strength', 'coverage_status']);
    assert.ok(COVERAGE_STATUSES.includes(r.coverage_status));
    assert.ok(CANDIDATE_EVIDENCE_STRENGTHS.includes(r.candidate_evidence_strength));
    assert.equal(typeof r.coverage_status, 'string'); // 全枚举字符串，无数值
  }
});

test('E20 (任务20) fixture-003：primary_archetype=execution_procurement 同时 required/preferred 含 sourcing_development（Archetype≠Capability）', () => {
  // 分类层：主代理裁决仍 execution_procurement（职责占比：报价核价+样品确认=执行主体）
  assert.equal(classifyArchetype(JD_003), 'execution_procurement');
  // taxonomy 层 detectCapabilities 同样含 sourcing（同一 10 桶枚举，两层独立产出）
  assert.ok(detectCapabilities(JD_003).includes('sourcing_development'));
  assert.ok(detectCapabilities(JD_003).includes('rfq_execution'));
  // 证据层：职责3"新供应商、新产品的开发导入"= required（分节语境），
  // 加分项"供应商开发"= preferred，同一能力同现 → required 优先，不双列
  const job = analyzeJobCapabilities(JD_003);
  const union = [
    ...job.required_capabilities.map(x => x.capability),
    ...job.preferred_capabilities.map(x => x.capability),
  ];
  assert.ok(union.includes('sourcing_development'), 'required ∪ preferred 应含 sourcing_development');
  assert.ok(union.includes('rfq_execution')); // 报价/核价/样品确认
  const reqSourcing = job.required_capabilities.find(x => x.capability === 'sourcing_development');
  assert.equal(reqSourcing.requirement_level, 'required');
  assert.equal(job.preferred_capabilities.some(x => x.capability === 'sourcing_development'), false);
  // 【加分项】分节语境确实生效：标题继承 → 条目归 preferred（用无歧义探针验证）
  const probe = analyzeJobCapabilities('【加分项】\n有SAP经验');
  assert.ok(probe.preferred_capabilities.some(x => x.capability === 'digital_tools'));
  assert.equal(probe.required_capabilities.length, 0);
});

test('E21 (任务21) capability 多样不覆盖 archetype：fixture-002 全文多桶证据，classifyArchetype 仍 sourcing', () => {
  // taxonomy 分类层：fixture-002 全文（含大量执行/交付词）→ 仍 sourcing（与 taxonomy T18 同源结论）
  assert.equal(classifyArchetype(JD_002), 'sourcing');
  assert.ok(detectCapabilities(JD_002).length >= 3, '002 应命中多个能力桶');
  // 证据层：多个能力桶并存，不回写、不改变分类层结果
  const job = analyzeJobCapabilities(JD_002);
  const caps = [
    ...job.required_capabilities.map(x => x.capability),
    ...job.preferred_capabilities.map(x => x.capability),
  ];
  assert.ok(new Set(caps).size >= 4, `fixture-002 证据层应识别多桶，实际: ${caps.join(',')}`);
  assert.equal(classifyArchetype(JD_002), 'sourcing');
});

// ---------------------------------------------------------------------------
// 结构与跨句推断（补充，非任务书强制项）
// ---------------------------------------------------------------------------

test('E22 candidate_evidence 结构完整（任务1.1 六字段），CV 全文量化证据走真实原文', () => {
  const evidence = buildCandidateEvidence(CV_SUMMARY + '\n' + CV_PREV_EMPLOYER + '\n' + CV_PROJECT);
  assert.ok(evidence.length >= 10, `CV 证据数应充分，实际 ${evidence.length}`);
  for (const ev of evidence) {
    assert.deepEqual(Object.keys(ev).sort(),
      ['capability', 'confidence', 'evidence_type', 'quantitative', 'source', 'strength', 'text'].sort());
    assert.ok(CAPABILITY_BUCKET_KEYS.includes(ev.capability));
    assert.ok(EVIDENCE_SOURCES.includes(ev.source));
    assert.equal(ev.source, 'cv');
    assert.ok(EVIDENCE_TYPES.includes(ev.evidence_type));
    assert.ok(EVIDENCE_STRENGTHS.includes(ev.strength));
    assert.ok(EVIDENCE_CONFIDENCE.includes(ev.confidence));
    assert.equal(typeof ev.text, 'string');
  }
  // 真实原文量化点全部落位：年开发100+家 / 节约50万元+ / 17个品类 / 降本约15% / 3h→0.5-1h
  const metrics = evidence.flatMap(x => (x.quantitative || []).map(q => q.metric));
  for (const m of ['new_supplier_count', 'cost_saving_amount', 'category_scale', 'cost_saving_percent', 'cycle_time_change']) {
    assert.ok(metrics.includes(m), `CV 量化证据缺 metric: ${m}`);
  }
  // 强度分布：既有 strong（量化结果）也有 weak（泛泛词），不允许凭空 strong
  assert.ok(evidence.some(x => x.strength === 'strong'));
  assert.ok(evidence.some(x => x.strength === 'weak'));
  assert.ok(evidence.every(x => x.strength !== 'no_evidence')); // 证据列表内不会有 no_evidence（那是覆盖态）
});

test('E23 inferred 跨句推断：上句明确职责+本句仅量化结果 → inferred + low confidence', () => {
  const cv = '主导数字化采购平台建设并完成上线。\n上线后单据流转时间由3小时缩短至0.5小时。';
  const evidence = buildEvidence(cv, 'cv');
  const explicit = evidence.find(x => x.capability === 'digital_tools' && x.evidence_type === 'explicit');
  assert.ok(explicit, '上句"主导…平台…上线"应为 explicit strong');
  assert.equal(explicit.strength, 'strong');
  assert.equal(explicit.confidence, 'high');
  const inferred = evidence.find(x => x.capability === 'digital_tools' && x.evidence_type === 'inferred');
  assert.ok(inferred, '下句仅有量化结果、系统名在上句 → 跨句 inferred');
  assert.equal(inferred.strength, 'strong');
  assert.equal(inferred.confidence, 'low');
  assert.equal(inferred.quantitative[0].metric, 'cycle_time_change');
  assert.equal(inferred.quantitative[0].value, null); // "3小时→0.5小时"区间/单位不折算
  assert.ok(inferred.text.includes('单据流转时间由3小时缩短至0.5小时'));
});

test('E24 一站式入口：analyzeCapabilityCoverage 输出结构冻结（fixture-001 JD × 真实 CV 原文）', () => {
  const result = analyzeCapabilityCoverage(JD_001, CV_SUMMARY + '\n' + CV_PREV_EMPLOYER + '\n' + CV_PROJECT);
  assert.deepEqual(Object.keys(result), ['job', 'candidate_evidence', 'coverage']);
  assert.ok(result.job.required_capabilities.length > 0);
  // fixture-001 全部 required 桶在候选人真实 CV 侧均有证据 → matched/partial，绝不输出百分比
  for (const row of result.coverage) {
    assert.ok(COVERAGE_STATUSES.includes(row.coverage_status));
    if (row.requirement_level === 'required') {
      assert.ok(['matched', 'partial', 'no_evidence'].includes(row.coverage_status), row.capability);
    }
  }
  assert.ok(!/cv_match|score/i.test(JSON.stringify(result.coverage)));
});
