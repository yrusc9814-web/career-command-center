// eligibility.test.mjs — Eligibility / Blocker 组装层单元测试（node --test，Phase 4）
// Run: node --test tools/tests/eligibility.test.mjs
//
// 冻结依据：PROCUREMENT_ARCHETYPE_AUDIT.md §22.1（hard_requirements 结构 / 判定四问 /
// 四级模型 / candidate-side 7 项 + job-side 4 项 blocker）+ §22.4 Phase 4 落地裁决。
//
// 单一 SoT 断言：decide() 的 recommendation 与直接调 scoring.computeRecommendation
// 同参结果 deepEqual —— eligibility.mjs 零决策，Step 0-5/矩阵/封顶只存在于 scoring.mjs。
//
// Fixtures：JD/CV 关键句摘录自本地回归报告 fixture-001/002/003 与 inbox JSON 原文（同源只读，不 fs 读
// gitignored 文件），匿名命名：fixture-001 汽配出口采购岗 / fixture-002 生鲜品类采购岗 /
// fixture-003 工程机械采购岗；公司主体一律用"示例集团（XYZ）"类匿名名。
// 三岗位分数（cv 58/48/84、career 2.24/2.7/3.8）为 Phase 3 引擎产出值，逐字引用不变。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HARD_REQUIREMENT_TYPES, GAP_LEVELS, MANDATORY_LEVELS,
  extractHardRequirements, evaluateRequirement, evaluateCandidateBlockers,
  evaluateEligibility, parseJdFacts, normalizeCompanyName, decide,
} from '../lib/eligibility.mjs';
import { computeRecommendation } from '../lib/scoring.mjs';
import { analyzeCapabilityCoverage } from '../lib/evidence.mjs';

// ---------------------------------------------------------------------------
// Fixtures（关键句同源摘录，匿名命名；与 cv-match.test.mjs 同源）
// ---------------------------------------------------------------------------

// fixture-001 汽配出口采购岗（本地回归报告 fixture-001 + inbox 原文职责句；大小周/薪资属 Career 维度层，不入 fixture）
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

// fixture-002 生鲜品类采购岗（本地回归报告 fixture-002 + inbox 原文职责句；JD 首条硬要求"有生鲜产品供应商资源"）
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

// fixture-003 工程机械采购岗（003 inbox 原文职责句；已排除含主体名的公司介绍段。
// 职级说明：fixture-003 的"主管→专员"属本公司内向下兼岗，Phase 3 引擎仅记 current_employer_conflict
// ——本 fixture 不传 jdTitle（职级不可比 → severe_level_downgrade 恒不触发），与 Phase 3 一致）
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

// 候选人画像（profile 同源：现任采购主管、5 年、本科、品类 工程机械/机械零部件；
// 薪资底线未配置、无地点/工作制/出差声明 —— 缺失一律 unknown/not_evaluated）
const CAND = { rawTitle: '采购主管', yearsExperience: 5, educationLevel: '本科', categories: ['工程机械', '机械零部件'] };

// ---------------------------------------------------------------------------
// 1. extractHardRequirements（结构 / 词表对齐 / 去重 / 显式词提取）
// ---------------------------------------------------------------------------

test('E1 hard_requirements 结构冻结：type ∈ §22.1 十类、mandatory ∈ 三级、id/jd_text 齐备', () => {
  assert.deepEqual(HARD_REQUIREMENT_TYPES, ['education', 'language', 'years', 'industry', 'category', 'management', 'system_erp_srm', 'travel', 'schedule', 'location']);
  assert.deepEqual(GAP_LEVELS, ['BLOCKER', 'HARD_GAP', 'SOFT_GAP', 'UNKNOWN']);
  assert.deepEqual(MANDATORY_LEVELS, ['explicit', 'likely', 'preferred']);
  const reqs = extractHardRequirements(JD_002);
  assert.ok(reqs.length > 0);
  for (const r of reqs) {
    assert.ok(HARD_REQUIREMENT_TYPES.includes(r.type), r.type);
    assert.ok(MANDATORY_LEVELS.includes(r.mandatory), r.mandatory);
    assert.match(r.id, /^hr-\d{2}$/);
    assert.ok(typeof r.jd_text === 'string' && r.jd_text.length > 0); // 原文摘录，不改写
  }
});

