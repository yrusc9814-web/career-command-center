// taxonomy.test.mjs — 采购 taxonomy 单元测试（node --test）
// Run: node --test tools/tests/taxonomy.test.mjs
//
// 冻结依据：PROCUREMENT_ARCHETYPE_AUDIT.md §21/§24（DESIGN FREEZE）。
// Phase 1.1（Taxonomy Closure）：主代理已裁决 fixture-003 primary_archetype =
// execution_procurement（职责占比 2 执行 vs 1 寻源+加分项）。本轮 taxonomy.mjs
// 升级为强/弱信号分层 + 最长匹配嵌套去重 + 弱信号子句语境归属，
// 全部为通用规则，无任何公司/岗位特判；本文件用 fixture-001/002/003 真实原文
// 关键句做回归护栏（T17-T19），并用分值明细（archetypeScoreBreakdown）让
// 裁决依据可复核。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as taxonomy from '../lib/taxonomy.mjs';
import {
  ARCHETYPES, ARCHETYPE_KEYS, SENIORITY_LEVELS, TITLE_DIRECT_MAP,
  DOMAINS, DOMAIN_KEYWORDS, CATEGORIES, CATEGORY_KEYWORDS,
  TAGS, TAG_KEYWORDS, CAPABILITY_BUCKETS, CAPABILITY_ALIASES,
  WEAK_SIGNALS, SOURCING_CONTEXT_MARKERS,
  classifyArchetype, normalizeSeniority, seniorityGap,
  detectDomain, detectCategories, detectTags, detectCapabilities,
  classifyTaxonomy, archetypeScoreBreakdown,
} from '../lib/taxonomy.mjs';

// ---------------------------------------------------------------------------
// Archetype 判定（用例 1-10）
// ---------------------------------------------------------------------------

test('T1 execution_procurement：多个执行信号 → 正确分类', () => {
  const jd = '负责采购订单下达、交付跟进、供应协调、对账与日常供应商维护，考核交货及时率';
  assert.equal(classifyArchetype(jd), 'execution_procurement');
  assert.equal(classifyTaxonomy(jd, null).archetype_unknown, false);
});

test('T2 sourcing：多个寻源信号 → 正确分类（"比价"降为弱信号后仍 sourcing）', () => {
  const jd = '负责新供应商开发、供应商筛选、比价、商务谈判与供应商导入，年开发源头工厂若干家';
  assert.equal(classifyArchetype(jd), 'sourcing');
  // 强信号 5 个（'新供应商开发' 最长匹配遮蔽 '新供应商'/'供应商开发' 子串，只计 1）；
  // '比价' 所在子句无 sourcing 语境标记 → +0.5 归 execution，不改变胜负方向
  const b = archetypeScoreBreakdown(jd);
  assert.equal(b.totals.sourcing, 5);
  assert.equal(b.totals.execution_procurement, 0.5);
  assert.deepEqual(b.strongHits.sourcing, ['新供应商开发', '供应商筛选', '商务谈判', '供应商导入', '源头工厂']);
});

test('T3 strategic_category：品类策略信号 → 正确分类（英文信号大小写不敏感）', () => {
  const jd = '制定品类策略与年度降本目标，搭建供应商组合，主导 Should-cost 成本拆解与长期成本规划';
  assert.equal(classifyArchetype(jd), 'strategic_category');
});

test('T4 证据不足 → unknown（无信号 / 仅弱信号，禁止硬套）', () => {
  assert.equal(classifyArchetype('负责部门日常行政事务与报销审核'), 'unknown');
  assert.equal(classifyArchetype('负责供应商比价'), 'unknown'); // 仅 1 个弱信号（比价）+0.5 < 2，且无强信号 → unknown
  assert.equal(classifyArchetype(''), 'unknown');
  assert.equal(classifyTaxonomy('负责部门日常行政事务', null).primary_archetype, 'unknown');
  assert.equal(classifyTaxonomy('负责部门日常行政事务', null).archetype_unknown, true);
});

