// cv-match.test.mjs — CV Match 层单元测试（node --test，Phase 3）
// Run: node --test tools/tests/cv-match.test.mjs
//
// 冻结依据：PROCUREMENT_ARCHETYPE_AUDIT.md §22.2（含 Phase 3 落地裁决段）+ §24.3 Category Alias。
// 覆盖：0-100 输出（无 1-5 版）；因子表冻结（权重和 100）；贡献映射（matched 1.0 /
// partial 0.5 / no_evidence 0.0 / unknown 退出分母）；品类（exact/alias/无证据）、行业、
// 职级（same/±1/±2）、年限、学历、语言、管理、外贸；unknown 不按 0；分层不重复扣分
// （Career Score 与 CV Match 互不引用对方字段）。
//
// Fixtures：JD/CV 关键句摘录自本地回归报告 fixture-001/002/003 与 inbox JSON 原文（同源只读，不 fs 读
// gitignored 文件）；品类词用 工程机械/生鲜食品/汽车零部件 等通用词，不含真实公司名；
// 现雇主身份仅作注释/上下文，绝不进入任何因子。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CV_MATCH_FACTORS, CV_MATCH_TOTAL_WEIGHT, EDUCATION_RANKS,
  computeCvMatch, parseJdYearsFloor, parseJdEducation,
} from '../lib/cv-match.mjs';
import { normalizeCategories } from '../lib/taxonomy.mjs';
import { DIMENSIONS, evaluate } from '../lib/scoring.mjs';

// ---------------------------------------------------------------------------
// Fixtures（关键句同源摘录）
// ---------------------------------------------------------------------------

// fixture-001 汽配出口采购专员（本地回归报告 fixture-001 + inbox 原文职责句）
const JD_001 = [
  '【岗位职责】',
  '1.拓品与寻源：根据公司海外市场爆品趋势及大客户OEM需求，精准开发匹配的源头工厂；',
  '2.成本与风控：独立完成询价、比价、议价全流程，对大宗原材料价格波动保持敏感，制定最优采购策略以持续降本；同时严格把关供应商资质（交货及时率、质量体系、安全合规筛查），从源头杜绝供应链风险；',
  '3.供应链运营：全程跟进样品打样、大货交期、验货监柜及出口单证核对，确保每一票订单按时、按质、按量交付至海外港口；',
  '4.市场情报：定期输出新品和行业动态报告，为业务团队提供前端的产品数据支持。',
  '【我们希望你】',
  '1.学历背景：全日制大专及以上学历（供应链管理、国际贸易、汽车工程相关专业优先）；',
  '2.经验门槛：具备1年以上外贸采购或销售经验，熟悉外贸跟单及船务单证流程；',
  '3.核心加分项（非硬性，但优先）：对汽车车型、汽配品类（尤其易损件）有浓厚兴趣或基础认知；过往有成功开发源头工厂、实现显著降本的案例；',
].join('\n');

// fixture-002 生鲜采购专员/主管（本地回归报告 fixture-002 + inbox 原文职责句）
const JD_002 = [
  '岗位职责：',
  '1.熟悉采购工作，有源头或基地资源渠道（蔬菜、水果、肉类、冻品、食品百货），熟悉生鲜行业产品特性；',
  '2.有生鲜产品供应商资源，可以独立开发上新品项，完成公司采购任务；',
  '3.根据商品的特性，制定仓储配送解决方案，降低损耗；',
  '4.根据市场行情，管控进价和售价，并制定商品的促销计划以及品类的销售和利润指标；',
  '5.负责区域客户售后问题对接处理。',
  '任职要求',
  '1.大专及以上学历；',
  '2.熟悉采购工作流程，具有较强的价格谈判.订单管理.账务处理.供应商开发管理等能力；',
  '3.有供应链.大中型超市.食品类采购经验者优先考虑',
].join('\n');

// fixture-003 工程机械采购专员（inbox 原文职责句；已排除含主体名的公司介绍段）
const JD_003 = [
  '国内采购',
  '机械制造品',
  '成品/样品',
  '【工作时间】',
  '周一至周五，9:00-18:15，中午午休2小时，周末双休。',
  '【岗位职责】',
  '1、对接业务部门的产品报价需求，组织供应商报价并完成核价工作；',
  '2、负责产品配置与供应商的技术对接，跟进样品确认及配置变更的落实；',
  '3、负责新供应商、新产品的开发导入，以及老供应商、老产品的维护与迭代，持续优化成本与质量。',
  '【任职要求】',
  '1、一年及以上采购工作经验',
  '2、做事严谨细致、责任心强，具备优秀的跨部门沟通能力',
  '【加分项】',
  '1、了解工程机械行业，熟悉工程机械整机、配件、CKD产品逻辑，能看懂BOM清单，精通成本核算，对数据、价格、成本高度敏感。',
  '2、有独立完成供应商开发、新品开发项目经验。',
].join('\n');