test('E2 fixture-002 提取：JD 首条硬要求"有生鲜产品供应商资源"=explicit；同品类去重取最高必须性；无 travel/schedule/language', () => {
  const reqs = extractHardRequirements(JD_002);
  // "有生鲜产品供应商资源"（无标记词，任职语境兜底）= explicit；"熟悉…"首条 = likely，被 explicit 覆盖
  const resource = reqs.filter(r => r.type === 'category' && r.jd_text.includes('生鲜产品供应商资源'));
  assert.equal(resource.length, 1);
  assert.equal(resource[0].mandatory, 'explicit');
  // 同品类（生鲜食品）的两处提及（"基地资源渠道"段 likely / "供应商资源"段 explicit）去重为一条
  const freshFromSeg1 = reqs.filter(r => r.type === 'category' && r.jd_text.includes('基地资源渠道'));
  assert.equal(freshFromSeg1.length, 0);
  // 学历：大专及以上 = explicit（及以上阈值句式）
  const edu = reqs.find(r => r.type === 'education');
  assert.ok(edu, '应提取学历要求');
  assert.equal(edu.mandatory, 'explicit');
  assert.ok(edu.jd_text.includes('大专及以上学历'));
  // fixture-002 无出差/工作制/地点/语言明示 → 不发明要求
  assert.ok(!reqs.some(r => ['travel', 'schedule', 'location', 'language'].includes(r.type)));
});

test('E3 空文本 / 无硬要求文本：0 条；evaluateEligibility 诚实降级 unknown', () => {
  assert.deepEqual(extractHardRequirements(''), []);
  assert.deepEqual(extractHardRequirements(null), []);
  // 无任何硬要求信息（行政岗）→ 0 条 → status=unknown（诚实降级，不硬套）
  const e = evaluateEligibility({ jdText: '负责部门日常行政事务与报销审核。', cvText: CV_MAIN, candidate: CAND });
  assert.equal(e.eligibility_status, 'unknown');
  assert.equal(e.hard_requirements.length, 0);
  assert.equal(e.has_hard_gap, false);
  assert.equal(e.eligibility_ineligible, false);
});

// ---------------------------------------------------------------------------
// 2. 判定四问 evaluateRequirement → 四级模型
// ---------------------------------------------------------------------------

test('E4 四问四级-BLOCKER：explicit + 高概率硬筛（资源词）+ 不可替代 + 确认缺失 → BLOCKER（job-side）', () => {
  const req = { id: 't1', type: 'category', jd_text: '必须具备生鲜产品供应商资源（蔬菜/冻品）', mandatory: 'explicit' };
  const r = evaluateRequirement(req, { categories: ['工程机械'] }, '主战场工程机械整机与配件');
  assert.equal(r.status, 'unmet');                 // 候选人品类已知但无交集 = 确认缺失（no_evidence ≠ false 的对称面）
  assert.equal(r.hard_screen, true);               // 四问②：资源/渠道 = 高概率真筛
  assert.equal(r.substitute_ok, false);            // 四问③：资源型需求不可替代
  assert.equal(r.level, 'BLOCKER');
});

test('E5 四问四级-HARD_GAP：mandatory 缺失但可替代/非硬筛；preferred 缺失 = SOFT_GAP', () => {
  // 同为 explicit 品类缺失，但无"资源/渠道"硬筛词 → 可替代 → HARD_GAP（不自动成 blocker）
  const req = { id: 't2', type: 'category', jd_text: '必须熟悉生鲜品类采购', mandatory: 'explicit' };
  const r = evaluateRequirement(req, { categories: ['工程机械'] }, '主战场工程机械整机与配件');
  assert.equal(r.status, 'unmet');
  assert.equal(r.hard_screen, false);
  assert.equal(r.substitute_ok, true);
  assert.equal(r.level, 'HARD_GAP');
  // preferred 缺失 = SOFT_GAP
  const soft = evaluateRequirement(
    { id: 't3', type: 'category', jd_text: '熟悉生鲜品类者优先', mandatory: 'preferred' },
    { categories: ['工程机械'] }, '主战场工程机械整机与配件'
  );
  assert.equal(soft.status, 'unmet');
  assert.equal(soft.level, 'SOFT_GAP');
});