test('T5 title 不进 Archetype 判定：rawTitle=采购主管 不改变职能归类；ARCHETYPES 中无“主管”', () => {
  const jd = '负责采购订单、交付跟进、对账';
  const r = classifyTaxonomy(jd, '采购主管');
  assert.equal(r.primary_archetype, 'execution_procurement');
  assert.equal(r.seniority.internal_level, 3); // 主管只进 Seniority 层
  // Archetype 词表是纯职能轴，不包含任何职级词
  assert.equal(ARCHETYPES.length, 3);
  assert.ok(!JSON.stringify(ARCHETYPES).includes('主管'));
  assert.ok(!JSON.stringify(ARCHETYPES).includes('专员'));
  assert.ok(!JSON.stringify(ARCHETYPES).includes('经理'));
});

test('T6 “高级采购专员”不是 Archetype：职能由 JD 职责定，title 归 Seniority L2', () => {
  const jd = '负责供应商开发与导入，年开发源头工厂若干家';
  const r = classifyTaxonomy(jd, '高级采购专员');
  assert.equal(r.primary_archetype, 'sourcing'); // 职能只看职责动词
  assert.equal(r.seniority.raw_title, '高级采购专员');
  assert.equal(r.seniority.normalized_seniority, '高级专员');
  assert.equal(r.seniority.internal_level, 2);
  assert.equal(r.seniority.unknown, false);
});

test('T7 “外贸采购”不成为唯一 Archetype：外贸词 → tags，职能按职责信号判', () => {
  // 纯“外贸采购”无任何职能信号 → unknown（不硬套成 sourcing）
  assert.equal(classifyArchetype('外贸采购'), 'unknown');
  const tags = detectTags('外贸采购');
  assert.ok(tags.includes('cross_border'));
  assert.ok(tags.includes('international'));
  // 外贸词存在但职责主体是执行 → execution，而非被“外贸”带偏
  assert.equal(classifyArchetype('外贸采购，负责日常下单、跟单与对账'), 'execution_procurement');
});

test('T8 “汽车零部件”进 Category/Domain 而非 Archetype', () => {
  const jd = '汽车零部件采购，负责雨刷等易损件';
  const r = classifyTaxonomy(jd, null);
  assert.equal(r.primary_archetype, 'unknown'); // 品类词不产生职能
  assert.equal(r.domain, 'automotive');
  assert.deepEqual(r.categories, ['汽车零部件']);
  assert.ok(CATEGORIES.includes('汽车零部件'));
  assert.ok(DOMAINS.some(d => d.key === 'automotive'));
  // 文本只含品类名本身也应命中 Category（名称自映射补全）
  assert.deepEqual(detectCategories('汽车零部件'), ['汽车零部件']);
  assert.ok(detectCategories('负责生鲜食品的采购').includes('生鲜食品'));
  assert.ok(detectCategories('电子元器件采购').includes('电子元器件'));
});

test('T9 项目采购 → tag project_based，primary_archetype 仍按职责信号判', () => {
  const jd = '按项目采购模式执行，参与 EPC 项目设备的下单、跟单与对账';
  const r = classifyTaxonomy(jd, null);
  assert.ok(r.tags.includes('project_based'));
  assert.equal(r.primary_archetype, 'execution_procurement'); // 职责主体是下单/跟单/对账
  // 纯项目词、无职能信号 → unknown，不硬套
  assert.equal(classifyArchetype('项目制，按项目结项复盘'), 'unknown');
});

