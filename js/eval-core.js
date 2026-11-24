/**
 * 评估项目管理平台核心业务规则（前后端共享，UMD）
 * 严格遵循《评估项目管理平台需求描述书 V1.0》第 3、4、6、7、8、10、12、15 章口径
 */
(function (root) {
  'use strict';

  var WorkCal = (root.WorkCal = root.WorkCal || {});

  var LEVELS = ['一级', '二级', '三级', '四级'];
  var ROLES = ['组员', '组长'];
  var STAGES = ['预评估', '正式评估'];
  var PROJECT_STATUSES = ['待开始', '进行中', '已提交', '已完成'];
  var SETTLE_STATUSES = ['未结', '已结'];
  var TRAVEL_CATS = ['打车', '高铁', '飞机', '自驾', '住宿', '餐饮', '自定义'];
  var REIMB_STATUSES = ['未报', '已报', '已结'];

  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  function createDefaultSettings() {
    return {
      daysRules: {
        一级: { 预评估: null, 正式评估: 2 },
        二级: { 预评估: 1, 正式评估: 2 },
        三级: { 预评估: 2, 正式评估: 3 },
        四级: { 预评估: 2, 正式评估: 4 }
      },
      feeRates: {
        一级: { 组员: null, 组长: null },
        二级: { 组员: 1000, 组长: 2000 },
        三级: { 组员: 1250, 组长: 3000 },
        四级: { 组员: null, 组长: null }
      }
    };
  }

  function round2(n) {
    return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  }

  function parseNullablePositiveInt(val) {
    if (val === null || val === undefined || val === '') return null;
    var n = Number(val);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.round(n);
  }

  function parseNullableNonNegMoney(val) {
    if (val === null || val === undefined || val === '') return null;
    var n = Number(val);
    if (!Number.isFinite(n) || n < 0) return null;
    return round2(n);
  }

  function normalizeSettings(raw) {
    var def = createDefaultSettings();
    var out = createDefaultSettings();
    if (!raw || typeof raw !== 'object') return out;

    var srcDays = raw.daysRules || raw.days || null;
    var srcRates = raw.feeRates || raw.rates || null;

    LEVELS.forEach(function (lv) {
      if (srcDays && srcDays[lv] && typeof srcDays[lv] === 'object') {
        STAGES.forEach(function (st) {
          if (Object.prototype.hasOwnProperty.call(srcDays[lv], st)) {
            out.daysRules[lv][st] = parseNullablePositiveInt(srcDays[lv][st]);
          } else {
            out.daysRules[lv][st] = def.daysRules[lv][st];
          }
        });
      }
      if (srcRates && srcRates[lv] && typeof srcRates[lv] === 'object') {
        ROLES.forEach(function (rl) {
          if (Object.prototype.hasOwnProperty.call(srcRates[lv], rl)) {
            out.feeRates[lv][rl] = parseNullableNonNegMoney(srcRates[lv][rl]);
          } else {
            out.feeRates[lv][rl] = def.feeRates[lv][rl];
          }
        });
      }
    });
    return out;
  }

  function isValidDateStr(s) {
    if (!DATE_RE.test(String(s || ''))) return false;
    var parts = String(s).split('-');
    var y = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10);
    var d = parseInt(parts[2], 10);
    var dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }

  function dateToUtcMs(s) {
    if (!isValidDateStr(s)) return NaN;
    var p = s.split('-');
    return Date.UTC(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
  }

  function utcMsToDateStr(ms) {
    var dt = new Date(ms);
    var y = dt.getUTCFullYear();
    var m = String(dt.getUTCMonth() + 1).padStart(2, '0');
    var d = String(dt.getUTCDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }

  function addDays(dateStr, delta) {
    var ms = dateToUtcMs(dateStr);
    if (!Number.isFinite(ms)) return '';
    return utcMsToDateStr(ms + delta * 86400000);
  }

  function diffDays(startStr, endStr) {
    var a = dateToUtcMs(startStr);
    var b = dateToUtcMs(endStr);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
    return Math.round((b - a) / 86400000);
  }

  function getTodayShanghai() {
    // 使用东八区当天日期，避免服务端 UTC 导致跨零点状态推进偏差
    var now = new Date();
    var sh = new Date(now.getTime() + 8 * 3600 * 1000);
    var y = sh.getUTCFullYear();
    var m = String(sh.getUTCMonth() + 1).padStart(2, '0');
    var d = String(sh.getUTCDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }

  function getRuleDays(level, stage, settings) {
    var cfg = settings || createDefaultSettings();
    if (!cfg.daysRules || !cfg.daysRules[level]) return null;
    var v = cfg.daysRules[level][stage];
    return v !== null && v !== undefined && Number(v) > 0 ? Math.round(Number(v)) : null;
  }

  function getUnitRate(level, role, settings) {
    var cfg = settings || createDefaultSettings();
    if (!cfg.feeRates || !cfg.feeRates[level]) return null;
    var v = cfg.feeRates[level][role];
    return v !== null && v !== undefined && Number.isFinite(Number(v)) ? round2(Number(v)) : null;
  }

  /**
   * 结束时间自动推算（§4.3）：结束时间 = 开始时间 + (规则天数 - 1)
   */
  function calcAutoEndDate(startDate, level, stage, settings) {
    if (!isValidDateStr(startDate)) return '';
    var rd = getRuleDays(level, stage, settings);
    if (!rd) return '';
    return addDays(startDate, rd - 1);
  }

  /**
   * 判断结束时间是否手动调整（§4.3 / §5.6）
   */
  function isEndDateManual(project, settings) {
    if (!project || !isValidDateStr(project.start) || !isValidDateStr(project.end)) return false;
    var autoEnd = calcAutoEndDate(project.start, project.level, project.stage, settings);
    if (!autoEnd) return false;
    return project.end !== autoEnd;
  }

  /**
   * 评估天数计算（§4.5）：自然日含首尾，不剔周末与节假日；缺失或结束早于开始计 0
   */
  function calcDays(startDate, endDate) {
    if (!isValidDateStr(startDate) || !isValidDateStr(endDate)) return 0;
    var d = diffDays(startDate, endDate);
    if (!Number.isFinite(d) || d < 0) return 0;
    return d + 1;
  }

  /**
   * 规则费用计算（§4.4）
   */
  function calcAutoFee(days, level, role, settings) {
    var rate = getUnitRate(level, role, settings);
    if (rate === null) return null;
    if (!days || days <= 0) return 0;
    return round2(days * rate);
  }

  /**
   * 生效评估费用计算（§4.4 / §12.2）
   * - 有人工值：直接取人工值，isManual = true（写入时若等于规则值已清为 null）
   * - 无人工值且费率为空：fee = null，pendingRate = true（显示“待设置”）
   * - 无人工值且天数为 0 且费率有值：fee = 0，pendingRate = false
   * - 无人工值且天数 > 0 且费率有值：fee = days * rate
   */
  function calcEffectiveFee(project, settings) {
    var days = calcDays(project.start, project.end);
    var unitRate = getUnitRate(project.level, project.role, settings);
    var autoFee = calcAutoFee(days, project.level, project.role, settings);
    var hasManual =
      project.feeManual !== null &&
      project.feeManual !== undefined &&
      project.feeManual !== '' &&
      Number.isFinite(Number(project.feeManual));

    if (hasManual) {
      var manualVal = round2(Number(project.feeManual));
      var differs = autoFee === null || Math.abs(manualVal - autoFee) >= 0.005;
      return {
        days: days,
        unitRate: unitRate,
        autoFee: autoFee,
        fee: manualVal,
        isManual: differs,
        pendingRate: false
      };
    }

    if (unitRate === null) {
      return {
        days: days,
        unitRate: null,
        autoFee: null,
        fee: null,
        isManual: false,
        pendingRate: true
      };
    }

    return {
      days: days,
      unitRate: unitRate,
      autoFee: autoFee,
      fee: autoFee,
      isManual: false,
      pendingRate: false
    };
  }

  /**
   * 写入前清洗 feeManual（§3.1 / §4.4）：若人工值与规则值相等，不记手动
   */
  function normalizeFeeManual(rawManual, days, level, role, settings) {
    if (rawManual === null || rawManual === undefined || rawManual === '') return null;
    var num = Number(rawManual);
    if (!Number.isFinite(num) || num < 0) return null;
    var val = round2(num);
    var autoFee = calcAutoFee(days, level, role, settings);
    if (autoFee !== null && Math.abs(val - autoFee) < 0.005) {
      return null;
    }
    return val;
  }

  /**
   * 两个闭区间 [s1, e1] 与 [s2, e2] 的自然日重叠天数（§4.8）
   */
  function calcOverlapDays(s1, e1, s2, e2) {
    if (!isValidDateStr(s1) || !isValidDateStr(s2) || !isValidDateStr(e2)) return 0;
    var effE1 = isValidDateStr(e1) && e1 >= s1 ? e1 : s1;
    var start = s1 > s2 ? s1 : s2;
    var end = effE1 < e2 ? effE1 : e2;
    if (end < start) return 0;
    return calcDays(start, end);
  }

  /**
   * 判断项目区间是否与查询区间 [rangeStart, rangeEnd] 有交集（§4.8 / §5.4）
   * 未排期（无 start）一律不命中
   */
  function projectIntersectsRange(project, rangeStart, rangeEnd) {
    if (!project || !isValidDateStr(project.start)) return false;
    var pEnd = isValidDateStr(project.end) && project.end >= project.start ? project.end : project.start;
    if (rangeStart && pEnd < rangeStart) return false;
    if (rangeEnd && project.start > rangeEnd) return false;
    return true;
  }

  /**
   * 合并态项目整体状态（§4.7）：有正式评估取正式评估，否则取预评估
   */
  function getMergedGroupStatus(records) {
    if (!records || !records.length) return '待开始';
    var formal = null;
    for (var i = 0; i < records.length; i++) {
      if (records[i].stage === '正式评估') formal = records[i];
    }
    if (formal) return formal.status || '待开始';
    return records[0].status || '待开始';
  }

  /**
   * 合并态项目级聚合排序基准（§1.3 / §5.5）
   */
  function getMergedGroupMeta(records, settings) {
    var preStart = '';
    var anyStart = '';
    var latestEnd = '';
    var totalDays = 0;
    var totalFee = 0;
    var hasPendingRate = false;
    var allSettled = records.length > 0;
    var levels = [];

    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      if (r.stage === '预评估' && isValidDateStr(r.start)) {
        if (!preStart || r.start < preStart) preStart = r.start;
      }
      if (isValidDateStr(r.start)) {
        if (!anyStart || r.start < anyStart) anyStart = r.start;
      }
      if (isValidDateStr(r.end)) {
        if (!latestEnd || r.end > latestEnd) latestEnd = r.end;
      }
      var eff = calcEffectiveFee(r, settings);
      totalDays += eff.days;
      if (eff.pendingRate) {
        hasPendingRate = true;
      } else if (eff.fee !== null) {
        totalFee = round2(totalFee + eff.fee);
      }
      if (r.settle !== '已结') allSettled = false;
      if (r.level) levels.push(r.level);
    }

    return {
      anchorStart: preStart || anyStart,
      latestEnd: latestEnd,
      totalDays: totalDays,
      totalFee: hasPendingRate && totalFee === 0 ? null : totalFee,
      hasPendingRate: hasPendingRate,
      status: getMergedGroupStatus(records),
      allSettled: allSettled,
      primaryLevel: levels[0] || ''
    };
  }

  /**
   * 合并态组内排序固定为：预评估在前，正式评估在后（§5.7）
   */
  function sortGroupRecords(records) {
    return records.slice().sort(function (a, b) {
      var sa = a.stage === '预评估' ? 0 : 1;
      var sb = b.stage === '预评估' ? 0 : 1;
      if (sa !== sb) return sa - sb;
      var da = a.start || '9999-99-99';
      var db = b.start || '9999-99-99';
      if (da !== db) return da.localeCompare(db);
      return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
    });
  }

  /**
   * 日期格式化展示 YYYY/MM/DD（§5.6）
   */
  function formatDateSlash(dateStr) {
    if (!isValidDateStr(dateStr)) return '';
    return dateStr.replace(/-/g, '/');
  }

  function formatPlanText(start, end) {
    if (!isValidDateStr(start)) return '';
    if (!isValidDateStr(end) || end === start) return formatDateSlash(start);
    return formatDateSlash(start) + ' ~ ' + formatDateSlash(end);
  }

  /**
   * 差旅与项目联动（§6.6 / §6.9）
   */
  function findLinkedProjectRecord(projectName, stage, travelDate, projects) {
    var targetName = String(projectName || '').trim();
    if (!targetName || !Array.isArray(projects)) return null;
    var matches = projects.filter(function (p) {
      return String(p.name || '').trim() === targetName && p.stage === stage;
    });
    if (!matches.length) return null;
    if (matches.length === 1 || !isValidDateStr(travelDate)) return matches[0];
    var best = matches[0];
    var bestDist = Infinity;
    for (var i = 0; i < matches.length; i++) {
      var d = isValidDateStr(matches[i].start) ? Math.abs(diffDays(matches[i].start, travelDate)) : Infinity;
      if (d < bestDist) {
        bestDist = d;
        best = matches[i];
      }
    }
    return best;
  }

  function findNearestStageForProject(projectName, travelDate, projects) {
    var targetName = String(projectName || '').trim();
    if (!targetName || !Array.isArray(projects)) return '预评估';
    var matches = projects.filter(function (p) {
      return String(p.name || '').trim() === targetName;
    });
    if (!matches.length) return '预评估';
    if (matches.length === 1) return matches[0].stage || '预评估';
    if (!isValidDateStr(travelDate)) {
      var hasPre = matches.some(function (p) { return p.stage === '预评估'; });
      return hasPre ? '预评估' : '正式评估';
    }
    var best = matches[0];
    var bestDist = Infinity;
    for (var i = 0; i < matches.length; i++) {
      var d = isValidDateStr(matches[i].start) ? Math.abs(diffDays(matches[i].start, travelDate)) : Infinity;
      if (d < bestDist) {
        bestDist = d;
        best = matches[i];
      }
    }
    return best.stage || '预评估';
  }

  function resolveTravelDisplayLink(travel, projects) {
    var linked = findLinkedProjectRecord(travel.name, travel.stage, travel.date, projects);
    if (linked) {
      return {
        linked: true,
        level: linked.level || travel.level || '',
        planStart: linked.start || '',
        planEnd: linked.end || '',
        planText: formatPlanText(linked.start, linked.end) || travel.planText || ''
      };
    }
    // 项目不存在或该阶段未登记：取差旅表自身缓存值（§6.9）
    var fallbackPlan = travel.planText || formatPlanText(travel.planStart, travel.planEnd);
    return {
      linked: false,
      level: travel.level || '',
      planStart: travel.planStart || '',
      planEnd: travel.planEnd || '',
      planText: fallbackPlan
    };
  }

  function getTravelDisplayCat(travel) {
    if (!travel) return '';
    if (travel.cat === '自定义') return String(travel.catCustom || '').trim() || '自定义';
    return travel.cat || '打车';
  }

  /**
   * 导入去重签名（§4.9 #10）
   */
  function projectDedupKey(p) {
    return (
      String((p && p.name) || '').trim() +
      '||' +
      String((p && p.stage) || '').trim() +
      '||' +
      String((p && p.start) || '').trim()
    );
  }

  function travelDedupKey(t) {
    var amt = Number(t && t.amount);
    var amtStr = Number.isFinite(amt) ? round2(amt).toFixed(2) : '0.00';
    return [
      String((t && t.date) || '').trim(),
      String((t && t.name) || '').trim(),
      String((t && t.stage) || '').trim(),
      getTravelDisplayCat(t),
      amtStr,
      String((t && t.detail) || '').trim()
    ].join('||');
  }

  /**
   * 联动工作日程：标题与备注拼装（已确认口径：标题保留“预评估/正式评估”）
   */
  function formatEventTitleForProject(name, stage) {
    var cleanName = String(name || '').trim();
    var cleanStage = String(stage || '').trim();
    var suffix = cleanStage ? '（' + cleanStage + '）' : '';
    var maxBaseLen = Math.max(1, 60 - suffix.length);
    if (cleanName.length > maxBaseLen) {
      cleanName = cleanName.slice(0, maxBaseLen);
    }
    return (cleanName + suffix).slice(0, 60);
  }

  function buildProjectEventNotes(project) {
    var parts = [];
    if (project.stage) parts.push('阶段：' + project.stage);
    if (project.level) parts.push('等级：' + project.level);
    if (project.role) parts.push('角色：' + project.role);
    if (project.status) parts.push('状态：' + project.status);
    if (project.note) parts.push(String(project.note).trim());
    return parts.join(' | ').slice(0, 500);
  }

  /**
   * 示例数据（§5.12 / AC-26）：7 条演示记录，含 2 个双阶段项目、费率已设/待设、不同状态
   */
  function buildSampleProjects(todayStr) {
    var base = isValidDateStr(todayStr) ? todayStr : getTodayShanghai();
    return [
      {
        name: '华东新能源装备有限公司',
        level: '三级',
        role: '组长',
        stage: '预评估',
        start: addDays(base, -18),
        end: addDays(base, -17),
        status: '已完成',
        settle: '已结',
        note: '现场访谈与体系文件初审已完成',
        feeManual: null
      },
      {
        name: '华东新能源装备有限公司',
        level: '三级',
        role: '组长',
        stage: '正式评估',
        start: addDays(base, -6),
        end: addDays(base, -4),
        status: '已完成',
        settle: '未结',
        note: '已提交评估报告，待甲方结算',
        feeManual: null
      },
      {
        name: '江南精密制造股份有限公司',
        level: '二级',
        role: '组员',
        stage: '预评估',
        start: addDays(base, -2),
        end: addDays(base, -2),
        status: '已完成',
        settle: '已结',
        note: '线上预审资料齐备',
        feeManual: null
      },
      {
        name: '江南精密制造股份有限公司',
        level: '二级',
        role: '组员',
        stage: '正式评估',
        start: addDays(base, 0),
        end: addDays(base, 1),
        status: '进行中',
        settle: '未结',
        note: '现场车间核验与访谈',
        feeManual: null
      },
      {
        name: '中科智能光电科技',
        level: '三级',
        role: '组员',
        stage: '正式评估',
        start: addDays(base, 3),
        end: addDays(base, 5),
        status: '待开始',
        settle: '未结',
        note: '按客户协议定额计费',
        feeManual: 4000
      },
      {
        name: '北辰汽车零部件集团',
        level: '四级',
        role: '组长',
        stage: '正式评估',
        start: addDays(base, 10),
        end: addDays(base, 13),
        status: '待开始',
        settle: '未结',
        note: '四级费率待确定',
        feeManual: null
      },
      {
        name: '明远纺织自动化工厂',
        level: '二级',
        role: '组长',
        stage: '正式评估',
        start: addDays(base, -12),
        end: addDays(base, -11),
        status: '已提交',
        settle: '未结',
        note: '等待评审委终审反馈',
        feeManual: null
      }
    ];
  }

  function formatMoney(n) {
    if (n === null || n === undefined || !Number.isFinite(Number(n))) return '待设置';
    return Number(n).toLocaleString('zh-CN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  WorkCal.EvalCore = {
    LEVELS: LEVELS,
    ROLES: ROLES,
    STAGES: STAGES,
    PROJECT_STATUSES: PROJECT_STATUSES,
    SETTLE_STATUSES: SETTLE_STATUSES,
    TRAVEL_CATS: TRAVEL_CATS,
    REIMB_STATUSES: REIMB_STATUSES,
    createDefaultSettings: createDefaultSettings,
    normalizeSettings: normalizeSettings,
    round2: round2,
    isValidDateStr: isValidDateStr,
    dateToUtcMs: dateToUtcMs,
    utcMsToDateStr: utcMsToDateStr,
    addDays: addDays,
    diffDays: diffDays,
    getTodayShanghai: getTodayShanghai,
    getRuleDays: getRuleDays,
    getUnitRate: getUnitRate,
    calcAutoEndDate: calcAutoEndDate,
    isEndDateManual: isEndDateManual,
    calcDays: calcDays,
    calcAutoFee: calcAutoFee,
    calcEffectiveFee: calcEffectiveFee,
    normalizeFeeManual: normalizeFeeManual,
    calcOverlapDays: calcOverlapDays,
    projectIntersectsRange: projectIntersectsRange,
    getMergedGroupStatus: getMergedGroupStatus,
    getMergedGroupMeta: getMergedGroupMeta,
    sortGroupRecords: sortGroupRecords,
    formatDateSlash: formatDateSlash,
    formatPlanText: formatPlanText,
    findLinkedProjectRecord: findLinkedProjectRecord,
    findNearestStageForProject: findNearestStageForProject,
    resolveTravelDisplayLink: resolveTravelDisplayLink,
    getTravelDisplayCat: getTravelDisplayCat,
    projectDedupKey: projectDedupKey,
    travelDedupKey: travelDedupKey,
    formatEventTitleForProject: formatEventTitleForProject,
    buildProjectEventNotes: buildProjectEventNotes,
    buildSampleProjects: buildSampleProjects,
    formatMoney: formatMoney
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = WorkCal.EvalCore;
  }
})(typeof window !== 'undefined' ? window : globalThis);
