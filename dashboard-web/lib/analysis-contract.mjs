// analysis-contract.mjs — Round 2 分析输出唯一正式合同（schema / normalize / validate）
//
// 职责（ANALYSIS OUTPUT STABILITY CONTRACT 的运行时实现）：
//   - 定义 canonical 分析 schema：必需 section、字段类型、engine 数值契约、unknown 表示；
//   - normalizeAnalysis：把任意 provider/legacy 输出归一为 canonical 形态
//     （同义字段别名映射 → 唯一字段名；类型漂移归一；缺失 key 补 canonical 空值）；
//   - validateAnalysis：结构完整性校验（不评内容质量）。
// 铁律：
//   - 本模块零依赖、纯函数、不 mutate 输入（浏览器与 node --test 共用）；
//   - 模型/provider 只是 untrusted structured input——本模块决定 schema，模型无权定义；
//   - 不做任何数值计算、不改评分结果；缺证据 = canonical 空值（[]/''），禁止编造。
//
// 枚举 SoT 指向（冻结副本，与 tools/lib/scoring.mjs 逐字一致；本模块刻意零依赖）：
//   RECOMMENDATION_LEVELS = ['强烈推荐','推荐','一般','不推荐','硬红线跳过']
//   ELIGIBILITY_STATUS    = ['eligible','eligible_with_gaps','ineligible','unknown']

// canonical schema 版本：2 = Round 2 canonical（含全部必需 section + 类型归一 + 完整性元数据）。
// legacy（无版本标记）= Round 2 前批次；score_scale_version 只管分数量纲，此处独立演进。
export const ANALYSIS_SCHEMA_VERSION = 2;

// 五档推荐枚举（冻结副本，SoT = tools/lib/scoring.mjs）
export const RECOMMENDATION_LEVELS = Object.freeze(['强烈推荐', '推荐', '一般', '不推荐', '硬红线跳过']);
// 资格状态枚举（冻结副本，SoT = tools/lib/eligibility.mjs）
export const ELIGIBILITY_STATUS = Object.freeze(['eligible', 'eligible_with_gaps', 'ineligible', 'unknown']);

// 用户可见板块 → canonical 字段（Golden Shape；字段名以项目现有 SoT 为准，不新造）。
// 结构必须存在；内容允许诚实为空（canonical 空值 = '' 或 []，禁止 key 消失）。
export const REQUIRED_ANALYSIS_SECTIONS = Object.freeze({
  recommendation_reason: 'string',   // 推荐原因
  strengths: 'array',                // 主要优势
  gaps: 'array',                     // 主要短板
  soft_gaps: 'array',                // 可弥补缺口
  cv_advice: 'string',               // 简历修改建议
  interview_focus: 'string',         // 面试建议
  decision_trace: 'array',           // 推荐决策链（engine 透传）
  score_breakdown: 'object',         // 评分明细（engine 产出；null 仅限未走引擎的 legacy 行）
});

// 引擎数值契约字段（Round 1B 冻结：true 0-100 + version 2；不得由模型自评）
export const ENGINE_NUMERIC_CONTRACT = Object.freeze({
  cv_match_score: { min: 0, max: 100 },
  career_ops_score: { min: 0, max: 100 },
});

// 同义字段别名 → canonical（provider 漂移容忍；持久化只留 canonical，别名 key 归一后删除）
export const FIELD_ALIASES = Object.freeze({
  strengths: ['advantages', 'key_strengths', 'keyStrengths', 'pro'],
  gaps: ['weaknesses', 'weak_points', 'cons'],
  soft_gaps: ['fixable_gaps'],
  cv_advice: ['resume_advice', 'resume_suggestions', 'cv_suggestions', 'resume_improvements'],
  interview_focus: ['interview_suggestions', 'interview_questions', 'interview_prep'],
});

const NARRATIVE_ARRAY_KEYS = ['strengths', 'gaps', 'soft_gaps', 'hard_gaps', 'decision_trace'];
const NARRATIVE_STRING_KEYS = ['recommendation_reason', 'cv_advice', 'interview_focus'];

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const toText = (v) => {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.filter(x => x != null).map(x => String(x).trim()).filter(Boolean).join('；');
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
};
const toArray = (v) => {
  if (v == null) return [];
  if (Array.isArray(v)) return v.filter(x => x != null && String(x).trim() !== '').map(x => (typeof x === 'string' ? x.trim() : x));
  if (typeof v === 'string') return v.trim() ? [v.trim()] : [];
  return [];
};