test('T10 “供应商管理”→ supplier_quality 能力桶，不产生第 4 个 Archetype', () => {
  const caps = detectCapabilities('负责供应商管理与绩效考核，处理质量异常');
  assert.ok(caps.includes('supplier_quality'));
  assert.equal(caps.includes('supplier_management'), false); // 已并入桶，不输出细粒度 key
  // 能力词不改变 Archetype 判定
  assert.equal(classifyArchetype('负责供应商管理与绩效考核'), 'unknown');
  assert.equal(ARCHETYPES.length, 3);
  assert.deepEqual([...ARCHETYPE_KEYS].sort(), ['execution_procurement', 'sourcing', 'strategic_category']);
});

test('T9b direct/indirect tag 由关键词可达（direct+production_material、indirect+non_production 成对产出）', () => {
  const directTags = detectTags('负责生产物料与直接材料的采购');
  assert.ok(directTags.includes('direct'));
  assert.ok(directTags.includes('production_material'));
  assert.equal(directTags.includes('indirect'), false);
  assert.ok(detectTags('直接物料').includes('direct'));
  assert.ok(detectTags('生产性物料').includes('direct'));
  assert.ok(detectTags('直接采购').includes('direct'));
  const indirectTags = detectTags('负责间接采购与非生产物料');
  assert.ok(indirectTags.includes('indirect'));
  assert.ok(indirectTags.includes('non_production'));
  assert.equal(indirectTags.includes('direct'), false);
  assert.ok(detectTags('非生产性采购').includes('non_production'));
  // 否定前缀消歧：'非生产物料' 不应经子串 '生产物料' 误触发 direct
  assert.equal(detectTags('非生产物料采购').includes('direct'), false);
  assert.ok(detectTags('非生产物料采购').includes('indirect'));
  // 混合文本：正反两处真实并存时两个 tag 都产出
  const mixed = detectTags('负责生产物料，兼管非生产物料');
  assert.ok(mixed.includes('direct') && mixed.includes('indirect'));
  // MRO 属 Category 层而非 tag（冻结 §24.3 修正）：'MRO/备品备件' 只进 categories
  assert.ok(detectCategories('MRO 备品备件采购').includes('MRO'));
  const mroTags = detectTags('MRO 备品备件采购');
  assert.equal(mroTags.includes('mro'), false);
  assert.equal(mroTags.length, 0);
  // 三岗位 fixture 的 tags 不受新词影响（回归护栏）
  assert.ok(detectTags('生鲜内贸供应链').includes('domestic'));
});

// ---------------------------------------------------------------------------
// Seniority（用例 11-16）
// ---------------------------------------------------------------------------

test('T11 采购专员 → L1', () => {
  const r = normalizeSeniority('采购专员', {});
  assert.equal(r.level, 1);
  assert.equal(r.display, '专员');
  assert.equal(r.unknown, false);
  assert.equal(r.raw_title, '采购专员'); // 原文保留
});

test('T12 高级采购专员 / 资深采购专员 → L2（不被“采购专员”包含匹配抢先判成 L1）', () => {
  for (const title of ['高级采购专员', '资深采购专员']) {
    const r = normalizeSeniority(title, {});
    assert.equal(r.level, 2, title);
    assert.equal(r.display, '高级专员', title);
  }
});

test('T13 采购主管 → L3', () => {
  const r = normalizeSeniority('采购主管', {});
  assert.equal(r.level, 3);
  assert.equal(r.display, '主管');
});

test('T14 采购经理 / 高级采购经理 → L4（高级经理并入经理档）', () => {
  assert.equal(normalizeSeniority('采购经理', {}).level, 4);
  const r = normalizeSeniority('高级采购经理', {});
  assert.equal(r.level, 4);
  assert.equal(r.display, '经理');
  // 采购总监 → L5
  assert.equal(normalizeSeniority('采购总监', {}).level, 5);
  // 采购助理 / 助理采购 → L0
  assert.equal(normalizeSeniority('采购助理', {}).level, 0);
  assert.equal(normalizeSeniority('助理采购', {}).level, 0);
});