// 候选人 CV 关键句（reports B/C 节同源：17 品类/降本 15%/年开发 100+ 家/报关单证/带 4 人小组）
const CV_MAIN = [
  '现任公司 采购主管（2022.06 至今），管理4人采购小组，负责17个品类采购管理，重点品类降本约15%。',
  '前任公司 采购专员（2021.01-2022.04）：年开发供应商100+家，建立多供应商询比价机制与商务谈判，账期30天延长至60天；',
  '负责报关单证、物流运输、验收及财务对接；建立供应商评估机制（价格/质量/交期）；跨部门协同跟进大货交期与验货。',
  '主战场为工程机械（发动机/叉车/装载机）整机与配件，熟悉 BOM 成本核算与数字化报价系统。',
].join('\n');

const CAND = { rawTitle: '采购主管', yearsExperience: 5, educationLevel: '本科' };
const factorOf = (r, key) => r.factors.find(f => f.key === key);

// ---------------------------------------------------------------------------
// 因子表冻结（任务书 18-19 前置）
// ---------------------------------------------------------------------------

test('C1 因子表冻结：权重和=100，组合计 Primary 55 / Secondary 30 / Low 15，无 Career-Score/blocker 专属 key', () => {
  assert.equal(CV_MATCH_TOTAL_WEIGHT, 100);
  assert.equal(CV_MATCH_FACTORS.reduce((s, f) => s + f.weight, 0), 100);
  const sum = g => CV_MATCH_FACTORS.filter(f => f.group === g).reduce((s, f) => s + f.weight, 0);
  assert.equal(sum('primary'), 55);
  assert.equal(sum('secondary'), 30);
  assert.equal(sum('low'), 15);
  // §22.2 冻结表逐行（权重）
  assert.deepEqual(CV_MATCH_FACTORS.map(f => [f.key, f.weight]), [
    ['category_experience', 15], ['sourcing_development', 12], ['negotiation_contract', 10],
    ['seniority_match', 10], ['cost_reduction', 8],
    ['domain_match', 8], ['international_procurement', 8], ['delivery_collaboration', 6],
    ['supplier_quality', 4], ['digital_tools', 4],
    ['leadership', 5], ['years_experience', 4], ['education', 3], ['language', 3],
  ]);
  // 大小周/薪资/通勤/稳定性/雇主身份绝不进 CV Match（它们属 Career Score/Blocker 层）
  const forbidden = ['compensation', 'workload_workstyle', 'location_fit', 'company_stability',
    'north_star', 'role_seniority', 'cv_match', 'career_growth', 'hiring_process_quality'];
  for (const k of forbidden) assert.ok(!CV_MATCH_FACTORS.some(f => f.key === k), `${k} 不得进入 CV Match`);
});

test('C2 normalizeCategories：别名归一（工程机械/通用机械/机械零部件→机械设备）、成员恒等、未知不强猜', () => {
  assert.deepEqual(
    normalizeCategories(['工程机械', '通用机械', '机械零部件', '生鲜食品', '办公用品']),
    [
      { raw: '工程机械', normalized: '机械设备' },
      { raw: '通用机械', normalized: '机械设备' },
      { raw: '机械零部件', normalized: '机械设备' },
      { raw: '生鲜食品', normalized: '生鲜食品' },
      { raw: '办公用品', normalized: null },
    ]
  );
  assert.deepEqual(normalizeCategories([]), []);
  assert.deepEqual(normalizeCategories(null), []);
  assert.deepEqual(normalizeCategories([42]), [{ raw: 42, normalized: null }]);
});

test('C3 输出形状：cv_match_score 0-100 取整；字段恰为 cv_match_score/confidence/factors；无 1-5 版 cv_match、无 recommendation/blocker', () => {
  const r = computeCvMatch({ jdText: JD_003, cvText: CV_MAIN, jdTitle: '采购专员', candidate: CAND });
  assert.deepEqual(Object.keys(r).sort(), ['confidence', 'cv_match_score', 'factors']);
  assert.deepEqual(Object.keys(r.confidence).sort(), ['level', 'percent']);
  assert.ok(Number.isInteger(r.cv_match_score) && r.cv_match_score >= 0 && r.cv_match_score <= 100);
  assert.ok(!('cv_match' in r)); // 旧 1-5 维度正式退役
  assert.equal(r.factors.length, CV_MATCH_FACTORS.length);
  for (const f of r.factors) {
    assert.deepEqual(Object.keys(f).sort(), ['contribution', 'evidence', 'group', 'key', 'status', 'weight']);
    assert.ok(['matched', 'partial', 'no_evidence', 'unknown', 'ok'].includes(f.status));
    if (f.status === 'unknown') assert.equal(f.contribution, null); // unknown 绝不按 0 分
    else assert.ok([1.0, 0.5, 0.0].includes(f.contribution));
    assert.ok(!('recommendation' in r) && !('blockers' in r) && !('score_breakdown' in r));
  }
});