test('E6 四问四级-UNKNOWN：JD 或候选侧信息不足 → UNKNOWN，绝不自动 ineligible / 不猜测', () => {
  // 候选人无任何品类信息（无 profile 品类 + 无 CV 文本）→ unknown
  const r = evaluateRequirement(
    { id: 't4', type: 'category', jd_text: '必须具备生鲜产品供应商资源', mandatory: 'explicit' },
    {}, ''
  );
  assert.equal(r.status, 'unknown');
  assert.equal(r.level, 'UNKNOWN');
  // 学历未提供 → unknown（不猜测）
  const edu = evaluateRequirement(
    { id: 't5', type: 'education', jd_text: '本科及以上学历', mandatory: 'explicit' },
    {}, CV_MAIN
  );
  assert.equal(edu.status, 'unknown');
  assert.equal(edu.level, 'UNKNOWN');
  // unknown 的 likely-hard 项 → eligible_with_gaps（绝不 ineligible）
  const e = evaluateEligibility({ jdText: '任职要求：本科及以上学历。', cvText: '', candidate: {} });
  assert.equal(e.eligibility_status, 'eligible_with_gaps');
  assert.equal(e.eligibility_ineligible, false);
});

test('E7 management/system_erp_srm 经 evidence 词表判定：strong/medium=met、weak=unmet 但非确认缺失（至多 HARD_GAP）、无 CV=unknown', () => {
  const req = { id: 't6', type: 'management', jd_text: '要求具备团队管理经验，带过采购团队', mandatory: 'explicit' };
  const met = evaluateRequirement(req, {}, '负责采购部门管理，管理5人采购团队');
  assert.equal(met.status, 'met');
  assert.equal(met.level, null);
  // 弱证据（协助/熟悉类）：不满足硬要求，但非"确认完全缺失"（§22.1 BLOCKER 需确认缺失）→ 至多 HARD_GAP
  const weak = evaluateRequirement(req, {}, '协助带教新人，参与团队协同');
  assert.equal(weak.status, 'unmet');
  assert.equal(weak.confirmed_missing, false);
  assert.equal(weak.level, 'HARD_GAP');
  // CV 存在但无任何管理信号 = 确认缺失 → explicit+硬筛+不可替代 → BLOCKER
  const absent = evaluateRequirement(req, {}, '负责日常下单与跟单，处理询报价');
  assert.equal(absent.status, 'unmet');
  assert.equal(absent.confirmed_missing, true);
  assert.equal(absent.level, 'BLOCKER');
  // CV 缺失 → unknown（不猜测）
  const unknown = evaluateRequirement(req, {}, '');
  assert.equal(unknown.status, 'unknown');
  assert.equal(unknown.level, 'UNKNOWN');
});

// ---------------------------------------------------------------------------
// 3. candidate-side blockers（未知即不触发 + config_gap，不猜测）
// ---------------------------------------------------------------------------