test('T15 “负责人”归一：无信号 unknown；团队+KPI+向GM汇报 L5；仅品类KPI无团队（单模块）L3', () => {
  // a) 无任何信号 → unknown，raw_title 保留，internal_level null
  const u = normalizeSeniority('负责人', {});
  assert.equal(u.unknown, true);
  assert.equal(u.level, null);
  assert.equal(u.display, null);
  assert.equal(u.raw_title, '负责人');
  // b) 团队 + 独立背品类 KPI + 汇报 GM → 总监·负责人档（S1+S2+S6 强组合）
  const l5 = normalizeSeniority('负责人', { teamManagement: true, annualTargetKpi: true, reportsToExec: true });
  assert.equal(l5.unknown, false);
  assert.equal(l5.level, 5);
  assert.equal(l5.display, '总监·负责人');
  // c) 仅独立背品类 KPI、无团队、仅单模块 owner → 主管档（S2+S7）
  const l3 = normalizeSeniority('负责人', { annualTargetKpi: true, moduleOwnerOnly: true });
  assert.equal(l3.unknown, false);
  assert.equal(l3.level, 3);
  assert.equal(l3.display, '主管');
  // d) 组合不足 → unknown：S1+S3 无 KPI、S1+S2 但缺 S3-S6
  assert.equal(normalizeSeniority('负责人', { teamManagement: true, supplierStrategyOwnership: true }).unknown, true);
  assert.equal(normalizeSeniority('负责人', { teamManagement: true, annualTargetKpi: true }).unknown, true);
  // e) seniorityGap：任一端 unknown → null
  assert.equal(seniorityGap('负责人', '采购专员'), null);
});