/** 岗位是否已完成正式分析（有推荐结论或引擎分）。未分析行不做 section 完整性要求。 */
export function isAnalyzed(a) {
  return !!(a && (a.recommendation != null || a.career_ops_score != null));
}

/**
 * 归一任意 provider/legacy analysis → canonical 形态（不 mutate 输入）。
 * 只处理合同管辖的 key：别名映射、类型归一、缺失补 canonical 空值；
 * 其余 key 原样透传（engine 字段、来源字段等不经手、不改写）。
 * @returns {{analysis: object, actions: string[]}} actions 记录每一步归一（审计用）
 */
export function normalizeAnalysis(input) {
  const a = (isPlainObject(input) ? input : {}) || {};
  const out = { ...a };
  const actions = [];

  // 1) 别名 → canonical（仅当 canonical 缺失且别名存在内容时搬运）
  for (const [canonical, aliases] of Object.entries(FIELD_ALIASES)) {
    const hasCanonical = out[canonical] != null && out[canonical] !== '';
    if (hasCanonical) continue;
    for (const alias of aliases) {
      if (out[alias] != null && out[alias] !== '') {
        out[canonical] = out[alias];
        actions.push(`alias:${alias}->${canonical}`);
        break;
      }
    }
  }
  for (const aliases of Object.values(FIELD_ALIASES)) {
    for (const alias of aliases) {
      if (alias in out && alias !== 'pro' && alias !== 'cons') { delete out[alias]; }
    }
  }

  // 2) 类型归一（canonical 空值：数组 = []，自由文本 = ''）
  for (const k of NARRATIVE_ARRAY_KEYS) {
    const before = out[k];
    const arr = toArray(before);
    if (!Array.isArray(before) || JSON.stringify(before) !== JSON.stringify(arr)) {
      actions.push(`type:${k}->array`);
    }
    out[k] = arr;
  }
  for (const k of NARRATIVE_STRING_KEYS) {
    const before = out[k];
    const s = toText(before);
    if (typeof before !== 'string' || before !== s) {
      actions.push(`type:${k}->string`);
    }
    out[k] = s;
  }

  // 3) 引擎结构字段：key 必须存在（null = 未走引擎的 legacy 形态，canonical 表示）
  if (!('score_breakdown' in out)) {
    out.score_breakdown = null;
    actions.push('type:score_breakdown->null');
  }

  return { analysis: out, actions };
}

const DIMS_OK = (bd) => {
  if (!isPlainObject(bd)) return false;
  const dims = bd.dimensions;
  if (!Array.isArray(dims) || dims.length === 0) return false;
  return dims.every(d => !d || d.score == null || (typeof d.score === 'number' && d.score >= 0 && d.score <= 100));
};

/**
 * 结构完整性校验（不评内容质量、不改数据）。
 * @param {object} a 归一后的 analysis
 * @returns {{status:'complete'|'partial', missing_sections:string[], type_errors:string[]}}
 */