test('E8 severe_level_downgrade：seniorityGap ≥2 档 → true；1 档 → false；title 不可归一 → false+note', () => {
  // 主管(L3) vs 专员(L1) = 2 档 → true（该 blocker 自身证据齐备 → 不在 unknown_items）
  const two = evaluateCandidateBlockers({ jdFacts: { jdTitle: '采购专员' }, candidate: { rawTitle: '采购主管' } });
  assert.equal(two.blockers.severe_level_downgrade, true);
  assert.ok(!two.unknown_items.includes('severe_level_downgrade'));
  // 主管(L3) vs 高级专员(L2) = 1 档 → false（HARD_GAP 语义，非 severe）
  const one = evaluateCandidateBlockers({ jdFacts: { jdTitle: '高级采购专员' }, candidate: { rawTitle: '采购主管' } });
  assert.equal(one.blockers.severe_level_downgrade, false);
  // JD title 缺失 → gap=null → false + note + unknown_item
  const missing = evaluateCandidateBlockers({ jdFacts: {}, candidate: { rawTitle: '采购主管' } });
  assert.equal(missing.blockers.severe_level_downgrade, false);
  assert.ok(missing.notes.some(n => n.includes('severe_level_downgrade')));
  assert.ok(missing.unknown_items.includes('severe_level_downgrade'));
  // "负责人"类不可归一 title → gap=null → 不触发
  const unknownTitle = evaluateCandidateBlockers({ jdFacts: { jdTitle: '负责人' }, candidate: { rawTitle: '采购主管' } });
  assert.equal(unknownTitle.blockers.severe_level_downgrade, false);
  assert.ok(unknownTitle.unknown_items.includes('severe_level_downgrade'));
});

test('E9 salary_floor_breach：底线未配置 → false+config_gap（不许猜）；双方齐备才判定 jdMax<floor', () => {
  // 底线未配置 → 不触发 + config_gap（Phase 4 裁决④：缺失 preference 不猜测）
  const noFloor = evaluateCandidateBlockers({ jdFacts: { salaryMaxK: 8 }, candidate: {} });
  assert.equal(noFloor.blockers.salary_floor_breach, false);
  assert.ok(noFloor.notes.some(n => n.includes('薪资底线未配置') && n.includes('config_gap')));
  assert.ok(noFloor.unknown_items.includes('salary_floor_breach'));
  // 双方齐备：JD 上限 8K < 底线 10K → true
  assert.equal(evaluateCandidateBlockers({ jdFacts: { salaryMaxK: 8 }, candidate: { salaryFloorK: 10 } }).blockers.salary_floor_breach, true);
  // JD 上限 12K ≥ 底线 10K → false
  assert.equal(evaluateCandidateBlockers({ jdFacts: { salaryMaxK: 12 }, candidate: { salaryFloorK: 10 } }).blockers.salary_floor_breach, false);
  // JD 上限缺失 → 不触发 + note
  const noJdMax = evaluateCandidateBlockers({ jdFacts: {}, candidate: { salaryFloorK: 10 } });
  assert.equal(noJdMax.blockers.salary_floor_breach, false);
  assert.ok(noJdMax.notes.some(n => n.includes('薪资上限缺失')));
});

test('E10 current_employer_conflict：公司名归一化（去括号内容/空格/大小写）匹配；任一侧缺失 → false+note', () => {
  assert.equal(normalizeCompanyName('示例集团（XYZ）'), '示例集团');
  assert.equal(normalizeCompanyName('示例集团 (XYZ) '), '示例集团');
  // "示例集团（XYZ）" vs "示例集团" → 同一主体 → true
  const hit = evaluateCandidateBlockers({ jdFacts: { company: '示例集团（XYZ）' }, candidate: { currentEmployer: '示例集团' } });
  assert.equal(hit.blockers.current_employer_conflict, true);
  // 互相包含（子公司全名 vs 母公司简称）→ true
  const contain = evaluateCandidateBlockers({ jdFacts: { company: '示例集团厦门分公司' }, candidate: { currentEmployer: '示例集团' } });
  assert.equal(contain.blockers.current_employer_conflict, true);
  // 不同主体 → false（无 note、无 unknown）
  const miss = evaluateCandidateBlockers({ jdFacts: { company: '示例科技（ABC）' }, candidate: { currentEmployer: '示例集团' } });
  assert.equal(miss.blockers.current_employer_conflict, false);
  assert.ok(!miss.unknown_items.includes('current_employer_conflict'));
  // 任一侧缺失 → false + note（不猜测）
  const absent = evaluateCandidateBlockers({ jdFacts: {}, candidate: { currentEmployer: '示例集团' } });
  assert.equal(absent.blockers.current_employer_conflict, false);
  assert.ok(absent.notes.some(n => n.includes('current_employer_conflict')));
  assert.ok(absent.unknown_items.includes('current_employer_conflict'));
});