// ---------------------------------------------------------------------------
// 职级匹配（seniorityGap 0/±1/≥2/unknown）
// ---------------------------------------------------------------------------

const JD_MIN = '负责采购订单下达与对账。'; // 无品类/行业/能力因子/年限/学历/语言 → 仅 seniority 可判

test('C4 seniority 差 0 档 → ok 1.0（唯一已知因子 → 100）', () => {
  const r = computeCvMatch({ jdText: JD_MIN, cvText: CV_MAIN, jdTitle: '采购专员', candidate: { rawTitle: '采购专员' } });
  assert.equal(factorOf(r, 'seniority_match').status, 'ok');
  assert.equal(factorOf(r, 'seniority_match').contribution, 1.0);
  assert.equal(r.cv_match_score, 100);
  assert.deepEqual(r.confidence, { percent: 10, level: '低' });
});

test('C5 seniority 差 1 档（高级专员→专员）→ partial 0.5 → 50', () => {
  const r = computeCvMatch({ jdText: JD_MIN, cvText: CV_MAIN, jdTitle: '高级采购专员', candidate: { rawTitle: '采购专员' } });
  assert.equal(factorOf(r, 'seniority_match').status, 'partial');
  assert.equal(factorOf(r, 'seniority_match').contribution, 0.5);
  assert.equal(r.cv_match_score, 50);
});

test('C6 seniority 差 2 档（专员 vs 主管）→ no_evidence 0.0 → 0', () => {
  const r = computeCvMatch({ jdText: JD_MIN, cvText: CV_MAIN, jdTitle: '采购专员', candidate: { rawTitle: '采购主管' } });
  assert.equal(factorOf(r, 'seniority_match').status, 'no_evidence');
  assert.equal(factorOf(r, 'seniority_match').contribution, 0.0);
  assert.equal(r.cv_match_score, 0);
});

test('C7 seniority 任一端无法归一（title 缺失 / “负责人”无信号）→ unknown 退出分母', () => {
  const missing = computeCvMatch({ jdText: JD_MIN, cvText: CV_MAIN, candidate: { rawTitle: '采购主管' } });
  assert.equal(factorOf(missing, 'seniority_match').status, 'unknown');
  assert.equal(factorOf(missing, 'seniority_match').contribution, null);
  assert.equal(missing.cv_match_score, null); // 无任何可判因子 → 有效维度不足
  assert.deepEqual(missing.confidence, { percent: 0, level: '低' });
  const vague = computeCvMatch({ jdText: JD_MIN, cvText: CV_MAIN, jdTitle: '采购专员', candidate: { rawTitle: '采购负责人' } });
  assert.equal(factorOf(vague, 'seniority_match').status, 'unknown');
  assert.equal(vague.cv_match_score, null);
});

// ---------------------------------------------------------------------------
// 品类经验（exact / alias / 无证据 / JD 不可判定）
// ---------------------------------------------------------------------------

test('C8 品类 exact：JD 汽车零部件 × CV 汽车零部件 → matched 1.0', () => {
  const r = computeCvMatch({
    jdText: '负责汽车零部件与原材料采购订单跟进。',
    cvText: '三年汽车零部件采购经验，负责采购订单与对账。',
    jdTitle: '采购专员', candidate: { rawTitle: '采购专员' },
  });
  assert.equal(factorOf(r, 'category_experience').status, 'matched');
  assert.equal(factorOf(r, 'category_experience').contribution, 1.0);
  assert.ok(factorOf(r, 'category_experience').evidence.includes('交集命中'));
});

test('C9 品类 alias：JD 工程机械（→机械设备）× 候选人 profile raw 工程机械（normalizeCategories 归一）→ 交集命中', () => {
  const r = computeCvMatch({
    jdText: '负责工程机械整机及配件的采购订单与对账。',
    cvText: '负责采购订单下达、供应商对账与交期跟进。',
    jdTitle: '采购专员',
    candidate: { rawTitle: '采购专员', categories: ['工程机械', '机械零部件', '办公用品'] },
  });
  assert.equal(factorOf(r, 'category_experience').status, 'matched');
  assert.equal(factorOf(r, 'category_experience').contribution, 1.0);
  assert.ok(factorOf(r, 'category_experience').evidence.includes('机械设备'));
});

test('C10 品类：候选侧无任何品类信息 → no_evidence 0.0（仍在分母）；JD 侧不可判定 → unknown 退出分母', () => {
  const noEvidence = computeCvMatch({
    jdText: '负责汽车零部件采购订单跟进。',
    cvText: '负责采购订单下达与对账，熟悉采购流程。',
  });
  assert.equal(factorOf(noEvidence, 'category_experience').status, 'no_evidence');
  assert.equal(factorOf(noEvidence, 'category_experience').contribution, 0.0);
  // 分母含品类 15 与行业 8（JD 有行业词、CV 无 → domain 亦 no_evidence）；seniority 无 title → unknown
  assert.equal(noEvidence.confidence.percent, 15 + 8);
  const jdUnknown = computeCvMatch({ jdText: JD_MIN, cvText: CV_MAIN, jdTitle: '采购专员', candidate: { rawTitle: '采购专员' } });
  assert.equal(factorOf(jdUnknown, 'category_experience').status, 'unknown');
  assert.equal(factorOf(jdUnknown, 'category_experience').contribution, null);
});