export function validateAnalysis(a) {
  const missing = [];
  const typeErrors = [];
  if (!isPlainObject(a)) return { status: 'partial', missing_sections: ['analysis'], type_errors: ['analysis not an object'] };

  // A. 必需 section 存在
  for (const k of Object.keys(REQUIRED_ANALYSIS_SECTIONS)) {
    if (!(k in a)) missing.push(k);
  }
  if (!('recommendation' in a)) missing.push('recommendation');

  // B. 类型
  for (const k of NARRATIVE_ARRAY_KEYS) {
    if (a[k] !== undefined && !Array.isArray(a[k])) typeErrors.push(`${k}:not-array`);
  }
  for (const k of NARRATIVE_STRING_KEYS) {
    if (a[k] !== undefined && typeof a[k] !== 'string') typeErrors.push(`${k}:not-string`);
  }

  // C. 枚举
  if (a.recommendation != null && !RECOMMENDATION_LEVELS.includes(a.recommendation)) {
    typeErrors.push(`recommendation:invalid-enum:${String(a.recommendation).slice(0, 24)}`);
  }
  if (a.eligibility_status != null && !ELIGIBILITY_STATUS.includes(a.eligibility_status)) {
    typeErrors.push(`eligibility_status:invalid-enum:${String(a.eligibility_status).slice(0, 24)}`);
  }

  // C2. engine 数值契约（true 0-100 + version 2）
  for (const [k, { min, max }] of Object.entries(ENGINE_NUMERIC_CONTRACT)) {
    const v = a[k];
    if (v == null) continue;
    if (typeof v !== 'number' || !Number.isFinite(v)) typeErrors.push(`${k}:not-number`);
    else if (v < min || v > max) typeErrors.push(`${k}:out-of-scale:${v}`);
  }
  if (a.career_ops_score != null) {
    if (a.score_scale_version !== 2) typeErrors.push('score_scale_version:not-2');
    if (!DIMS_OK(a.score_breakdown)) typeErrors.push('score_breakdown:missing-or-invalid-dimensions');
    if (!Array.isArray(a.decision_trace) || a.decision_trace.length === 0) missing.push('decision_trace');
  } else if (a.score_breakdown === undefined) {
    // 未走引擎的 legacy 行：breakdown 允许 null，但 key 必须存在
  }

  const status = (missing.length === 0 && typeErrors.length === 0) ? 'complete' : 'partial';
  return { status, missing_sections: missing, type_errors: typeErrors };
}

/** UI 空状态文案（canonical 空值 → 稳定、中性、非能力判词的展示文本；缺数据 ≠ 差）。
 *  覆盖全部 REQUIRED_ANALYSIS_SECTIONS（score_breakdown/decision_trace 的 null 形态也在内）。 */
export const SECTION_EMPTY_TEXT = Object.freeze({
  recommendation_reason: '暂无推荐原因（该岗位未走当前引擎链路）',
  strengths: '暂无可从当前证据确认的明确优势项',
  gaps: '暂无明确的短板项',
  soft_gaps: '暂无明确的可弥补缺口',
  cv_advice: '暂无基于当前证据的简历修改建议',
  interview_focus: '暂无基于当前证据的面试关注点',
  decision_trace: '暂无决策链记录（该岗位未走当前引擎链路）',
  score_breakdown: '暂无评分明细（该岗位未走当前引擎链路）',
});

// ============================================================================
// Round 2B — Persistence Gate（唯一正式持久化门禁；PERSISTENCE GATE CONTRACT）
//
// 铁律：
//   - 任何正式 analysis 在通过本 Gate 前不得持久化；
//   - provider/model 输出是 untrusted input，只允许贡献 narrative 字段；
//   - 确定性引擎字段永远覆盖 provider 自带值（merge precedence：engine > model）；
//   - 所有持久化路径走同一条 normalize → strip → merge → repair → validate →
//     metadata → validate 流程；raw provider output 直接落盘 = 违约；
//   - schema 完整性（schema_status）与内容丰富度（content_status）是两个独立概念；
//   - 换模型/供应商不得改变持久化 schema。
// 本段保持零依赖、纯函数（浏览器与 node --test 共用）；文件落盘由
// tools/lib/analysis-persistence.mjs + tools/finalize-analysis.mjs 承担。
// ============================================================================

/** 模型允许贡献的 narrative 字段（白名单；其余一切字段模型无权提供）。 */
export const MODEL_NARRATIVE_FIELDS = Object.freeze([
  'strengths', 'gaps', 'soft_gaps', 'cv_advice', 'interview_focus',
]);

/** 确定性引擎独占字段（模型/provider 一律不可写入；严格模式下从 provider 输出剥离）。
 *  spec §4 清单的 canonical 落地：评分、置信度、决策、资格、taxonomy、capability、规则层。 */
export const ENGINE_OWNED_FIELDS = Object.freeze([
  // 评分与量纲（Round 1B 冻结）
  'cv_match_score', 'cv_match_confidence', 'cv_match_factors',
  'career_ops_score', 'career_score', 'score', 'score_confidence',
  'score_scale', 'score_scale_version', 'score_scale_migration', 'score_breakdown',
  // 决策链与推荐
  'recommendation', 'recommendation_reason', 'decision_trace',
  // 资格与缺口（engine 判定）
  'eligibility_status', 'eligibility_notes', 'hard_requirements', 'blockers',
  'hard_gaps', 'hard_redline',
  // 规则层（6b 初筛，确定性公式）
  'rule_filter', 'skip_reason', 'rule_score', 'salary_fit', 'location_fit',
  // taxonomy / capability engine 字段
  'taxonomy', 'capability_summary', 'unknown_items',
]);