test('E11 location / work_schedule / travel：需双侧显式证据才 true；缺任一侧 → false+note（未知不触发）', () => {
  // location：acceptableLocations 显式声明 + JD 显式地点
  const locOk = evaluateCandidateBlockers({ jdFacts: { location: '厦门市海沧区' }, candidate: { acceptableLocations: ['厦门市'] } });
  assert.equal(locOk.blockers.location_blocker, false); // 包含匹配 → 可接受
  const locBad = evaluateCandidateBlockers({ jdFacts: { location: '泉州市丰泽区' }, candidate: { acceptableLocations: ['厦门市'] } });
  assert.equal(locBad.blockers.location_blocker, true);
  const locUnknown = evaluateCandidateBlockers({ jdFacts: {}, candidate: { acceptableLocations: ['厦门市'] } });
  assert.equal(locUnknown.blockers.location_blocker, false);
  assert.ok(locUnknown.notes.some(n => n.includes('location_blocker')));
  assert.ok(locUnknown.unknown_items.includes('location_blocker'));
  // work_schedule：大小周本身只是 workload 维度证据，候选人声明后才升级
  const schedHit = evaluateCandidateBlockers({ jdFacts: { scheduleSignals: ['大小周'] }, candidate: { workstyleConstraints: ['大小周'] } });
  assert.equal(schedHit.blockers.work_schedule_blocker, true);
  const schedUnknown = evaluateCandidateBlockers({ jdFacts: { scheduleSignals: ['大小周'] }, candidate: {} });
  assert.equal(schedUnknown.blockers.work_schedule_blocker, false);
  assert.ok(schedUnknown.unknown_items.includes('work_schedule_blocker'));
  // travel：JD 明示外派 + 候选人明确拒绝 → true；候选人未声明 → 不触发
  const travelHit = evaluateCandidateBlockers({ jdFacts: { travelSignals: ['外派'] }, candidate: { travelWilling: false } });
  assert.equal(travelHit.blockers.travel_refusal, true);
  const travelUnknown = evaluateCandidateBlockers({ jdFacts: { travelSignals: ['外派'] }, candidate: {} });
  assert.equal(travelUnknown.blockers.travel_refusal, false);
  assert.ok(travelUnknown.unknown_items.includes('travel_refusal'));
  // 候选人接受出差（travelWilling=true）→ false，无 unknown_item
  const travelOk = evaluateCandidateBlockers({ jdFacts: { travelSignals: ['外派'] }, candidate: { travelWilling: true } });
  assert.equal(travelOk.blockers.travel_refusal, false);
  assert.ok(!travelOk.unknown_items.includes('travel_refusal'));
});

test('E12 parseJdFacts：薪资区间（K/万/元）、工作制信号、出差信号；解析不了 → null/[]（不猜测）', () => {
  assert.deepEqual(parseJdFacts('薪资5-8K。'), { company: null, jdTitle: null, location: null, salaryMaxK: 8, scheduleSignals: [], travelSignals: [] });
  assert.equal(parseJdFacts('薪资8-12K·13薪').salaryMaxK, 12);
  assert.equal(parseJdFacts('薪资1-1.5万/月').salaryMaxK, 15);
  assert.equal(parseJdFacts('薪资8000-12000元/月').salaryMaxK, 12);
  assert.deepEqual(parseJdFacts('工作制：大小周').scheduleSignals, ['大小周']);
  const travel = parseJdFacts('需常驻出差，接受外派');
  assert.ok(travel.travelSignals.includes('常驻出差'));
  assert.ok(travel.travelSignals.includes('外派'));
  // 长词遮蔽：'常驻出差' 命中后 '出差' 不重复计
  assert.ok(!travel.travelSignals.filter(s => s === '出差').length);
  const empty = parseJdFacts('负责采购订单与跟单。');
  assert.equal(empty.salaryMaxK, null);
  assert.deepEqual(empty.scheduleSignals, []);
  assert.deepEqual(empty.travelSignals, []);
  // overrides 优先：结构化字段由调用方传入
  const ov = parseJdFacts('薪资5-8K', { company: '示例集团（XYZ）', jdTitle: '采购专员', location: '厦门市海沧区' });
  assert.equal(ov.company, '示例集团（XYZ）');
  assert.equal(ov.jdTitle, '采购专员');
  assert.equal(ov.location, '厦门市海沧区');
});

