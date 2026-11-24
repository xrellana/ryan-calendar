/**
 * 评估项目管理平台主界面渲染与交互控制器（五个子页签完整实现）
 * 1. 项目执行列表  2. 评估费用统计  3. 评估天数统计  4. 项目差旅  5. 设置
 */
(function (root) {
  'use strict';

  var WorkCal = (root.WorkCal = root.WorkCal || {});

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function createEvalUI(ctx) {
    var container = ctx.container;
    var evalStore = ctx.evalStore;
    var modals = ctx.modals;
    var showToast = ctx.showToast;
    var onDataChanged = ctx.onDataChanged;
    var Core = WorkCal.EvalCore;
    var Charts = WorkCal.EvalCharts;
    var Xlsx = WorkCal.EvalXlsx;

    function getToday() {
      return WorkCal.DateUtils ? WorkCal.DateUtils.todayStr() : Core.getTodayShanghai();
    }

    var todayInit = getToday();
    var initYear = parseInt(todayInit.slice(0, 4), 10);
    var initMonth = parseInt(todayInit.slice(5, 7), 10);
    var initQuarter = Math.floor((initMonth - 1) / 3) + 1;

    var ui = {
      activeTab: 'projects',
      openMsKey: null,

      // Tab 1: 项目执行列表筛选与排序
      pFilter: {
        query: '',
        levels: [],
        stages: [],
        statuses: [],
        settles: [],
        timeType: 'all', // all | year | quarter | month | custom
        year: initYear,
        quarter: initQuarter,
        month: todayInit.slice(0, 7),
        customStart: '',
        customEnd: ''
      },
      pSort: { field: 'start', dir: 'desc' },

      // Tab 2: 评估费用统计筛选（默认本年度 1月1日~12月31日，§15.1）
      feeFilter: {
        start: initYear + '-01-01',
        end: initYear + '-12-31',
        preset: 'year',
        levels: [],
        roles: [],
        settles: [],
        statuses: [],
        groupBy: 'month' // month | level | role | settle | status | stage
      },

      // Tab 3: 评估天数统计近期窗口（默认未来一周，§15.1）
      daysWindow: {
        mode: 'week', // today | week | month | quarter | custom
        customStart: todayInit,
        customEnd: Core.addDays(todayInit, 6)
      },

      // Tab 4: 项目差旅筛选与汇总维度
      tFilter: {
        start: '',
        end: '',
        preset: 'all',
        names: [],
        cats: [],
        reimbs: [],
        query: '',
        groupBy: 'cat' // cat | project | month | reimb
      }
    };

    // -----------------------------------------------------------------------
    // 辅助工具
    // -----------------------------------------------------------------------
    function getRangePresetDates(preset) {
      var td = getToday();
      var y = parseInt(td.slice(0, 4), 10);
      var m = parseInt(td.slice(5, 7), 10);
      if (preset === 'month') {
        var lastD = new Date(y, m, 0).getDate();
        return {
          start: y + '-' + String(m).padStart(2, '0') + '-01',
          end: y + '-' + String(m).padStart(2, '0') + '-' + String(lastD).padStart(2, '0')
        };
      }
      if (preset === 'quarter') {
        var q = Math.floor((m - 1) / 3);
        var qStartM = q * 3 + 1;
        var qEndM = qStartM + 2;
        var qLastD = new Date(y, qEndM, 0).getDate();
        return {
          start: y + '-' + String(qStartM).padStart(2, '0') + '-01',
          end: y + '-' + String(qEndM).padStart(2, '0') + '-' + String(qLastD).padStart(2, '0')
        };
      }
      if (preset === 'year') {
        return { start: y + '-01-01', end: y + '-12-31' };
      }
      return { start: '', end: '' };
    }

    function getProjectTimeRange() {
      var f = ui.pFilter;
      if (f.timeType === 'all') return { start: '', end: '' };
      if (f.timeType === 'year') {
        return { start: f.year + '-01-01', end: f.year + '-12-31' };
      }
      if (f.timeType === 'quarter') {
        var sm = (f.quarter - 1) * 3 + 1;
        var em = sm + 2;
        var ld = new Date(f.year, em, 0).getDate();
        return {
          start: f.year + '-' + String(sm).padStart(2, '0') + '-01',
          end: f.year + '-' + String(em).padStart(2, '0') + '-' + String(ld).padStart(2, '0')
        };
      }
      if (f.timeType === 'month' && /^\d{4}-\d{2}$/.test(f.month)) {
        var yy = parseInt(f.month.slice(0, 4), 10);
        var mm = parseInt(f.month.slice(5, 7), 10);
        var ldm = new Date(yy, mm, 0).getDate();
        return {
          start: f.month + '-01',
          end: f.month + '-' + String(ldm).padStart(2, '0')
        };
      }
      if (f.timeType === 'custom') {
        return { start: f.customStart || '', end: f.customEnd || '' };
      }
      return { start: '', end: '' };
    }

    function renderMultiSelect(key, label, options, selectedArr) {
      var isOpen = ui.openMsKey === key;
      var hasVal = selectedArr.length > 0;
      var btnText = !hasVal
        ? '全部' + label
        : selectedArr.length === 1
          ? label + '：' + selectedArr[0]
          : label + '：' + selectedArr[0] + ' 等 ' + selectedArr.length + ' 项';

      var panelHtml = '';
      if (isOpen) {
        var optsHtml = options.length
          ? options
              .map(function (opt) {
                var checked = selectedArr.indexOf(opt) !== -1;
                return (
                  '<label class="eval-ms-opt">' +
                  '<input type="checkbox" data-eval-ms-opt="' +
                  esc(key) +
                  '" value="' +
                  esc(opt) +
                  '"' +
                  (checked ? ' checked' : '') +
                  '>' +
                  '<span>' +
                  esc(opt) +
                  '</span>' +
                  '</label>'
                );
              })
              .join('')
          : '<div class="eval-ac-empty">暂无可选项</div>';

        panelHtml =
          '<div class="eval-ms-panel">' +
          '<div class="eval-ms-list">' +
          optsHtml +
          '</div>' +
          '<div class="eval-ms-footer">' +
          '<button type="button" class="eval-link-btn" data-eval-ms-all="' +
          esc(key) +
          '">全选</button>' +
          '<button type="button" class="eval-link-btn is-danger" data-eval-ms-clear="' +
          esc(key) +
          '">清空</button>' +
          '</div>' +
          '</div>';
      }

      return (
        '<div class="eval-ms-wrap" data-eval-ms-wrap="' +
        esc(key) +
        '">' +
        '<button type="button" class="eval-ms-btn' +
        (hasVal ? ' has-value' : '') +
        '" data-eval-ms-toggle="' +
        esc(key) +
        '">' +
        '<span>' +
        esc(btnText) +
        '</span><span class="eval-ms-caret">▾</span>' +
        '</button>' +
        panelHtml +
        '</div>'
      );
    }

    function getMultiSelectBinding(key) {
      var map = {
        p_level: { arr: ui.pFilter.levels, opts: Core.LEVELS },
        p_stage: { arr: ui.pFilter.stages, opts: Core.STAGES },
        p_status: { arr: ui.pFilter.statuses, opts: Core.PROJECT_STATUSES },
        p_settle: { arr: ui.pFilter.settles, opts: Core.SETTLE_STATUSES },
        f_level: { arr: ui.feeFilter.levels, opts: Core.LEVELS },
        f_role: { arr: ui.feeFilter.roles, opts: Core.ROLES },
        f_settle: { arr: ui.feeFilter.settles, opts: Core.SETTLE_STATUSES },
        f_status: { arr: ui.feeFilter.statuses, opts: Core.PROJECT_STATUSES },
        t_name: { arr: ui.tFilter.names, opts: getAllTravelProjectNames() },
        t_cat: { arr: ui.tFilter.cats, opts: getAllTravelCatNames() },
        t_reimb: { arr: ui.tFilter.reimbs, opts: Core.REIMB_STATUSES }
      };
      return map[key] || null;
    }

    function getAllTravelProjectNames() {
      var set = {};
      evalStore.getTravels().forEach(function (t) {
        if (t.name) set[t.name] = true;
      });
      return Object.keys(set).sort();
    }

    function getAllTravelCatNames() {
      var set = {};
      evalStore.getTravels().forEach(function (t) {
        var c = Core.getTravelDisplayCat(t);
        if (c) set[c] = true;
      });
      return Object.keys(set);
    }

    // -----------------------------------------------------------------------
    // 筛选与排序：项目执行列表（§5.4 / §5.5 / §5.7）
    // -----------------------------------------------------------------------
    function getFilteredProjects() {
      var all = evalStore.getProjects();
      var f = ui.pFilter;
      var q = f.query.trim().toLowerCase();
      var tr = getProjectTimeRange();
      var hasTime = f.timeType !== 'all' && Boolean(tr.start || tr.end);

      return all.filter(function (p) {
        if (q) {
          var hay = ((p.name || '') + ' ' + (p.note || '') + ' ' + (p.role || '')).toLowerCase();
          if (hay.indexOf(q) === -1) return false;
        }
        if (f.levels.length && f.levels.indexOf(p.level) === -1) return false;
        if (f.stages.length && f.stages.indexOf(p.stage) === -1) return false;
        if (f.statuses.length && f.statuses.indexOf(p.status) === -1) return false;
        if (f.settles.length && f.settles.indexOf(p.settle) === -1) return false;
        if (hasTime && !Core.projectIntersectsRange(p, tr.start, tr.end)) return false;
        return true;
      });
    }

    function compareNullable(a, b, dir, isNumeric) {
      var aNull = a === null || a === undefined || a === '';
      var bNull = b === null || b === undefined || b === '';
      // 空值统一沉底，无论升序降序（§5.5 / AC-28）
      if (aNull && bNull) return 0;
      if (aNull) return 1;
      if (bNull) return -1;
      var diff = isNumeric ? Number(a) - Number(b) : String(a).localeCompare(String(b), 'zh-CN');
      return dir === 'asc' ? diff : -diff;
    }

    var LEVEL_RANK = { 一级: 1, 二级: 2, 三级: 3, 四级: 4 };
    var STAGE_RANK = { 预评估: 1, 正式评估: 2 };
    var STATUS_RANK = { 待开始: 1, 进行中: 2, 已提交: 3, 已完成: 4 };
    var SETTLE_RANK = { 未结: 1, 已结: 2 };

    function sortFlatProjects(records, settings) {
      var field = ui.pSort.field;
      var dir = ui.pSort.dir;
      return records.slice().sort(function (a, b) {
        var effA = Core.calcEffectiveFee(a, settings);
        var effB = Core.calcEffectiveFee(b, settings);
        var cmp = 0;
        if (field === 'name') cmp = compareNullable(a.name, b.name, dir, false);
        else if (field === 'level') cmp = compareNullable(LEVEL_RANK[a.level], LEVEL_RANK[b.level], dir, true);
        else if (field === 'stage') cmp = compareNullable(STAGE_RANK[a.stage], STAGE_RANK[b.stage], dir, true);
        else if (field === 'start') cmp = compareNullable(a.start, b.start, dir, false);
        else if (field === 'end') cmp = compareNullable(a.end, b.end, dir, false);
        else if (field === 'days') cmp = compareNullable(effA.days, effB.days, dir, true);
        else if (field === 'status') cmp = compareNullable(STATUS_RANK[a.status], STATUS_RANK[b.status], dir, true);
        else if (field === 'fee') cmp = compareNullable(effA.fee, effB.fee, dir, true);
        else if (field === 'settle') cmp = compareNullable(SETTLE_RANK[a.settle], SETTLE_RANK[b.settle], dir, true);
        if (cmp !== 0) return cmp;
        return String(b.start || '').localeCompare(String(a.start || ''));
      });
    }

    function buildMergedProjectGroups(filteredRecords, allRecords, settings) {
      var map = {};
      var order = [];
      filteredRecords.forEach(function (r) {
        if (!map[r.name]) {
          map[r.name] = [];
          order.push(r.name);
        }
        map[r.name].push(r);
      });

      // 同时索引全量同名记录，用于计算整体状态与合并态项目级全选（§4.7 / §5.9 / AC-12）
      var fullByName = {};
      allRecords.forEach(function (r) {
        if (!fullByName[r.name]) fullByName[r.name] = [];
        fullByName[r.name].push(r);
      });

      var groups = order.map(function (name) {
        var visibleRecs = Core.sortGroupRecords(map[name]);
        var fullRecs = Core.sortGroupRecords(fullByName[name] || visibleRecs);
        var meta = Core.getMergedGroupMeta(visibleRecs, settings);
        var fullMeta = Core.getMergedGroupMeta(fullRecs, settings);
        return {
          name: name,
          records: visibleRecs,
          allRecords: fullRecs,
          meta: meta,
          overallStatus: fullMeta.status
        };
      });

      var field = ui.pSort.field;
      var dir = ui.pSort.dir;
      groups.sort(function (ga, gb) {
        var ma = ga.meta;
        var mb = gb.meta;
        var cmp = 0;
        if (field === 'name') cmp = compareNullable(ga.name, gb.name, dir, false);
        else if (field === 'level') cmp = compareNullable(LEVEL_RANK[ma.primaryLevel], LEVEL_RANK[mb.primaryLevel], dir, true);
        else if (field === 'stage') cmp = compareNullable(STAGE_RANK[ga.records[0].stage], STAGE_RANK[gb.records[0].stage], dir, true);
        else if (field === 'start') cmp = compareNullable(ma.anchorStart, mb.anchorStart, dir, false);
        else if (field === 'end') cmp = compareNullable(ma.latestEnd, mb.latestEnd, dir, false);
        else if (field === 'days') cmp = compareNullable(ma.totalDays, mb.totalDays, dir, true);
        else if (field === 'status') cmp = compareNullable(STATUS_RANK[ga.overallStatus], STATUS_RANK[gb.overallStatus], dir, true);
        else if (field === 'fee') cmp = compareNullable(ma.totalFee, mb.totalFee, dir, true);
        else if (field === 'settle') cmp = compareNullable(ma.allSettled ? 2 : 1, mb.allSettled ? 2 : 1, dir, true);
        if (cmp !== 0) return cmp;
        return compareNullable(ma.anchorStart, mb.anchorStart, 'desc', false);
      });

      return groups;
    }

    function computeProjectKPIs(records, settings) {
      var names = {};
      var inProgress = 0;
      var totalDays = 0;
      var totalFee = 0;
      var settledFee = 0;
      var unsettledFee = 0;
      var pendingRateCount = 0;

      records.forEach(function (r) {
        names[r.name] = true;
        if (r.status === '进行中') inProgress++;
        var eff = Core.calcEffectiveFee(r, settings);
        totalDays += eff.days;
        if (eff.pendingRate) {
          pendingRateCount++;
        } else if (eff.fee !== null) {
          totalFee = Core.round2(totalFee + eff.fee);
          if (r.settle === '已结') settledFee = Core.round2(settledFee + eff.fee);
          else unsettledFee = Core.round2(unsettledFee + eff.fee);
        }
      });

      return {
        projectCount: Object.keys(names).length,
        recordCount: records.length,
        inProgress: inProgress,
        totalDays: totalDays,
        totalFee: totalFee,
        settledFee: settledFee,
        unsettledFee: unsettledFee,
        pendingRateCount: pendingRateCount
      };
    }

    // -----------------------------------------------------------------------
    // Tab 1 渲染：项目执行列表（§5）
    // -----------------------------------------------------------------------
    function renderProjectsTab() {
      var all = evalStore.getProjects();
      var settings = evalStore.getSettings();
      var merged = evalStore.isMergeNames();
      var filtered = getFilteredProjects();
      var selectedIds = evalStore.getSelectedProjectIds();
      var hasSelection = selectedIds.length > 0;

      var selectedRecords = hasSelection
        ? all.filter(function (p) {
            return evalStore.isProjectSelected(p.id);
          })
        : [];
      var kpiScope = hasSelection ? selectedRecords : filtered;
      var kpi = computeProjectKPIs(kpiScope, settings);
      var totalSummary = computeProjectKPIs(filtered, settings);

      var selectedNameSet = {};
      selectedRecords.forEach(function (p) {
        selectedNameSet[p.name] = true;
      });
      var selectedProjectCount = Object.keys(selectedNameSet).length;

      // 年份下拉选项
      var yearSet = {};
      yearSet[initYear] = true;
      all.forEach(function (p) {
        if (p.start) yearSet[parseInt(p.start.slice(0, 4), 10)] = true;
        if (p.end) yearSet[parseInt(p.end.slice(0, 4), 10)] = true;
      });
      var yearOpts = Object.keys(yearSet)
        .map(Number)
        .sort(function (a, b) {
          return b - a;
        });

      var timeSubHtml = '';
      if (ui.pFilter.timeType === 'year') {
        timeSubHtml =
          '<select class="eval-filter-select" data-eval-p-time-year>' +
          yearOpts
            .map(function (y) {
              return '<option value="' + y + '"' + (y === ui.pFilter.year ? ' selected' : '') + '>' + y + '年</option>';
            })
            .join('') +
          '</select>';
      } else if (ui.pFilter.timeType === 'quarter') {
        timeSubHtml =
          '<select class="eval-filter-select" data-eval-p-time-year>' +
          yearOpts
            .map(function (y) {
              return '<option value="' + y + '"' + (y === ui.pFilter.year ? ' selected' : '') + '>' + y + '年</option>';
            })
            .join('') +
          '</select>' +
          '<select class="eval-filter-select" data-eval-p-time-quarter>' +
          [1, 2, 3, 4]
            .map(function (q) {
              return '<option value="' + q + '"' + (q === ui.pFilter.quarter ? ' selected' : '') + '>第 ' + q + ' 季度</option>';
            })
            .join('') +
          '</select>';
      } else if (ui.pFilter.timeType === 'month') {
        timeSubHtml =
          '<input type="month" class="eval-filter-date" data-eval-p-time-month value="' +
          esc(ui.pFilter.month) +
          '">';
      } else if (ui.pFilter.timeType === 'custom') {
        timeSubHtml =
          '<input type="date" class="eval-filter-date" data-eval-p-time-start value="' +
          esc(ui.pFilter.customStart) +
          '">' +
          '<span class="eval-muted">~</span>' +
          '<input type="date" class="eval-filter-date" data-eval-p-time-end value="' +
          esc(ui.pFilter.customEnd) +
          '">';
      }

      var sortHeader = function (field, label, cls) {
        var isCur = ui.pSort.field === field;
        var arrow = isCur ? (ui.pSort.dir === 'asc' ? '▲' : '▼') : '⇅';
        return (
          '<th class="is-sortable' +
          (isCur ? ' is-sorted' : '') +
          (cls ? ' ' + cls : '') +
          '" data-eval-sort="' +
          field +
          '">' +
          esc(label) +
          '<span class="eval-sort-arrow">' +
          arrow +
          '</span></th>'
        );
      };

      var statusSelectHtml = function (val, attrs) {
        var opts = Core.PROJECT_STATUSES.map(function (s) {
          return '<option value="' + s + '"' + (s === val ? ' selected' : '') + '>' + s + '</option>';
        }).join('');
        return '<select class="eval-badge-select st-' + esc(val) + '" ' + attrs + '>' + opts + '</select>';
      };

      var settleSelectHtml = function (val, id) {
        var opts = Core.SETTLE_STATUSES.map(function (s) {
          return '<option value="' + s + '"' + (s === val ? ' selected' : '') + '>' + s + '</option>';
        }).join('');
        return (
          '<select class="eval-badge-select st-' +
          esc(val) +
          '" data-eval-inline-settle="' +
          esc(id) +
          '">' +
          opts +
          '</select>'
        );
      };

      // 表头全选框状态
      var allVisibleTargetIds = [];
      if (merged) {
        var visNames = {};
        filtered.forEach(function (r) {
          visNames[r.name] = true;
        });
        all.forEach(function (r) {
          if (visNames[r.name]) allVisibleTargetIds.push(r.id);
        });
      } else {
        allVisibleTargetIds = filtered.map(function (r) {
          return r.id;
        });
      }
      var visSelectedCount = allVisibleTargetIds.filter(function (id) {
        return evalStore.isProjectSelected(id);
      }).length;
      var headerAllChecked = allVisibleTargetIds.length > 0 && visSelectedCount === allVisibleTargetIds.length;
      var headerIndeterminate = visSelectedCount > 0 && visSelectedCount < allVisibleTargetIds.length;

      var tbodyHtml = '';
      if (filtered.length > 0) {
        if (merged) {
          var groups = buildMergedProjectGroups(filtered, all, settings);
          groups.forEach(function (grp, gIdx) {
            var bandCls = gIdx % 2 === 1 ? ' eval-band-alt' : '';
            var fullIds = grp.allRecords.map(function (r) {
              return r.id;
            });
            var selInGrp = fullIds.filter(function (id) {
              return evalStore.isProjectSelected(id);
            }).length;
            var grpChecked = selInGrp === fullIds.length && fullIds.length > 0;
            var grpPartial = selInGrp > 0 && selInGrp < fullIds.length;
            var rowSpan = grp.records.length;

            grp.records.forEach(function (rec, rIdx) {
              var eff = Core.calcEffectiveFee(rec, settings);
              var endMod = Core.isEndDateManual(rec, settings);
              var isSelRow = evalStore.isProjectSelected(rec.id);
              var trCls =
                (rIdx === 0 && gIdx > 0 ? 'eval-group-first' : '') +
                bandCls +
                (isSelRow ? ' is-selected' : '');

              var feeCell = eff.pendingRate
                ? '<span class="eval-pending-tag">待设置</span>'
                : '<span>' +
                  esc(Core.formatMoney(eff.fee)) +
                  '</span>' +
                  (eff.isManual
                    ? '<span class="eval-mod-badge" title="' +
                      esc(
                        eff.autoFee !== null
                          ? '已手工改写；按规则应为 ¥' + Core.formatMoney(eff.autoFee)
                          : '已手工填写（该等级/角色费率未设置）'
                      ) +
                      '">改</span>'
                    : '');

              var endCell = rec.end
                ? '<span>' +
                  esc(Core.formatDateSlash(rec.end)) +
                  '</span>' +
                  (endMod ? '<span class="eval-mod-badge" title="已手动调整结束时间">改</span>' : '')
                : '<span class="eval-muted">未排期</span>';

              tbodyHtml += '<tr class="' + trCls.trim() + '">';
              if (rIdx === 0) {
                tbodyHtml +=
                  '<td class="eval-center eval-col-check" rowspan="' +
                  rowSpan +
                  '"><input type="checkbox" data-eval-p-check-group="' +
                  esc(grp.name) +
                  '" data-partial="' +
                  (grpPartial ? '1' : '0') +
                  '"' +
                  (grpChecked ? ' checked' : '') +
                  '></td>' +
                  '<td class="eval-center" rowspan="' +
                  rowSpan +
                  '">' +
                  (gIdx + 1) +
                  '</td>' +
                  '<td class="eval-project-name-cell" rowspan="' +
                  rowSpan +
                  '">' +
                  esc(grp.name) +
                  '</td>';
              }

              tbodyHtml +=
                '<td>' +
                esc(rec.level) +
                '</td>' +
                '<td>' +
                esc(rec.role) +
                '</td>' +
                '<td>' +
                esc(rec.stage) +
                '</td>' +
                '<td class="eval-nowrap">' +
                (rec.start ? esc(Core.formatDateSlash(rec.start)) : '<span class="eval-muted">未排期</span>') +
                '</td>' +
                '<td class="eval-nowrap">' +
                endCell +
                '</td>' +
                '<td class="eval-num">' +
                eff.days +
                '</td>';

              if (rIdx === 0) {
                tbodyHtml +=
                  '<td class="eval-center" rowspan="' +
                  rowSpan +
                  '">' +
                  statusSelectHtml(
                    grp.overallStatus,
                    'data-eval-inline-status="' + esc(rec.id) + '" data-sync-group="1"'
                  ) +
                  '</td>';
              }

              tbodyHtml +=
                '<td class="eval-num">' +
                feeCell +
                '</td>' +
                '<td class="eval-center">' +
                settleSelectHtml(rec.settle, rec.id) +
                '</td>' +
                '<td class="eval-ellipsis" title="' +
                esc(rec.note || '') +
                '">' +
                (rec.note ? esc(rec.note) : '<span class="eval-muted">—</span>') +
                '</td>' +
                '<td class="eval-center eval-col-action"><div class="eval-row-actions">' +
                '<button type="button" class="eval-link-btn" data-eval-edit-project="' +
                esc(rec.id) +
                '">编辑</button>' +
                '<button type="button" class="eval-link-btn is-danger" data-eval-del-project="' +
                esc(rec.id) +
                '">删除</button>' +
                '</div></td>' +
                '</tr>';
            });
          });
        } else {
          var flat = sortFlatProjects(filtered, settings);
          // 平铺态仍按项目名称分配白/浅灰交替底色（§5.7）
          var nameBandMap = {};
          var bandSeq = 0;
          flat.forEach(function (rec, idx) {
            if (nameBandMap[rec.name] === undefined) {
              nameBandMap[rec.name] = bandSeq++ % 2;
            }
            var bandCls = nameBandMap[rec.name] === 1 ? 'eval-band-alt' : '';
            var isSel = evalStore.isProjectSelected(rec.id);
            var eff = Core.calcEffectiveFee(rec, settings);
            var endMod = Core.isEndDateManual(rec, settings);

            var feeCell = eff.pendingRate
              ? '<span class="eval-pending-tag">待设置</span>'
              : '<span>' +
                esc(Core.formatMoney(eff.fee)) +
                '</span>' +
                (eff.isManual
                  ? '<span class="eval-mod-badge" title="' +
                    esc(
                      eff.autoFee !== null
                        ? '已手工改写；按规则应为 ¥' + Core.formatMoney(eff.autoFee)
                        : '已手工填写'
                    ) +
                    '">改</span>'
                  : '');

            var endCell = rec.end
              ? '<span>' +
                esc(Core.formatDateSlash(rec.end)) +
                '</span>' +
                (endMod ? '<span class="eval-mod-badge" title="已手动调整结束时间">改</span>' : '')
              : '<span class="eval-muted">未排期</span>';

            tbodyHtml +=
              '<tr class="' +
              (bandCls + (isSel ? ' is-selected' : '')).trim() +
              '">' +
              '<td class="eval-center eval-col-check"><input type="checkbox" data-eval-p-check-one="' +
              esc(rec.id) +
              '"' +
              (isSel ? ' checked' : '') +
              '></td>' +
              '<td class="eval-center">' +
              (idx + 1) +
              '</td>' +
              '<td class="eval-project-name-cell">' +
              esc(rec.name) +
              '</td>' +
              '<td>' +
              esc(rec.level) +
              '</td>' +
              '<td>' +
              esc(rec.role) +
              '</td>' +
              '<td>' +
              esc(rec.stage) +
              '</td>' +
              '<td class="eval-nowrap">' +
              (rec.start ? esc(Core.formatDateSlash(rec.start)) : '<span class="eval-muted">未排期</span>') +
              '</td>' +
              '<td class="eval-nowrap">' +
              endCell +
              '</td>' +
              '<td class="eval-num">' +
              eff.days +
              '</td>' +
              '<td class="eval-center">' +
              statusSelectHtml(rec.status, 'data-eval-inline-status="' + esc(rec.id) + '" data-sync-group="0"') +
              '</td>' +
              '<td class="eval-num">' +
              feeCell +
              '</td>' +
              '<td class="eval-center">' +
              settleSelectHtml(rec.settle, rec.id) +
              '</td>' +
              '<td class="eval-ellipsis" title="' +
              esc(rec.note || '') +
              '">' +
              (rec.note ? esc(rec.note) : '<span class="eval-muted">—</span>') +
              '</td>' +
              '<td class="eval-center eval-col-action"><div class="eval-row-actions">' +
              '<button type="button" class="eval-link-btn" data-eval-edit-project="' +
              esc(rec.id) +
              '">编辑</button>' +
              '<button type="button" class="eval-link-btn is-danger" data-eval-del-project="' +
              esc(rec.id) +
              '">删除</button>' +
              '</div></td>' +
              '</tr>';
          });
        }
      }

      var tableAreaHtml = '';
      if (all.length === 0) {
        tableAreaHtml =
          '<div class="eval-empty-state">' +
          '<div class="eval-empty-title">还没有评估项目</div>' +
          '<div>新建项目后将自动按起止时间同步到工作日程（类别：外出评估），也可一键导入历史 Excel 台账。</div>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;">' +
          '<button type="button" class="btn btn-primary btn-sm" data-eval-action="new-project">+ 新建项目</button>' +
          '<button type="button" class="btn btn-outline btn-sm" data-eval-action="import-projects">导入 Excel</button>' +
          '<button type="button" class="btn btn-subtle btn-sm" data-eval-action="load-sample-projects">载入示例数据</button>' +
          '</div>' +
          '</div>';
      } else if (filtered.length === 0) {
        tableAreaHtml =
          '<div class="eval-empty-state">' +
          '<div class="eval-empty-title">没有符合条件的项目</div>' +
          '<div>请调整上方筛选条件或点击重置恢复全部列表。</div>' +
          '<button type="button" class="btn btn-outline btn-sm" data-eval-action="reset-p-filter">重置筛选</button>' +
          '</div>';
      } else {
        var totalPrefix = hasSelection ? '全部 ' : '';
        tableAreaHtml =
          '<div class="eval-table-wrap">' +
          '<table class="eval-table">' +
          '<thead><tr>' +
          '<th class="eval-center eval-col-check" style="width:40px;"><input type="checkbox" id="eval-p-check-all" data-indeterminate="' +
          (headerIndeterminate ? '1' : '0') +
          '"' +
          (headerAllChecked ? ' checked' : '') +
          '></th>' +
          '<th class="eval-center" style="width:52px;">序号</th>' +
          sortHeader('name', '项目名称', 'eval-center') +
          sortHeader('level', '等级', '') +
          '<th style="width:58px;">角色</th>' +
          sortHeader('stage', '评估阶段', '') +
          sortHeader('start', '开始时间', '') +
          sortHeader('end', '结束时间', '') +
          sortHeader('days', '天数', 'eval-num') +
          sortHeader('status', '项目状态', 'eval-center') +
          sortHeader('fee', '评估费用（元）', 'eval-num') +
          sortHeader('settle', '费用状态', 'eval-center') +
          '<th>备注</th>' +
          '<th class="eval-center eval-col-action" style="width:96px;">操作</th>' +
          '</tr></thead>' +
          '<tbody>' +
          tbodyHtml +
          '</tbody>' +
          '<tfoot><tr>' +
          '<td colspan="8">合计（' +
          totalPrefix +
          totalSummary.projectCount +
          ' 个项目 / ' +
          totalSummary.recordCount +
          ' 条记录）</td>' +
          '<td class="eval-num">' +
          totalSummary.totalDays +
          '</td>' +
          '<td></td>' +
          '<td class="eval-num">¥' +
          esc(Core.formatMoney(totalSummary.totalFee)) +
          '</td>' +
          '<td colspan="3">' +
          (totalSummary.pendingRateCount > 0
            ? '<span class="eval-pending-tag">' + totalSummary.pendingRateCount + ' 条费率待设置</span>'
            : '') +
          '</td>' +
          '</tr></tfoot>' +
          '</table>' +
          '</div>';
      }

      var batchBarHtml = hasSelection
        ? '<div class="eval-batch-bar">' +
          '<span class="eval-batch-info">已选 ' +
          selectedProjectCount +
          ' 个项目 · ' +
          selectedRecords.length +
          ' 条记录</span>' +
          '<div class="eval-batch-groups">' +
          '<div class="eval-batch-group"><span class="eval-batch-label">项目状态设为：</span>' +
          Core.PROJECT_STATUSES.map(function (st) {
            return (
              '<button type="button" class="eval-batch-btn" data-eval-batch-p-status="' +
              st +
              '">' +
              st +
              '</button>'
            );
          }).join('') +
          '</div>' +
          '<div class="eval-batch-group"><span class="eval-batch-label">费用状态设为：</span>' +
          Core.SETTLE_STATUSES.map(function (se) {
            return (
              '<button type="button" class="eval-batch-btn" data-eval-batch-p-settle="' +
              se +
              '">' +
              se +
              '</button>'
            );
          }).join('') +
          '</div>' +
          '<button type="button" class="eval-link-btn is-danger" data-eval-action="clear-p-sel">取消选择</button>' +
          '</div>' +
          '</div>'
        : '';

      return (
        '<div class="eval-meta-bar">' +
        '<div class="eval-meta-left">' +
        (hasSelection
          ? '<span class="eval-scope-pill">统计范围：已选 ' +
            selectedProjectCount +
            ' 个项目 · ' +
            selectedRecords.length +
            ' 条记录<button type="button" class="eval-scope-clear" data-eval-action="clear-p-sel" title="清除勾选">✕</button></span>' +
            '<span>更新于 ' +
            esc(evalStore.getLastRefreshedAt()) +
            '</span>'
          : '<span>当前展示 ' +
            totalSummary.projectCount +
            ' 个项目 · ' +
            totalSummary.recordCount +
            ' 条评估记录 · 更新于 ' +
            esc(evalStore.getLastRefreshedAt()) +
            '</span>') +
        '</div>' +
        '<div class="eval-meta-right">' +
        '<button type="button" class="btn btn-outline btn-sm" data-eval-action="refresh">刷新</button>' +
        '<button type="button" class="btn btn-outline btn-sm" data-eval-action="import-projects">导入 Excel</button>' +
        '<button type="button" class="btn btn-outline btn-sm" data-eval-action="export-projects">导出 Excel</button>' +
        '</div>' +
        '</div>' +
        '<div class="eval-kpi-grid' +
        (hasSelection ? ' is-selected-scope' : '') +
        '">' +
        '<div class="eval-kpi-card"><div class="eval-kpi-label">项目数</div><div class="eval-kpi-value">' +
        kpi.projectCount +
        '</div><div class="eval-kpi-sub">' +
        kpi.recordCount +
        ' 条评估记录</div></div>' +
        '<div class="eval-kpi-card"><div class="eval-kpi-label">进行中</div><div class="eval-kpi-value is-blue">' +
        kpi.inProgress +
        '</div><div class="eval-kpi-sub">状态为进行中</div></div>' +
        '<div class="eval-kpi-card"><div class="eval-kpi-label">评估天数合计</div><div class="eval-kpi-value">' +
        kpi.totalDays +
        ' 天</div><div class="eval-kpi-sub">所有列示项目</div></div>' +
        '<div class="eval-kpi-card"><div class="eval-kpi-label">评估费用合计</div><div class="eval-kpi-value">¥' +
        esc(Core.formatMoney(kpi.totalFee)) +
        '</div><div class="eval-kpi-sub">' +
        (kpi.pendingRateCount > 0 ? kpi.pendingRateCount + ' 个项目费率待设置' : '按当前费率计算') +
        '</div></div>' +
        '<div class="eval-kpi-card"><div class="eval-kpi-label">已结</div><div class="eval-kpi-value is-green">¥' +
        esc(Core.formatMoney(kpi.settledFee)) +
        '</div><div class="eval-kpi-sub">费用已结算</div></div>' +
        '<div class="eval-kpi-card"><div class="eval-kpi-label">未结</div><div class="eval-kpi-value is-orange">¥' +
        esc(Core.formatMoney(kpi.unsettledFee)) +
        '</div><div class="eval-kpi-sub">费用待结算</div></div>' +
        '</div>' +
        '<div class="eval-card is-filter-card">' +
        '<div class="eval-filter-row">' +
        '<div class="eval-filter-controls">' +
        '<input type="search" class="eval-filter-input" id="eval-p-search" placeholder="搜索项目名称、备注或角色..." value="' +
        esc(ui.pFilter.query) +
        '">' +
        renderMultiSelect('p_level', '等级', Core.LEVELS, ui.pFilter.levels) +
        renderMultiSelect('p_stage', '阶段', Core.STAGES, ui.pFilter.stages) +
        renderMultiSelect('p_status', '项目状态', Core.PROJECT_STATUSES, ui.pFilter.statuses) +
        renderMultiSelect('p_settle', '费用状态', Core.SETTLE_STATUSES, ui.pFilter.settles) +
        '<select class="eval-filter-select" data-eval-p-time-type>' +
        '<option value="all"' +
        (ui.pFilter.timeType === 'all' ? ' selected' : '') +
        '>全部时间</option>' +
        '<option value="year"' +
        (ui.pFilter.timeType === 'year' ? ' selected' : '') +
        '>按年</option>' +
        '<option value="quarter"' +
        (ui.pFilter.timeType === 'quarter' ? ' selected' : '') +
        '>按季</option>' +
        '<option value="month"' +
        (ui.pFilter.timeType === 'month' ? ' selected' : '') +
        '>按月</option>' +
        '<option value="custom"' +
        (ui.pFilter.timeType === 'custom' ? ' selected' : '') +
        '>自定义区间</option>' +
        '</select>' +
        timeSubHtml +
        '<button type="button" class="btn btn-subtle btn-sm" data-eval-action="reset-p-filter">重置</button>' +
        '</div>' +
        '<label class="eval-toggle">' +
        '<input type="checkbox" id="eval-merge-toggle"' +
        (merged ? ' checked' : '') +
        '>' +
        '<span class="eval-toggle-slider"></span>' +
        '<span>合并同名项目</span>' +
        '</label>' +
        '</div>' +
        '</div>' +
        '<div class="eval-card">' +
        batchBarHtml +
        tableAreaHtml +
        '</div>'
      );
    }

    // -----------------------------------------------------------------------
    // Tab 2 渲染：评估费用统计（§7）
    // -----------------------------------------------------------------------
    function renderFeeStatsTab() {
      var all = evalStore.getProjects();
      var settings = evalStore.getSettings();
      var f = ui.feeFilter;

      // 按开始时间判断落在区间内（§7.1）
      var list = all.filter(function (p) {
        if (f.start || f.end) {
          if (!Core.isValidDateStr(p.start)) return false;
          if (f.start && p.start < f.start) return false;
          if (f.end && p.start > f.end) return false;
        }
        if (f.levels.length && f.levels.indexOf(p.level) === -1) return false;
        if (f.roles.length && f.roles.indexOf(p.role) === -1) return false;
        if (f.settles.length && f.settles.indexOf(p.settle) === -1) return false;
        if (f.statuses.length && f.statuses.indexOf(p.status) === -1) return false;
        return true;
      });

      var totalDays = 0;
      var totalFee = 0;
      var settledFee = 0;
      var unsettledFee = 0;
      var unsettledCount = 0;
      var pendingCount = 0;
      var monthMap = {};
      var groupMap = {};

      list.forEach(function (p) {
        var eff = Core.calcEffectiveFee(p, settings);
        totalDays += eff.days;
        if (p.settle === '未结') unsettledCount++;

        var feeVal = eff.pendingRate ? 0 : eff.fee || 0;
        if (eff.pendingRate) {
          pendingCount++;
        } else {
          totalFee = Core.round2(totalFee + feeVal);
          if (p.settle === '已结') settledFee = Core.round2(settledFee + feeVal);
          else unsettledFee = Core.round2(unsettledFee + feeVal);
        }

        // 月度费用按开始时间归属（§4.8 / AC-21）
        if (Core.isValidDateStr(p.start) && !eff.pendingRate) {
          var ym = p.start.slice(0, 7);
          if (!monthMap[ym]) monthMap[ym] = { month: ym, total: 0, settled: 0, unsettled: 0 };
          monthMap[ym].total = Core.round2(monthMap[ym].total + feeVal);
          if (p.settle === '已结') monthMap[ym].settled = Core.round2(monthMap[ym].settled + feeVal);
          else monthMap[ym].unsettled = Core.round2(monthMap[ym].unsettled + feeVal);
        }

        var gKey = '';
        if (f.groupBy === 'month') gKey = Core.isValidDateStr(p.start) ? p.start.slice(0, 7) : '未排期';
        else if (f.groupBy === 'level') gKey = p.level;
        else if (f.groupBy === 'role') gKey = p.role;
        else if (f.groupBy === 'settle') gKey = p.settle;
        else if (f.groupBy === 'status') gKey = p.status;
        else gKey = p.stage;

        if (!groupMap[gKey]) {
          groupMap[gKey] = { key: gKey, count: 0, days: 0, fee: 0, settled: 0, unsettled: 0 };
        }
        groupMap[gKey].count++;
        groupMap[gKey].days += eff.days;
        if (!eff.pendingRate) {
          groupMap[gKey].fee = Core.round2(groupMap[gKey].fee + feeVal);
          if (p.settle === '已结') groupMap[gKey].settled = Core.round2(groupMap[gKey].settled + feeVal);
          else groupMap[gKey].unsettled = Core.round2(groupMap[gKey].unsettled + feeVal);
        }
      });

      var settledPct = totalFee > 0 ? ((settledFee / totalFee) * 100).toFixed(1) : '0.0';
      var unsettledPct = totalFee > 0 ? ((unsettledFee / totalFee) * 100).toFixed(1) : '0.0';

      var monthlyRows = Object.keys(monthMap)
        .sort()
        .map(function (k) {
          return monthMap[k];
        });

      var groupRows = Object.keys(groupMap)
        .map(function (k) {
          return groupMap[k];
        })
        .sort(function (a, b) {
          return b.fee - a.fee;
        });

      var dims = [
        { k: 'month', l: '按年月' },
        { k: 'level', l: '按项目等级' },
        { k: 'role', l: '按角色' },
        { k: 'settle', l: '按费用状态' },
        { k: 'status', l: '按项目状态' },
        { k: 'stage', l: '按评估阶段' }
      ];

      var groupTableRows = groupRows.length
        ? groupRows
            .map(function (g) {
              var pct = totalFee > 0 ? ((g.fee / totalFee) * 100).toFixed(1) + '%' : '0.0%';
              return (
                '<tr>' +
                '<td><strong>' +
                esc(g.key) +
                '</strong></td>' +
                '<td class="eval-num">' +
                g.count +
                '</td>' +
                '<td class="eval-num">' +
                g.days +
                ' 天</td>' +
                '<td class="eval-num">¥' +
                esc(Core.formatMoney(g.fee)) +
                '</td>' +
                '<td class="eval-num" style="color:#15803d;">¥' +
                esc(Core.formatMoney(g.settled)) +
                '</td>' +
                '<td class="eval-num" style="color:#c2410c;">¥' +
                esc(Core.formatMoney(g.unsettled)) +
                '</td>' +
                '<td class="eval-num">' +
                pct +
                '</td>' +
                '</tr>'
              );
            })
            .join('')
        : '<tr><td colspan="7" class="eval-center eval-muted" style="padding:24px;">当前筛选条件下暂无费用记录</td></tr>';

      return (
        '<div class="eval-card is-filter-card">' +
        '<div class="eval-filter-row">' +
        '<div class="eval-filter-controls">' +
        '<span class="eval-muted">开始时间：</span>' +
        '<input type="date" class="eval-filter-date" data-eval-fee-start value="' +
        esc(f.start) +
        '">' +
        '<span class="eval-muted">~</span>' +
        '<input type="date" class="eval-filter-date" data-eval-fee-end value="' +
        esc(f.end) +
        '">' +
        '<div class="eval-segmented">' +
        [
          { k: 'month', l: '本月' },
          { k: 'quarter', l: '本季' },
          { k: 'year', l: '本年' },
          { k: 'all', l: '全部' }
        ]
          .map(function (b) {
            return (
              '<button type="button" class="eval-seg-btn' +
              (f.preset === b.k ? ' active' : '') +
              '" data-eval-fee-preset="' +
              b.k +
              '">' +
              b.l +
              '</button>'
            );
          })
          .join('') +
        '</div>' +
        renderMultiSelect('f_level', '等级', Core.LEVELS, f.levels) +
        renderMultiSelect('f_role', '角色', Core.ROLES, f.roles) +
        renderMultiSelect('f_settle', '费用状态', Core.SETTLE_STATUSES, f.settles) +
        renderMultiSelect('f_status', '项目状态', Core.PROJECT_STATUSES, f.statuses) +
        '</div>' +
        '<button type="button" class="btn btn-outline btn-sm" data-eval-action="refresh">刷新</button>' +
        '</div>' +
        '</div>' +
        '<div class="eval-kpi-grid">' +
        '<div class="eval-kpi-card"><div class="eval-kpi-label">项目数</div><div class="eval-kpi-value">' +
        list.length +
        '</div><div class="eval-kpi-sub">当前统计范围</div></div>' +
        '<div class="eval-kpi-card"><div class="eval-kpi-label">评估天数</div><div class="eval-kpi-value">' +
        totalDays +
        ' 天</div><div class="eval-kpi-sub">—</div></div>' +
        '<div class="eval-kpi-card"><div class="eval-kpi-label">评估费用合计</div><div class="eval-kpi-value">¥' +
        esc(Core.formatMoney(totalFee)) +
        '</div><div class="eval-kpi-sub">' +
        (pendingCount > 0 ? pendingCount + ' 个项目费率待设置' : '已剔除待设置项目') +
        '</div></div>' +
        '<div class="eval-kpi-card"><div class="eval-kpi-label">已结金额</div><div class="eval-kpi-value is-green">¥' +
        esc(Core.formatMoney(settledFee)) +
        '</div><div class="eval-kpi-sub">占比 ' +
        settledPct +
        '%</div></div>' +
        '<div class="eval-kpi-card"><div class="eval-kpi-label">未结金额</div><div class="eval-kpi-value is-orange">¥' +
        esc(Core.formatMoney(unsettledFee)) +
        '</div><div class="eval-kpi-sub">占比 ' +
        unsettledPct +
        '%</div></div>' +
        '<div class="eval-kpi-card"><div class="eval-kpi-label">未结项目数</div><div class="eval-kpi-value is-orange">' +
        unsettledCount +
        '</div><div class="eval-kpi-sub">费用待结算记录</div></div>' +
        '</div>' +
        '<div class="eval-card">' +
        '<div class="eval-card-head"><h3 class="eval-card-title">月度评估费用分布<span class="eval-card-sub">按项目开始时间归属月份</span></h3></div>' +
        Charts.renderMonthlyFeeChartHtml(monthlyRows) +
        '</div>' +
        '<div class="eval-card">' +
        '<div class="eval-card-head">' +
        '<h3 class="eval-card-title">分组统计表</h3>' +
        '<div class="eval-segmented">' +
        dims
          .map(function (d) {
            return (
              '<button type="button" class="eval-seg-btn' +
              (f.groupBy === d.k ? ' active' : '') +
              '" data-eval-fee-group="' +
              d.k +
              '">' +
              d.l +
              '</button>'
            );
          })
          .join('') +
        '</div>' +
        '</div>' +
        '<div class="eval-table-wrap">' +
        '<table class="eval-table">' +
        '<thead><tr><th>分组名</th><th class="eval-num">项目数</th><th class="eval-num">评估天数</th><th class="eval-num">评估费用</th><th class="eval-num">已结</th><th class="eval-num">未结</th><th class="eval-num">占比</th></tr></thead>' +
        '<tbody>' +
        groupTableRows +
        '</tbody>' +
        '</table>' +
        '</div>' +
        '</div>'
      );
    }

    // -----------------------------------------------------------------------
    // Tab 3 渲染：评估天数统计（§8）
    // -----------------------------------------------------------------------
    function getDaysWindowRange() {
      var td = getToday();
      var m = ui.daysWindow.mode;
      if (m === 'today') return { start: td, end: td, label: Core.formatDateSlash(td) };
      if (m === 'week') {
        var eW = Core.addDays(td, 6);
        return { start: td, end: eW, label: Core.formatDateSlash(td) + ' ~ ' + Core.formatDateSlash(eW) };
      }
      if (m === 'month') {
        var eM = Core.addDays(td, 29);
        return { start: td, end: eM, label: Core.formatDateSlash(td) + ' ~ ' + Core.formatDateSlash(eM) };
      }
      if (m === 'quarter') {
        var eQ = Core.addDays(td, 89);
        return { start: td, end: eQ, label: Core.formatDateSlash(td) + ' ~ ' + Core.formatDateSlash(eQ) };
      }
      var cs = ui.daysWindow.customStart || td;
      var ce = ui.daysWindow.customEnd || cs;
      return {
        start: cs,
        end: ce,
        label: Core.formatDateSlash(cs) + ' ~ ' + Core.formatDateSlash(ce)
      };
    }

    function renderDaysStatsTab() {
      var all = evalStore.getProjects();
      var td = getToday();
      var curYm = td.slice(0, 7);
      var curY = parseInt(td.slice(0, 4), 10);
      var curM = parseInt(td.slice(5, 7), 10);
      var curMonthStart = curYm + '-01';
      var curMonthEnd = curYm + '-' + String(new Date(curY, curM, 0).getDate()).padStart(2, '0');

      var win = getDaysWindowRange();

      var todayInEval = 0;
      var winInEval = 0;
      var elapsedTotal = 0;
      var thisMonthDays = 0;
      var futurePlanDays = 0;
      var allPlanDays = 0;
      var uniqueNames = {};
      var monthBucket = {};

      var progressRows = [];
      var recentRows = [];

      all.forEach(function (p) {
        uniqueNames[p.name] = true;
        if (!Core.isValidDateStr(p.start)) return;
        var effEnd = Core.isValidDateStr(p.end) && p.end >= p.start ? p.end : p.start;
        var days = Core.calcDays(p.start, effEnd);
        allPlanDays += days;

        if (p.start <= td && effEnd >= td) todayInEval++;

        var elapsed = 0;
        if (p.start <= td) {
          var capEnd = effEnd < td ? effEnd : td;
          elapsed = Core.calcDays(p.start, capEnd);
        } else {
          futurePlanDays += days;
        }
        elapsedTotal += elapsed;

        thisMonthDays += Core.calcOverlapDays(p.start, effEnd, curMonthStart, curMonthEnd);

        var pct = days > 0 ? Math.min(100, Math.round((elapsed / days) * 100)) : 0;
        var rowObj = {
          project: p,
          effEnd: effEnd,
          days: days,
          elapsed: elapsed,
          remaining: Math.max(0, days - elapsed),
          pct: pct
        };
        progressRows.push(rowObj);

        if (Core.projectIntersectsRange(p, win.start, win.end)) {
          winInEval++;
          recentRows.push(rowObj);
        }

        // 跨月按实际重叠拆分到每个自然月（§4.8 / §8.3 / AC-22）
        var sy = parseInt(p.start.slice(0, 4), 10);
        var sm = parseInt(p.start.slice(5, 7), 10);
        var ey = parseInt(effEnd.slice(0, 4), 10);
        var em = parseInt(effEnd.slice(5, 7), 10);
        var cy = sy;
        var cm = sm;
        while (cy < ey || (cy === ey && cm <= em)) {
          var ym = cy + '-' + String(cm).padStart(2, '0');
          var ms = ym + '-01';
          var me = ym + '-' + String(new Date(cy, cm, 0).getDate()).padStart(2, '0');
          var ov = Core.calcOverlapDays(p.start, effEnd, ms, me);
          if (ov > 0) {
            if (!monthBucket[ym]) {
              monthBucket[ym] = {
                month: ym,
                days: 0,
                projects: {},
                doneDays: 0,
                doingDays: 0,
                isFuture: ym > curYm
              };
            }
            monthBucket[ym].days += ov;
            monthBucket[ym].projects[p.name] = true;
            if (p.status === '已完成') monthBucket[ym].doneDays += ov;
            if (p.status === '进行中') monthBucket[ym].doingDays += ov;
          }
          cm++;
          if (cm > 12) {
            cm = 1;
            cy++;
          }
        }
      });

      recentRows.sort(function (a, b) {
        return a.project.start.localeCompare(b.project.start);
      });
      progressRows.sort(function (a, b) {
        return b.project.start.localeCompare(a.project.start);
      });

      var monthlyRows = Object.keys(monthBucket)
        .sort()
        .map(function (ym) {
          var b = monthBucket[ym];
          return {
            month: ym,
            days: b.days,
            projectCount: Object.keys(b.projects).length,
            doneDays: b.doneDays,
            doingDays: b.doingDays,
            isFuture: b.isFuture
          };
        });

      var progressBarHtml = function (pct) {
        return (
          '<div class="eval-progress-cell">' +
          '<div class="eval-progress-track"><div class="eval-progress-fill' +
          (pct >= 100 ? ' is-done' : '') +
          '" style="width:' +
          pct +
          '%;"></div></div>' +
          '<span class="eval-progress-pct">' +
          pct +
          '%</span>' +
          '</div>'
        );
      };

      var recentHtml = recentRows.length
        ? recentRows
            .map(function (r, idx) {
              var p = r.project;
              return (
                '<tr>' +
                '<td class="eval-center">' +
                (idx + 1) +
                '</td>' +
                '<td class="eval-project-name-cell">' +
                esc(p.name) +
                '</td>' +
                '<td>' +
                esc(p.level) +
                '</td>' +
                '<td>' +
                esc(p.role) +
                '</td>' +
                '<td>' +
                esc(p.stage) +
                '</td>' +
                '<td class="eval-nowrap">' +
                esc(Core.formatDateSlash(p.start)) +
                '</td>' +
                '<td class="eval-nowrap">' +
                esc(Core.formatDateSlash(r.effEnd)) +
                '</td>' +
                '<td class="eval-num">' +
                r.days +
                '</td>' +
                '<td>' +
                progressBarHtml(r.pct) +
                '</td>' +
                '<td class="eval-center"><span class="eval-pill st-' +
                esc(p.status) +
                '">' +
                esc(p.status) +
                '</span></td>' +
                '</tr>'
              );
            })
            .join('')
        : '<tr><td colspan="10" class="eval-center eval-muted" style="padding:22px;">所选时间窗口内暂无评估安排</td></tr>';

      var monthlyDetailHtml = monthlyRows.length
        ? monthlyRows
            .slice()
            .reverse()
            .map(function (m) {
              return (
                '<tr>' +
                '<td><strong>' +
                esc(m.month) +
                '</strong></td>' +
                '<td class="eval-num">' +
                m.days +
                ' 天</td>' +
                '<td class="eval-num">' +
                m.projectCount +
                ' 个</td>' +
                '<td class="eval-num">' +
                m.doneDays +
                ' 天</td>' +
                '<td class="eval-num">' +
                m.doingDays +
                ' 天</td>' +
                '</tr>'
              );
            })
            .join('')
        : '<tr><td colspan="5" class="eval-center eval-muted" style="padding:20px;">暂无月度明细</td></tr>';

      var allProgressHtml = progressRows.length
        ? progressRows
            .map(function (r, idx) {
              var p = r.project;
              return (
                '<tr>' +
                '<td class="eval-center">' +
                (idx + 1) +
                '</td>' +
                '<td class="eval-project-name-cell">' +
                esc(p.name) +
                '</td>' +
                '<td>' +
                esc(p.level) +
                '</td>' +
                '<td>' +
                esc(p.role) +
                '</td>' +
                '<td>' +
                esc(p.stage) +
                '</td>' +
                '<td class="eval-nowrap">' +
                esc(Core.formatDateSlash(p.start)) +
                '</td>' +
                '<td class="eval-nowrap">' +
                esc(Core.formatDateSlash(r.effEnd)) +
                '</td>' +
                '<td class="eval-num">' +
                r.days +
                '</td>' +
                '<td class="eval-num">' +
                r.elapsed +
                '</td>' +
                '<td class="eval-num">' +
                r.remaining +
                '</td>' +
                '<td>' +
                progressBarHtml(r.pct) +
                '</td>' +
                '<td class="eval-center"><span class="eval-pill st-' +
                esc(p.status) +
                '">' +
                esc(p.status) +
                '</span></td>' +
                '</tr>'
              );
            })
            .join('')
        : '<tr><td colspan="12" class="eval-center eval-muted" style="padding:22px;">暂无已排期项目</td></tr>';

      var winModes = [
        { k: 'today', l: '今天' },
        { k: 'week', l: '未来一周' },
        { k: 'month', l: '未来一月' },
        { k: 'quarter', l: '未来一季' },
        { k: 'custom', l: '自定义' }
      ];

      return (
        '<div class="eval-meta-bar">' +
        '<div class="eval-meta-left"><span>评估产能与排期进度统计 · 今天 ' +
        esc(Core.formatDateSlash(td)) +
        ' · 更新于 ' +
        esc(evalStore.getLastRefreshedAt()) +
        '</span></div>' +
        '<div class="eval-meta-right"><button type="button" class="btn btn-outline btn-sm" data-eval-action="refresh">刷新</button></div>' +
        '</div>' +
        '<div class="eval-kpi-grid">' +
        '<div class="eval-kpi-card"><div class="eval-kpi-label">今日在评估项目</div><div class="eval-kpi-value is-blue">' +
        todayInEval +
        '</div><div class="eval-kpi-sub">' +
        esc(Core.formatDateSlash(td)) +
        '</div></div>' +
        '<div class="eval-kpi-card"><div class="eval-kpi-label">窗口内评估项目</div><div class="eval-kpi-value">' +
        winInEval +
        '</div><div class="eval-kpi-sub">' +
        esc(win.label) +
        '</div></div>' +
        '<div class="eval-kpi-card"><div class="eval-kpi-label">累计已评估天数</div><div class="eval-kpi-value is-green">' +
        elapsedTotal +
        ' 天</div><div class="eval-kpi-sub">所有项目截至今天</div></div>' +
        '<div class="eval-kpi-card"><div class="eval-kpi-label">本月评估天数</div><div class="eval-kpi-value">' +
        thisMonthDays +
        ' 天</div><div class="eval-kpi-sub">' +
        esc(curYm) +
        '</div></div>' +
        '<div class="eval-kpi-card"><div class="eval-kpi-label">未来计划天数</div><div class="eval-kpi-value is-blue">' +
        futurePlanDays +
        ' 天</div><div class="eval-kpi-sub">尚未开始的项目</div></div>' +
        '<div class="eval-kpi-card"><div class="eval-kpi-label">全部计划天数</div><div class="eval-kpi-value">' +
        allPlanDays +
        ' 天</div><div class="eval-kpi-sub">' +
        Object.keys(uniqueNames).length +
        ' 个项目</div></div>' +
        '</div>' +
        '<div class="eval-card">' +
        '<div class="eval-card-head">' +
        '<h3 class="eval-card-title">近期评估情况<span class="eval-card-sub">' +
        esc(win.label) +
        '（按开始时间升序）</span></h3>' +
        '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
        '<div class="eval-segmented">' +
        winModes
          .map(function (wm) {
            return (
              '<button type="button" class="eval-seg-btn' +
              (ui.daysWindow.mode === wm.k ? ' active' : '') +
              '" data-eval-days-win="' +
              wm.k +
              '">' +
              wm.l +
              '</button>'
            );
          })
          .join('') +
        '</div>' +
        (ui.daysWindow.mode === 'custom'
          ? '<input type="date" class="eval-filter-date" data-eval-days-cstart value="' +
            esc(ui.daysWindow.customStart) +
            '"><span class="eval-muted">~</span><input type="date" class="eval-filter-date" data-eval-days-cend value="' +
            esc(ui.daysWindow.customEnd) +
            '">'
          : '') +
        '</div>' +
        '</div>' +
        '<div class="eval-table-wrap">' +
        '<table class="eval-table">' +
        '<thead><tr><th class="eval-center" style="width:52px;">序号</th><th class="eval-center">项目名称</th><th>等级</th><th>角色</th><th>评估阶段</th><th>开始时间</th><th>结束时间</th><th class="eval-num">天数</th><th>当前进度</th><th class="eval-center">项目状态</th></tr></thead>' +
        '<tbody>' +
        recentHtml +
        '</tbody>' +
        '</table>' +
        '</div>' +
        '</div>' +
        '<div class="eval-card">' +
        '<div class="eval-card-head"><h3 class="eval-card-title">月度评估天数分布<span class="eval-card-sub">跨月项目按实际重叠自然日拆分</span></h3></div>' +
        Charts.renderMonthlyDaysChartHtml(monthlyRows) +
        '</div>' +
        '<div class="eval-card">' +
        '<div class="eval-card-head"><h3 class="eval-card-title">月度天数明细</h3></div>' +
        '<div class="eval-table-wrap">' +
        '<table class="eval-table">' +
        '<thead><tr><th>年月</th><th class="eval-num">评估天数</th><th class="eval-num">涵盖项目数</th><th class="eval-num">已完成项目天数</th><th class="eval-num">进行中项目天数</th></tr></thead>' +
        '<tbody>' +
        monthlyDetailHtml +
        '</tbody>' +
        '</table>' +
        '</div>' +
        '</div>' +
        '<div class="eval-card">' +
        '<div class="eval-card-head"><h3 class="eval-card-title">项目执行进度与未来计划</h3></div>' +
        '<div class="eval-table-wrap is-scrollable">' +
        '<table class="eval-table">' +
        '<thead><tr><th class="eval-center" style="width:52px;">序号</th><th class="eval-center">项目名称</th><th>等级</th><th>角色</th><th>评估阶段</th><th>开始时间</th><th>结束时间</th><th class="eval-num">总天数</th><th class="eval-num">已执行</th><th class="eval-num">剩余</th><th>进度</th><th class="eval-center">项目状态</th></tr></thead>' +
        '<tbody>' +
        allProgressHtml +
        '</tbody>' +
        '</table>' +
        '</div>' +
        '</div>'
      );
    }

    // -----------------------------------------------------------------------
    // Tab 4 渲染：项目差旅（§6）
    // -----------------------------------------------------------------------
    function getFilteredTravels() {
      var all = evalStore.getTravels();
      var f = ui.tFilter;
      var q = f.query.trim().toLowerCase();

      var filtered = all.filter(function (t) {
        if (f.start && t.date < f.start) return false;
        if (f.end && t.date > f.end) return false;
        if (f.names.length && f.names.indexOf(t.name) === -1) return false;
        var dispCat = Core.getTravelDisplayCat(t);
        if (f.cats.length && f.cats.indexOf(dispCat) === -1) return false;
        if (f.reimbs.length && f.reimbs.indexOf(t.reimb) === -1) return false;
        if (q) {
          var hay = ((t.name || '') + ' ' + (t.detail || '') + ' ' + dispCat).toLowerCase();
          if (hay.indexOf(q) === -1) return false;
        }
        return true;
      });

      // 默认按差旅日期倒序排列，同日按项目名称排序（§6.3）
      filtered.sort(function (a, b) {
        if (a.date !== b.date) return b.date.localeCompare(a.date);
        return String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN');
      });
      return filtered;
    }

    function renderTravelsTab() {
      var all = evalStore.getTravels();
      var projects = evalStore.getProjects();
      var filtered = getFilteredTravels();
      var selectedIds = evalStore.getSelectedTravelIds();
      var hasSel = selectedIds.length > 0;
      var selectedList = hasSel
        ? all.filter(function (t) {
            return evalStore.isTravelSelected(t.id);
          })
        : [];
      var scopeList = hasSel ? selectedList : filtered;

      var calcTravelStats = function (list) {
        var total = 0;
        var unrep = 0;
        var unrepCnt = 0;
        var rep = 0;
        var repCnt = 0;
        var done = 0;
        var doneCnt = 0;
        var projSet = {};
        list.forEach(function (t) {
          var amt = Core.round2(t.amount);
          total = Core.round2(total + amt);
          projSet[t.name] = true;
          if (t.reimb === '未报') {
            unrep = Core.round2(unrep + amt);
            unrepCnt++;
          } else if (t.reimb === '已报') {
            rep = Core.round2(rep + amt);
            repCnt++;
          } else {
            done = Core.round2(done + amt);
            doneCnt++;
          }
        });
        return {
          total: total,
          count: list.length,
          projectCount: Object.keys(projSet).length,
          unrep: unrep,
          unrepCnt: unrepCnt,
          rep: rep,
          repCnt: repCnt,
          done: done,
          doneCnt: doneCnt,
          avg: list.length > 0 ? Core.round2(total / list.length) : 0
        };
      };

      var stats = calcTravelStats(scopeList);
      var filterTotal = calcTravelStats(filtered);

      // 差旅费用结构图（按类别降序，随勾选口径联动 §6.2 / §6.7 / AC-19）
      var catAgg = {};
      scopeList.forEach(function (t) {
        var c = Core.getTravelDisplayCat(t);
        if (!catAgg[c]) catAgg[c] = { name: c, amount: 0, count: 0 };
        catAgg[c].amount = Core.round2(catAgg[c].amount + Core.round2(t.amount));
        catAgg[c].count++;
      });
      var catChartRows = Object.keys(catAgg)
        .map(function (k) {
          var r = catAgg[k];
          r.pct = stats.total > 0 ? ((r.amount / stats.total) * 100).toFixed(1) : '0.0';
          return r;
        })
        .sort(function (a, b) {
          return b.amount - a.amount;
        });

      // 差旅汇总表（四维：cat / project / month / reimb）
      var sumMap = {};
      scopeList.forEach(function (t) {
        var gKey = '';
        if (ui.tFilter.groupBy === 'cat') gKey = Core.getTravelDisplayCat(t);
        else if (ui.tFilter.groupBy === 'project') gKey = t.name;
        else if (ui.tFilter.groupBy === 'month') gKey = String(t.date || '').slice(0, 7) || '未知';
        else gKey = t.reimb;

        if (!sumMap[gKey]) {
          sumMap[gKey] = { key: gKey, count: 0, total: 0, unrep: 0, rep: 0, done: 0 };
        }
        var amt = Core.round2(t.amount);
        sumMap[gKey].count++;
        sumMap[gKey].total = Core.round2(sumMap[gKey].total + amt);
        if (t.reimb === '未报') sumMap[gKey].unrep = Core.round2(sumMap[gKey].unrep + amt);
        else if (t.reimb === '已报') sumMap[gKey].rep = Core.round2(sumMap[gKey].rep + amt);
        else sumMap[gKey].done = Core.round2(sumMap[gKey].done + amt);
      });
      var sumRows = Object.keys(sumMap)
        .map(function (k) {
          return sumMap[k];
        })
        .sort(function (a, b) {
          return b.total - a.total;
        });

      var visSelCount = filtered.filter(function (t) {
        return evalStore.isTravelSelected(t.id);
      }).length;
      var allTChecked = filtered.length > 0 && visSelCount === filtered.length;
      var tIndeterminate = visSelCount > 0 && visSelCount < filtered.length;

      var tbodyHtml = filtered
        .map(function (t, idx) {
          var link = Core.resolveTravelDisplayLink(t, projects);
          var isSel = evalStore.isTravelSelected(t.id);
          var reimbOpts = Core.REIMB_STATUSES.map(function (r) {
            return '<option value="' + r + '"' + (r === t.reimb ? ' selected' : '') + '>' + r + '</option>';
          }).join('');
          return (
            '<tr class="' +
            (isSel ? 'is-selected' : '') +
            '">' +
            '<td class="eval-center eval-col-check"><input type="checkbox" data-eval-t-check-one="' +
            esc(t.id) +
            '"' +
            (isSel ? ' checked' : '') +
            '></td>' +
            '<td class="eval-center">' +
            (idx + 1) +
            '</td>' +
            '<td class="eval-nowrap">' +
            esc(Core.formatDateSlash(t.date)) +
            '</td>' +
            '<td class="eval-project-name-cell eval-ellipsis" title="' +
            esc(t.name) +
            '">' +
            esc(t.name) +
            '</td>' +
            '<td>' +
            esc(t.stage) +
            '</td>' +
            '<td>' +
            (link.level ? esc(link.level) : '<span class="eval-muted">—</span>') +
            '</td>' +
            '<td class="eval-nowrap">' +
            (link.planText ? esc(link.planText) : '<span class="eval-muted">—</span>') +
            '</td>' +
            '<td>' +
            esc(Core.getTravelDisplayCat(t)) +
            '</td>' +
            '<td class="eval-num">¥' +
            esc(Core.formatMoney(t.amount)) +
            '</td>' +
            '<td class="eval-ellipsis" title="' +
            esc(t.detail || '') +
            '">' +
            (t.detail ? esc(t.detail) : '<span class="eval-muted">—</span>') +
            '</td>' +
            '<td class="eval-center"><select class="eval-badge-select st-' +
            esc(t.reimb) +
            '" data-eval-inline-reimb="' +
            esc(t.id) +
            '">' +
            reimbOpts +
            '</select></td>' +
            '<td class="eval-center eval-col-action"><div class="eval-row-actions">' +
            '<button type="button" class="eval-link-btn" data-eval-edit-travel="' +
            esc(t.id) +
            '">编辑</button>' +
            '<button type="button" class="eval-link-btn is-danger" data-eval-del-travel="' +
            esc(t.id) +
            '">删除</button>' +
            '</div></td>' +
            '</tr>'
          );
        })
        .join('');

      var batchBarHtml = hasSel
        ? '<div class="eval-batch-bar">' +
          '<span class="eval-batch-info">已选 ' +
          stats.count +
          ' 条 · 合计 ¥' +
          esc(Core.formatMoney(stats.total)) +
          '</span>' +
          '<div class="eval-batch-groups">' +
          '<div class="eval-batch-group"><span class="eval-batch-label">报销状态设为：</span>' +
          Core.REIMB_STATUSES.map(function (rb) {
            return (
              '<button type="button" class="eval-batch-btn" data-eval-batch-t-reimb="' +
              rb +
              '">' +
              rb +
              '</button>'
            );
          }).join('') +
          '</div>' +
          '<button type="button" class="eval-link-btn is-danger" data-eval-action="clear-t-sel">取消选择</button>' +
          '</div>' +
          '</div>'
        : '';

      var tableAreaHtml = '';
      if (all.length === 0) {
        tableAreaHtml =
          '<div class="eval-empty-state">' +
          '<div class="eval-empty-title">还没有差旅记录</div>' +
          '<div>登记现场交通、住宿、餐饮等支出并跟踪报销状态，支持按项目自动带出等级与评估计划。</div>' +
          '<div style="display:flex;gap:8px;margin-top:6px;">' +
          '<button type="button" class="btn btn-primary btn-sm" data-eval-action="new-travel">+ 新建差旅</button>' +
          '<button type="button" class="btn btn-outline btn-sm" data-eval-action="import-travels">导入 Excel</button>' +
          '</div>' +
          '</div>';
      } else if (filtered.length === 0) {
        tableAreaHtml =
          '<div class="eval-empty-state">' +
          '<div class="eval-empty-title">没有符合条件的差旅记录</div>' +
          '<button type="button" class="btn btn-outline btn-sm" data-eval-action="reset-t-filter">重置筛选</button>' +
          '</div>';
      } else {
        tableAreaHtml =
          '<div class="eval-table-wrap is-scrollable">' +
          '<table class="eval-table">' +
          '<thead><tr>' +
          '<th class="eval-center eval-col-check" style="width:40px;"><input type="checkbox" id="eval-t-check-all" data-indeterminate="' +
          (tIndeterminate ? '1' : '0') +
          '"' +
          (allTChecked ? ' checked' : '') +
          '></th>' +
          '<th class="eval-center" style="width:50px;">序号</th>' +
          '<th>差旅日期</th>' +
          '<th class="eval-center">项目名称</th>' +
          '<th>评估阶段</th>' +
          '<th>等级</th>' +
          '<th>评估计划</th>' +
          '<th>差旅类别</th>' +
          '<th class="eval-num">金额（元）</th>' +
          '<th>差旅具体内容</th>' +
          '<th class="eval-center">报销状态</th>' +
          '<th class="eval-center eval-col-action">操作</th>' +
          '</tr></thead>' +
          '<tbody>' +
          tbodyHtml +
          '</tbody>' +
          '<tfoot><tr>' +
          '<td colspan="8">合计（' +
          (hasSel ? '全部 ' : '') +
          filterTotal.count +
          ' 笔 / ' +
          filterTotal.projectCount +
          ' 个项目）</td>' +
          '<td class="eval-num">¥' +
          esc(Core.formatMoney(filterTotal.total)) +
          '</td>' +
          '<td colspan="3"></td>' +
          '</tr></tfoot>' +
          '</table>' +
          '</div>';
      }

      var sumRowsHtml = sumRows.length
        ? sumRows
            .map(function (r) {
              var pct = stats.total > 0 ? ((r.total / stats.total) * 100).toFixed(1) + '%' : '0.0%';
              return (
                '<tr>' +
                '<td><strong>' +
                esc(r.key) +
                '</strong></td>' +
                '<td class="eval-num">' +
                r.count +
                '</td>' +
                '<td class="eval-num">¥' +
                esc(Core.formatMoney(r.total)) +
                '</td>' +
                '<td class="eval-num" style="color:#c2410c;">¥' +
                esc(Core.formatMoney(r.unrep)) +
                '</td>' +
                '<td class="eval-num" style="color:#1d4ed8;">¥' +
                esc(Core.formatMoney(r.rep)) +
                '</td>' +
                '<td class="eval-num" style="color:#15803d;">¥' +
                esc(Core.formatMoney(r.done)) +
                '</td>' +
                '<td class="eval-num">' +
                pct +
                '</td>' +
                '</tr>'
              );
            })
            .join('')
        : '<tr><td colspan="7" class="eval-center eval-muted" style="padding:20px;">暂无差旅汇总数据</td></tr>';

      var subSuffix = hasSel ? ' · 已选 ' + stats.count + ' 笔' : '';

      return (
        '<div class="eval-meta-bar">' +
        '<div class="eval-meta-left">' +
        (hasSel
          ? '<span class="eval-scope-pill">统计范围：已选 ' +
            stats.count +
            ' 笔 · ' +
            stats.projectCount +
            ' 个项目<button type="button" class="eval-scope-clear" data-eval-action="clear-t-sel" title="清除勾选">✕</button></span>'
          : '<span>差旅支出共 ' +
            filterTotal.count +
            ' 笔 · ' +
            filterTotal.projectCount +
            ' 个项目</span>') +
        '<span>更新于 ' +
        esc(evalStore.getLastRefreshedAt()) +
        '</span>' +
        '</div>' +
        '<div class="eval-meta-right">' +
        '<button type="button" class="btn btn-outline btn-sm" data-eval-action="refresh">刷新</button>' +
        '<button type="button" class="btn btn-outline btn-sm" data-eval-action="import-travels">导入 Excel</button>' +
        '<button type="button" class="btn btn-outline btn-sm" data-eval-action="export-travels" title="导出当前筛选结果，同时可作为导入模板">导出 Excel（模板）</button>' +
        '<button type="button" class="btn btn-primary btn-sm" data-eval-action="new-travel">+ 新建差旅</button>' +
        '</div>' +
        '</div>' +
        '<div class="eval-kpi-grid cols-5' +
        (hasSel ? ' is-selected-scope' : '') +
        '">' +
        '<div class="eval-kpi-card"><div class="eval-kpi-label">差旅总额</div><div class="eval-kpi-value">¥' +
        esc(Core.formatMoney(stats.total)) +
        '</div><div class="eval-kpi-sub">' +
        stats.count +
        ' 笔 · ' +
        stats.projectCount +
        ' 个项目' +
        (hasSel ? '（已选）' : '') +
        '</div></div>' +
        '<div class="eval-kpi-card"><div class="eval-kpi-label">未报</div><div class="eval-kpi-value is-orange">¥' +
        esc(Core.formatMoney(stats.unrep)) +
        '</div><div class="eval-kpi-sub">' +
        stats.unrepCnt +
        ' 笔待报销</div></div>' +
        '<div class="eval-kpi-card"><div class="eval-kpi-label">已报待结</div><div class="eval-kpi-value is-blue">¥' +
        esc(Core.formatMoney(stats.rep)) +
        '</div><div class="eval-kpi-sub">' +
        stats.repCnt +
        ' 笔已提交</div></div>' +
        '<div class="eval-kpi-card"><div class="eval-kpi-label">已结</div><div class="eval-kpi-value is-green">¥' +
        esc(Core.formatMoney(stats.done)) +
        '</div><div class="eval-kpi-sub">' +
        stats.doneCnt +
        ' 笔已结算</div></div>' +
        '<div class="eval-kpi-card"><div class="eval-kpi-label">单笔平均</div><div class="eval-kpi-value">¥' +
        esc(Core.formatMoney(stats.avg)) +
        '</div><div class="eval-kpi-sub">' +
        (hasSel ? '所选 ' + stats.count + ' 笔平均' : '当前筛选结果') +
        '</div></div>' +
        '</div>' +
        '<div class="eval-card is-filter-card">' +
        '<div class="eval-filter-controls">' +
        '<input type="date" class="eval-filter-date" data-eval-t-start value="' +
        esc(ui.tFilter.start) +
        '">' +
        '<span class="eval-muted">~</span>' +
        '<input type="date" class="eval-filter-date" data-eval-t-end value="' +
        esc(ui.tFilter.end) +
        '">' +
        '<div class="eval-segmented">' +
        [
          { k: 'month', l: '本月' },
          { k: 'quarter', l: '本季' },
          { k: 'year', l: '本年' },
          { k: 'all', l: '全部' }
        ]
          .map(function (b) {
            return (
              '<button type="button" class="eval-seg-btn' +
              (ui.tFilter.preset === b.k ? ' active' : '') +
              '" data-eval-t-preset="' +
              b.k +
              '">' +
              b.l +
              '</button>'
            );
          })
          .join('') +
        '</div>' +
        renderMultiSelect('t_name', '项目', getAllTravelProjectNames(), ui.tFilter.names) +
        renderMultiSelect('t_cat', '类别', getAllTravelCatNames(), ui.tFilter.cats) +
        renderMultiSelect('t_reimb', '报销状态', Core.REIMB_STATUSES, ui.tFilter.reimbs) +
        '<input type="search" class="eval-filter-input" id="eval-t-search" placeholder="搜索项目、具体内容或类别..." value="' +
        esc(ui.tFilter.query) +
        '">' +
        '<button type="button" class="btn btn-subtle btn-sm" data-eval-action="reset-t-filter">重置</button>' +
        '</div>' +
        '</div>' +
        '<div class="eval-card">' +
        batchBarHtml +
        tableAreaHtml +
        '</div>' +
        '<div class="eval-card">' +
        '<div class="eval-card-head"><h3 class="eval-card-title">差旅费用结构<span class="eval-card-sub">按差旅类别金额降序' +
        esc(subSuffix) +
        '</span></h3></div>' +
        Charts.renderTravelCategoryChartHtml(catChartRows) +
        '</div>' +
        '<div class="eval-card">' +
        '<div class="eval-card-head">' +
        '<h3 class="eval-card-title">差旅汇总<span class="eval-card-sub">占比以当前统计范围总额为分母' +
        esc(subSuffix) +
        '</span></h3>' +
        '<div class="eval-segmented">' +
        [
          { k: 'cat', l: '按差旅类别' },
          { k: 'project', l: '按项目' },
          { k: 'month', l: '按月份' },
          { k: 'reimb', l: '按报销状态' }
        ]
          .map(function (d) {
            return (
              '<button type="button" class="eval-seg-btn' +
              (ui.tFilter.groupBy === d.k ? ' active' : '') +
              '" data-eval-t-group="' +
              d.k +
              '">' +
              d.l +
              '</button>'
            );
          })
          .join('') +
        '</div>' +
        '</div>' +
        '<div class="eval-table-wrap">' +
        '<table class="eval-table">' +
        '<thead><tr><th>分组名</th><th class="eval-num">笔数</th><th class="eval-num">差旅金额</th><th class="eval-num">未报金额</th><th class="eval-num">已报金额</th><th class="eval-num">已结金额</th><th class="eval-num">占比</th></tr></thead>' +
        '<tbody>' +
        sumRowsHtml +
        '</tbody>' +
        '</table>' +
        '</div>' +
        '</div>'
      );
    }

    // -----------------------------------------------------------------------
    // Tab 5 渲染：设置（§9）
    // -----------------------------------------------------------------------
    function renderSettingsTab() {
      var s = evalStore.getSettings();
      var daysNote = {
        一级: '默认无预评估阶段',
        二级: '预评估 1 天，正式 2 天',
        三级: '预评估 2 天，正式 3 天',
        四级: '预评估 2 天，正式 4 天'
      };
      var feeNote = {
        一级: '留空则列表显示「待设置」',
        二级: '按角色取元/天单价',
        三级: '按角色取元/天单价',
        四级: '留空则列表显示「待设置」'
      };

      var daysRows = Core.LEVELS.map(function (lv) {
        var pre = s.daysRules[lv]['预评估'];
        var formal = s.daysRules[lv]['正式评估'];
        return (
          '<tr>' +
          '<td><strong>' +
          lv +
          '</strong></td>' +
          '<td><input type="number" min="1" step="1" class="eval-setting-input" data-eval-set-day="' +
          lv +
          '|预评估" placeholder="留空无此阶段" value="' +
          (pre !== null && pre !== undefined ? pre : '') +
          '"></td>' +
          '<td><input type="number" min="1" step="1" class="eval-setting-input" data-eval-set-day="' +
          lv +
          '|正式评估" placeholder="留空" value="' +
          (formal !== null && formal !== undefined ? formal : '') +
          '"></td>' +
          '<td class="eval-muted">' +
          daysNote[lv] +
          '</td>' +
          '</tr>'
        );
      }).join('');

      var rateRows = Core.LEVELS.map(function (lv) {
        var mem = s.feeRates[lv]['组员'];
        var lead = s.feeRates[lv]['组长'];
        return (
          '<tr>' +
          '<td><strong>' +
          lv +
          '</strong></td>' +
          '<td><input type="number" min="0" step="0.01" class="eval-setting-input" data-eval-set-rate="' +
          lv +
          '|组员" placeholder="待设置" value="' +
          (mem !== null && mem !== undefined ? mem : '') +
          '"></td>' +
          '<td><input type="number" min="0" step="0.01" class="eval-setting-input" data-eval-set-rate="' +
          lv +
          '|组长" placeholder="待设置" value="' +
          (lead !== null && lead !== undefined ? lead : '') +
          '"></td>' +
          '<td class="eval-muted">' +
          feeNote[lv] +
          '</td>' +
          '</tr>'
        );
      }).join('');

      return (
        '<div class="eval-settings-grid">' +
        '<div class="eval-card">' +
        '<div class="eval-card-head"><h3 class="eval-card-title">评估天数规则</h3></div>' +
        '<div class="form-hint" style="margin-bottom:10px;">按开始时间加规则天数（含首尾）自动推算结束日期，新建和编辑时仍可手动调整；预评估留空表示该等级无预评估阶段。</div>' +
        '<div class="eval-table-wrap">' +
        '<table class="eval-table">' +
        '<thead><tr><th>项目等级</th><th>预评估天数</th><th>正式评估天数</th><th>说明</th></tr></thead>' +
        '<tbody>' +
        daysRows +
        '</tbody>' +
        '</table>' +
        '</div>' +
        '</div>' +
        '<div class="eval-card">' +
        '<div class="eval-card-head"><h3 class="eval-card-title">单位评估费（元/天）</h3></div>' +
        '<div class="form-hint" style="margin-bottom:10px;">新建项目按新规则定价；已有项目天数不变、未手改的费用按新费率实时重算；已手工改过的费用不受费率变动影响。</div>' +
        '<div class="eval-table-wrap">' +
        '<table class="eval-table">' +
        '<thead><tr><th>项目等级</th><th>组员（元/天）</th><th>组长（元/天）</th><th>说明</th></tr></thead>' +
        '<tbody>' +
        rateRows +
        '</tbody>' +
        '</table>' +
        '</div>' +
        '</div>' +
        '</div>' +
        '<div class="eval-card">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">' +
        '<span class="form-hint">以上两张基础数据表仅对当前登录账号生效，云端持久化保存。</span>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
        '<button type="button" class="btn btn-outline" data-eval-action="reset-settings">恢复默认</button>' +
        '<button type="button" class="btn btn-primary" data-eval-action="save-settings">保存基础数据</button>' +
        '</div>' +
        '</div>' +
        '</div>' +
        '<div class="eval-card">' +
        '<div class="eval-card-head"><h3 class="eval-card-title">数据管理（仅作用于当前账号的评估模块）</h3></div>' +
        '<div class="form-hint" style="margin-bottom:12px;">日常与线下表格互通请使用「项目执行列表」和「项目差旅」中的 Excel 导入导出；JSON 备份兼容原单机版评估平台格式，用于完整迁移与留档（恢复/清空不会影响其他类别的工作日程）。</div>' +
        '<div class="eval-data-actions">' +
        '<button type="button" class="btn btn-outline" data-eval-action="export-eval-json">导出备份（JSON）</button>' +
        '<button type="button" class="btn btn-outline" data-eval-action="import-eval-json">导入备份（JSON）</button>' +
        '<input type="file" id="eval-json-file-input" accept=".json,application/json" class="hidden">' +
        '<button type="button" class="btn btn-danger" data-eval-action="clear-eval-all">清空全部评估数据</button>' +
        '</div>' +
        '</div>'
      );
    }

    // -----------------------------------------------------------------------
    // 总渲染入口
    // -----------------------------------------------------------------------
    function render() {
      if (!container) return;

      // 保持搜索框聚焦状态与光标位置
      var activeEl = document.activeElement;
      var activeId = activeEl && (activeEl.id === 'eval-p-search' || activeEl.id === 'eval-t-search') ? activeEl.id : null;
      var selStart = activeId ? activeEl.selectionStart : null;

      var tabs = [
        { k: 'projects', l: '项目执行列表' },
        { k: 'fee-stats', l: '评估费用统计' },
        { k: 'days-stats', l: '评估天数统计' },
        { k: 'travels', l: '项目差旅' },
        { k: 'settings', l: '设置' }
      ];

      var bodyHtml = '';
      if (ui.activeTab === 'projects') bodyHtml = renderProjectsTab();
      else if (ui.activeTab === 'fee-stats') bodyHtml = renderFeeStatsTab();
      else if (ui.activeTab === 'days-stats') bodyHtml = renderDaysStatsTab();
      else if (ui.activeTab === 'travels') bodyHtml = renderTravelsTab();
      else bodyHtml = renderSettingsTab();

      container.innerHTML =
        '<div class="eval-subnav no-print">' +
        '<div class="eval-tabs" role="tablist">' +
        tabs
          .map(function (t) {
            return (
              '<button type="button" class="eval-tab-btn' +
              (ui.activeTab === t.k ? ' active' : '') +
              '" data-eval-tab="' +
              t.k +
              '" role="tab" aria-selected="' +
              (ui.activeTab === t.k ? 'true' : 'false') +
              '">' +
              t.l +
              '</button>'
            );
          })
          .join('') +
        '</div>' +
        '<div class="eval-subnav-actions">' +
        '<button type="button" class="btn btn-primary btn-sm" data-eval-action="new-project">+ 新建项目</button>' +
        '</div>' +
        '</div>' +
        bodyHtml;

      // 设置半选复选框的 indeterminate DOM 属性
      var pAll = document.getElementById('eval-p-check-all');
      if (pAll && pAll.getAttribute('data-indeterminate') === '1') pAll.indeterminate = true;
      var tAll = document.getElementById('eval-t-check-all');
      if (tAll && tAll.getAttribute('data-indeterminate') === '1') tAll.indeterminate = true;
      var partials = container.querySelectorAll('[data-partial="1"]');
      for (var i = 0; i < partials.length; i++) partials[i].indeterminate = true;

      if (activeId) {
        var re = document.getElementById(activeId);
        if (re) {
          re.focus();
          if (selStart !== null) {
            try {
              re.setSelectionRange(selStart, selStart);
            } catch (e) {}
          }
        }
      }
    }

    // -----------------------------------------------------------------------
    // 统一事件委托
    // -----------------------------------------------------------------------
    function bindEvents() {
      // 点击外部自动收起多选下拉面板（§5.4）
      document.addEventListener('click', function (e) {
        if (!ui.openMsKey) return;
        var wrap = e.target && e.target.closest('[data-eval-ms-wrap]');
        if (!wrap || wrap.getAttribute('data-eval-ms-wrap') !== ui.openMsKey) {
          ui.openMsKey = null;
          if (!container.classList.contains('hidden')) render();
        }
      });

      container.addEventListener('click', function (e) {
        var t = e.target;

        // 切子页签
        var tabBtn = t.closest('[data-eval-tab]');
        if (tabBtn) {
          var next = tabBtn.getAttribute('data-eval-tab');
          if (next && next !== ui.activeTab) {
            ui.activeTab = next;
            ui.openMsKey = null;
            render();
          }
          return;
        }

        // 多选下拉开关
        var msToggle = t.closest('[data-eval-ms-toggle]');
        if (msToggle) {
          e.stopPropagation();
          var k = msToggle.getAttribute('data-eval-ms-toggle');
          ui.openMsKey = ui.openMsKey === k ? null : k;
          render();
          return;
        }

        var msAll = t.closest('[data-eval-ms-all]');
        if (msAll) {
          e.stopPropagation();
          var bk = getMultiSelectBinding(msAll.getAttribute('data-eval-ms-all'));
          if (bk) {
            bk.arr.length = 0;
            bk.opts.forEach(function (v) {
              bk.arr.push(v);
            });
            render();
          }
          return;
        }

        var msClr = t.closest('[data-eval-ms-clear]');
        if (msClr) {
          e.stopPropagation();
          var bk2 = getMultiSelectBinding(msClr.getAttribute('data-eval-ms-clear'));
          if (bk2) {
            bk2.arr.length = 0;
            render();
          }
          return;
        }

        // 表头排序
        var sortTh = t.closest('[data-eval-sort]');
        if (sortTh) {
          var field = sortTh.getAttribute('data-eval-sort');
          if (ui.pSort.field === field) {
            ui.pSort.dir = ui.pSort.dir === 'asc' ? 'desc' : 'asc';
          } else {
            ui.pSort.field = field;
            ui.pSort.dir = field === 'start' || field === 'end' || field === 'fee' || field === 'days' ? 'desc' : 'asc';
          }
          render();
          return;
        }

        // 费用统计快捷区间 / 分组维度
        var feePreset = t.closest('[data-eval-fee-preset]');
        if (feePreset) {
          var pk = feePreset.getAttribute('data-eval-fee-preset');
          var r = getRangePresetDates(pk);
          ui.feeFilter.preset = pk;
          ui.feeFilter.start = r.start;
          ui.feeFilter.end = r.end;
          render();
          return;
        }

        var feeGroup = t.closest('[data-eval-fee-group]');
        if (feeGroup) {
          ui.feeFilter.groupBy = feeGroup.getAttribute('data-eval-fee-group');
          render();
          return;
        }

        // 天数统计近期窗口
        var daysWin = t.closest('[data-eval-days-win]');
        if (daysWin) {
          ui.daysWindow.mode = daysWin.getAttribute('data-eval-days-win');
          render();
          return;
        }

        // 差旅快捷区间 / 汇总维度
        var tPreset = t.closest('[data-eval-t-preset]');
        if (tPreset) {
          var tpk = tPreset.getAttribute('data-eval-t-preset');
          var tr = getRangePresetDates(tpk);
          ui.tFilter.preset = tpk;
          ui.tFilter.start = tr.start;
          ui.tFilter.end = tr.end;
          render();
          return;
        }

        var tGroup = t.closest('[data-eval-t-group]');
        if (tGroup) {
          ui.tFilter.groupBy = tGroup.getAttribute('data-eval-t-group');
          render();
          return;
        }

        // 编辑 / 删除单条项目
        var editP = t.closest('[data-eval-edit-project]');
        if (editP) {
          modals.open('eval-project-editor', { projectId: editP.getAttribute('data-eval-edit-project') });
          return;
        }
        var delP = t.closest('[data-eval-del-project]');
        if (delP) {
          modals.open('confirm-delete-eval-project', { projectId: delP.getAttribute('data-eval-del-project') });
          return;
        }

        // 编辑 / 删除单条差旅
        var editT = t.closest('[data-eval-edit-travel]');
        if (editT) {
          modals.open('eval-travel-editor', { travelId: editT.getAttribute('data-eval-edit-travel') });
          return;
        }
        var delT = t.closest('[data-eval-del-travel]');
        if (delT) {
          modals.open('confirm-delete-eval-travel', { travelId: delT.getAttribute('data-eval-del-travel') });
          return;
        }

        // 批量设置项目状态（保留勾选 §5.9 / AC-11）
        var batchPStatus = t.closest('[data-eval-batch-p-status]');
        if (batchPStatus) {
          var nextSt = batchPStatus.getAttribute('data-eval-batch-p-status');
          var ids = evalStore.getSelectedProjectIds();
          if (!ids.length) return;
          evalStore
            .batchUpdateProjects(ids, { status: nextSt })
            .then(function (res) {
              onDataChanged();
              showToast(
                '已把 ' + res.projectCount + ' 个项目的 ' + res.updatedCount + ' 条记录的项目状态设为' + nextSt,
                'success'
              );
            })
            .catch(function (err) {
              showToast((err && err.message) || '批量更新失败', 'error');
            });
          return;
        }

        // 批量设置费用状态（保留勾选 §5.9 / AC-11）
        var batchPSettle = t.closest('[data-eval-batch-p-settle]');
        if (batchPSettle) {
          var nextSe = batchPSettle.getAttribute('data-eval-batch-p-settle');
          var ids2 = evalStore.getSelectedProjectIds();
          if (!ids2.length) return;
          evalStore
            .batchUpdateProjects(ids2, { settle: nextSe })
            .then(function (res) {
              onDataChanged();
              showToast(
                '已把 ' + res.projectCount + ' 个项目的 ' + res.updatedCount + ' 条记录的评估费用状态设为' + nextSe,
                'success'
              );
            })
            .catch(function (err) {
              showToast((err && err.message) || '批量更新失败', 'error');
            });
          return;
        }

        // 批量设置差旅报销状态（执行后清空勾选 §6.5 / AC-20）
        var batchTReimb = t.closest('[data-eval-batch-t-reimb]');
        if (batchTReimb) {
          var nextRb = batchTReimb.getAttribute('data-eval-batch-t-reimb');
          var tids = evalStore.getSelectedTravelIds();
          if (!tids.length) return;
          evalStore
            .batchUpdateTravels(tids, nextRb)
            .then(function (res) {
              onDataChanged();
              showToast('已将 ' + res.updatedCount + ' 笔差旅的报销状态设为' + nextRb, 'success');
            })
            .catch(function (err) {
              showToast((err && err.message) || '批量更新差旅失败', 'error');
            });
          return;
        }

        // 通用按钮动作
        var actBtn = t.closest('[data-eval-action]');
        if (!actBtn) return;
        var act = actBtn.getAttribute('data-eval-action');

        if (act === 'new-project') {
          modals.open('eval-project-editor', {});
        } else if (act === 'new-travel') {
          modals.open('eval-travel-editor', {});
        } else if (act === 'import-projects') {
          modals.open('eval-import-projects', {}, true);
        } else if (act === 'export-projects') {
          var toExp = getFilteredProjects();
          Xlsx.exportProjectsXlsx(toExp, evalStore.getSettings());
          showToast('已导出 ' + toExp.length + ' 条项目记录到 Excel', 'success');
        } else if (act === 'import-travels') {
          modals.open('eval-import-travels', {}, true);
        } else if (act === 'export-travels') {
          var tExp = getFilteredTravels();
          Xlsx.exportTravelsXlsx(tExp, evalStore.getProjects());
          showToast('已导出 ' + tExp.length + ' 笔差旅记录到 Excel（可作导入模板）', 'success');
        } else if (act === 'load-sample-projects') {
          actBtn.disabled = true;
          evalStore
            .loadSampleProjects()
            .then(function (res) {
              onDataChanged();
              showToast('已载入 ' + res.count + ' 条示例评估项目并同步至工作日程', 'success');
            })
            .catch(function (err) {
              showToast((err && err.message) || '载入示例数据失败', 'error');
            })
            .finally(function () {
              if (actBtn.isConnected) actBtn.disabled = false;
            });
        } else if (act === 'refresh') {
          evalStore
            .refreshAll()
            .then(function () {
              onDataChanged();
              showToast('已刷新最新数据与项目状态', 'success');
            })
            .catch(function (err) {
              showToast((err && err.message) || '刷新失败', 'error');
            });
        } else if (act === 'clear-p-sel') {
          evalStore.clearProjectSelection();
          render();
        } else if (act === 'clear-t-sel') {
          evalStore.clearTravelSelection();
          render();
        } else if (act === 'reset-p-filter') {
          ui.pFilter.query = '';
          ui.pFilter.levels = [];
          ui.pFilter.stages = [];
          ui.pFilter.statuses = [];
          ui.pFilter.settles = [];
          ui.pFilter.timeType = 'all';
          ui.pFilter.customStart = '';
          ui.pFilter.customEnd = '';
          evalStore.clearProjectSelection();
          render();
        } else if (act === 'reset-t-filter') {
          ui.tFilter.start = '';
          ui.tFilter.end = '';
          ui.tFilter.preset = 'all';
          ui.tFilter.names = [];
          ui.tFilter.cats = [];
          ui.tFilter.reimbs = [];
          ui.tFilter.query = '';
          evalStore.clearTravelSelection();
          render();
        } else if (act === 'save-settings') {
          var nextSettings = Core.createDefaultSettings();
          var dayInputs = container.querySelectorAll('[data-eval-set-day]');
          for (var di = 0; di < dayInputs.length; di++) {
            var dk = dayInputs[di].getAttribute('data-eval-set-day').split('|');
            var dv = dayInputs[di].value.trim();
            if (dv === '') {
              nextSettings.daysRules[dk[0]][dk[1]] = null;
            } else {
              var dn = Number(dv);
              if (!Number.isFinite(dn) || dn <= 0 || Math.floor(dn) !== dn) {
                showToast(dk[0] + dk[1] + '天数必须为正整数或留空', 'error');
                dayInputs[di].focus();
                return;
              }
              nextSettings.daysRules[dk[0]][dk[1]] = dn;
            }
          }
          var rateInputs = container.querySelectorAll('[data-eval-set-rate]');
          for (var ri = 0; ri < rateInputs.length; ri++) {
            var rk = rateInputs[ri].getAttribute('data-eval-set-rate').split('|');
            var rv = rateInputs[ri].value.trim();
            if (rv === '') {
              nextSettings.feeRates[rk[0]][rk[1]] = null;
            } else {
              var rn = Number(rv);
              if (!Number.isFinite(rn) || rn < 0) {
                showToast(rk[0] + rk[1] + '费率必须为非负数字或留空', 'error');
                rateInputs[ri].focus();
                return;
              }
              nextSettings.feeRates[rk[0]][rk[1]] = Core.round2(rn);
            }
          }
          evalStore
            .saveSettings(nextSettings)
            .then(function () {
              onDataChanged();
              showToast('基础数据已保存，现有未手改项目费用已按新费率实时重算', 'success');
            })
            .catch(function (err) {
              showToast((err && err.message) || '保存基础数据失败', 'error');
            });
        } else if (act === 'reset-settings') {
          modals.open('confirm-reset-eval-settings', {});
        } else if (act === 'export-eval-json') {
          var blob = new Blob([evalStore.exportBackupJSON()], { type: 'application/json;charset=utf-8' });
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url;
          a.download = '评估项目备份_' + getToday().replace(/-/g, '') + '.json';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(function () {
            URL.revokeObjectURL(url);
          }, 1000);
          showToast('已导出评估平台 JSON 完整备份', 'success');
        } else if (act === 'import-eval-json') {
          var fi = document.getElementById('eval-json-file-input');
          if (fi) {
            fi.value = '';
            fi.click();
          }
        } else if (act === 'clear-eval-all') {
          modals.open('confirm-clear-eval-all', {});
        }
      });

      // 搜索框即时输入
      container.addEventListener('input', function (e) {
        var t = e.target;
        if (t.id === 'eval-p-search') {
          ui.pFilter.query = t.value;
          render();
        } else if (t.id === 'eval-t-search') {
          ui.tFilter.query = t.value;
          render();
        }
      });

      // change 事件处理（复选框、行内状态下拉、日期筛选、合并开关、JSON 文件选择）
      container.addEventListener('change', function (e) {
        var t = e.target;

        if (t.hasAttribute('data-eval-ms-opt')) {
          var key = t.getAttribute('data-eval-ms-opt');
          var val = t.value;
          var bk = getMultiSelectBinding(key);
          if (bk) {
            var idx = bk.arr.indexOf(val);
            if (t.checked && idx === -1) bk.arr.push(val);
            else if (!t.checked && idx !== -1) bk.arr.splice(idx, 1);
            render();
          }
          return;
        }

        if (t.id === 'eval-merge-toggle') {
          evalStore.setMergeNames(t.checked);
          render();
          return;
        }

        // 项目全选框（合并态展开至项目全部记录 §5.9 / AC-12）
        if (t.id === 'eval-p-check-all') {
          var filtered = getFilteredProjects();
          var targetIds = [];
          if (evalStore.isMergeNames()) {
            var nameSet = {};
            filtered.forEach(function (r) {
              nameSet[r.name] = true;
            });
            evalStore.getProjects().forEach(function (r) {
              if (nameSet[r.name]) targetIds.push(r.id);
            });
          } else {
            targetIds = filtered.map(function (r) {
              return r.id;
            });
          }
          evalStore.setProjectSelected(targetIds, t.checked);
          render();
          return;
        }

        // 合并态项目组复选框（含被筛选隐藏的阶段 §5.9 / AC-12）
        if (t.hasAttribute('data-eval-p-check-group')) {
          var pName = t.getAttribute('data-eval-p-check-group');
          var groupIds = evalStore
            .getProjects()
            .filter(function (r) {
              return r.name === pName;
            })
            .map(function (r) {
              return r.id;
            });
          evalStore.setProjectSelected(groupIds, t.checked);
          render();
          return;
        }

        if (t.hasAttribute('data-eval-p-check-one')) {
          evalStore.setProjectSelected(t.getAttribute('data-eval-p-check-one'), t.checked);
          render();
          return;
        }

        // 行内项目状态修改
        if (t.hasAttribute('data-eval-inline-status')) {
          var pid = t.getAttribute('data-eval-inline-status');
          var syncGroup = t.getAttribute('data-sync-group') === '1';
          var nextStatus = t.value;
          evalStore
            .updateProject(pid, { status: nextStatus, syncGroupStatus: syncGroup })
            .then(function (res) {
              onDataChanged();
              if (syncGroup && res && res.affectedCount > 1) {
                showToast('已将该项目的 ' + res.affectedCount + ' 条记录设为' + nextStatus, 'success');
              } else {
                showToast('已更新为' + nextStatus, 'success');
              }
            })
            .catch(function (err) {
              render();
              showToast((err && err.message) || '更新状态失败', 'error');
            });
          return;
        }

        // 行内费用结算状态修改（AC-30）
        if (t.hasAttribute('data-eval-inline-settle')) {
          var spid = t.getAttribute('data-eval-inline-settle');
          var nextSettle = t.value;
          evalStore
            .updateProject(spid, { settle: nextSettle })
            .then(function () {
              onDataChanged();
              showToast('已更新为' + nextSettle, 'success');
            })
            .catch(function (err) {
              render();
              showToast((err && err.message) || '更新费用状态失败', 'error');
            });
          return;
        }

        // 项目时间筛选控件
        if (t.hasAttribute('data-eval-p-time-type')) {
          ui.pFilter.timeType = t.value;
          render();
          return;
        }
        if (t.hasAttribute('data-eval-p-time-year')) {
          ui.pFilter.year = parseInt(t.value, 10);
          render();
          return;
        }
        if (t.hasAttribute('data-eval-p-time-quarter')) {
          ui.pFilter.quarter = parseInt(t.value, 10);
          render();
          return;
        }
        if (t.hasAttribute('data-eval-p-time-month')) {
          ui.pFilter.month = t.value;
          render();
          return;
        }
        if (t.hasAttribute('data-eval-p-time-start')) {
          ui.pFilter.customStart = t.value;
          render();
          return;
        }
        if (t.hasAttribute('data-eval-p-time-end')) {
          ui.pFilter.customEnd = t.value;
          render();
          return;
        }

        // 费用统计日期筛选
        if (t.hasAttribute('data-eval-fee-start')) {
          ui.feeFilter.start = t.value;
          ui.feeFilter.preset = 'custom';
          render();
          return;
        }
        if (t.hasAttribute('data-eval-fee-end')) {
          ui.feeFilter.end = t.value;
          ui.feeFilter.preset = 'custom';
          render();
          return;
        }

        // 天数统计自定义窗口
        if (t.hasAttribute('data-eval-days-cstart')) {
          ui.daysWindow.customStart = t.value;
          render();
          return;
        }
        if (t.hasAttribute('data-eval-days-cend')) {
          ui.daysWindow.customEnd = t.value;
          render();
          return;
        }

        // 差旅日期 / 勾选 / 行内报销状态
        if (t.hasAttribute('data-eval-t-start')) {
          ui.tFilter.start = t.value;
          ui.tFilter.preset = 'custom';
          render();
          return;
        }
        if (t.hasAttribute('data-eval-t-end')) {
          ui.tFilter.end = t.value;
          ui.tFilter.preset = 'custom';
          render();
          return;
        }
        if (t.id === 'eval-t-check-all') {
          var tfIds = getFilteredTravels().map(function (x) {
            return x.id;
          });
          evalStore.setTravelSelected(tfIds, t.checked);
          render();
          return;
        }
        if (t.hasAttribute('data-eval-t-check-one')) {
          evalStore.setTravelSelected(t.getAttribute('data-eval-t-check-one'), t.checked);
          render();
          return;
        }
        if (t.hasAttribute('data-eval-inline-reimb')) {
          var tid = t.getAttribute('data-eval-inline-reimb');
          var nextR = t.value;
          evalStore
            .updateTravel(tid, { reimb: nextR })
            .then(function () {
              onDataChanged();
              showToast('已更新报销状态为' + nextR, 'success');
            })
            .catch(function (err) {
              render();
              showToast((err && err.message) || '更新报销状态失败', 'error');
            });
          return;
        }

        // 设置页 JSON 备份导入
        if (t.id === 'eval-json-file-input' && t.files && t.files[0]) {
          t.files[0]
            .text()
            .then(function (txt) {
              var parsed = JSON.parse(txt);
              if (!parsed || !Array.isArray(parsed.projects)) {
                throw new Error('JSON 备份格式无效，缺少 projects 数组');
              }
              modals.open('confirm-restore-eval-json', { backupData: parsed });
            })
            .catch(function (err) {
              showToast((err && err.message) || '无法解析 JSON 备份文件', 'error');
            });
        }
      });
    }

    bindEvents();

    return {
      render: render,
      setTab: function (tab) {
        ui.activeTab = tab;
        ui.openMsKey = null;
        render();
      },
      getTab: function () {
        return ui.activeTab;
      }
    };
  }

  WorkCal.EvalUI = {
    createEvalUI: createEvalUI
  };
})(typeof window !== 'undefined' ? window : globalThis);