/** Gate 元数据（provider 无权伪造，最终由 Gate 写入）。 */
export const GATE_METADATA_FIELDS = Object.freeze([
  'analysis_schema_version', 'analysis_completeness', 'analysis_gate',
]);

/** strict 模式下允许持久化的 key 白名单（narrative + engine + gate 元数据）。
 *  canonical 之外的未知 provider key 一律丢弃（保证跨 provider 形状一致，P13）。 */
export const ANALYSIS_PERSISTENCE_ALLOWLIST = Object.freeze([
  ...MODEL_NARRATIVE_FIELDS, ...ENGINE_OWNED_FIELDS, ...GATE_METADATA_FIELDS,
]);

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);

/** 面试确认点派生（deterministic evidence-based repair，spec §7 允许的唯一内容派生）：
 *  cv_match_factors 中 no_evidence/partial 因子的 evidence 首段。 */
function deriveInterviewFocusFromFactors(factors) {
  if (!Array.isArray(factors)) return [];
  return factors
    .filter(f => f && (f.status === 'no_evidence' || f.status === 'partial'))
    .map(f => String(f.evidence || '').split('｜')[0].split('；')[0].trim())
    .filter(Boolean)
    .slice(0, 3);
}

/**
 * content_status 的 deterministic 判定（spec §9：模型无权自报 rich）。
 * 6 个 narrative 信号位：recommendation_reason / strengths / gaps / soft_gaps /
 * cv_advice / interview_focus 实质非空计数（canonical 空值不算信号）。
 *   rich    ≥5    —— 首批引擎链路的全量 narrative
 *   partial 3–4  —— 结构在、部分 narrative 实质为空
 *   sparse  ≤2    —— 仅初筛事实（典型：6b 规则链路 / 后续采集批）
 * 不引入第二个 0-100 分；阈值冻结，改动需走合同变更。
 */
export function computeContentStatus(a) {
  const signals = {
    recommendation_reason: String(a?.recommendation_reason ?? '').trim().length > 0,
    strengths: Array.isArray(a?.strengths) && a.strengths.length > 0,
    gaps: Array.isArray(a?.gaps) && a.gaps.length > 0,
    soft_gaps: Array.isArray(a?.soft_gaps) && a.soft_gaps.length > 0,
    cv_advice: String(a?.cv_advice ?? '').trim().length > 0,
    interview_focus: String(a?.interview_focus ?? '').trim().length > 0,
  };
  const substantive = Object.values(signals).filter(Boolean).length;
  const status = substantive >= 5 ? 'rich' : substantive >= 3 ? 'partial' : 'sparse';
  return { status, substantive, signals };
}

/**
 * 唯一正式持久化门禁：provider/legacy 任意形态输入 → canonical analysis。
 *
 * @param {object} p
 *   provider - untrusted 输入（模型 narrative / 旧数据混合形态）；
 *   engine   - 确定性引擎输出（trusted；evaluate/cv-match/规则层的合并结果，
 *              key ∈ ENGINE_OWNED_FIELDS；为 null 时 = 不重算，仅规范校验既有对象）；
 *   strict   - true（默认，provider 是新模型输出）：白名单裁剪 + 引擎字段剥离；
 *              false（provider 是已持久化的 canonical/legacy 对象）：保留未知 key，
 *              引擎字段以既有值为基础、仅被 engine 提供的 key 覆盖（rescore/migrate 路径）；
 *   source   - 来源标记（写入 analysis_gate.source，审计用）。
 * @returns {{ok:boolean, analysis:object, schema_status, content_status, validate,
 *            repaired_actions:string[], overrides_removed:string[], dropped_keys:string[],
 *            reason:?string}}
 */