// ---------------------------------------------------------------------------
// 4. 单一 SoT：decide() 零决策，recommendation 与 computeRecommendation 同参一致
// ---------------------------------------------------------------------------

// 把 evaluateEligibility 输出按 decide() 的转发规则手工铺开（与 decide 内部完全一致）
const forwardDirect = (eligibility, scores, extra = {}) => computeRecommendation({
  career_ops_score: scores.career_ops_score !== undefined ? scores.career_ops_score : null,
  cv_match_score: scores.cv_match_score !== undefined ? scores.cv_match_score : null,
  eligibility_status: eligibility.eligibility_status,
  eligibility_ineligible: eligibility.eligibility_ineligible,
  has_hard_gap: eligibility.has_hard_gap,
  ...eligibility.blockers,
  ...extra,
});

test('E13 单一 SoT：decide().recommendation 与直接调 computeRecommendation 同参结果 deepEqual（fixture-002）', () => {
  const scores = { cv_match_score: 48, career_ops_score: 42.5 }; // true 0-100（旧 2.7 → (2.7−1)×25）
  const d = decide({ jdText: JD_002, cvText: CV_MAIN, candidate: CAND, scores });
  assert.deepEqual(d.recommendation, forwardDirect(d.eligibility, scores));
  // 决策来自 Step 2（job-side ineligible）
  assert.equal(d.recommendation.recommendation, '不推荐');
  assert.equal(d.eligibility.eligibility_status, 'ineligible');
  assert.equal(d.recommendation.trace.find(t => t.step === 2).outcome, 'hit');
  assert.ok(d.recommendation.recommendation_reason.includes('硬性资格不满足'));
});

test('E14 blocker 不污染分数：decide 不输出任何分数字段，scores 输入前后 deepEqual 不变', () => {
  const scores = { cv_match_score: 48, career_ops_score: 42.5 };
  const snapshot = JSON.parse(JSON.stringify(scores));
  const d = decide({ jdText: JD_002, cvText: CV_MAIN, candidate: CAND, scores });
  assert.deepEqual(scores, snapshot); // 输入对象未被改动
  // decide 输出结构恒为 eligibility/blockers/notes/recommendation（recommendation 内无分数字段）
  assert.deepEqual(Object.keys(d).sort(), ['blockers', 'eligibility', 'notes', 'recommendation']);
  assert.deepEqual(Object.keys(d.recommendation).sort(), ['recommendation', 'recommendation_reason', 'trace']);
  // blockers 与 eligibility.blockers 同引用一致，notes 透传
  assert.deepEqual(d.blockers, d.eligibility.blockers);
  assert.ok(Array.isArray(d.notes));
});

// ---------------------------------------------------------------------------
// 5. 三岗位回归（匿名 fixture；分数 = Phase 3 产出值，逐字不变）
// ---------------------------------------------------------------------------