// ---------------------------------------------------------------------------
// 行业（detectDomain 交集）
// ---------------------------------------------------------------------------

test('C11 行业：一致 → 1.0；双知不相交 → 0；候选侧空 → no_evidence；JD 侧不可判定 → unknown', () => {
  const hit = computeCvMatch({
    jdText: '汽车零部件采购订单跟进。',
    cvText: '汽车零部件采购经验丰富，负责采购订单。',
    jdTitle: '采购专员', candidate: { rawTitle: '采购专员' },
  });
  assert.equal(factorOf(hit, 'domain_match').status, 'matched');
  assert.equal(factorOf(hit, 'domain_match').contribution, 1.0);

  const miss = computeCvMatch({
    jdText: '汽车零部件采购订单跟进。',
    cvText: '工程机械整机与配件采购，负责采购订单。',
    jdTitle: '采购专员', candidate: { rawTitle: '采购专员' },
  });
  assert.equal(factorOf(miss, 'domain_match').status, 'no_evidence');
  assert.equal(factorOf(miss, 'domain_match').contribution, 0.0);

  const cvSilent = computeCvMatch({
    jdText: '汽车零部件采购订单跟进。',
    cvText: '负责采购订单下达与对账。',
    jdTitle: '采购专员', candidate: { rawTitle: '采购专员' },
  });
  assert.equal(factorOf(cvSilent, 'domain_match').status, 'no_evidence');
  assert.ok(factorOf(cvSilent, 'domain_match').evidence.includes('CV 无行业信息'));

  const jdSilent = computeCvMatch({ jdText: JD_MIN, cvText: CV_MAIN, jdTitle: '采购专员', candidate: { rawTitle: '采购专员' } });
  assert.equal(factorOf(jdSilent, 'domain_match').status, 'unknown');
  assert.equal(factorOf(jdSilent, 'domain_match').contribution, null);
});

// ---------------------------------------------------------------------------
// 能力因子（required matched/partial/no_evidence + preferred + 权重效应 + unknown）
// ---------------------------------------------------------------------------

const JD_SRC = '负责新供应商开发与寻源，完成年度降本目标。';

test('C12 required 能力：strong CV → matched 1.0；weak CV（协助类）→ partial 0.5；CV 空白 → no_evidence 0.0', () => {
  // 不传 title：seniority unknown 退出分母，分数只反映目标能力因子
  const strong = computeCvMatch({
    jdText: JD_SRC,
    cvText: '年开发供应商100+家，主导年度降本15%。',
  });
  assert.equal(factorOf(strong, 'sourcing_development').status, 'matched');
  assert.equal(factorOf(strong, 'sourcing_development').contribution, 1.0);
  assert.equal(factorOf(strong, 'cost_reduction').status, 'matched');
  assert.equal(factorOf(strong, 'cost_reduction').contribution, 1.0);
  assert.equal(strong.cv_match_score, 100); // (12+8)/(12+8)

  const weak = computeCvMatch({
    jdText: JD_SRC,
    cvText: '协助供应商开发，参与寻源。',
  });
  assert.equal(factorOf(weak, 'sourcing_development').status, 'partial');
  assert.equal(factorOf(weak, 'sourcing_development').contribution, 0.5);
  assert.equal(factorOf(weak, 'cost_reduction').status, 'no_evidence');
  assert.equal(factorOf(weak, 'cost_reduction').contribution, 0.0);
  assert.equal(weak.cv_match_score, 30); // (0.5×12)/(12+8) = 6/20

  const none = computeCvMatch({
    jdText: JD_SRC,
    cvText: '负责采购订单下达与对账。',
  });
  assert.equal(factorOf(none, 'sourcing_development').status, 'no_evidence');
  assert.equal(none.cv_match_score, 0);
});

test('C13 preferred（加分项）能力：有证据 → 仍按映射 matched（coverage 复用，不发明第二套规则）', () => {
  const r = computeCvMatch({
    jdText: '负责采购订单下达与对账。\n【加分项】\n有供应商开发经验者优先。',
    cvText: '年开发供应商100+家，建立多供应商询比价机制。',
    jdTitle: '采购专员', candidate: { rawTitle: '采购专员' },
  });
  assert.equal(factorOf(r, 'sourcing_development').status, 'matched');
  assert.equal(factorOf(r, 'sourcing_development').contribution, 1.0);
  assert.ok(factorOf(r, 'sourcing_development').evidence.includes('优先'));
});