export function finalizeAnalysisForPersistence({ provider = null, engine = null, source = null, strict = true } = {}) {
  const repairedActions = [];
  const overridesRemoved = [];
  const droppedKeys = [];

  // 1-3) normalize provider：别名归一 → canonical；类型漂移归一；缺失补 canonical 空值
  const prov = isPlainObject(provider) ? provider : {};
  // 越权记录基于原始输入（normalize 会补 score_breakdown:null 等结构 key，不能算 provider 越权）：
  // 只有非 null / 非 '' / 非空数组的值才算一次真实的引擎字段覆盖尝试。
  const meaningful = (v) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);
  if (strict) {
    for (const k of ENGINE_OWNED_FIELDS) {
      if (meaningful(prov[k])) overridesRemoved.push(k);
    }
    repairedActions.push(`reject-provider-engine-fields:${overridesRemoved.length}`);
  }
  const norm = normalizeAnalysis(prov);
  const out = norm.analysis;
  for (const a of norm.actions) repairedActions.push(`normalize:${a}`);

  if (strict) {
    // 4-5) 引擎字段剥离：provider 提供的确定性字段一律视为越权覆盖尝试（engine > model）
    for (const k of ENGINE_OWNED_FIELDS) {
      delete out[k];
    }
    // P13 形状一致性：canonical 白名单之外的未知 provider key 丢弃（记录，不静默）
    for (const k of Object.keys(out)) {
      if (!ANALYSIS_PERSISTENCE_ALLOWLIST.includes(k)) {
        droppedKeys.push(k);
        delete out[k];
      }
    }
  }

  // 6) attach deterministic engine fields（engine 提供的 key 永远权威，后写覆盖）
  const eng = isPlainObject(engine) ? engine : {};
  for (const k of Object.keys(eng)) {
    if (eng[k] === undefined) continue;
    out[k] = eng[k];
  }

  // 7) 结构收尾：再 normalize 一次（engine 输出已是 canonical；narrative 缺失补 canonical 空值）
  const norm2 = normalizeAnalysis(out);
  const merged = norm2.analysis;
  for (const a of norm2.actions) repairedActions.push(`fill:${a}`);

  // 8) deterministic repair（仅 narrative/schema 结构；评分/决策/资格字段禁止伪造）
  if (!merged.interview_focus && Array.isArray(merged.cv_match_factors)) {
    const focus = deriveInterviewFocusFromFactors(merged.cv_match_factors);
    if (focus.length) {
      merged.interview_focus = focus.join('；');
      repairedActions.push('derive:interview_focus<-cv_match_factors');
    }
  }

  // 9-10) validate → 失败 = FAIL persistence（缺 engine 必需字段/枚举/量纲错误不伪造默认值）
  const v1 = validateAnalysis(merged);
  if (v1.status !== 'complete') {
    return {
      ok: false,
      analysis: merged,
      schema_status: 'invalid',
      content_status: computeContentStatus(merged).status,
      validate: v1,
      repaired_actions: repairedActions,
      overrides_removed: overridesRemoved,
      dropped_keys: droppedKeys,
      reason: `persistence rejected: ${v1.type_errors.join(';') || 'missing:' + v1.missing_sections.join(',')}`,
    };
  }

  // engine 输入自身的量纲合同：带 career_ops_score 必须带 version 2（P8 锁定在 Gate 入口）
  if (eng.career_ops_score != null && eng.score_scale_version !== 2) {
    return {
      ok: false, analysis: merged, schema_status: 'invalid',
      content_status: computeContentStatus(merged).status, validate: v1,
      repaired_actions: repairedActions, overrides_removed: overridesRemoved,
      dropped_keys: droppedKeys,
      reason: `persistence rejected: engine score_scale_version must be 2, got ${JSON.stringify(eng.score_scale_version)}`,
    };
  }

  // 11) completeness metadata（schema_status / content_status 分离；Round 2 的
  //     analysis_completeness 保留为兼容透传，SoT 移交 analysis_gate）
  const content = computeContentStatus(merged);
  merged.analysis_schema_version = ANALYSIS_SCHEMA_VERSION;
  merged.analysis_completeness = {
    status: 'complete',
    missing_sections: v1.missing_sections,
    type_errors: v1.type_errors,
    repaired: repairedActions.length > 0,
  };
  merged.analysis_gate = {
    schema_status: 'complete',
    content_status: content.status,
    content_substantive: content.substantive,
    repaired: repairedActions.length > 0,
    repaired_actions: repairedActions,
    overrides_removed: overridesRemoved,
    dropped_keys: droppedKeys,
    source: source ?? null,
    gated_at: new Date().toISOString(),
  };

  // 12) final validate（metadata 附加后对最终对象再校验一次）
  const v2 = validateAnalysis(merged);
  if (v2.status !== 'complete') {
    return {
      ok: false, analysis: merged, schema_status: 'invalid', content_status: content.status,
      validate: v2, repaired_actions: repairedActions, overrides_removed: overridesRemoved,
      dropped_keys: droppedKeys,
      reason: `persistence rejected at final validate: ${v2.type_errors.join(';') || 'missing:' + v2.missing_sections.join(',')}`,
    };
  }

  return {
    ok: true, analysis: merged, schema_status: 'complete', content_status: content.status,
    validate: v2, repaired_actions: repairedActions, overrides_removed: overridesRemoved,
    dropped_keys: droppedKeys, reason: null,
  };
}