test('E15 fixture-001 汽配出口采购岗：主管→专员 2 档 = severe_level_downgrade → Step 1 不推荐；eligibility 仍 eligible；分数不被触碰', () => {
  const scores = { cv_match_score: 58, career_ops_score: 31.0 }; // true 0-100（旧 2.24 → 31；cv-match.test C21 = 58）
  const d = decide({
    jdText: JD_001, cvText: CV_MAIN, candidate: CAND,
    jdFacts: { jdTitle: '采购专员' }, scores,
  });
  // §25：fixture-001 eligibility=eligible（品类仅加分项缺失 = SOFT_GAP），拒绝来自 candidate-side blocker
  assert.equal(d.eligibility.eligibility_status, 'eligible');
  assert.equal(d.eligibility.has_hard_gap, false);
  assert.equal(d.blockers.severe_level_downgrade, true);
  // Step 1 短路：不查矩阵、不回落 scoreBand → 输出不含任何分数路径
  assert.equal(d.recommendation.recommendation, '不推荐');
  assert.equal(d.recommendation.recommendation_reason, '职级严重倒退（Career Score 31/100）');
  assert.ok(!d.recommendation.trace.some(t => t.step === 3), 'Step 1 命中后不得再走矩阵/band 路径');
  assert.equal(d.recommendation.trace.find(t => t.step === 1).outcome, 'severe_level_downgrade');
  // 单一 SoT：与直接调 computeRecommendation 同参逐字节一致
  const direct = computeRecommendation({
    career_ops_score: 31.0, cv_match_score: 58, eligibility_status: 'eligible',
    eligibility_ineligible: false, has_hard_gap: false, ...d.eligibility.blockers,
  });
  assert.deepEqual(d.recommendation, direct);
});

test('E16 fixture-002 生鲜品类采购岗："生鲜供应商资源"=explicit+硬筛+不可替代+候选缺失 → job-side BLOCKER → ineligible → 不推荐；capability 层 sourcing 仍 matched', () => {
  const scores = { cv_match_score: 48, career_ops_score: 42.5 }; // true 0-100（旧 2.7 → 42.5；cv-match.test C22 = 48）
  const d = decide({ jdText: JD_002, cvText: CV_MAIN, candidate: CAND, scores });
  const blockerReq = d.eligibility.hard_requirements.find(r => r.level === 'BLOCKER');
  assert.ok(blockerReq, '应存在 job-side BLOCKER');
  assert.equal(blockerReq.type, 'category');
  assert.equal(blockerReq.mandatory, 'explicit');
  assert.equal(blockerReq.hard_screen, true);
  assert.equal(blockerReq.substitute_ok, false);
  assert.equal(blockerReq.status, 'unmet');
  assert.ok(blockerReq.jd_text.includes('生鲜产品供应商资源'));
  assert.equal(d.eligibility.eligibility_status, 'ineligible');
  assert.equal(d.blockers.severe_level_downgrade, false); // 双通道可平级（Phase 3 语义）
  assert.equal(d.recommendation.recommendation, '不推荐');
  // Phase 2 语义不回退：缺的是品类资源，不是采购能力（sourcing_development 仍 matched）
  const cov = analyzeCapabilityCoverage(JD_002, CV_MAIN);
  const sourcing = cov.coverage.find(x => x.capability === 'sourcing_development');
  assert.equal(sourcing.coverage_status, 'matched');
});