test('C14 同 coverage 形态下缺省贡献由因子权重决定：12 权重缺失 → 75，4 权重缺失 → 25', () => {
  const jd = '负责新供应商开发与寻源，并负责供应商考核与质量异常处理。';
  const onlySourcing = computeCvMatch({
    jdText: jd,
    cvText: '年开发供应商100+家，建立多供应商询比价机制。',
  });
  assert.equal(factorOf(onlySourcing, 'sourcing_development').status, 'matched');
  assert.equal(factorOf(onlySourcing, 'supplier_quality').status, 'no_evidence');
  assert.equal(onlySourcing.cv_match_score, 75); // 12/(12+4)

  const onlyQuality = computeCvMatch({
    jdText: jd,
    cvText: '推动供应商考核与质量异常闭环处理。',
  });
  assert.equal(factorOf(onlyQuality, 'sourcing_development').status, 'no_evidence');
  assert.equal(factorOf(onlyQuality, 'supplier_quality').status, 'matched');
  assert.equal(onlyQuality.cv_match_score, 25); // 4/(12+4)
});

test('C15 unknown 不按 0：JD 静默因子退出分母使分数高于“JD 要求但 CV 缺失”', () => {
  const base = computeCvMatch({
    jdText: '负责新供应商开发与寻源。',
    cvText: '年开发供应商100+家，建立多供应商询比价机制。',
  });
  assert.equal(factorOf(base, 'digital_tools').status, 'unknown');
  assert.equal(base.cv_match_score, 100); // digital 退出分母

  const withMissing = computeCvMatch({
    jdText: '负责新供应商开发与寻源。\n需熟悉ERP系统。',
    cvText: '年开发供应商100+家，建立多供应商询比价机制。',
  });
  assert.equal(factorOf(withMissing, 'digital_tools').status, 'no_evidence');
  assert.equal(factorOf(withMissing, 'digital_tools').contribution, 0.0);
  assert.equal(withMissing.cv_match_score, 75); // 12/(12+4)，digital 以 0 入分母
  assert.ok(base.cv_match_score > withMissing.cv_match_score);
});

// ---------------------------------------------------------------------------
// 年限 / 学历 / 语言（裁决②③：输入或文本规则判定）
// ---------------------------------------------------------------------------

test('C16 年限：≥下限 → 1.0；差 1 年内 → 0.5；其余 → 0；未提供 → unknown；经验不限 → unknown 退出分母', () => {
  const jd = '负责采购订单下达与对账，具备3年以上采购经验。';
  assert.deepEqual(parseJdYearsFloor(jd), { floor: 3 });
  assert.deepEqual(parseJdYearsFloor('一年及以上采购工作经验'), { floor: 1 });
  assert.deepEqual(parseJdYearsFloor('1-3年'), { floor: 1 });
  assert.deepEqual(parseJdYearsFloor('经验不限'), { unlimited: true });
  assert.equal(parseJdYearsFloor('负责采购订单下达与对账。'), null);
  assert.equal(parseJdYearsFloor('2019-2024年第一个五年规划'), null); // 年份区间误配护栏（>30 不可信）

  // 不传 title：seniority unknown 退出分母，分数只反映年限因子（w4）
  const ok = computeCvMatch({ jdText: jd, cvText: CV_MAIN, candidate: { yearsExperience: 3 } });
  assert.equal(factorOf(ok, 'years_experience').status, 'ok');
  assert.equal(ok.cv_match_score, 100);
  const near = computeCvMatch({ jdText: jd, cvText: CV_MAIN, candidate: { yearsExperience: 2.5 } });
  assert.equal(factorOf(near, 'years_experience').status, 'partial');
  assert.equal(factorOf(near, 'years_experience').contribution, 0.5);
  assert.equal(near.cv_match_score, 50);
  const far = computeCvMatch({ jdText: jd, cvText: CV_MAIN, candidate: { yearsExperience: 1 } });
  assert.equal(factorOf(far, 'years_experience').status, 'no_evidence');
  assert.equal(far.cv_match_score, 0);
  const unknown = computeCvMatch({ jdText: jd, cvText: CV_MAIN, candidate: { rawTitle: '采购专员' } });
  assert.equal(factorOf(unknown, 'years_experience').status, 'unknown');
  assert.equal(unknown.cv_match_score, null);
  const unlimited = computeCvMatch({ jdText: '负责采购订单下达与对账，经验不限。', cvText: CV_MAIN, candidate: { yearsExperience: 0 } });
  assert.equal(factorOf(unlimited, 'years_experience').status, 'unknown');
  assert.equal(unlimited.cv_match_score, null);
});

