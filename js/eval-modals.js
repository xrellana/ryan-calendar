/**
 * 评估项目管理平台弹窗组件（与主应用唯一浮层 #modal-dialog 共用）
 * 包含：
 * 1. 新建/编辑评估项目（支持从评估平台打开，也支持从工作日程选「外出评估」双向联动打开）
 * 2. 新建/编辑差旅记录（项目联想 + 日期就近阶段联动 + 两位小数金额）
 * 3. 项目执行列表 Excel 导入与预览（统一承接日程顶栏「导入台账」入口）
 * 4. 差旅 Excel 导入与预览
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

  function highlightMatch(text, query) {
    var t = String(text || '');
    var q = String(query || '').trim();
    if (!q) return esc(t);
    var idx = t.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) return esc(t);
    return (
      esc(t.slice(0, idx)) +
      '<mark class="eval-ac-hl">' +
      esc(t.slice(idx, idx + q.length)) +
      '</mark>' +
      esc(t.slice(idx + q.length))
    );
  }

  /**
   * 绑定通用联想输入控件（支持上下键、回车选中、Esc 关闭、点击外部收起）
   */
  function attachAutocomplete(inputEl, listEl, getItemsFn, onSelectFn) {
    var activeIdx = -1;
    var currentItems = [];

    function closeList() {
      listEl.classList.add('hidden');
      activeIdx = -1;
    }

    function renderList() {
      var q = inputEl.value.trim();
      currentItems = getItemsFn(q) || [];
      activeIdx = -1;
      if (!currentItems.length) {
        if (q) {
          listEl.innerHTML =
            '<div class="eval-ac-empty">无历史匹配项，可直接按当前输入「' +
            esc(q) +
            '」新建</div>';
          listEl.classList.remove('hidden');
        } else {
          listEl.classList.add('hidden');
        }
        return;
      }

      listEl.innerHTML = currentItems
        .map(function (it, idx) {
          return (
            '<div class="eval-ac-item" data-ac-idx="' +
            idx +
            '">' +
            '<span class="eval-ac-name">' +
            highlightMatch(it.name, q) +
            '</span>' +
            (it.meta ? '<span class="eval-ac-meta">' + esc(it.meta) + '</span>' : '') +
            '</div>'
          );
        })
        .join('');
      listEl.classList.remove('hidden');
    }

    function updateHighlight() {
      var nodes = listEl.querySelectorAll('.eval-ac-item');
      for (var i = 0; i < nodes.length; i++) {
        nodes[i].classList.toggle('is-active', i === activeIdx);
      }
      if (activeIdx >= 0 && nodes[activeIdx]) {
        nodes[activeIdx].scrollIntoView({ block: 'nearest' });
      }
    }

    function pick(idx) {
      var item = currentItems[idx];
      if (!item) return;
      inputEl.value = item.name;
      closeList();
      if (onSelectFn) onSelectFn(item);
    }

    inputEl.addEventListener('focus', renderList);
    inputEl.addEventListener('input', function () {
      renderList();
      if (onSelectFn) onSelectFn(null);
    });
    inputEl.addEventListener('keydown', function (e) {
      if (listEl.classList.contains('hidden')) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (currentItems.length) {
          activeIdx = (activeIdx + 1) % currentItems.length;
          updateHighlight();
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (currentItems.length) {
          activeIdx = (activeIdx - 1 + currentItems.length) % currentItems.length;
          updateHighlight();
        }
      } else if (e.key === 'Enter' && activeIdx >= 0) {
        e.preventDefault();
        pick(activeIdx);
      } else if (e.key === 'Escape') {
        e.stopPropagation();
        closeList();
      }
    });

    listEl.addEventListener('mousedown', function (e) {
      var row = e.target.closest('[data-ac-idx]');
      if (!row) return;
      e.preventDefault();
      pick(parseInt(row.getAttribute('data-ac-idx'), 10));
    });

    inputEl.addEventListener('blur', function () {
      setTimeout(closeList, 140);
    });
  }

  // =========================================================================
  // 1. 新建 / 编辑评估项目弹窗（支持评估平台 & 工作日程双向联动）
  // =========================================================================
  function renderProjectEditor(dialog, ctx) {
    var Core = WorkCal.EvalCore;
    var evalStore = ctx.evalStore;
    var calStore = ctx.store;
    var payload = ctx.payload || {};
    var settings = evalStore.getSettings();
    var today = WorkCal.DateUtils ? WorkCal.DateUtils.todayStr() : Core.getTodayShanghai();

    var editing = payload.projectId ? evalStore.getProjectById(payload.projectId) : null;
    var fromCalendar = Boolean(payload.fromCalendar);
    var calendarEventId = payload.calendarEventId || '';
    var lockedToEval = Boolean(fromCalendar && editing);
    var draft = payload.draft || null;

    var initName = draft ? draft.title || draft.name || '' : editing ? editing.name : '';
    var initLevel = editing ? editing.level : '二级';
    var initRole = editing ? editing.role : '组员';
    var initStage = editing ? editing.stage : '预评估';
    var initStart = draft
      ? draft.startDate || draft.start || today
      : editing
        ? editing.start || ''
        : payload.date || today;
    var initAutoEnd = Core.calcAutoEndDate(initStart, initLevel, initStage, settings);
    var initEnd = draft
      ? draft.endDate || draft.end || initAutoEnd
      : editing
        ? editing.end || ''
        : initAutoEnd;
    var initStatus = editing ? editing.status : '待开始';
    var initSettle = editing ? editing.settle : '未结';
    var initNote = draft ? draft.notes || draft.note || '' : editing ? editing.note || '' : '';

    var endManual = editing
      ? Core.isEndDateManual(editing, settings)
      : Boolean(draft && draft.endDate && initAutoEnd && draft.endDate !== initAutoEnd);

    var feeManualFlag = editing
      ? editing.feeManual !== null && editing.feeManual !== undefined
      : false;
    var initEff = Core.calcEffectiveFee(
      {
        start: initStart,
        end: initEnd,
        level: initLevel,
        role: initRole,
        feeManual: editing ? editing.feeManual : null
      },
      settings
    );
    var initFeeStr = initEff.fee !== null ? initEff.fee.toFixed(2) : '';

    var catRowHtml = '';
    if (fromCalendar && calStore) {
      var cats = calStore.getCategories();
      var assessId = WorkCal.Config.protectedAssessmentCategoryId || 'cat-assessment';
      var catOpts = cats
        .map(function (c) {
          return (
            '<option value="' +
            esc(c.id) +
            '"' +
            (c.id === assessId ? ' selected' : '') +
            '>' +
            esc(c.name) +
            '</option>'
          );
        })
        .join('');
      catRowHtml =
        '<div class="form-field">' +
        '<div class="form-label-row">' +
        '<label class="form-label" for="ep-cal-category">行程类别 *</label>' +
        (lockedToEval
          ? '<span class="tag-badge" style="background:#fff7ed;color:#c2410c;">已关联评估项目 · 双向同步</span>'
          : '<span class="form-hint">选择「外出评估」将同步录入评估项目管理平台</span>') +
        '</div>' +
        '<select id="ep-cal-category" class="select-control"' +
        (lockedToEval ? ' disabled' : '') +
        '>' +
        catOpts +
        '</select>' +
        '</div>';
    }

    var titleText = fromCalendar
      ? editing
        ? '编辑评估日程（同步评估项目）'
        : '新建日程 · 外出评估（同步项目台账）'
      : editing
        ? '编辑评估项目'
        : '新建评估项目';

    var optHtml = function (arr, cur) {
      return arr
        .map(function (v) {
          return '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(v) + '</option>';
        })
        .join('');
    };

    dialog.innerHTML =
      '<div class="modal-header">' +
      '<h2 id="modal-title" class="modal-title">' +
      esc(titleText) +
      '</h2>' +
      '<button type="button" class="modal-close" data-modal-action="close" aria-label="关闭">×</button>' +
      '</div>' +
      '<form id="eval-project-form" class="modal-body" novalidate>' +
      '<div id="ep-error" class="field-error hidden" role="alert"></div>' +
      catRowHtml +
      '<div class="form-field eval-ac-wrap">' +
      '<div class="form-label-row">' +
      '<label class="form-label" for="ep-name">项目名称 *</label>' +
      '<span id="ep-name-hint" class="form-hint"></span>' +
      '</div>' +
      '<input id="ep-name" type="text" class="input-control" maxlength="120" autocomplete="off" placeholder="输入项目名称，支持联想历史项目" value="' +
      esc(initName) +
      '" required>' +
      '<div id="ep-name-ac" class="eval-ac-list hidden"></div>' +
      '</div>' +
      '<div class="eval-form-grid-3">' +
      '<div class="form-field">' +
      '<label class="form-label" for="ep-level">项目等级 *</label>' +
      '<select id="ep-level" class="select-control">' +
      optHtml(Core.LEVELS, initLevel) +
      '</select>' +
      '</div>' +
      '<div class="form-field">' +
      '<label class="form-label" for="ep-role">角色 *</label>' +
      '<select id="ep-role" class="select-control">' +
      optHtml(Core.ROLES, initRole) +
      '</select>' +
      '</div>' +
      '<div class="form-field">' +
      '<label class="form-label" for="ep-stage">评估阶段 *</label>' +
      '<select id="ep-stage" class="select-control">' +
      optHtml(Core.STAGES, initStage) +
      '</select>' +
      '</div>' +
      '</div>' +
      '<div id="ep-stage-warn" class="eval-inline-warn hidden"></div>' +
      '<div class="form-row-2">' +
      '<div class="form-field">' +
      '<label class="form-label" for="ep-start">开始时间 *</label>' +
      '<input id="ep-start" type="date" class="input-control" value="' +
      esc(initStart) +
      '" required>' +
      '</div>' +
      '<div class="form-field">' +
      '<div class="form-label-row">' +
      '<label class="form-label" for="ep-end">结束时间</label>' +
      '<button type="button" id="ep-recalc-end" class="eval-link-btn">重算</button>' +
      '</div>' +
      '<input id="ep-end" type="date" class="input-control" value="' +
      esc(initEnd) +
      '">' +
      '<div id="ep-end-hint" class="form-hint"></div>' +
      '</div>' +
      '</div>' +
      '<div class="form-row-2">' +
      '<div class="form-field">' +
      '<label class="form-label" for="ep-status">项目状态 *</label>' +
      '<select id="ep-status" class="select-control">' +
      optHtml(Core.PROJECT_STATUSES, initStatus) +
      '</select>' +
      '</div>' +
      '<div class="form-field">' +
      '<label class="form-label" for="ep-settle">费用结算状态 *</label>' +
      '<select id="ep-settle" class="select-control">' +
      optHtml(Core.SETTLE_STATUSES, initSettle) +
      '</select>' +
      '</div>' +
      '</div>' +
      '<div class="form-row-2">' +
      '<div class="form-field">' +
      '<label class="form-label">评估天数（自动计算）</label>' +
      '<div id="ep-days-display" class="eval-readonly-box">—</div>' +
      '</div>' +
      '<div class="form-field">' +
      '<div class="form-label-row">' +
      '<label class="form-label" for="ep-fee">评估费用（元） <span id="ep-fee-manual-tag" class="eval-mod-badge hidden">手动</span></label>' +
      '<button type="button" id="ep-recalc-fee" class="eval-link-btn">重算</button>' +
      '</div>' +
      '<input id="ep-fee" type="text" inputmode="decimal" class="input-control eval-num-input" placeholder="自动按费率计算，或手填金额" value="' +
      esc(initFeeStr) +
      '">' +
      '</div>' +
      '</div>' +
      '<div id="ep-calc-summary" class="eval-calc-bar"></div>' +
      '<div class="form-field">' +
      '<label class="form-label" for="ep-note">备注</label>' +
      '<textarea id="ep-note" class="textarea-control" rows="2" maxlength="1000" placeholder="选填，如现场联系人、协议定价说明等">' +
      esc(initNote) +
      '</textarea>' +
      '</div>' +
      '</form>' +
      '<div class="modal-footer modal-footer-between">' +
      '<div>' +
      (editing && fromCalendar && calendarEventId
        ? '<button type="button" class="btn btn-danger" data-modal-action="ask-delete-event" data-from="event-editor" data-event-id="' +
          esc(calendarEventId) +
          '">删除日程与项目</button>'
        : editing && !fromCalendar
          ? '<button type="button" class="btn btn-danger" id="ep-delete-btn">删除项目</button>'
          : '<button type="button" class="btn btn-outline" data-modal-action="close">取消</button>') +
      '</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
      (editing
        ? '<button type="button" class="btn btn-outline" data-modal-action="close">取消</button>'
        : '') +
      '<button type="button" id="ep-save-btn" class="btn btn-primary">保存</button>' +
      '</div>' +
      '</div>';

    var nameEl = document.getElementById('ep-name');
    var nameAcEl = document.getElementById('ep-name-ac');
    var nameHintEl = document.getElementById('ep-name-hint');
    var levelEl = document.getElementById('ep-level');
    var roleEl = document.getElementById('ep-role');
    var stageEl = document.getElementById('ep-stage');
    var stageWarnEl = document.getElementById('ep-stage-warn');
    var startEl = document.getElementById('ep-start');
    var endEl = document.getElementById('ep-end');
    var endHintEl = document.getElementById('ep-end-hint');
    var statusEl = document.getElementById('ep-status');
    var settleEl = document.getElementById('ep-settle');
    var daysEl = document.getElementById('ep-days-display');
    var feeEl = document.getElementById('ep-fee');
    var feeTagEl = document.getElementById('ep-fee-manual-tag');
    var summaryEl = document.getElementById('ep-calc-summary');
    var noteEl = document.getElementById('ep-note');
    var errEl = document.getElementById('ep-error');
    var calCatEl = document.getElementById('ep-cal-category');

    // 从工作日程新建/升级时，如果把类别切出「外出评估」，切回标准日程弹窗并保留已填草稿
    if (calCatEl && !lockedToEval && ctx.onSwitchBackToStandardEvent) {
      calCatEl.addEventListener('change', function () {
        var assessId = WorkCal.Config.protectedAssessmentCategoryId || 'cat-assessment';
        if (calCatEl.value !== assessId) {
          ctx.onSwitchBackToStandardEvent({
            eventId: calendarEventId || null,
            draft: {
              title: nameEl.value.trim(),
              categoryId: calCatEl.value,
              startDate: startEl.value || today,
              endDate: endEl.value || '',
              allDay: true,
              startTime: '09:00',
              endTime: '18:00',
              notes: noteEl.value || ''
            }
          });
        }
      });
    }

    function updateStageAndNameHints() {
      var nm = nameEl.value.trim();
      var st = stageEl.value;
      var stagesMap = evalStore.getProjectStagesMap();
      var existingStages = nm && stagesMap[nm] ? stagesMap[nm] : [];
      if (existingStages.length) {
        nameHintEl.textContent = '已登记：' + existingStages.join('、');
      } else {
        nameHintEl.textContent = '';
      }

      var hasSameStage = evalStore.getProjects().some(function (p) {
        return p.name === nm && p.stage === st && (!editing || p.id !== editing.id);
      });
      if (nm && hasSameStage) {
        stageWarnEl.textContent = '提示：该项目已有「' + st + '」记录';
        stageWarnEl.classList.remove('hidden');
      } else {
        stageWarnEl.classList.add('hidden');
      }
    }

    function refreshCalculations(opts) {
      var lv = levelEl.value;
      var rl = roleEl.value;
      var st = stageEl.value;
      var start = startEl.value;
      var autoEnd = Core.calcAutoEndDate(start, lv, st, settings);

      if (opts && opts.recalcEnd) {
        endManual = false;
        endEl.value = autoEnd;
      } else if (!endManual && opts && opts.ruleInputsChanged) {
        endEl.value = autoEnd;
      }

      var end = endEl.value;
      var ruleDays = Core.getRuleDays(lv, st, settings);
      if (!start) {
        endHintEl.textContent = '请先选择开始时间';
      } else if (!ruleDays) {
        endHintEl.textContent = '该等级/阶段的天数规则未设置，可自行填写结束时间';
      } else if (end && end !== autoEnd) {
        endManual = true;
        endHintEl.textContent = '已手动调整（自动推算为 ' + Core.formatDateSlash(autoEnd) + '）';
      } else {
        endManual = false;
        endHintEl.textContent = '按规则自动推算（' + ruleDays + ' 天）';
      }

      var invalidRange = Boolean(start && end && end < start);
      var days = invalidRange ? 0 : Core.calcDays(start, end);
      daysEl.textContent = days > 0 ? days + ' 天' : '—';

      var rate = Core.getUnitRate(lv, rl, settings);
      var autoFee = Core.calcAutoFee(days, lv, rl, settings);

      if (opts && opts.recalcFee) {
        feeManualFlag = false;
        feeEl.value = autoFee !== null ? autoFee.toFixed(2) : '';
      } else if (!feeManualFlag) {
        feeEl.value = autoFee !== null ? autoFee.toFixed(2) : '';
      }

      var curFeeStr = feeEl.value.trim();
      var curFeeNum = curFeeStr !== '' && Number.isFinite(Number(curFeeStr)) ? Core.round2(Number(curFeeStr)) : null;
      var isActuallyManual =
        feeManualFlag &&
        curFeeNum !== null &&
        (autoFee === null || Math.abs(curFeeNum - autoFee) >= 0.005);

      feeTagEl.classList.toggle('hidden', !isActuallyManual);

      summaryEl.classList.remove('is-error');
      if (invalidRange) {
        summaryEl.classList.add('is-error');
        summaryEl.textContent = '结束时间早于开始时间，请调整起止日期';
      } else if (isActuallyManual) {
        var ruleNote =
          autoFee !== null
            ? '（按规则 ' + days + ' 天 × ' + Core.formatMoney(rate) + ' 元/天 = ' + Core.formatMoney(autoFee) + ' 元）'
            : '（当前等级/角色费率未设置）';
        summaryEl.textContent = '手动评估费用：¥' + Core.formatMoney(curFeeNum) + ' ' + ruleNote;
      } else if (rate === null) {
        summaryEl.textContent = '该等级/角色费率未设置，可直接手填评估费（留空将显示为「待设置」）';
      } else if (days <= 0) {
        summaryEl.textContent = '请补全起止时间以计算评估天数与费用';
      } else {
        summaryEl.textContent =
          days +
          ' 天 × ' +
          rate.toLocaleString('zh-CN') +
          ' 元/天 = ' +
          Core.formatMoney(autoFee) +
          ' 元';
      }

      updateStageAndNameHints();
    }

    attachAutocomplete(
      nameEl,
      nameAcEl,
      function (q) {
        var stagesMap = evalStore.getProjectStagesMap();
        var names = evalStore.getUniqueProjectNames();
        var low = q.toLowerCase();
        return names
          .filter(function (n) {
            return !low || n.toLowerCase().indexOf(low) !== -1;
          })
          .slice(0, 12)
          .map(function (n) {
            return { name: n, meta: '已登记：' + (stagesMap[n] || []).join('、') };
          });
      },
      function (picked) {
        if (picked && !editing) {
          // 自动带出同名项目已有的等级与角色，减少重复选择
          var matched = evalStore.getProjects().find(function (p) {
            return p.name === picked.name;
          });
          if (matched) {
            levelEl.value = matched.level;
            roleEl.value = matched.role;
            // 若已有预评估且没有正式评估，智能切到正式评估
            var stList = evalStore.getProjectStagesMap()[picked.name] || [];
            if (stList.indexOf('预评估') !== -1 && stList.indexOf('正式评估') === -1) {
              stageEl.value = '正式评估';
            }
            refreshCalculations({ ruleInputsChanged: true });
            return;
          }
        }
        updateStageAndNameHints();
      }
    );

    levelEl.addEventListener('change', function () {
      refreshCalculations({ ruleInputsChanged: true });
    });
    roleEl.addEventListener('change', function () {
      refreshCalculations({ ruleInputsChanged: false });
    });
    stageEl.addEventListener('change', function () {
      refreshCalculations({ ruleInputsChanged: true });
    });
    startEl.addEventListener('change', function () {
      refreshCalculations({ ruleInputsChanged: true });
    });
    endEl.addEventListener('change', function () {
      endManual = true;
      refreshCalculations({ ruleInputsChanged: false });
    });
    document.getElementById('ep-recalc-end').addEventListener('click', function () {
      refreshCalculations({ recalcEnd: true });
    });
    document.getElementById('ep-recalc-fee').addEventListener('click', function () {
      refreshCalculations({ recalcFee: true });
    });
    feeEl.addEventListener('input', function () {
      var v = feeEl.value.replace(/[^\d.]/g, '');
      var parts = v.split('.');
      if (parts.length > 2) v = parts[0] + '.' + parts.slice(1).join('');
      if (parts[1] && parts[1].length > 2) v = parts[0] + '.' + parts[1].slice(0, 2);
      if (feeEl.value !== v) feeEl.value = v;
      feeManualFlag = v.trim() !== '';
      refreshCalculations({ ruleInputsChanged: false });
    });
    feeEl.addEventListener('blur', function () {
      var v = feeEl.value.trim();
      if (v !== '' && Number.isFinite(Number(v))) {
        feeEl.value = Core.round2(Number(v)).toFixed(2);
      }
    });

    var delBtn = document.getElementById('ep-delete-btn');
    if (delBtn && editing) {
      delBtn.addEventListener('click', function () {
        ctx.openConfirmDeleteProject(editing.id);
      });
    }

    document.getElementById('ep-save-btn').addEventListener('click', function (e) {
      var btn = e.currentTarget;
      errEl.classList.add('hidden');
      var showErr = function (msg) {
        errEl.textContent = msg;
        errEl.classList.remove('hidden');
      };

      var name = nameEl.value.trim();
      var level = levelEl.value;
      var role = roleEl.value;
      var stage = stageEl.value;
      var start = startEl.value.trim();
      var end = endEl.value.trim();
      var status = statusEl.value;
      var settle = settleEl.value;
      var note = noteEl.value;

      if (!name) {
        showErr('请填写项目名称');
        nameEl.focus();
        return;
      }
      if (!start) {
        showErr('请选择开始时间');
        startEl.focus();
        return;
      }
      if (end && end < start) {
        showErr('结束时间早于开始时间');
        endEl.focus();
        return;
      }

      var rawFeeText = feeEl.value.trim();
      var feeManualVal = null;
      if (feeManualFlag && rawFeeText !== '') {
        var num = Number(rawFeeText);
        if (!Number.isFinite(num) || num < 0) {
          showErr('评估费用格式无效');
          feeEl.focus();
          return;
        }
        feeManualVal = Core.normalizeFeeManual(num, Core.calcDays(start, end), level, role, settings);
      }

      var body = {
        name: name,
        level: level,
        role: role,
        stage: stage,
        start: start,
        end: end,
        status: status,
        settle: settle,
        note: note,
        feeManual: feeManualVal
      };

      ctx.runBusy(btn, function () {
        if (editing) {
          return evalStore.updateProject(editing.id, body).then(function () {
            ctx.onDataChanged();
            ctx.closeAfterBusy();
            ctx.showToast('项目与工作日程已同步更新', 'success');
          });
        }

        // 若从工作日程把一条旧普通日程改成了「外出评估」，先建项目生成联动日程，再删除原普通日程避免重复
        var prevUnlinkedId = fromCalendar && calendarEventId && !editing ? calendarEventId : '';
        return evalStore.createProject(body).then(function () {
          if (prevUnlinkedId && calStore) {
            return calStore.deleteEvent(prevUnlinkedId).catch(function () {});
          }
        }).then(function () {
          ctx.onDataChanged();
          ctx.closeAfterBusy();
          ctx.showToast(
            fromCalendar
              ? '已新建「外出评估」日程并同步添加至评估项目列表'
              : '已新建项目并自动同步至工作日程',
            'success'
          );
        });
      });
    });

    refreshCalculations({ ruleInputsChanged: false });
    setTimeout(function () {
      if (!editing) nameEl.focus();
    }, 20);
  }

  // =========================================================================
  // 2. 新建 / 编辑差旅弹窗（§6.6）
  // =========================================================================
  function renderTravelEditor(dialog, ctx) {
    var Core = WorkCal.EvalCore;
    var evalStore = ctx.evalStore;
    var payload = ctx.payload || {};
    var today = WorkCal.DateUtils ? WorkCal.DateUtils.todayStr() : Core.getTodayShanghai();
    var editing = payload.travelId ? evalStore.getTravelById(payload.travelId) : null;

    var initDate = editing ? editing.date : today;
    var initCat = editing ? editing.cat : '打车';
    var initCatCustom = editing ? editing.catCustom || '' : '';
    var initName = editing ? editing.name : '';
    var initStage = editing ? editing.stage : '预评估';
    var initAmount = editing ? Core.round2(editing.amount).toFixed(2) : '';
    var initReimb = editing ? editing.reimb : '未报';
    var initDetail = editing ? editing.detail || '' : '';

    var optHtml = function (arr, cur) {
      return arr
        .map(function (v) {
          return '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(v) + '</option>';
        })
        .join('');
    };

    dialog.innerHTML =
      '<div class="modal-header">' +
      '<h2 id="modal-title" class="modal-title">' +
      (editing ? '编辑差旅记录' : '新建差旅记录') +
      '</h2>' +
      '<button type="button" class="modal-close" data-modal-action="close" aria-label="关闭">×</button>' +
      '</div>' +
      '<form id="eval-travel-form" class="modal-body" novalidate>' +
      '<div id="et-error" class="field-error hidden" role="alert"></div>' +
      '<div class="form-row-2">' +
      '<div class="form-field">' +
      '<label class="form-label" for="et-date">差旅发生日期 *</label>' +
      '<input id="et-date" type="date" class="input-control" value="' +
      esc(initDate) +
      '" required>' +
      '</div>' +
      '<div class="form-field">' +
      '<label class="form-label" for="et-cat">差旅类别 *</label>' +
      '<select id="et-cat" class="select-control">' +
      optHtml(Core.TRAVEL_CATS, initCat) +
      '</select>' +
      '</div>' +
      '</div>' +
      '<div id="et-cat-custom-wrap" class="form-field' +
      (initCat === '自定义' ? '' : ' hidden') +
      '">' +
      '<label class="form-label" for="et-cat-custom">自定义类别名称 *</label>' +
      '<input id="et-cat-custom" type="text" class="input-control" maxlength="40" placeholder="例如：机场停车费" value="' +
      esc(initCatCustom) +
      '">' +
      '</div>' +
      '<div class="form-field eval-ac-wrap">' +
      '<label class="form-label" for="et-name">项目名称 *</label>' +
      '<input id="et-name" type="text" class="input-control" maxlength="120" autocomplete="off" placeholder="选择已登记项目或直接输入新名称" value="' +
      esc(initName) +
      '" required>' +
      '<div id="et-name-ac" class="eval-ac-list hidden"></div>' +
      '</div>' +
      '<div class="eval-form-grid-3">' +
      '<div class="form-field">' +
      '<label class="form-label" for="et-stage">评估阶段 *</label>' +
      '<select id="et-stage" class="select-control"></select>' +
      '</div>' +
      '<div class="form-field">' +
      '<label class="form-label">项目等级（自动带出）</label>' +
      '<div id="et-level-display" class="eval-readonly-box">—</div>' +
      '</div>' +
      '<div class="form-field">' +
      '<label class="form-label">评估计划（自动带出）</label>' +
      '<div id="et-plan-display" class="eval-readonly-box">—</div>' +
      '</div>' +
      '</div>' +
      '<div class="form-row-2">' +
      '<div class="form-field">' +
      '<label class="form-label" for="et-amount">差旅金额（元） *</label>' +
      '<input id="et-amount" type="text" inputmode="decimal" class="input-control eval-num-input" placeholder="如 326.50" value="' +
      esc(initAmount) +
      '" required>' +
      '</div>' +
      '<div class="form-field">' +
      '<label class="form-label" for="et-reimb">报销状态 *</label>' +
      '<select id="et-reimb" class="select-control">' +
      optHtml(Core.REIMB_STATUSES, initReimb) +
      '</select>' +
      '</div>' +
      '</div>' +
      '<div class="form-field">' +
      '<label class="form-label" for="et-detail">差旅具体内容 *</label>' +
      '<textarea id="et-detail" class="textarea-control" rows="2" maxlength="500" placeholder="例如：高铁往返二等座、现场住宿两晚" required>' +
      esc(initDetail) +
      '</textarea>' +
      '</div>' +
      '</form>' +
      '<div class="modal-footer modal-footer-between">' +
      '<div>' +
      (editing
        ? '<button type="button" class="btn btn-danger" id="et-delete-btn">删除差旅</button>'
        : '<button type="button" class="btn btn-outline" data-modal-action="close">取消</button>') +
      '</div>' +
      '<div style="display:flex;gap:8px;">' +
      (editing ? '<button type="button" class="btn btn-outline" data-modal-action="close">取消</button>' : '') +
      '<button type="button" id="et-save-btn" class="btn btn-primary">保存</button>' +
      '</div>' +
      '</div>';

    var dateEl = document.getElementById('et-date');
    var catEl = document.getElementById('et-cat');
    var catCustomWrap = document.getElementById('et-cat-custom-wrap');
    var catCustomEl = document.getElementById('et-cat-custom');
    var nameEl = document.getElementById('et-name');
    var nameAcEl = document.getElementById('et-name-ac');
    var stageEl = document.getElementById('et-stage');
    var levelDisplay = document.getElementById('et-level-display');
    var planDisplay = document.getElementById('et-plan-display');
    var amountEl = document.getElementById('et-amount');
    var reimbEl = document.getElementById('et-reimb');
    var detailEl = document.getElementById('et-detail');
    var errEl = document.getElementById('et-error');

    var stageManuallyChanged = Boolean(editing);
    var linkedCache = {
      level: editing ? editing.level || '' : '',
      planStart: editing ? editing.planStart || '' : '',
      planEnd: editing ? editing.planEnd || '' : '',
      planText: editing ? editing.planText || '' : ''
    };

    function refreshStageOptionsAndLink(autoPickStage) {
      var projects = evalStore.getProjects();
      var nm = nameEl.value.trim();
      var dt = dateEl.value;
      var stagesMap = evalStore.getProjectStagesMap();
      var regStages = nm && stagesMap[nm] ? stagesMap[nm] : [];
      var targetStage = stageEl.value || initStage;

      if (autoPickStage && nm && regStages.length && !stageManuallyChanged) {
        targetStage = Core.findNearestStageForProject(nm, dt, projects);
      }

      stageEl.innerHTML = Core.STAGES.map(function (st) {
        var unregistered = nm && regStages.length > 0 && regStages.indexOf(st) === -1;
        var label = st + (unregistered ? '（未登记）' : '');
        return (
          '<option value="' +
          esc(st) +
          '"' +
          (st === targetStage ? ' selected' : '') +
          '>' +
          esc(label) +
          '</option>'
        );
      }).join('');

      var linked = Core.findLinkedProjectRecord(nm, stageEl.value, dt, projects);
      if (linked) {
        linkedCache = {
          level: linked.level || '',
          planStart: linked.start || '',
          planEnd: linked.end || '',
          planText: Core.formatPlanText(linked.start, linked.end)
        };
      } else if (editing && nm === editing.name && stageEl.value === editing.stage) {
        linkedCache = {
          level: editing.level || '',
          planStart: editing.planStart || '',
          planEnd: editing.planEnd || '',
          planText: editing.planText || Core.formatPlanText(editing.planStart, editing.planEnd)
        };
      } else {
        linkedCache = { level: '', planStart: '', planEnd: '', planText: '' };
      }

      levelDisplay.textContent = linkedCache.level || '—';
      planDisplay.textContent = linkedCache.planText || '—';
    }

    attachAutocomplete(
      nameEl,
      nameAcEl,
      function (q) {
        var stagesMap = evalStore.getProjectStagesMap();
        var travelCounts = {};
        evalStore.getTravels().forEach(function (t) {
          travelCounts[t.name] = (travelCounts[t.name] || 0) + 1;
        });
        var nameSet = {};
        evalStore.getUniqueProjectNames().forEach(function (n) {
          nameSet[n] = true;
        });
        Object.keys(travelCounts).forEach(function (n) {
          nameSet[n] = true;
        });
        var low = q.toLowerCase();
        return Object.keys(nameSet)
          .filter(function (n) {
            return !low || n.toLowerCase().indexOf(low) !== -1;
          })
          .slice(0, 12)
          .map(function (n) {
            var parts = [];
            if (stagesMap[n] && stagesMap[n].length) parts.push(stagesMap[n].join('/'));
            if (travelCounts[n]) parts.push(travelCounts[n] + ' 笔差旅');
            return { name: n, meta: parts.join(' · ') };
          });
      },
      function (picked) {
        if (picked) {
          stageManuallyChanged = false;
          refreshStageOptionsAndLink(true);
        } else {
          refreshStageOptionsAndLink(false);
        }
      }
    );

    catEl.addEventListener('change', function () {
      catCustomWrap.classList.toggle('hidden', catEl.value !== '自定义');
      if (catEl.value === '自定义') catCustomEl.focus();
    });
    dateEl.addEventListener('change', function () {
      refreshStageOptionsAndLink(true);
    });
    stageEl.addEventListener('change', function () {
      stageManuallyChanged = true;
      refreshStageOptionsAndLink(false);
    });

    // 金额输入过滤：只允许数字和一个小数点、最多两位小数，失焦补两位（§6.6 / AC-17）
    amountEl.addEventListener('input', function () {
      var v = amountEl.value.replace(/[^\d.]/g, '');
      var parts = v.split('.');
      if (parts.length > 2) v = parts[0] + '.' + parts.slice(1).join('');
      if (parts[1] && parts[1].length > 2) {
        v = parts[0] + '.' + parts[1].slice(0, 2);
      }
      if (amountEl.value !== v) amountEl.value = v;
    });
    amountEl.addEventListener('blur', function () {
      var v = amountEl.value.trim();
      if (v && Number.isFinite(Number(v)) && Number(v) > 0) {
        amountEl.value = Core.round2(Number(v)).toFixed(2);
      }
    });

    var delBtn = document.getElementById('et-delete-btn');
    if (delBtn && editing) {
      delBtn.addEventListener('click', function () {
        ctx.openConfirmDeleteTravel(editing.id);
      });
    }

    document.getElementById('et-save-btn').addEventListener('click', function (e) {
      var btn = e.currentTarget;
      errEl.classList.add('hidden');
      var showErr = function (msg) {
        errEl.textContent = msg;
        errEl.classList.remove('hidden');
      };

      var date = dateEl.value.trim();
      var name = nameEl.value.trim();
      var stage = stageEl.value;
      var cat = catEl.value;
      var catCustom = catCustomEl.value.trim();
      var rawAmt = amountEl.value.trim();
      var amt = Number(rawAmt);
      var reimb = reimbEl.value;
      var detail = detailEl.value.trim();

      if (!date) return showErr('请选择差旅发生日期');
      if (!name) return showErr('请填写项目名称');
      if (cat === '自定义' && !catCustom) return showErr('选择「自定义」类别时必须填写类别名称');
      if (!rawAmt || !Number.isFinite(amt) || amt <= 0) return showErr('请填写大于 0 的差旅金额');
      if (!detail) return showErr('请填写差旅具体内容');

      var body = {
        date: date,
        name: name,
        stage: stage,
        level: linkedCache.level,
        planStart: linkedCache.planStart,
        planEnd: linkedCache.planEnd,
        planText: linkedCache.planText,
        cat: cat,
        catCustom: cat === '自定义' ? catCustom : '',
        amount: Core.round2(amt),
        detail: detail,
        reimb: reimb
      };

      ctx.runBusy(btn, function () {
        var req = editing
          ? evalStore.updateTravel(editing.id, body)
          : evalStore.createTravel(body);
        return req.then(function () {
          ctx.onDataChanged();
          ctx.closeAfterBusy();
          ctx.showToast(editing ? '差旅记录已更新' : '已新增差旅记录', 'success');
        });
      });
    });

    refreshStageOptionsAndLink(!editing);
    setTimeout(function () {
      if (!editing) nameEl.focus();
    }, 20);
  }

  // =========================================================================
  // 3. 项目执行列表 Excel 导入与预览弹窗（§10.2，统一承接日程「导入台账」）
  // =========================================================================
  function renderProjectImportModal(dialog, ctx, stateHolder) {
    var Core = WorkCal.EvalCore;
    var Xlsx = WorkCal.EvalXlsx;
    var evalStore = ctx.evalStore;
    var st = stateHolder;

    if (!st.rawRows) {
      dialog.innerHTML =
        '<div class="modal-header">' +
        '<h2 id="modal-title" class="modal-title">导入《评估项目执行列表》</h2>' +
        '<button type="button" class="modal-close" data-modal-action="close" aria-label="关闭">×</button>' +
        '</div>' +
        '<div class="modal-body">' +
        '<div id="ep-imp-drop" class="dropzone" tabindex="0">' +
        '<div><strong>点击选择或拖入 Excel (.xlsx) / CSV 文件</strong></div>' +
        '<div class="form-hint" style="margin-top:4px;">支持合并单元格沿用上一行名称、日期与状态自动归一、按「名称+阶段+开始时间」去重，导入后自动同步至工作日程（类别：外出评估）</div>' +
        '<input id="ep-imp-file" type="file" accept=".xlsx,.csv,.tsv,.txt,.xls" class="hidden">' +
        '</div>' +
        '<div class="form-field">' +
        '<div class="form-label-row">' +
        '<label class="form-label" for="ep-imp-paste">或直接从 Excel 复制表格粘贴到此处</label>' +
        '<button type="button" id="ep-imp-export-tpl" class="btn btn-subtle btn-sm">下载标准模板 (.xlsx)</button>' +
        '</div>' +
        '<textarea id="ep-imp-paste" class="textarea-control" rows="5" placeholder="在 Excel 中选中含表头的数据区域按 Ctrl+C，再在此处按 Ctrl+V 粘贴..."></textarea>' +
        '</div>' +
        '<div id="ep-imp-err" class="field-error hidden"></div>' +
        '</div>' +
        '<div class="modal-footer modal-footer-between">' +
        '<button type="button" class="btn btn-outline" data-modal-action="close">取消</button>' +
        '<button type="button" id="ep-imp-parse-paste" class="btn btn-primary">识别粘贴内容并预览</button>' +
        '</div>';

      var dropEl = document.getElementById('ep-imp-drop');
      var fileEl = document.getElementById('ep-imp-file');
      var errEl = document.getElementById('ep-imp-err');

      var onFile = function (file) {
        if (!file) return;
        errEl.classList.add('hidden');
        Xlsx.parseEvalProjectsFile(file, evalStore.getProjects(), evalStore.getSettings(), {
          keepManualFee: false
        })
          .then(function (res) {
            st.rawRows = res.rawRows;
            st.date1904 = res.date1904;
            st.keepManualFee = false;
            st.parsed = res.parsed;
            st.confirmReplace = false;
            renderProjectImportModal(dialog, ctx, st);
          })
          .catch(function (err) {
            errEl.textContent = (err && err.message) || '文件解析失败';
            errEl.classList.remove('hidden');
          });
      };

      dropEl.addEventListener('click', function () {
        fileEl.click();
      });
      fileEl.addEventListener('change', function () {
        if (fileEl.files && fileEl.files[0]) onFile(fileEl.files[0]);
      });
      dropEl.addEventListener('dragover', function (e) {
        e.preventDefault();
        dropEl.classList.add('is-dragover');
      });
      dropEl.addEventListener('dragleave', function () {
        dropEl.classList.remove('is-dragover');
      });
      dropEl.addEventListener('drop', function (e) {
        e.preventDefault();
        dropEl.classList.remove('is-dragover');
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
          onFile(e.dataTransfer.files[0]);
        }
      });

      document.getElementById('ep-imp-export-tpl').addEventListener('click', function () {
        Xlsx.exportProjectsXlsx(evalStore.getProjects(), evalStore.getSettings());
        ctx.showToast('已导出项目执行列表（可直接作为导入模板）', 'success');
      });

      document.getElementById('ep-imp-parse-paste').addEventListener('click', function () {
        var txt = document.getElementById('ep-imp-paste').value;
        errEl.classList.add('hidden');
        if (!txt.trim()) {
          errEl.textContent = '请先选择文件或粘贴表格内容';
          errEl.classList.remove('hidden');
          return;
        }
        try {
          var rows = WorkCal.Importer.parseDelimitedText(txt);
          var parsed = Xlsx.parseEvalProjectsGrid(
            rows,
            evalStore.getProjects(),
            evalStore.getSettings(),
            { date1904: false, keepManualFee: false }
          );
          st.rawRows = rows;
          st.date1904 = false;
          st.keepManualFee = false;
          st.parsed = parsed;
          st.confirmReplace = false;
          renderProjectImportModal(dialog, ctx, st);
        } catch (err) {
          errEl.textContent = (err && err.message) || '粘贴内容识别失败';
          errEl.classList.remove('hidden');
        }
      });
      return;
    }

    var pv = st.parsed;
    var s = pv.summary;
    var allDup = s.recognizedCount > 0 && s.importCount === 0;
    var existingCount = evalStore.getProjects().length;

    var previewRows = pv.allItems
      .slice(0, 8)
      .map(function (it) {
        var eff = Core.calcEffectiveFee(it, evalStore.getSettings());
        var feeTxt = eff.fee !== null ? Core.formatMoney(eff.fee) + (eff.isManual ? ' 改' : '') : '待设置';
        return (
          '<tr class="' +
          (it._isDup ? 'eval-row-muted' : '') +
          '">' +
          '<td>' +
          esc(it.name) +
          '</td>' +
          '<td>' +
          esc(it.level) +
          '</td>' +
          '<td>' +
          esc(it.role) +
          '</td>' +
          '<td>' +
          esc(it.stage) +
          '</td>' +
          '<td>' +
          esc(it.start ? Core.formatDateSlash(it.start) : '未排期') +
          '</td>' +
          '<td>' +
          esc(it.end ? Core.formatDateSlash(it.end) : '—') +
          '</td>' +
          '<td class="eval-num">' +
          esc(feeTxt) +
          '</td>' +
          '<td>' +
          (it._isDup
            ? '<span class="tag-badge">重复跳过</span>'
            : '<span class="tag-badge" style="background:#dcfce7;color:#166534;">将导入</span>') +
          '</td>' +
          '</tr>'
        );
      })
      .join('');

    var notesHtml = pv.notes.length
      ? '<div class="skip-list"><strong>识别与映射提示：</strong><ul>' +
        pv.notes
          .map(function (n) {
            return '<li>' + esc(n) + '</li>';
          })
          .join('') +
        '</ul></div>'
      : '';

    var replaceConfirmHtml = st.confirmReplace
      ? '<div class="danger-box"><strong>确认覆盖导入？</strong><br>覆盖导入将清空当前 <strong>' +
        existingCount +
        '</strong> 条项目记录及其关联日程，替换为文件中的 <strong>' +
        s.recognizedCount +
        '</strong> 条记录。' +
        '<div style="margin-top:8px;display:flex;gap:8px;">' +
        '<button type="button" id="ep-imp-confirm-replace" class="btn btn-danger-solid btn-sm">确认覆盖导入</button>' +
        '<button type="button" id="ep-imp-cancel-replace" class="btn btn-outline btn-sm">取消</button>' +
        '</div></div>'
      : '';

    dialog.innerHTML =
      '<div class="modal-header">' +
      '<h2 id="modal-title" class="modal-title">项目导入预览与确认</h2>' +
      '<button type="button" class="modal-close" data-modal-action="close" aria-label="关闭">×</button>' +
      '</div>' +
      '<div class="modal-body">' +
      '<div class="eval-preview-grid-5">' +
      '<div class="preview-stat-box"><div class="preview-stat-num">' +
      s.recognizedCount +
      '</div><div class="preview-stat-label">识别记录数</div></div>' +
      '<div class="preview-stat-box"><div class="preview-stat-num">' +
      s.projectCount +
      '</div><div class="preview-stat-label">归入项目数</div></div>' +
      '<div class="preview-stat-box"><div class="preview-stat-num" style="color:#166534;">' +
      s.importCount +
      '</div><div class="preview-stat-label">追加将导入</div></div>' +
      '<div class="preview-stat-box"><div class="preview-stat-num" style="color:#b45309;">' +
      s.dupCount +
      '</div><div class="preview-stat-label">重复跳过</div></div>' +
      '<div class="preview-stat-box"><div class="preview-stat-num" style="color:#64748b;">' +
      s.unscheduledCount +
      '</div><div class="preview-stat-label">未排期数</div></div>' +
      '</div>' +
      '<div class="eval-switch-card">' +
      '<label class="eval-toggle">' +
      '<input id="ep-imp-keep-fee" type="checkbox"' +
      (st.keepManualFee ? ' checked' : '') +
      '>' +
      '<span class="eval-toggle-slider"></span>' +
      '<span class="eval-toggle-label">保留原表「评估费用」作为手动值（仅当与规则值不同时标「改」）</span>' +
      '</label>' +
      '</div>' +
      (allDup
        ? '<div class="info-box">文件里的 ' +
          s.recognizedCount +
          ' 条记录在台账中已全部存在，无需重复导入（如需替换可使用「覆盖导入」）。</div>'
        : '') +
      replaceConfirmHtml +
      (pv.allItems.length
        ? '<div class="form-hint">前 ' +
          Math.min(8, pv.allItems.length) +
          ' 条预览（共 ' +
          pv.allItems.length +
          ' 条）：</div>' +
          '<div class="preview-table-wrap"><table class="preview-table"><thead><tr><th>项目名称</th><th>等级</th><th>角色</th><th>阶段</th><th>开始</th><th>结束</th><th>评估费用</th><th>状态</th></tr></thead><tbody>' +
          previewRows +
          '</tbody></table></div>'
        : '<div class="panel-empty">未识别到有效项目记录</div>') +
      notesHtml +
      '</div>' +
      '<div class="modal-footer modal-footer-between">' +
      '<button type="button" id="ep-imp-reset" class="btn btn-outline">重新选择文件</button>' +
      '<div class="modal-footer-actions">' +
      '<button type="button" class="btn btn-outline" data-modal-action="close">取消</button>' +
      '<button type="button" id="ep-imp-replace" class="btn btn-danger"' +
      (s.recognizedCount === 0 ? ' disabled' : '') +
      '>覆盖导入</button>' +
      '<button type="button" id="ep-imp-append" class="btn btn-primary"' +
      (s.importCount === 0 ? ' disabled' : '') +
      '>追加导入（' +
      s.importCount +
      ' 条）</button>' +
      '</div>' +
      '</div>';

    document.getElementById('ep-imp-keep-fee').addEventListener('change', function (e) {
      st.keepManualFee = Boolean(e.target.checked);
      st.parsed = Xlsx.parseEvalProjectsGrid(
        st.rawRows,
        evalStore.getProjects(),
        evalStore.getSettings(),
        { date1904: st.date1904, keepManualFee: st.keepManualFee }
      );
      renderProjectImportModal(dialog, ctx, st);
    });

    document.getElementById('ep-imp-reset').addEventListener('click', function () {
      st.rawRows = null;
      st.parsed = null;
      st.confirmReplace = false;
      renderProjectImportModal(dialog, ctx, st);
    });

    var doImport = function (mode, btn) {
      var list = mode === 'replace' ? pv.allItems : pv.toImport;
      ctx.runBusy(btn, function () {
        btn.textContent = '导入中...';
        return evalStore.importProjects(list, mode).then(function (res) {
          st.rawRows = null;
          st.parsed = null;
          st.confirmReplace = false;
          ctx.onDataChanged();
          ctx.closeAfterBusy();
          if (ctx.onAfterProjectImport) ctx.onAfterProjectImport();
          ctx.showToast(
            (mode === 'replace' ? '覆盖导入完成：共写入 ' : '追加导入完成：新增 ') +
              res.imported +
              ' 条项目记录（已同步工作日程）',
            'success'
          );
        });
      });
    };

    document.getElementById('ep-imp-append').addEventListener('click', function (e) {
      if (s.importCount === 0) {
        ctx.showToast('文件里的 ' + s.recognizedCount + ' 条记录在台账中已全部存在，无需重复导入', 'error');
        return;
      }
      doImport('append', e.currentTarget);
    });

    document.getElementById('ep-imp-replace').addEventListener('click', function () {
      st.confirmReplace = true;
      renderProjectImportModal(dialog, ctx, st);
    });

    var confirmRepBtn = document.getElementById('ep-imp-confirm-replace');
    if (confirmRepBtn) {
      confirmRepBtn.addEventListener('click', function (e) {
        doImport('replace', e.currentTarget);
      });
    }
    var cancelRepBtn = document.getElementById('ep-imp-cancel-replace');
    if (cancelRepBtn) {
      cancelRepBtn.addEventListener('click', function () {
        st.confirmReplace = false;
        renderProjectImportModal(dialog, ctx, st);
      });
    }
  }

  // =========================================================================
  // 4. 项目差旅 Excel 导入与预览弹窗（§10.3）
  // =========================================================================
  function renderTravelImportModal(dialog, ctx, stateHolder) {
    var Core = WorkCal.EvalCore;
    var Xlsx = WorkCal.EvalXlsx;
    var evalStore = ctx.evalStore;
    var st = stateHolder;

    if (!st.rawRows) {
      dialog.innerHTML =
        '<div class="modal-header">' +
        '<h2 id="modal-title" class="modal-title">导入项目差旅 Excel</h2>' +
        '<button type="button" class="modal-close" data-modal-action="close" aria-label="关闭">×</button>' +
        '</div>' +
        '<div class="modal-body">' +
        '<div id="et-imp-drop" class="dropzone" tabindex="0">' +
        '<div><strong>点击选择或拖入差旅 Excel (.xlsx) / CSV 文件</strong></div>' +
        '<div class="form-hint" style="margin-top:4px;">需包含「差旅日期」「项目名称」「差旅金额」列；非标准类别将自动归入自定义并保留原名，报销状态自动归一</div>' +
        '<input id="et-imp-file" type="file" accept=".xlsx,.csv,.tsv,.txt,.xls" class="hidden">' +
        '</div>' +
        '<div style="display:flex;justify-content:flex-end;">' +
        '<button type="button" id="et-imp-export-tpl" class="btn btn-subtle btn-sm">下载差旅标准模板 (.xlsx)</button>' +
        '</div>' +
        '<div id="et-imp-err" class="field-error hidden"></div>' +
        '</div>' +
        '<div class="modal-footer">' +
        '<button type="button" class="btn btn-outline" data-modal-action="close">取消</button>' +
        '</div>';

      var dropEl = document.getElementById('et-imp-drop');
      var fileEl = document.getElementById('et-imp-file');
      var errEl = document.getElementById('et-imp-err');

      var onFile = function (file) {
        if (!file) return;
        errEl.classList.add('hidden');
        Xlsx.parseEvalTravelsFile(file, evalStore.getTravels(), evalStore.getProjects())
          .then(function (res) {
            st.rawRows = res.rawRows;
            st.parsed = res.parsed;
            st.confirmReplace = false;
            renderTravelImportModal(dialog, ctx, st);
          })
          .catch(function (err) {
            errEl.textContent = (err && err.message) || '差旅文件解析失败';
            errEl.classList.remove('hidden');
          });
      };

      dropEl.addEventListener('click', function () {
        fileEl.click();
      });
      fileEl.addEventListener('change', function () {
        if (fileEl.files && fileEl.files[0]) onFile(fileEl.files[0]);
      });
      dropEl.addEventListener('dragover', function (e) {
        e.preventDefault();
        dropEl.classList.add('is-dragover');
      });
      dropEl.addEventListener('dragleave', function () {
        dropEl.classList.remove('is-dragover');
      });
      dropEl.addEventListener('drop', function (e) {
        e.preventDefault();
        dropEl.classList.remove('is-dragover');
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
          onFile(e.dataTransfer.files[0]);
        }
      });

      document.getElementById('et-imp-export-tpl').addEventListener('click', function () {
        Xlsx.exportTravelsXlsx(evalStore.getTravels(), evalStore.getProjects());
        ctx.showToast('已导出项目差旅表（可作为导入模板）', 'success');
      });
      return;
    }

    var pv = st.parsed;
    var s = pv.summary;
    var allDup = s.recognizedCount > 0 && s.importCount === 0;
    var existingCount = evalStore.getTravels().length;

    var rowsHtml = pv.allItems
      .slice(0, 8)
      .map(function (it) {
        return (
          '<tr class="' +
          (it._isDup ? 'eval-row-muted' : '') +
          '">' +
          '<td>' +
          esc(Core.formatDateSlash(it.date)) +
          '</td>' +
          '<td>' +
          esc(it.name) +
          '</td>' +
          '<td>' +
          esc(it.stage) +
          '</td>' +
          '<td>' +
          esc(Core.getTravelDisplayCat(it)) +
          '</td>' +
          '<td class="eval-num">¥' +
          esc(Core.formatMoney(it.amount)) +
          '</td>' +
          '<td>' +
          esc(it.detail || '—') +
          '</td>' +
          '<td>' +
          esc(it.reimb) +
          '</td>' +
          '<td>' +
          (it._isDup
            ? '<span class="tag-badge">重复跳过</span>'
            : '<span class="tag-badge" style="background:#dcfce7;color:#166534;">将导入</span>') +
          '</td>' +
          '</tr>'
        );
      })
      .join('');

    var notesHtml = pv.notes.length
      ? '<div class="skip-list"><strong>识别与归一提示：</strong><ul>' +
        pv.notes
          .map(function (n) {
            return '<li>' + esc(n) + '</li>';
          })
          .join('') +
        '</ul></div>'
      : '';

    var replaceConfirmHtml = st.confirmReplace
      ? '<div class="danger-box"><strong>确认覆盖导入差旅？</strong><br>将以文件中的 <strong>' +
        s.recognizedCount +
        '</strong> 笔差旅替换现有全部 <strong>' +
        existingCount +
        '</strong> 笔差旅。' +
        '<div style="margin-top:8px;display:flex;gap:8px;">' +
        '<button type="button" id="et-imp-confirm-replace" class="btn btn-danger-solid btn-sm">确认覆盖导入</button>' +
        '<button type="button" id="et-imp-cancel-replace" class="btn btn-outline btn-sm">取消</button>' +
        '</div></div>'
      : '';

    dialog.innerHTML =
      '<div class="modal-header">' +
      '<h2 id="modal-title" class="modal-title">差旅导入预览与确认</h2>' +
      '<button type="button" class="modal-close" data-modal-action="close" aria-label="关闭">×</button>' +
      '</div>' +
      '<div class="modal-body">' +
      '<div class="preview-stats-grid">' +
      '<div class="preview-stat-box"><div class="preview-stat-num">' +
      s.recognizedCount +
      '</div><div class="preview-stat-label">识别有效笔数</div></div>' +
      '<div class="preview-stat-box"><div class="preview-stat-num" style="color:#166534;">' +
      s.importCount +
      '</div><div class="preview-stat-label">追加将导入</div></div>' +
      '<div class="preview-stat-box"><div class="preview-stat-num" style="color:#b45309;">' +
      s.dupCount +
      '</div><div class="preview-stat-label">重复跳过</div></div>' +
      '<div class="preview-stat-box"><div class="preview-stat-num" style="color:#dc2626;">' +
      s.invalidCount +
      '</div><div class="preview-stat-label">无效跳过</div></div>' +
      '</div>' +
      (allDup
        ? '<div class="info-box">文件里的 ' +
          s.recognizedCount +
          ' 笔差旅在台账中已全部存在，无需重复导入。</div>'
        : '') +
      replaceConfirmHtml +
      (pv.allItems.length
        ? '<div class="preview-table-wrap"><table class="preview-table"><thead><tr><th>日期</th><th>项目名称</th><th>阶段</th><th>类别</th><th>金额</th><th>内容</th><th>报销</th><th>动作</th></tr></thead><tbody>' +
          rowsHtml +
          '</tbody></table></div>'
        : '<div class="panel-empty">未识别到有效差旅记录</div>') +
      notesHtml +
      '</div>' +
      '<div class="modal-footer modal-footer-between">' +
      '<button type="button" id="et-imp-reset" class="btn btn-outline">重新选择文件</button>' +
      '<div class="modal-footer-actions">' +
      '<button type="button" class="btn btn-outline" data-modal-action="close">取消</button>' +
      '<button type="button" id="et-imp-replace" class="btn btn-danger"' +
      (s.recognizedCount === 0 ? ' disabled' : '') +
      '>覆盖导入</button>' +
      '<button type="button" id="et-imp-append" class="btn btn-primary"' +
      (s.importCount === 0 ? ' disabled' : '') +
      '>追加导入（' +
      s.importCount +
      ' 笔）</button>' +
      '</div>' +
      '</div>';

    document.getElementById('et-imp-reset').addEventListener('click', function () {
      st.rawRows = null;
      st.parsed = null;
      st.confirmReplace = false;
      renderTravelImportModal(dialog, ctx, st);
    });

    var doImport = function (mode, btn) {
      var list = mode === 'replace' ? pv.allItems : pv.toImport;
      ctx.runBusy(btn, function () {
        btn.textContent = '导入中...';
        return evalStore.importTravels(list, mode).then(function (res) {
          st.rawRows = null;
          st.parsed = null;
          st.confirmReplace = false;
          ctx.onDataChanged();
          ctx.closeAfterBusy();
          ctx.showToast(
            (mode === 'replace' ? '差旅覆盖导入完成：共 ' : '差旅追加导入完成：新增 ') +
              res.imported +
              ' 笔',
            'success'
          );
        });
      });
    };

    document.getElementById('et-imp-append').addEventListener('click', function (e) {
      doImport('append', e.currentTarget);
    });
    document.getElementById('et-imp-replace').addEventListener('click', function () {
      st.confirmReplace = true;
      renderTravelImportModal(dialog, ctx, st);
    });
    var cRep = document.getElementById('et-imp-confirm-replace');
    if (cRep) {
      cRep.addEventListener('click', function (e) {
        doImport('replace', e.currentTarget);
      });
    }
    var cancelRep = document.getElementById('et-imp-cancel-replace');
    if (cancelRep) {
      cancelRep.addEventListener('click', function () {
        st.confirmReplace = false;
        renderTravelImportModal(dialog, ctx, st);
      });
    }
  }

  WorkCal.EvalModals = {
    renderProjectEditor: renderProjectEditor,
    renderTravelEditor: renderTravelEditor,
    renderProjectImportModal: renderProjectImportModal,
    renderTravelImportModal: renderTravelImportModal
  };
})(typeof window !== 'undefined' ? window : globalThis);