test('E17 fixture-003 工程机械采购岗：现雇主冲突（示例集团（XYZ）vs 示例集团）→ Step 1 不推荐；cv 84/career 3.8 逐字不变；无冲突对照 → 矩阵 3.8×84 → 推荐', () => {
  const scores = { cv_match_score: 84, career_ops_score: 70.0 }; // true 0-100（旧 3.8 → 70；cv-match.test C23 = 84）
  // 冲突情形：Step 1 覆盖双高
  const dConflict = decide({
    jdText: JD_003, cvText: CV_MAIN,
    candidate: { ...CAND, currentEmployer: '示例集团（XYZ）' },
    jdFacts: { company: '示例集团' }, scores,
  });
  assert.equal(dConflict.eligibility.eligibility_status, 'eligible'); // §25：fixture-003 硬要求全 met
  assert.equal(dConflict.blockers.current_employer_conflict, true);
  assert.equal(dConflict.blockers.severe_level_downgrade, false); // 本公司内向下兼岗：仅雇主冲突（Phase 3 语义）
  assert.equal(dConflict.recommendation.recommendation, '不推荐');
  assert.equal(dConflict.recommendation.recommendation_reason, '现任雇主/关联主体岗位，不构成外部跳槽机会（Career Score 70/100）');
  assert.ok(!dConflict.recommendation.trace.some(t => t.step === 3), 'Step 1 短路，不查矩阵');
  // 无冲突对照：矩阵 70（50-74）× 84（≥80）→ 推荐。
  // （legacy band(76)=一般 —— §22.4 冻结矩阵把该格升级为"推荐"，老对照 band=一般 由矩阵取代）
  const dClean = decide({
    jdText: JD_003, cvText: CV_MAIN, candidate: CAND,
    jdFacts: { company: '其他示例公司' }, scores,
  });
  assert.equal(dClean.blockers.current_employer_conflict, false);
  assert.equal(dClean.recommendation.recommendation, '推荐');
  assert.ok(dClean.recommendation.recommendation_reason.includes('决策矩阵'));
  // 分数逐字不变：trace step 3 的输入即原始分数（84 / 70），decide 未做任何改写
  assert.deepEqual(dClean.recommendation.trace.find(t => t.step === 3).input, { career_ops_score: 70.0, cv_match_score: 84 });
  // 单一 SoT
  assert.deepEqual(dConflict.recommendation, forwardDirect(dConflict.eligibility, scores));
  assert.deepEqual(dClean.recommendation, forwardDirect(dClean.eligibility, scores));
});

// ---------------------------------------------------------------------------
// 6. 组合语义（eligible_with_gaps 降一档封顶 / has_hard_gap 封顶）经 decide 端到端
// ---------------------------------------------------------------------------

test('E18 eligible_with_gaps 降一档封顶（强烈推荐→推荐）：可替代的 explicit 品类缺失 = HARD_GAP，高分也不强烈推荐', () => {
  // 无"资源/渠道"硬筛词 → 品类缺失可替代 → HARD_GAP → eligible_with_gaps
  const jd = '任职要求：必须熟悉生鲜品类采购，有相关采购经验。';
  const d = decide({
    jdText: jd, cvText: CV_MAIN, candidate: CAND,
    scores: { cv_match_score: 90, career_ops_score: 95.0 },
  });
  assert.equal(d.eligibility.eligibility_status, 'eligible_with_gaps');
  assert.equal(d.eligibility.has_hard_gap, true);
  // 矩阵 95×90 = 强烈推荐 → 降一档封顶"推荐"
  assert.equal(d.recommendation.recommendation, '推荐');
  assert.ok(d.recommendation.recommendation_reason.includes('降一档'));
  assert.deepEqual(d.recommendation, forwardDirect(d.eligibility, { cv_match_score: 90, career_ops_score: 95.0 }));
});

test('E19 hard_requirements 的四级枚举与委派：travel/schedule/location 委派 candidate-side blocker 层，不产生 job-side 级别', () => {
  const jd = [
    '岗位职责：负责品类采购与供应商管理，具备团队管理经验。',
    '【其他】',
    '能适应长期出差与外派；工作制为大小周；工作地点：厦门市海沧区。',
  ].join('\n');
  const reqs = extractHardRequirements(jd);
  for (const type of ['travel', 'schedule', 'location']) {
    const r = reqs.find(x => x.type === type);
    assert.ok(r, `应提取 ${type}`);
    const ev = evaluateRequirement(r, CAND, CV_MAIN);
    assert.equal(ev.delegated, true);
    assert.equal(ev.status, 'unknown');
    assert.equal(ev.level, 'UNKNOWN'); // 委派型不产生 job-side BLOCKER/HARD_GAP
  }
  // management（leadership 桶）为 explicit 硬要求：CV_MAIN 命中"管理4人采购小组"（strong）→ met
  const mgmt = reqs.find(x => x.type === 'management');
  assert.ok(mgmt, '应提取 management 要求');
  const mgmtEv = evaluateRequirement(mgmt, CAND, CV_MAIN);
  assert.equal(mgmtEv.status, 'met');
  assert.equal(mgmtEv.level, null);
});