test('C17 学历：候选本科 ≥ JD 大专 → 1.0；JD 本科 vs 候选大专 → 0；未提供 → unknown；学历不限 → unknown', () => {
  const jdDazhuan = '负责采购订单下达与对账，要求大专及以上学历。';
  assert.deepEqual(parseJdEducation(jdDazhuan), { rank: 3, label: '大专' });
  const ok = computeCvMatch({ jdText: jdDazhuan, cvText: CV_MAIN, candidate: { educationLevel: '本科' } });
  assert.equal(factorOf(ok, 'education').status, 'ok');
  assert.equal(factorOf(ok, 'education').contribution, 1.0);
  assert.equal(ok.cv_match_score, 100);
  const fail = computeCvMatch({ jdText: '负责采购订单下达与对账，要求本科及以上学历。', cvText: CV_MAIN, candidate: { educationLevel: '大专' } });
  assert.equal(factorOf(fail, 'education').status, 'no_evidence');
  assert.equal(factorOf(fail, 'education').contribution, 0.0);
  assert.equal(fail.cv_match_score, 0);
  const unknown = computeCvMatch({ jdText: jdDazhuan, cvText: CV_MAIN, candidate: {} });
  assert.equal(factorOf(unknown, 'education').status, 'unknown');
  assert.equal(unknown.cv_match_score, null);
  const none = computeCvMatch({ jdText: '负责采购订单下达与对账，学历不限。', cvText: CV_MAIN, candidate: { educationLevel: '初中' } });
  assert.equal(factorOf(none, 'education').status, 'unknown');
  assert.equal(none.cv_match_score, null);
  assert.equal(EDUCATION_RANKS['大专'], 3);
  assert.equal(EDUCATION_RANKS['本科'], 4);
});

test('C18 语言：JD 无要求 → unknown 退出分母；有要求 + CV 有信号 → 1.0；有要求无信号 → 0', () => {
  const jdReq = '负责采购订单下达与对账，要求英语流利。';
  const ok = computeCvMatch({ jdText: jdReq, cvText: '英语CET-6，负责采购订单下达与对账。' });
  assert.equal(factorOf(ok, 'language').status, 'ok');
  assert.equal(factorOf(ok, 'language').contribution, 1.0);
  assert.equal(ok.cv_match_score, 100);
  const zero = computeCvMatch({ jdText: jdReq, cvText: '负责采购订单下达与对账，熟悉采购流程。' });
  assert.equal(factorOf(zero, 'language').status, 'no_evidence');
  assert.equal(zero.cv_match_score, 0);
  const noReq = computeCvMatch({ jdText: JD_MIN, cvText: CV_MAIN, candidate: { yearsExperience: 3 } });
  assert.equal(factorOf(noReq, 'language').status, 'unknown');
  assert.equal(noReq.cv_match_score, null);
});

// ---------------------------------------------------------------------------
// 管理经验 / 外贸
// ---------------------------------------------------------------------------

test('C19 管理经验（leadership）：JD 有要求 + CV 带团队 → matched；JD 有要求 CV 无 → no_evidence；JD 未提 → unknown', () => {
  const jd = '负责采购团队管理与新人带教，制定采购SOP。';
  const matched = computeCvMatch({ jdText: jd, cvText: '管理4人采购小组，推动新人带教。' });
  assert.equal(factorOf(matched, 'leadership').status, 'matched');
  assert.equal(factorOf(matched, 'leadership').contribution, 1.0);
  assert.equal(matched.cv_match_score, 100);
  const none = computeCvMatch({ jdText: jd, cvText: '负责采购订单下达与对账。' });
  assert.equal(factorOf(none, 'leadership').status, 'no_evidence');
  assert.equal(none.cv_match_score, 0);
  const jdSilent = computeCvMatch({ jdText: JD_MIN, cvText: '管理4人采购小组。' });
  assert.equal(factorOf(jdSilent, 'leadership').status, 'unknown');
  assert.equal(jdSilent.cv_match_score, null);
});

test('C20 外贸（international_procurement）：JD 报关/进出口 + CV 报关/外贸 → matched；CV 无 → no_evidence', () => {
  const jd = '负责进出口采购，熟悉报关流程与国际贸易术语。';
  const matched = computeCvMatch({ jdText: jd, cvText: '熟悉报关单证与外贸跟单，负责采购订单。' });
  assert.equal(factorOf(matched, 'international_procurement').status, 'matched');
  assert.equal(factorOf(matched, 'international_procurement').contribution, 1.0);
  assert.equal(matched.cv_match_score, 100);
  const none = computeCvMatch({ jdText: jd, cvText: '负责采购订单下达与对账。' });
  assert.equal(factorOf(none, 'international_procurement').status, 'no_evidence');
  assert.equal(none.cv_match_score, 0);
});

// ---------------------------------------------------------------------------
// 三岗位场景（fixture-001 / 002 / 003，同源关键句回放）
// ---------------------------------------------------------------------------