/**
 * Writer 侧 runtime assertion（spec §6）：正式 writer 落盘前逐 job 调用；
 * 未过 Gate 的 raw analysis 必须被拒绝。三重检查：
 *   ① validateAnalysis 结构 complete（含枚举/量纲/decision_trace 契约）；
 *   ② analysis_schema_version === 2；
 *   ③ analysis_gate 存在且 schema_status === 'complete'（Gate 通过的封印——
 *      光是"validate 通过"不等于"走过 Gate"，防止调用方自盖 validate 章）。
 * 未分析行（isAnalyzed = false）不做 canonical 要求（无分析内容可校验）。
 */
export function assertCanonicalAnalysis(a) {
  if (!isPlainObject(a)) return { ok: false, errors: ['analysis not an object'] };
  if (!isAnalyzed(a)) return { ok: true, errors: [] };
  const errors = [];
  const v = validateAnalysis(a);
  if (v.status !== 'complete') {
    errors.push(...v.missing_sections.map(s => `missing:${s}`), ...v.type_errors);
  }
  if (a.analysis_schema_version !== ANALYSIS_SCHEMA_VERSION) {
    errors.push(`analysis_schema_version:${JSON.stringify(a.analysis_schema_version)}`);
  }
  const gate = a.analysis_gate;
  if (!isPlainObject(gate) || gate.schema_status !== 'complete') {
    errors.push('analysis_gate:missing-or-not-complete');
  }
  return { ok: errors.length === 0, errors };
}

/** 批次 Persistence / Completeness Summary（spec §10 的确定性聚合）。 */
export function buildBatchSummary(entries) {
  const s = {
    total: entries.length,
    schema_pass: 0,
    schema_rejected: 0,
    repaired: 0,
    rich: 0, partial: 0, sparse: 0,
    persist_rejected: 0,
    numeric_drift: 0,
    recommendation_drift: 0,
    eligibility_drift: 0,
  };
  for (const e of entries) {
    if (e?.ok) {
      s.schema_pass++;
      if (e.analysis?.analysis_gate?.repaired) s.repaired++;
      const cs = e.analysis?.analysis_gate?.content_status ?? e.content_status;
      if (cs === 'rich') s.rich++;
      else if (cs === 'partial') s.partial++;
      else s.sparse++;
      // 防住的漂移：provider 越权提供的决策字段计数（engine > model 裁剪记录）
      const rm = e.overrides_removed || [];
      if (rm.some(k => ['cv_match_score', 'cv_match_confidence', 'career_ops_score', 'career_score', 'score', 'score_breakdown', 'score_scale_version'].includes(k))) s.numeric_drift++;
      if (rm.includes('recommendation') || rm.includes('recommendation_reason')) s.recommendation_drift++;
      if (rm.includes('eligibility_status')) s.eligibility_drift++;
    } else {
      s.schema_rejected++;
      s.persist_rejected++;
    }
  }
  return s;
}

/** §10 固定文案（供 CLI 打印；数字全部来自 buildBatchSummary，不手工拼）。 */
export function formatBatchSummary(s) {
  return [
    'Batch Summary',
    `Total: ${s.total}`,
    `Schema PASS: ${s.schema_pass}/${s.total}`,
    `Repaired: ${s.repaired}`,
    `Rich: ${s.rich}`,
    `Partial: ${s.partial}`,
    `Sparse: ${s.sparse}`,
    `Rejected: ${s.persist_rejected}`,
    `Numeric Drift: ${s.numeric_drift}`,
    `Recommendation Drift: ${s.recommendation_drift}`,
    `Eligibility Drift: ${s.eligibility_drift}`,
  ].join('\n');
}