test('T16 六档冻结 + 全模块 export 不含互联网职级与技术词', () => {
  assert.equal(SENIORITY_LEVELS.length, 6);
  assert.deepEqual(SENIORITY_LEVELS.map(s => s.level), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(SENIORITY_LEVELS.map(s => s.display), ['助理', '专员', '高级专员', '主管', '经理', '总监·负责人']);
  assert.equal(ARCHETYPES.length, 3);
  assert.equal(CAPABILITY_BUCKETS.length, 10);
  assert.equal(DOMAINS.length, 6);
  // 本测试文件允许出现禁止词字符串本身（仅用于断言），模块 export 中必须为 0
  const snapshot = JSON.stringify({ ...taxonomy });
  for (const banned of ['P6', 'P7', 'Staff', 'Principal', '架构师', 'Data Engineer', 'LLM', 'RAG', 'Spark', 'Flink', '数仓', '技术栈现代度']) {
    assert.ok(!snapshot.includes(banned), `taxonomy export 泄漏禁止词: ${banned}`);
  }
  // 直接映射表不覆盖“负责人”类 title（负责人走信号规则，不走字符串直映射）
  assert.ok(!TITLE_DIRECT_MAP.some(m => m.title.includes('负责人')));
  assert.ok(DOMAIN_KEYWORDS.length === 6 && CATEGORY_KEYWORDS.length === CATEGORIES.length);
  assert.equal(TAGS.length, 8); // 冻结 §24.3：8 值 tag 枚举（无 mro，MRO 属 Category 层）
  assert.ok(!TAGS.includes('mro'));
  assert.ok(Object.values(CAPABILITY_ALIASES).every(b => CAPABILITY_BUCKETS.some(x => x.key === b)));
});

// ---------------------------------------------------------------------------
// 三岗位回归 fixture（用例 17 + 3）
// 摘录均取自本地回归报告 fixture-001/002/003 原文关键句（本地只读数据），未编造。
// ---------------------------------------------------------------------------

test('T17 fixture-001 汽配出口采购岗 → execution_procurement / trade / 汽车零部件 / cross_border / L1', () => {
  // 关键句摘自本地回归报告 fixture-001（TL;DR / A 块 / 提取的关键词）：
  // “源头工厂寻源+全流程议价+出口交付+验货监柜+出口单证”“雨刷等易损件”“进出口贸易”“外贸跟单”“交货及时率”“询价、比价”
  const jd001 = '出口采购专员岗：源头工厂寻源+全流程议价+出口交付+验货监柜+出口单证；雨刷等易损件；进出口贸易；外贸跟单；交货及时率；询价、比价';
  const r = classifyTaxonomy(jd001, '采购专员');
  assert.equal(r.primary_archetype, 'execution_procurement');
  // 分值明细（Phase 1.1 加权规则）：execution 强 5（验货/监柜/出口单证/跟单/交货及时率）
  // + 弱 1.0（询价/比价 所在子句无 sourcing 语境标记 → 归 execution）
  // > sourcing 强 2（源头工厂/寻源）+ 弱 0.5（议价 与"源头工厂寻源"同子句 → 归 sourcing）
  // = 6.0 vs 2.5（fixture-001 = execution 主 + sourcing 副，方向不变）
  const b = archetypeScoreBreakdown(jd001);
  assert.equal(b.totals.execution_procurement, 6);
  assert.equal(b.totals.sourcing, 2.5);
  assert.equal(r.domain, 'trade'); // 进出口贸易公司（贸易商 → trade，品类另记）
  assert.ok(r.categories.includes('汽车零部件'));
  assert.ok(r.tags.includes('cross_border'));
  assert.ok(r.tags.includes('international'));
  assert.ok(r.required_capabilities.includes('rfq_execution'));
  assert.ok(r.required_capabilities.includes('sourcing_development'));
  assert.equal(r.seniority.raw_title, '采购专员');
  assert.equal(r.seniority.normalized_seniority, '专员');
  assert.equal(r.seniority.internal_level, 1);
  assert.equal(r.seniority.unknown, false);
  // 主管 → 专员 = 2 档关系可被识别（未来 severe_level_downgrade blocker 判据）
  assert.equal(seniorityGap('采购主管', '采购专员'), 2);
});

test('T18 fixture-002 生鲜品类采购岗 → sourcing / food / 生鲜食品 / domestic，与任何“工程机械”归类无关', () => {
  // 关键句摘自本地回归报告 fixture-002（B 块 / C 块）：
  // “生鲜产品供应商资源（蔬菜/水果/肉类/冻品）”“独立开发上新品项”“供应商开发/评估机制/比价筛选/交期质量异常处理”“仓储配送方案/降损耗”“生鲜内贸供应链”
  const jd002 = '生鲜产品供应商资源（蔬菜/水果/肉类/冻品）；独立开发上新品项；供应商开发/比价筛选/交期质量异常处理；仓储配送方案/降损耗；生鲜内贸供应链';
  const r = classifyTaxonomy(jd002, '采购专员/采购主管');
  assert.equal(r.primary_archetype, 'sourcing');
  // 分值明细（Phase 1.1 加权规则）：sourcing 强 3（'供应商资源'/'开发上新'/'供应商开发'）
  // + 弱 0.5（'比价' 与"供应商开发/比价筛选"同子句，含语境标记'筛选' → 归 sourcing）
  // > execution 强 1（交期）= 3.5 vs 1（方向与冻结版一致）
  const b = archetypeScoreBreakdown(jd002);
  assert.equal(b.totals.sourcing, 3.5);
  assert.equal(b.totals.execution_procurement, 1);
  assert.equal(r.domain, 'food');
  assert.ok(r.categories.includes('生鲜食品'));
  assert.ok(r.tags.includes('domestic'));
  // “fixture-002 永不等于任何含工程机械的归类”由两条事实保证：
  // ① ARCHETYPES 仅 3 个 key（无任何工程机械/品类画像型 archetype）；② domain=food
  assert.deepEqual([...ARCHETYPE_KEYS].sort(), ['execution_procurement', 'sourcing', 'strategic_category']);
  assert.ok(!JSON.stringify(ARCHETYPES).includes('工程机械'));
  assert.equal(r.domain, 'food');
  assert.ok(r.seniority.raw_title === '采购专员/采购主管'); // raw_title 原样保留
});

test('T19 fixture-003 工程机械采购岗 → execution_procurement / industrial / 机械设备 / cross_border / L1（主代理裁决）', () => {
  // 主代理裁决（Phase 1.1，本测试实施裁决，不重新裁决）：
  //   primary_archetype = execution_procurement。
  //   依据 JD 原文职责占比：职责1"对接业务部门的产品报价需求，组织供应商报价并完成
  //   核价工作" + 职责2"负责产品配置与供应商的技术对接，跟进样品确认及配置变更的落实"
  //   = 日常执行主体（2 条）；职责3 仅前半"新供应商、新产品的开发导入"是 sourcing，
  //   后半"老供应商、老产品的维护与迭代"仍是执行；"供应商开发"仅出现在加分项。
  // 加权分明细：execution = 核价1 + 样品确认1 + 报价(弱信号→execution 语境)0.5 = 2.5
  //           > sourcing = 新供应商1 + 供应商开发1(加分项) = 2
  //   "新供应商、新产品的开发导入"因顿号断开，'新供应商开发'不连续命中，靠'新供应商'命中；
  //   嵌套去重后与'供应商开发'（加分项）不重复计。
  // fixture 为 JD 原文关键职责句（职责 1/2/3 + 加分项 2），字符串常量内嵌，
  // 不 fs 读 gitignored 的 inbox 文件。
  const jd003 = '对接业务部门的产品报价需求，组织供应商报价并完成核价工作；' +
    '负责产品配置与供应商的技术对接，跟进样品确认及配置变更的落实；' +
    '负责新供应商、新产品的开发导入，以及老供应商、老产品的维护与迭代，持续优化成本与质量；' +
    '有独立完成供应商开发、新品开发项目经验；工程机械；跨境电商';
  const r = classifyTaxonomy(jd003, '采购专员');
  assert.equal(r.primary_archetype, 'execution_procurement');
  assert.equal(r.archetype_unknown, false);
  assert.equal(r.domain, 'industrial');
  assert.ok(r.categories.includes('机械设备'));
  assert.ok(r.tags.includes('cross_border'));
  assert.ok(r.tags.includes('international'));
  assert.ok(r.required_capabilities.includes('rfq_execution'));
  assert.ok(r.required_capabilities.includes('sourcing_development'));
  assert.equal(r.seniority.raw_title, '采购专员');
  assert.equal(r.seniority.internal_level, 1);
  // 裁决依据可复核：分值明细必须恰好等于上述加权分
  const b = archetypeScoreBreakdown(jd003);
  assert.equal(b.totals.execution_procurement, 2.5);
  assert.equal(b.totals.sourcing, 2);
  assert.deepEqual(b.strongHits.execution_procurement, ['核价', '样品确认']);
  assert.deepEqual(b.strongHits.sourcing, ['新供应商', '供应商开发']);
  assert.deepEqual(b.weakHits, [{ signal: '报价', attribution: 'execution' }]);
});

// ---------------------------------------------------------------------------
// Phase 1.1 新增：弱信号分层 / 嵌套去重 / 弱信号语境归属（全部通用规则）
// ---------------------------------------------------------------------------

test('T20 弱信号永远不能单独定案：询价单独出现 → unknown（含 4 弱信号凑满 2.0 的情形）', () => {
  // ① 单个弱信号
  assert.equal(classifyArchetype('询价'), 'unknown');
  assert.equal(archetypeScoreBreakdown('询价').totals.execution_procurement, 0.5);
  // ② 4 个弱信号同现（全部 execution 语境，加权 2.0）——无任何强信号 → 仍 unknown：
  //    "弱信号永远不能单独定案"由通用护栏保证（无强信号命中一律 unknown）
  const allWeak = '询价、报价、比价、议价';
  assert.equal(classifyArchetype(allWeak), 'unknown');
  const b = archetypeScoreBreakdown(allWeak);
  assert.equal(b.totals.execution_procurement, 2); // 加权分够 2 但无强信号支撑 → 不定案
  assert.deepEqual(b.strongHits.execution_procurement, []);
  // ③ 有强信号托底后，同样的弱信号才会参与定案
  assert.equal(classifyArchetype('负责采购订单下达与下单，日常询价报价'), 'execution_procurement');
});

test('T21 弱信号语境归属：默认归 execution，子句含 sourcing 语境标记 → 归 sourcing', () => {
  // ② "既有供应商"≠寻源语境：孤立的询价/核价/下单 = buyer 日常工作 → execution
  const jdExec = '根据既有供应商进行询价、核价、下单';
  assert.equal(classifyArchetype(jdExec), 'execution_procurement');
  const bExec = archetypeScoreBreakdown(jdExec);
  assert.equal(bExec.totals.execution_procurement, 2.5); // 核价1 + 下单1 + 询价(弱)0.5
  assert.deepEqual(bExec.weakHits, [{ signal: '询价', attribution: 'execution' }]);
  // ③ 子句含 sourcing 语境标记（筛选/开发/新供应商/RFQ）→ 弱信号归 sourcing
  const jdSrc = '开发新供应商、发起 RFQ、筛选报价、导入供应商';
  assert.equal(classifyArchetype(jdSrc), 'sourcing');
  const bSrc = archetypeScoreBreakdown(jdSrc);
  assert.equal(bSrc.totals.sourcing, 2.5); // 新供应商1 + RFQ1 + 报价(弱，子句含'筛选')0.5
  assert.deepEqual(bSrc.weakHits, [{ signal: '报价', attribution: 'sourcing' }]);
  // 同一弱信号在两种语境都出现 → both（两侧各 +0.5）
  const bBoth = archetypeScoreBreakdown('筛选报价，日常报价跟进');
  assert.deepEqual(bBoth.weakHits, [{ signal: '报价', attribution: 'both' }]);
  assert.equal(bBoth.totals.sourcing, 0.5);
  assert.equal(bBoth.totals.execution_procurement, 0.5);
  // 语境标记词表冻结可查
  assert.ok(SOURCING_CONTEXT_MARKERS.includes('筛选') && SOURCING_CONTEXT_MARKERS.includes('开发'));
  assert.deepEqual(WEAK_SIGNALS, ['询价', '报价', '比价', '议价']);
});

test('T22 嵌套去重（最长匹配遮蔽）：子串信号不重复计数，顿号断开后靠短词命中', () => {
  // '新供应商开发导入'：'新供应商' 与 '新供应商开发' 按最长匹配只计一次
  const b1 = archetypeScoreBreakdown('新供应商开发导入');
  assert.deepEqual(b1.strongHits.sourcing, ['新供应商开发']);
  assert.equal(b1.totals.sourcing, 1); // 不叠加 '新供应商' / '供应商开发' / '供应商导入'
  // 长信号命中后其子串被遮蔽：'新供应商开发' 计 1，'供应商开发' 不重复计
  const b2 = archetypeScoreBreakdown('负责新供应商开发，另负责其他供应商开发');
  assert.deepEqual(b2.strongHits.sourcing, ['新供应商开发', '供应商开发']); // 第二处独立出现照常计
  assert.equal(b2.totals.sourcing, 2);
  // 顿号断开："新供应商、新产品的开发导入" → '新供应商开发' 不连续，靠 '新供应商' 命中；
  // 裸 '导入' 已收窄为 '供应商导入'，"开发导入"不误判
  const b3 = archetypeScoreBreakdown('新供应商、新产品的开发导入');
  assert.deepEqual(b3.strongHits.sourcing, ['新供应商']);
  assert.equal(b3.totals.sourcing, 1);
  assert.equal(classifyArchetype('新供应商、新产品的开发导入'), 'unknown'); // 仅 1 强信号 < 2
  // 对照：完整连续词 '供应商导入' 仍正常命中
  assert.ok(archetypeScoreBreakdown('负责供应商导入与筛选').strongHits.sourcing.includes('供应商导入'));
});

// ---------------------------------------------------------------------------
// Phase 1.1 新增：分发文件内容守卫（tracked 模板必须与采购领域一致，
// 防止 gitignored 用户实例（profile.yml / portals.yml / _profile.md / target_pool.md）
// 的 tracked 拷贝源回退成技术领域旧版）
// 测试文件位于 tools/tests/ → 仓库根为 ../../
// ---------------------------------------------------------------------------

import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
function readTracked(relPath) {
  return readFileSync(REPO_ROOT + relPath, 'utf8');
}

test('T23 内容守卫：config/profile.example.yml 为采购四层 target_roles，无技术领域残留', () => {
  const yml = readTracked('config/profile.example.yml');
  // 四层结构齐备（冻结 §24.4）
  for (const key of ['primary_archetype', 'categories', 'tags', 'seniority_range']) {
    assert.ok(yml.includes(key), `profile.example.yml 缺少四层字段: ${key}`);
  }
  // 技术领域 archetype 残留清零
  for (const banned of ['AI/ML Engineer', 'Data Engineer', 'LLM', 'P6', 'P7']) {
    assert.ok(!yml.includes(banned), `profile.example.yml 泄漏技术领域词: ${banned}`);
  }
});

test('T24 内容守卫：modes/_profile.template.md 无互联网职级与技术词', () => {
  const tpl = readTracked('modes/_profile.template.md');
  for (const banned of ['LLM', 'RAG', 'Spark', '数仓', 'P6', 'P7']) {
    assert.ok(!tpl.includes(banned), `_profile.template.md 泄漏技术领域词: ${banned}`);
  }
});

test('T25 内容守卫：templates/portals-china.example.yml seniority_boost 为采购五词，无技术职级词', () => {
  const yml = readTracked('templates/portals-china.example.yml');
  // 与用户实例 portals.yml 同款采购五词（Phase 1 冻结：只换词，数值机制不变）
  assert.ok(yml.includes('采购主管'), 'portals-china.example.yml 缺少采购职级词: 采购主管');
  for (const banned of ['Staff', 'Principal', '架构师']) {
    assert.ok(!yml.includes(banned), `portals-china.example.yml 泄漏技术职级词: ${banned}`);
  }
});

// ---------------------------------------------------------------------------
// Phase 2（Capability + Evidence Model）：第 22 条守卫测试
// config/profile.example.yml 的 target_roles.categories 必须全部 ∈ CATEGORIES
// （P2 闭环：示例配置与 taxonomy.mjs 品类枚举一致；真实 config/profile.yml 为
// 用户文件不在本守卫范围，其枚举外值由实施报告登记）
// ---------------------------------------------------------------------------

test('T26 守卫：config/profile.example.yml target_roles 的所有 categories 值 ∈ CATEGORIES', () => {
  const yml = readTracked('config/profile.example.yml');
  const matches = [...yml.matchAll(/categories:\s*\[([^\]]*)\]/g)];
  assert.ok(matches.length >= 3, 'profile.example.yml 应含至少 3 条 target_roles categories');
  const seen = [];
  for (const m of matches) {
    const values = m[1].split(',').map(s => s.trim()).filter(Boolean);
    assert.ok(values.length > 0, 'categories 不允许为空');
    for (const v of values) {
      assert.ok(CATEGORIES.includes(v), `profile.example.yml categories 非法值: ${v}（合法枚举: ${CATEGORIES.join(' / ')}）`);
      seen.push(v);
    }
  }
  assert.ok(seen.length > 0);
});