test('C21 fixture-001 汽配出口采购专员：品类/行业不相交 + 职级差 2 档 = 0，但能力覆盖高 → 58（不归零）；大小周/薪资绝不进 CV Match', () => {
  const r = computeCvMatch({ jdText: JD_001, cvText: CV_MAIN, jdTitle: '采购专员', candidate: CAND });
  assert.equal(r.cv_match_score, 58);
  assert.deepEqual(r.confidence, { percent: 78, level: '中' });
  assert.equal(factorOf(r, 'category_experience').status, 'no_evidence');
  assert.equal(factorOf(r, 'category_experience').contribution, 0.0);
  assert.equal(factorOf(r, 'domain_match').status, 'no_evidence');
  assert.equal(factorOf(r, 'domain_match').contribution, 0.0);
  assert.equal(factorOf(r, 'seniority_match').status, 'no_evidence'); // 主管 vs 专员 = 2 档（Match 层）
  assert.equal(factorOf(r, 'sourcing_development').status, 'matched'); // transferable：能力覆盖高
  assert.equal(factorOf(r, 'cost_reduction').status, 'matched');
  assert.ok(r.cv_match_score > 0); // 不同品类不归零

  // 反例断言：大小周/薪资只进 Career Score 维度评分输入，追加进 JD 文本不得改变 CV Match
  const withWorkloadSalary = computeCvMatch({
    jdText: JD_001 + '\n【小提示】：工作时间为：8:30-12:00；14:00-18:00，大小周。薪资5-8K。',
    cvText: CV_MAIN, jdTitle: '采购专员', candidate: CAND,
  });
  assert.deepEqual(withWorkloadSalary, r);
  // 输出不含 compensation/workload 因子
  assert.ok(!r.factors.some(f => ['compensation', 'workload_workstyle'].includes(f.key)));
});

test('C22 fixture-002 生鲜采购：品类因子 0（生鲜 vs 机械设备）但 sourcing 因子满贡献，两者共存 → 48（中等不过高）', () => {
  const r = computeCvMatch({ jdText: JD_002, cvText: CV_MAIN, jdTitle: '采购专员/采购主管', candidate: CAND });
  assert.equal(r.cv_match_score, 48);
  assert.ok(r.cv_match_score >= 40 && r.cv_match_score < 60);
  assert.equal(factorOf(r, 'category_experience').status, 'no_evidence');
  assert.equal(factorOf(r, 'category_experience').contribution, 0.0); // 缺的是品类资源
  assert.equal(factorOf(r, 'sourcing_development').status, 'matched'); // 不是采购能力
  assert.equal(factorOf(r, 'sourcing_development').contribution, 1.0);
  assert.equal(factorOf(r, 'domain_match').contribution, 0.0);
  assert.equal(factorOf(r, 'negotiation_contract').status, 'matched');
});

test('C23 fixture-003 工程机械采购专员：同品类同行业同能力 → 84 高分；现雇主身份只是注释，不进任何因子', () => {
  const base = { jdText: JD_003, cvText: CV_MAIN, jdTitle: '采购专员', candidate: CAND };
  const r = computeCvMatch(base);
  assert.equal(r.cv_match_score, 84);
  assert.equal(factorOf(r, 'category_experience').status, 'matched');
  assert.equal(factorOf(r, 'domain_match').status, 'matched');
  assert.equal(factorOf(r, 'sourcing_development').status, 'matched');
  assert.equal(factorOf(r, 'seniority_match').status, 'no_evidence'); // 职级匹配因子照常打分（§22.2 边界）
  // 现雇主身份在输入中只作为注释/上下文传入 → 引擎忽略，输出逐字节不变
  const withNote = computeCvMatch({ ...base, employerNote: '候选人现任雇主即发帖主体（上下文注释，不进任何因子）' });
  assert.deepEqual(withNote, r);
});

// ---------------------------------------------------------------------------
// 分层：Career Score 与 CV Match 互不重复扣、互不引用（§22.2/§22.3/§25）
// ---------------------------------------------------------------------------

test('C24 两模块输出互不引用对方字段；维度/因子互斥', () => {
  const evalOut = evaluate(DIMENSIONS.map(d => ({ key: d.key, score: 4 })), {});
  const cvOut = computeCvMatch({ jdText: JD_003, cvText: CV_MAIN, jdTitle: '采购专员', candidate: CAND });
  assert.ok(!('cv_match_score' in evalOut) && !('factors' in evalOut) && !('confidence' in evalOut));
  assert.ok(!('career_ops_score' in cvOut) && !('recommendation' in cvOut) && !('score_breakdown' in cvOut));
  // Career Score 维度不含 CV Match 因子 key
  for (const f of CV_MATCH_FACTORS) {
    assert.ok(!DIMENSIONS.some(d => d.key === f.key), `CV Match 因子 ${f.key} 不得成为 Career Score 维度`);
  }
  // CV Match 因子不含 Career Score 维度 key（role_seniority 是岗位价值维；seniority_match 是 Match 层）
  for (const d of DIMENSIONS) {
    assert.ok(!CV_MATCH_FACTORS.some(f => f.key === d.key), `Career Score 维度 ${d.key} 不得进入 CV Match`);
  }
});

test('C25 三岗位分层 sanity：Career Score 显式给分（每维人工按 RUBRIC 评）与 CV Match 独立共存，blocker 只压 Recommendation', () => {
  // fixture-001：comp/工作制/职级三高权重维全低 + digital/hiring 无证据 → 2.24（92% 高）；
  //      CV Match 58；severe_level_downgrade blocker 压 Recommendation，分数不动
  const dims001 = [
    { key: 'compensation', score: 1.5, reason: '5-8K 低于带宽下沿且大小周折算缩水' },
    { key: 'workload_workstyle', score: 1, reason: 'JD 明示大小周' },
    { key: 'role_seniority', score: 1, reason: '纯执行专员岗，低于现职级' },
    { key: 'career_growth', score: 3, reason: '有上升叙事无机制证据' },
    { key: 'category_domain_value', score: 3, reason: '汽配出口属相邻品类' },
    { key: 'procurement_ownership', score: 3, reason: '独立询比价议价，有谈判参与权' },
    { key: 'location_fit', score: 5, reason: '目标城市目标区' },
    { key: 'company_stability', score: 3, reason: '存续小企业，单一信源无负面' },
    { key: 'digital_tooling', score: null, reason: 'JD 无采购系统描述（营销叙事不作证据）' },
    { key: 'hiring_process_quality', score: null, reason: '无证据' },
  ];
  const career001 = evaluate(dims001, { severe_level_downgrade: true });
  assert.equal(career001.career_ops_score, 2.24); // 206/92
  assert.deepEqual(career001.score_confidence, { percent: 92, level: '高' });
  assert.equal(career001.recommendation, '不推荐');
  const cv001 = computeCvMatch({ jdText: JD_001, cvText: CV_MAIN, jdTitle: '采购专员', candidate: CAND });
  assert.equal(cv001.cv_match_score, 58);

  // fixture-002：workload 无证据不入分母（禁行业刻板印象）→ 2.8（77% 中）；CV Match 48
  const dims002 = [
    { key: 'compensation', score: 2.5, reason: '区间上段但低于主管市场中位' },
    { key: 'workload_workstyle', score: null, reason: 'JD 未写作息，不臆测' },
    { key: 'role_seniority', score: 3.5, reason: '专员/主管双通道可平级' },
    { key: 'career_growth', score: 3, reason: '有上升叙事无机制证据' },
    { key: 'category_domain_value', score: 1, reason: '生鲜对机械履历无迁移价值' },
    { key: 'procurement_ownership', score: 3, reason: '独立开发上新品项' },
    { key: 'location_fit', score: 4, reason: '同城邻近区' },
    { key: 'company_stability', score: 3, reason: '存续中型民企' },
    { key: 'digital_tooling', score: null, reason: '无描述' },
    { key: 'hiring_process_quality', score: null, reason: '无证据' },
  ];
  const career002 = evaluate(dims002, {});
  assert.equal(career002.career_ops_score, 2.8); // 215.5/77
  assert.deepEqual(career002.score_confidence, { percent: 77, level: '中' });
  const cv002 = computeCvMatch({ jdText: JD_002, cvText: CV_MAIN, jdTitle: '采购专员/采购主管', candidate: CAND });
  assert.equal(cv002.cv_match_score, 48);

  // fixture-003：品类/工作制/成长全优 + digital 无描述 → 3.8（92% 高）；CV Match 84；
  //      current_employer_conflict 只压 Recommendation，career_ops_score 与 cv_match_score 均不变
  const dims003 = [
    { key: 'compensation', score: 3.5, reason: '8-12K·13薪+期权，总包结构正常偏上' },
    { key: 'workload_workstyle', score: 5, reason: '明确双休+标准工时原文' },
    { key: 'role_seniority', score: 1.5, reason: '专员级，低于现职级' },
    { key: 'career_growth', score: 4, reason: '季度调薪晋升窗口且业务扩张' },
    { key: 'category_domain_value', score: 5, reason: '主路径品类（工程机械）' },
    { key: 'procurement_ownership', score: 3, reason: '组织报价核价，有谈判参与权' },
    { key: 'location_fit', score: 5, reason: '同区通勤不恶化' },
    { key: 'company_stability', score: 4, reason: '细分头部+多年经营+自有产能' },
    { key: 'digital_tooling', score: null, reason: '无工具描述（营销叙事不作证据）' },
    { key: 'hiring_process_quality', score: null, reason: '无证据' },
  ];
  const career003 = evaluate(dims003, { current_employer_conflict: true });
  const career003NoBlocker = evaluate(dims003, {});
  assert.equal(career003.career_ops_score, 3.8); // 349.5/92
  assert.equal(career003NoBlocker.career_ops_score, 3.8); // blocker 不影响 Career Score
  assert.equal(career003.recommendation, '不推荐');
  assert.equal(career003NoBlocker.recommendation, '一般'); // scoreBand(3.8)
  assert.deepEqual(career003.score_confidence, { percent: 92, level: '高' });
  const cv003 = computeCvMatch({ jdText: JD_003, cvText: CV_MAIN, jdTitle: '采购专员', candidate: CAND });
  assert.equal(cv003.cv_match_score, 84);
});
