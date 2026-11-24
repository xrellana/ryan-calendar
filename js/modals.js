/**
 * 统一单浮层交互管理器（同一时刻只渲染一个浮层）
 * 包含：当天详情、新建/编辑日程、误删二次确认、类别管理、台账导入预览、
 * 更多工具、JSON 备份恢复、个人账号与 .ics 订阅、管理员后台（账号/节假日/备份）、旧本地数据迁移
 */
(function (root) {
  'use strict';

  var WorkCal = (root.WorkCal = root.WorkCal || {});

  function esc(str) {
    return WorkCal.Views.escapeHtml(str);
  }

  function formatBytes(bytes) {
    var n = Number(bytes) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function formatDateTimeShort(iso) {
    if (!iso) return '从未';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    var pad = function (x) {
      return String(x).padStart(2, '0');
    };
    return (
      d.getFullYear() +
      '-' +
      pad(d.getMonth() + 1) +
      '-' +
      pad(d.getDate()) +
      ' ' +
      pad(d.getHours()) +
      ':' +
      pad(d.getMinutes())
    );
  }

  function copyToClipboard(text, fallbackEl, onSuccess) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(function () {
          if (onSuccess) onSuccess();
        })
        .catch(function () {
          fallbackCopy(text, fallbackEl, onSuccess);
        });
    } else {
      fallbackCopy(text, fallbackEl, onSuccess);
    }
  }

  function fallbackCopy(text, fallbackEl, onSuccess) {
    try {
      if (fallbackEl && typeof fallbackEl.select === 'function') {
        fallbackEl.select();
        document.execCommand('copy');
      } else {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      if (onSuccess) onSuccess();
    } catch (e) {
      // ignore
    }
  }

  function createModalManager(ctx) {
    var store = ctx.store;
    var evalStore = ctx.evalStore || null;
    var api = ctx.api || WorkCal.Api;
    var getCurrentUser = ctx.getCurrentUser;
    var onUserUpdated = ctx.onUserUpdated;
    var onLogout = ctx.onLogout;
    var onDataChanged = ctx.onDataChanged;
    var onJumpToMonth = ctx.onJumpToMonth;
    var onSwitchToEval = ctx.onSwitchToEval;
    var showToast = ctx.showToast;

    var backdrop = document.getElementById('modal-backdrop');
    var dialog = document.getElementById('modal-dialog');

    var currentType = null;
    var currentPayload = null;
    var isBusy = false;

    // 从日程编辑跳入类别管理时暂存未保存草稿
    var savedEditorDraft = null;
    // 类别管理中当前展开色板的类别 ID（或 '__new__'）
    var openPaletteForId = null;
    var newCatColor = '#7C3AED';
    // 台账导入预览状态
    var ledgerParseState = null;
    var evalProjectImportState = {};
    var evalTravelImportState = {};
    // 管理员后台状态
    var adminState = {
      tab: 'users',
      loading: false,
      users: [],
      holidays: null,
      selectedHolidayYear: new Date().getFullYear(),
      backups: null,
      credentialBanner: null,
      confirmDeleteUserId: null
    };

    function isOpen() {
      return Boolean(currentType && !backdrop.classList.contains('hidden'));
    }

    function close() {
      if (isBusy) return;
      currentType = null;
      currentPayload = null;
      openPaletteForId = null;
      adminState.credentialBanner = null;
      adminState.confirmDeleteUserId = null;
      backdrop.classList.add('hidden');
      backdrop.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('modal-open');
      dialog.classList.remove('is-wide');
      dialog.innerHTML = '';
    }

    function open(type, payload, wide) {
      currentType = type;
      currentPayload = payload || {};
      dialog.classList.toggle('is-wide', Boolean(wide));
      renderCurrent();
      backdrop.classList.remove('hidden');
      backdrop.setAttribute('aria-hidden', 'false');
      document.body.classList.add('modal-open');
    }

    function runBusy(btn, promiseFn) {
      if (isBusy) return;
      isBusy = true;
      var origText = btn ? btn.textContent : '';
      if (btn) {
        btn.disabled = true;
        btn.dataset.origText = origText;
      }
      Promise.resolve()
        .then(promiseFn)
        .catch(function (err) {
          showToast((err && err.message) || '操作失败，请稍后重试', 'error');
        })
        .finally(function () {
          isBusy = false;
          if (btn && btn.isConnected) {
            btn.disabled = false;
            if (btn.dataset.origText !== undefined) {
              btn.textContent = btn.dataset.origText;
            }
          }
        });
    }

    function evalModalCtx() {
      return {
        store: store,
        evalStore: evalStore,
        payload: currentPayload,
        runBusy: runBusy,
        onDataChanged: onDataChanged,
        showToast: showToast,
        closeAfterBusy: function () {
          isBusy = false;
          close();
        },
        onSwitchBackToStandardEvent: function (restorePayload) {
          open('event-editor', restorePayload || {});
        },
        openConfirmDeleteProject: function (projectId) {
          open('confirm-delete-eval-project', { projectId: projectId });
        },
        openConfirmDeleteTravel: function (travelId) {
          open('confirm-delete-eval-travel', { travelId: travelId });
        },
        onAfterProjectImport: function () {
          if (onSwitchToEval) onSwitchToEval('projects');
        }
      };
    }

    function renderConfirmDeleteEvalProject() {
      var proj = evalStore && currentPayload.projectId ? evalStore.getProjectById(currentPayload.projectId) : null;
      if (!proj) {
        close();
        return;
      }
      dialog.innerHTML =
        '<div class="modal-header">' +
        '<h2 id="modal-title" class="modal-title">确认删除评估项目</h2>' +
        '<button type="button" class="modal-close" data-modal-action="close" aria-label="关闭">×</button>' +
        '</div>' +
        '<div class="modal-body">' +
        '<div class="danger-box">' +
        '<strong>确定删除项目「' +
        esc(proj.name) +
        '（' +
        esc(proj.stage) +
        '）」？此操作不可撤销。</strong><br>' +
        '<div style="margin-top:6px;">删除后将同步移除工作日程中对应的「外出评估」日程记录；若该项目有另一阶段记录仍会保留，且历史差旅支出记录不受影响。</div>' +
        '</div>' +
        '</div>' +
        '<div class="modal-footer modal-footer-between">' +
        '<button type="button" class="btn btn-outline" data-modal-action="close">取消</button>' +
        '<button type="button" class="btn btn-danger-solid" data-modal-action="confirm-delete-eval-project">确认删除</button>' +
        '</div>';
    }

    function renderConfirmDeleteEvalTravel() {
      var tr = evalStore && currentPayload.travelId ? evalStore.getTravelById(currentPayload.travelId) : null;
      if (!tr) {
        close();
        return;
      }
      dialog.innerHTML =
        '<div class="modal-header">' +
        '<h2 id="modal-title" class="modal-title">确认删除差旅记录</h2>' +
        '<button type="button" class="modal-close" data-modal-action="close" aria-label="关闭">×</button>' +
        '</div>' +
        '<div class="modal-body">' +
        '<div class="danger-box">' +
        '<strong>确定删除该笔差旅记录？此操作不可撤销。</strong><br>' +
        '<div style="margin-top:6px;">项目：<strong>' +
        esc(tr.name) +
        '</strong> · 金额：¥' +
        esc(WorkCal.EvalCore.formatMoney(tr.amount)) +
        '（' +
        esc(tr.date) +
        '）</div>' +
        '</div>' +
        '</div>' +
        '<div class="modal-footer modal-footer-between">' +
        '<button type="button" class="btn btn-outline" data-modal-action="close">取消</button>' +
        '<button type="button" class="btn btn-danger-solid" data-modal-action="confirm-delete-eval-travel">确认删除</button>' +
        '</div>';
    }

    function renderConfirmResetEvalSettings() {
      dialog.innerHTML =
        '<div class="modal-header">' +
        '<h2 id="modal-title" class="modal-title">确认恢复默认规则与费率</h2>' +
        '<button type="button" class="modal-close" data-modal-action="close" aria-label="关闭">×</button>' +
        '</div>' +
        '<div class="modal-body">' +
        '<div class="danger-box">' +
        '<strong>确定将「评估天数规则」和「单位评估费」恢复为系统默认值吗？</strong><br>' +
        '<div style="margin-top:6px;">恢复后，未手工改写费用的项目将按默认费率实时重算；已手工改过的费用不受影响。</div>' +
        '</div>' +
        '</div>' +
        '<div class="modal-footer modal-footer-between">' +
        '<button type="button" class="btn btn-outline" data-modal-action="close">取消</button>' +
        '<button type="button" class="btn btn-danger-solid" data-modal-action="confirm-reset-eval-settings">确认恢复默认</button>' +
        '</div>';
    }

    function renderConfirmClearEvalAll() {
      var pCnt = evalStore ? evalStore.getProjects().length : 0;
      var tCnt = evalStore ? evalStore.getTravels().length : 0;
      dialog.innerHTML =
        '<div class="modal-header">' +
        '<h2 id="modal-title" class="modal-title">确认清空全部评估数据</h2>' +
        '<button type="button" class="modal-close" data-modal-action="close" aria-label="关闭">×</button>' +
        '</div>' +
        '<div class="modal-body">' +
        '<div class="danger-box">' +
        '<strong>⚠️ 不可撤销操作确认：</strong><br>' +
        '即将永久清空当前账号下的 <strong>' +
        pCnt +
        '</strong> 条评估项目记录（含工作日程中对应关联日程）、<strong>' +
        tCnt +
        '</strong> 笔差旅记录，并将天数规则与费率恢复默认。<br>' +
        '<div style="margin-top:6px;">其他类别的手工工作日程不受影响。建议先导出 JSON 备份。</div>' +
        '</div>' +
        '</div>' +
        '<div class="modal-footer modal-footer-between">' +
        '<button type="button" class="btn btn-outline" data-modal-action="close">取消</button>' +
        '<button type="button" class="btn btn-danger-solid" data-modal-action="confirm-clear-eval-all">确认全部清空</button>' +
        '</div>';
    }

    function renderConfirmRestoreEvalJson() {
      var data = currentPayload.backupData || {};
      var inProj = Array.isArray(data.projects) ? data.projects.length : 0;
      var inTrv = Array.isArray(data.travels) ? data.travels.length : 0;
      var curProj = evalStore ? evalStore.getProjects().length : 0;
      var curTrv = evalStore ? evalStore.getTravels().length : 0;
      dialog.innerHTML =
        '<div class="modal-header">' +
        '<h2 id="modal-title" class="modal-title">确认恢复评估平台 JSON 备份</h2>' +
        '<button type="button" class="modal-close" data-modal-action="close" aria-label="关闭">×</button>' +
        '</div>' +
        '<div class="modal-body">' +
        '<div class="danger-box">' +
        '<strong>覆盖恢复确认：</strong><br>' +
        '将用备份文件中的 <strong>' +
        inProj +
        '</strong> 条项目、<strong>' +
        inTrv +
        '</strong> 笔差旅及规则设置，完整覆盖当前账号现有的 <strong>' +
        curProj +
        '</strong> 条项目与 <strong>' +
        curTrv +
        '</strong> 笔差旅，并同步更新工作日程中的评估项目排期（其他类别日程不受影响）。' +
        '</div>' +
        '</div>' +
        '<div class="modal-footer modal-footer-between">' +
        '<button type="button" class="btn btn-outline" data-modal-action="close">取消</button>' +
        '<button type="button" class="btn btn-danger-solid" data-modal-action="confirm-restore-eval-json">确认覆盖恢复</button>' +
        '</div>';
    }

    function renderCurrent() {
      if (currentType === 'day-detail') renderDayDetail();
      else if (currentType === 'event-editor') renderEventEditor();
      else if (currentType === 'confirm-delete-event') renderConfirmDeleteEvent();
      else if (currentType === 'confirm-delete-cat') renderConfirmDeleteCat();
      else if (currentType === 'categories') renderCategoryManager();
      else if (currentType === 'import' || currentType === 'eval-import-projects') {
        dialog.classList.add('is-wide');
        WorkCal.EvalModals.renderProjectImportModal(dialog, evalModalCtx(), evalProjectImportState);
      } else if (currentType === 'eval-import-travels') {
        dialog.classList.add('is-wide');
        WorkCal.EvalModals.renderTravelImportModal(dialog, evalModalCtx(), evalTravelImportState);
      } else if (currentType === 'eval-project-editor') {
        WorkCal.EvalModals.renderProjectEditor(dialog, evalModalCtx());
      } else if (currentType === 'eval-travel-editor') {
        WorkCal.EvalModals.renderTravelEditor(dialog, evalModalCtx());
      } else if (currentType === 'confirm-delete-eval-project') {
        renderConfirmDeleteEvalProject();
      } else if (currentType === 'confirm-delete-eval-travel') {
        renderConfirmDeleteEvalTravel();
      } else if (currentType === 'confirm-reset-eval-settings') {
        renderConfirmResetEvalSettings();
      } else if (currentType === 'confirm-clear-eval-all') {
        renderConfirmClearEvalAll();
      } else if (currentType === 'confirm-restore-eval-json') {
        renderConfirmRestoreEvalJson();
      } else if (currentType === 'more') renderMoreMenu();
      else if (currentType === 'backup') renderBackupModal();
      else if (currentType === 'clear-confirm') renderClearConfirm();
      else if (currentType === 'migrate-local') renderMigrateLocalModal();
      else if (currentType === 'account') renderAccountModal();
      else if (currentType === 'confirm-reset-ics') renderConfirmResetIcs();
      else if (currentType === 'admin') renderAdminModal();
    }

    // =======================================================================
    // 1. 当天详情弹窗
    // =======================================================================
    function renderDayDetail() {
      var DU = WorkCal.DateUtils;
      var Lunar = WorkCal.Lunar;
      var Color = WorkCal.Color;
      var dateStr = currentPayload.date;
      var p = DU.parseYMD(dateStr);
      var meta = DU.getDayMeta(dateStr);
      var lunar = Lunar.getLunarInfo(p.year, p.month, p.day);
      var events = store.getEventsOnDate(dateStr, { ignoreFilter: true });

      var dayTag = meta.badge
        ? meta.badge === '休'
          ? '法定节假日（休）'
          : '调休上班日（班）'
        : meta.isGray
          ? '周末休息日'
          : '工作日';
      var lunarFull =
        '农历' +
        lunar.lunarMonthName +
        lunar.lunarDayName +
        (lunar.festival ? ' · ' + lunar.festival : '') +
        (lunar.solarTerm ? ' · ' + lunar.solarTerm : '');

      var listHtml;
      if (!events.length) {
        listHtml = '<div class="panel-empty">这一天还没有安排，点击下方按钮即可快速新增。</div>';
      } else {
        listHtml = events
          .map(function (ev) {
            var cat = store.getCategory(ev.categoryId);
            var st = Color.getEventStyles(cat.color);
            var rangeStr =
              ev.endDate && ev.endDate > ev.startDate
                ? DU.formatDisplayDateCN(ev.startDate) + ' 至 ' + DU.formatDisplayDateCN(ev.endDate)
                : DU.formatDisplayDateCN(ev.startDate);
            var timeStr =
              ev.allDay === false
                ? (ev.startTime || '09:00') + ' - ' + (ev.endTime || '18:00')
                : '全天';

            var metaBadges =
              '<span class="tag-badge" style="background:' +
              st.chipBg +
              ';color:' +
              st.textColor +
              ';">' +
              esc(cat.name) +
              '</span>' +
              '<span class="tag-badge">' +
              (ev.source === 'eval' ? '评估项目' : ev.source === 'ledger' ? '台账导入' : '手工录入') +
              '</span>';

            if (ev.ledgerMeta && ev.ledgerMeta.stage) {
              metaBadges += '<span class="tag-badge">' + esc(ev.ledgerMeta.stage) + '</span>';
            }

            return (
              '<div class="detail-event-card" style="--cat-color:' +
              st.borderColor +
              ';--cat-text:' +
              st.textColor +
              ';">' +
              '<div class="detail-event-head">' +
              '<div class="detail-event-title">' +
              esc(ev.title) +
              '</div>' +
              '<div class="detail-badges">' +
              metaBadges +
              '</div>' +
              '</div>' +
              '<div class="day-detail-sub">' +
              esc(rangeStr + ' · ' + timeStr) +
              '</div>' +
              (ev.notes ? '<div class="detail-notes">' + esc(ev.notes) + '</div>' : '') +
              '<div class="detail-actions">' +
              '<button type="button" class="btn btn-outline btn-sm" data-modal-action="edit-event" data-event-id="' +
              esc(ev.id) +
              '">编辑</button>' +
              '<button type="button" class="btn btn-danger btn-sm" data-modal-action="ask-delete-event" data-from="day-detail" data-date="' +
              esc(dateStr) +
              '" data-event-id="' +
              esc(ev.id) +
              '">删除</button>' +
              '</div>' +
              '</div>'
            );
          })
          .join('');
      }

      dialog.innerHTML =
        '<div class="modal-header">' +
        '<h2 id="modal-title" class="modal-title">' +
        esc(DU.formatDisplayDateCN(dateStr) + ' ' + DU.getWeekdayLabel(dateStr)) +
        '</h2>' +
        '<button type="button" class="modal-close" data-modal-action="close" aria-label="关闭">×</button>' +
        '</div>' +
        '<div class="modal-body">' +
        '<div class="day-detail-banner">' +
        '<div><strong>' +
        esc(lunarFull) +
        '</strong><div class="day-detail-sub">' +
        esc(dayTag + (meta.holidayName ? ' · ' + meta.holidayName : '')) +
        '</div></div>' +
        '<span class="tag-badge">共 ' +
        events.length +
        ' 条安排</span>' +
        '</div>' +
        listHtml +
        '</div>' +
        '<div class="modal-footer modal-footer-between">' +
        '<button type="button" class="btn btn-outline" data-modal-action="close">关闭</button>' +
        '<button type="button" class="btn btn-primary" data-modal-action="add-on-day" data-date="' +
        esc(dateStr) +
        '">+ 新增该日日程</button>' +
        '</div>';
    }

    // =======================================================================
    // 2. 新建 / 编辑日程弹窗
    // =======================================================================
    function renderEventEditor() {
      var Color = WorkCal.Color;
      var DU = WorkCal.DateUtils;
      var categories = store.getCategories();
      var editing = currentPayload.eventId ? store.getEventById(currentPayload.eventId) : null;
      var draft = currentPayload.draft || null;
      var assessId = WorkCal.Config.protectedAssessmentCategoryId || 'cat-assessment';

      // 编辑已关联评估项目的「外出评估」日程时，直接切换至完整评估项目编辑弹窗（双向同步）
      // 本地评估数据可能落后于日程（例如其他设备刚新增项目），先刷新一次再决定，避免退回普通日程表单
      if (
        editing &&
        editing.evalProjectId &&
        evalStore &&
        !evalStore.getProjectById(editing.evalProjectId) &&
        !currentPayload.evalReloaded
      ) {
        currentPayload.evalReloaded = true;
        var payloadRef = currentPayload;
        dialog.innerHTML = '<div class="modal-body">正在加载评估项目…</div>';
        Promise.resolve()
          .then(function () {
            return evalStore.loadFromServer();
          })
          .catch(function () {})
          .then(function () {
            if (currentType === 'event-editor' && currentPayload === payloadRef) renderCurrent();
          });
        return;
      }
      if (editing && editing.evalProjectId && evalStore && evalStore.getProjectById(editing.evalProjectId)) {
        currentType = 'eval-project-editor';
        currentPayload = {
          projectId: editing.evalProjectId,
          fromCalendar: true,
          calendarEventId: editing.id
        };
        WorkCal.EvalModals.renderProjectEditor(dialog, evalModalCtx());
        return;
      }

      var firstNonAssess = null;
      for (var fi = 0; fi < categories.length; fi++) {
        if (categories[fi].id !== assessId) {
          firstNonAssess = categories[fi];
          break;
        }
      }

      var defaultCatId =
        (draft && draft.categoryId) ||
        (editing && editing.categoryId) ||
        currentPayload.categoryId ||
        (firstNonAssess ? firstNonAssess.id : categories[0] ? categories[0].id : '__fallback__');

      // 若显式以「外出评估」新建日程，直接进入评估项目同步表单
      if (!editing && defaultCatId === assessId && evalStore) {
        currentType = 'eval-project-editor';
        currentPayload = {
          fromCalendar: true,
          date: currentPayload.date || (draft && draft.startDate) || DU.todayStr(),
          draft: draft
        };
        WorkCal.EvalModals.renderProjectEditor(dialog, evalModalCtx());
        return;
      }

      var activeCat = store.getCategory(defaultCatId);
      if (activeCat.isFallback && categories.length && !editing && !draft) {
        defaultCatId = categories[0].id;
        activeCat = categories[0];
      }

      var titleVal = draft ? draft.title : editing ? editing.title : '';
      var startVal = draft
        ? draft.startDate
        : editing
          ? editing.startDate
          : currentPayload.date || DU.todayStr();
      var endVal = draft ? draft.endDate : editing ? editing.endDate || '' : '';
      var allDayVal = draft ? draft.allDay : editing ? editing.allDay !== false : true;
      var startTimeVal = draft
        ? draft.startTime
        : editing
          ? editing.startTime || '09:00'
          : '09:00';
      var endTimeVal = draft ? draft.endTime : editing ? editing.endTime || '18:00' : '18:00';
      var notesVal = draft ? draft.notes : editing ? editing.notes || '' : '';

      var styles = Color.getEventStyles(activeCat.color);

      var catOptions = categories
        .map(function (c) {
          var sel = c.id === defaultCatId ? ' selected' : '';
          return '<option value="' + esc(c.id) + '"' + sel + '>' + esc(c.name) + '</option>';
        })
        .join('');
      if (activeCat.isFallback) {
        catOptions =
          '<option value="' +
          esc(defaultCatId) +
          '" selected>' +
          esc(activeCat.name) +
          '</option>' +
          catOptions;
      }

      dialog.innerHTML =
        '<div class="modal-header">' +
        '<h2 id="modal-title" class="modal-title">' +
        (editing ? '编辑日程' : '新建日程') +
        '</h2>' +
        '<button type="button" class="modal-close" data-modal-action="close" aria-label="关闭">×</button>' +
        '</div>' +
        '<form id="event-editor-form" class="modal-body" novalidate>' +
        '<div class="form-field">' +
        '<div class="form-label-row"><label class="form-label" for="evt-title">标题 *（最长 60 字）</label><span id="evt-title-count" class="form-hint">' +
        titleVal.length +
        '/60</span></div>' +
        '<div class="title-input-wrap" style="--active-cat-color:' +
        styles.borderColor +
        ';--active-cat-ring:' +
        styles.focusRing +
        ';--active-cat-border:' +
        styles.borderColor +
        ';--active-cat-bg:' +
        styles.softBg +
        ';--active-cat-text:' +
        styles.textColor +
        ';">' +
        '<input id="evt-title" class="input-control title-input-colored" type="text" maxlength="60" placeholder="例如：赴××公司现场评估" value="' +
        esc(titleVal) +
        '" style="color:' +
        styles.textColor +
        ';" required>' +
        '<span id="evt-cat-pill" class="cat-pill-tag">' +
        esc(activeCat.name) +
        '</span>' +
        '</div>' +
        '<div id="evt-form-error" class="field-error hidden"></div>' +
        '</div>' +
        '<div class="form-field">' +
        '<div class="form-label-row">' +
        '<label class="form-label" for="evt-category">行程类别 *</label>' +
        '<button type="button" class="btn btn-subtle btn-sm" data-modal-action="manage-cats-from-editor">管理类别 / 换色</button>' +
        '</div>' +
        '<select id="evt-category" class="select-control">' +
        catOptions +
        '</select>' +
        '</div>' +
        '<div class="form-row-2">' +
        '<div class="form-field">' +
        '<label class="form-label" for="evt-start">开始日期 *</label>' +
        '<input id="evt-start" class="input-control" type="date" value="' +
        esc(startVal) +
        '" required>' +
        '</div>' +
        '<div class="form-field">' +
        '<label class="form-label" for="evt-end">结束日期（跨天可填，留空为单日）</label>' +
        '<input id="evt-end" class="input-control" type="date" value="' +
        esc(endVal) +
        '">' +
        '</div>' +
        '</div>' +
        '<div class="form-field">' +
        '<div class="switch-row">' +
        '<label class="checkbox-label"><input id="evt-allday" type="checkbox"' +
        (allDayVal ? ' checked' : '') +
        '><span>全天行程</span></label>' +
        '<span class="form-hint">关闭后可填写具体起止时刻</span>' +
        '</div>' +
        '</div>' +
        '<div id="evt-time-row" class="form-row-2' +
        (allDayVal ? ' hidden' : '') +
        '">' +
        '<div class="form-field">' +
        '<label class="form-label" for="evt-stime">开始时间</label>' +
        '<input id="evt-stime" class="input-control" type="time" value="' +
        esc(startTimeVal) +
        '">' +
        '</div>' +
        '<div class="form-field">' +
        '<label class="form-label" for="evt-etime">结束时间</label>' +
        '<input id="evt-etime" class="input-control" type="time" value="' +
        esc(endTimeVal) +
        '">' +
        '</div>' +
        '</div>' +
        '<div class="form-field">' +
        '<div class="form-label-row"><label class="form-label" for="evt-notes">备注（地点、联系人、需带材料）</label><span id="evt-notes-count" class="form-hint">' +
        notesVal.length +
        '/500</span></div>' +
        '<textarea id="evt-notes" class="textarea-control" rows="3" maxlength="500" placeholder="选填，最多 500 字">' +
        esc(notesVal) +
        '</textarea>' +
        '</div>' +
        '</form>' +
        '<div class="modal-footer modal-footer-between">' +
        '<div>' +
        (editing
          ? '<button type="button" class="btn btn-danger" data-modal-action="ask-delete-event" data-from="event-editor" data-event-id="' +
            esc(editing.id) +
            '">删除日程</button>'
          : '<button type="button" class="btn btn-outline" data-modal-action="close">取消</button>') +
        '</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
        (editing
          ? '<button type="button" class="btn btn-outline" data-modal-action="close">取消</button>'
          : '<button type="button" class="btn btn-outline" data-modal-action="save-and-next">保存并加下一条</button>') +
        '<button type="button" class="btn btn-primary" data-modal-action="save-event">保存</button>' +
        '</div>' +
        '</div>';

      var titleInput = document.getElementById('evt-title');
      var notesInput = document.getElementById('evt-notes');
      var catSelect = document.getElementById('evt-category');
      var allDayChk = document.getElementById('evt-allday');

      titleInput.addEventListener('input', function () {
        document.getElementById('evt-title-count').textContent = titleInput.value.length + '/60';
        var err = document.getElementById('evt-form-error');
        if (err) err.classList.add('hidden');
      });
      notesInput.addEventListener('input', function () {
        document.getElementById('evt-notes-count').textContent = notesInput.value.length + '/500';
      });
      allDayChk.addEventListener('change', function () {
        document.getElementById('evt-time-row').classList.toggle('hidden', allDayChk.checked);
      });
      catSelect.addEventListener('change', function () {
        if (catSelect.value === assessId && evalStore) {
          var formDraft = readEditorForm();
          currentType = 'eval-project-editor';
          currentPayload = {
            fromCalendar: true,
            calendarEventId: editing ? editing.id : '',
            date: formDraft.startDate || DU.todayStr(),
            draft: formDraft
          };
          WorkCal.EvalModals.renderProjectEditor(dialog, evalModalCtx());
          return;
        }
        var cat = store.getCategory(catSelect.value);
        var st = Color.getEventStyles(cat.color);
        var wrap = titleInput.parentElement;
        titleInput.style.color = st.textColor;
        wrap.style.setProperty('--active-cat-color', st.borderColor);
        wrap.style.setProperty('--active-cat-ring', st.focusRing);
        wrap.style.setProperty('--active-cat-border', st.borderColor);
        wrap.style.setProperty('--active-cat-bg', st.softBg);
        wrap.style.setProperty('--active-cat-text', st.textColor);
        var pill = document.getElementById('evt-cat-pill');
        if (pill) pill.textContent = cat.name;
      });

      setTimeout(function () {
        if (titleInput && !editing) titleInput.focus();
      }, 20);
    }

    function readEditorForm() {
      return {
        title: document.getElementById('evt-title').value.trim(),
        categoryId: document.getElementById('evt-category').value,
        startDate: document.getElementById('evt-start').value,
        endDate: document.getElementById('evt-end').value,
        allDay: document.getElementById('evt-allday').checked,
        startTime: document.getElementById('evt-stime').value || '09:00',
        endTime: document.getElementById('evt-etime').value || '18:00',
        notes: document.getElementById('evt-notes').value
      };
    }

    function validateAndSaveEditor(keepOpenForNext, btn) {
      var data = readEditorForm();
      var errEl = document.getElementById('evt-form-error');
      var showErr = function (msg) {
        errEl.textContent = msg;
        errEl.classList.remove('hidden');
      };

      if (!data.title) {
        showErr('请填写日程标题（不能为空）');
        document.getElementById('evt-title').focus();
        return;
      }
      if (!data.startDate) {
        showErr('请选择开始日期');
        return;
      }
      if (data.endDate && data.endDate < data.startDate) {
        showErr('结束日期不能早于开始日期');
        return;
      }

      var editingId = currentPayload.eventId;
      runBusy(btn, function () {
        if (editingId && !keepOpenForNext) {
          return store.updateEvent(editingId, data).then(function (updatedEvt) {
            // 关联日程改日期时服务端已回写项目，同步刷新本地评估数据
            if (evalStore && updatedEvt && updatedEvt.evalProjectId) {
              return evalStore.loadFromServer().catch(function () {});
            }
          }).then(function () {
            showToast('日程已更新', 'success');
            onDataChanged();
            isBusy = false;
            close();
          });
        }
        return store.addEvent(data).then(function () {
          onDataChanged();
          if (keepOpenForNext) {
            showToast('已保存，可继续录入下一条', 'success');
            var tEl = document.getElementById('evt-title');
            var nEl = document.getElementById('evt-notes');
            if (tEl) tEl.value = '';
            if (nEl) nEl.value = '';
            var tc = document.getElementById('evt-title-count');
            var nc = document.getElementById('evt-notes-count');
            if (tc) tc.textContent = '0/60';
            if (nc) nc.textContent = '0/500';
            errEl.classList.add('hidden');
            if (tEl) tEl.focus();
          } else {
            showToast('已新增日程', 'success');
            isBusy = false;
            close();
          }
        });
      });
    }

    // =======================================================================
    // 2.5 误删二次确认弹窗（单条日程 / 类别）
    // =======================================================================
    function renderConfirmDeleteEvent() {
      var ev = store.getEventById(currentPayload.eventId);
      if (!ev) {
        close();
        return;
      }
      var DU = WorkCal.DateUtils;
      var cat = store.getCategory(ev.categoryId);
      var range =
        ev.endDate && ev.endDate > ev.startDate
          ? DU.formatDisplayDateCN(ev.startDate) + ' 至 ' + DU.formatDisplayDateCN(ev.endDate)
          : DU.formatDisplayDateCN(ev.startDate);

      dialog.innerHTML =
        '<div class="modal-header">' +
        '<h2 id="modal-title" class="modal-title">确认删除日程</h2>' +
        '<button type="button" class="modal-close" data-modal-action="cancel-delete-event" aria-label="关闭">×</button>' +
        '</div>' +
        '<div class="modal-body">' +
        '<div class="danger-box">' +
        '<strong>确定要永久删除这条日程吗？</strong><br>' +
        '<div style="margin-top:6px;">标题：<strong>' +
        esc(ev.title) +
        '</strong></div>' +
        '<div>时间：' +
        esc(range) +
        ' · 类别：' +
        esc(cat.name) +
        '</div>' +
        (ev.evalProjectId
          ? '<div style="margin-top:8px;color:#b91c1c;font-weight:600;">⚠️ 该日程关联「评估项目管理平台」的项目记录，删除后将同步删除对应的项目记录（历史差旅支出保留）。</div>'
          : '') +
        '</div>' +
        '</div>' +
        '<div class="modal-footer modal-footer-between">' +
        '<button type="button" class="btn btn-outline" data-modal-action="cancel-delete-event">取消返回</button>' +
        '<button type="button" class="btn btn-danger-solid" data-modal-action="confirm-delete-event">确认删除</button>' +
        '</div>';
    }

    function renderConfirmDeleteCat() {
      var cat = store.getCategory(currentPayload.catId);
      var count = store.countEventsByCategory(currentPayload.catId);
      dialog.innerHTML =
        '<div class="modal-header">' +
        '<h2 id="modal-title" class="modal-title">确认删除类别</h2>' +
        '<button type="button" class="modal-close" data-modal-action="cancel-delete-cat" aria-label="关闭">×</button>' +
        '</div>' +
        '<div class="modal-body">' +
        '<div class="danger-box">' +
        '<strong>确定要删除类别“' +
        esc(cat.name) +
        '”吗？</strong><br>' +
        (count > 0
          ? '当前共有 <strong>' + count + '</strong> 条日程属于该类别，删除后这些日程会被保留，但显示为默认灰色兜底样式。'
          : '当前暂无日程使用该类别，删除后不可恢复。') +
        '</div>' +
        '</div>' +
        '<div class="modal-footer modal-footer-between">' +
        '<button type="button" class="btn btn-outline" data-modal-action="cancel-delete-cat">取消返回</button>' +
        '<button type="button" class="btn btn-danger-solid" data-modal-action="confirm-delete-cat">确认删除类别</button>' +
        '</div>';
    }

    // =======================================================================
    // 3. 类别自主管理弹窗
    // =======================================================================
    function renderPaletteHtml(targetId, currentHex) {
      var Color = WorkCal.Color;
      var norm = Color.normalizeHex(currentHex);
      var swatches = Color.PRESET_COLORS.map(function (hex) {
        var sel = hex === norm ? ' is-selected' : '';
        return (
          '<button type="button" class="palette-swatch' +
          sel +
          '" data-modal-action="pick-preset-color" data-target-id="' +
          esc(targetId) +
          '" data-color="' +
          hex +
          '" style="background:' +
          hex +
          ';" title="' +
          hex +
          '" aria-label="选择颜色 ' +
          hex +
          '"></button>'
        );
      }).join('');

      return (
        '<div class="palette-popover">' +
        '<div class="palette-grid">' +
        swatches +
        '</div>' +
        '<div class="palette-custom-row">' +
        '<span>自定义任意颜色（支持浅色自动压暗字色）：</span>' +
        '<input type="color" value="' +
        esc(norm) +
        '" data-modal-color-picker="' +
        esc(targetId) +
        '" aria-label="自定义取色器">' +
        '</div>' +
        '</div>'
      );
    }

    function renderCategoryManager() {
      var cats = store.getCategories();

      var listHtml = cats.length
        ? cats
            .map(function (c, idx) {
              var isProtected = Boolean(
                c.protected || c.id === (WorkCal.Config.protectedAssessmentCategoryId || 'cat-assessment')
              );
              var paletteHtml =
                openPaletteForId === c.id ? renderPaletteHtml(c.id, c.color) : '';
              return (
                '<div>' +
                '<div class="cat-row">' +
                '<span class="cat-priority-num" title="优先级第 ' +
                (idx + 1) +
                ' 位">' +
                (idx + 1) +
                '</span>' +
                '<button type="button" class="cat-color-trigger" data-modal-action="toggle-palette" data-target-id="' +
                esc(c.id) +
                '" style="background:' +
                esc(c.color) +
                ';" title="点击换色"></button>' +
                '<input type="text" class="input-control cat-name-input" maxlength="20" value="' +
                esc(c.name) +
                '" data-orig-name="' +
                esc(c.name) +
                '" data-cat-rename="' +
                esc(c.id) +
                '"' +
                (isProtected ? ' readonly title="系统保护类别，不可改名（可换色与调序）"' : '') +
                ' aria-label="类别名称">' +
                (isProtected ? '<span class="tag-badge" style="background:#fff7ed;color:#c2410c;">保护</span>' : '') +
                '<div class="cat-row-actions">' +
                '<button type="button" class="btn btn-subtle btn-sm" data-modal-action="move-cat-up" data-cat-id="' +
                esc(c.id) +
                '"' +
                (idx === 0 ? ' disabled' : '') +
                ' title="上移提高优先级">↑</button>' +
                '<button type="button" class="btn btn-subtle btn-sm" data-modal-action="move-cat-down" data-cat-id="' +
                esc(c.id) +
                '"' +
                (idx === cats.length - 1 ? ' disabled' : '') +
                ' title="下移降低优先级">↓</button>' +
                '<button type="button" class="btn btn-danger btn-sm" data-modal-action="ask-delete-cat" data-cat-id="' +
                esc(c.id) +
                '"' +
                (isProtected ? ' disabled title="系统保护类别不可删除"' : ' title="删除类别"') +
                '>删</button>' +
                '</div>' +
                '</div>' +
                paletteHtml +
                '</div>'
              );
            })
            .join('')
        : '<div class="panel-empty">当前没有类别，请在下方新增。</div>';

      var newPaletteHtml =
        openPaletteForId === '__new__' ? renderPaletteHtml('__new__', newCatColor) : '';

      var returnBtn = savedEditorDraft
        ? '<button type="button" class="btn btn-primary" data-modal-action="return-to-editor">返回日程编辑</button>'
        : '<button type="button" class="btn btn-primary" data-modal-action="close">完成</button>';

      dialog.innerHTML =
        '<div class="modal-header">' +
        '<h2 id="modal-title" class="modal-title">类别与颜色管理</h2>' +
        '<button type="button" class="modal-close" data-modal-action="' +
        (savedEditorDraft ? 'return-to-editor' : 'close') +
        '" aria-label="关闭">×</button>' +
        '</div>' +
        '<div class="modal-body">' +
        '<div class="form-hint">提示：列表顺序即同日多条日程的取色优先级（第 1 位最高）。修改名称失焦即时保存，点击色块可展开 28 种预设色或自定义取色。</div>' +
        listHtml +
        '<div style="padding-top:8px;border-top:1px solid var(--border-subtle);">' +
        '<div class="form-label" style="margin-bottom:6px;">新增类别</div>' +
        '<div class="cat-row">' +
        '<button type="button" class="cat-color-trigger" data-modal-action="toggle-palette" data-target-id="__new__" style="background:' +
        esc(newCatColor) +
        ';" title="点击选择新类别颜色"></button>' +
        '<input id="new-cat-name" type="text" class="input-control cat-name-input" maxlength="20" placeholder="输入新类别名称（如：内部评审）">' +
        '<button type="button" class="btn btn-primary btn-sm" data-modal-action="add-category">新增</button>' +
        '</div>' +
        newPaletteHtml +
        '</div>' +
        '</div>' +
        '<div class="modal-footer">' +
        returnBtn +
        '</div>';

      var renameInputs = dialog.querySelectorAll('[data-cat-rename]');
      for (var i = 0; i < renameInputs.length; i++) {
        (function (inp) {
          var commit = function () {
            var cid = inp.getAttribute('data-cat-rename');
            var orig = inp.getAttribute('data-orig-name') || '';
            var val = inp.value.trim();
            if (!val) {
              inp.value = orig;
              return;
            }
            if (val === orig) return;
            inp.setAttribute('data-orig-name', val);
            store
              .updateCategory(cid, { name: val })
              .then(function () {
                onDataChanged();
                showToast('类别名称已保存', 'success');
              })
              .catch(function (err) {
                inp.value = orig;
                inp.setAttribute('data-orig-name', orig);
                showToast(err.message || '改名失败', 'error');
              });
          };
          inp.addEventListener('blur', commit);
          inp.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
              inp.blur();
            }
          });
        })(renameInputs[i]);
      }

      var pickers = dialog.querySelectorAll('[data-modal-color-picker]');
      for (var j = 0; j < pickers.length; j++) {
        (function (picker) {
          picker.addEventListener('input', function () {
            var tid = picker.getAttribute('data-modal-color-picker');
            if (tid === '__new__') {
              newCatColor = picker.value.toUpperCase();
              var trig = dialog.querySelector('[data-target-id="__new__"].cat-color-trigger');
              if (trig) trig.style.background = newCatColor;
            } else {
              var trig2 = dialog.querySelector('[data-target-id="' + tid + '"].cat-color-trigger');
              if (trig2) trig2.style.background = picker.value;
            }
          });
          picker.addEventListener('change', function () {
            var tid = picker.getAttribute('data-modal-color-picker');
            if (tid === '__new__') return;
            store
              .updateCategory(tid, { color: picker.value })
              .then(function () {
                onDataChanged();
                showToast('已更新类别颜色', 'success');
              })
              .catch(function (err) {
                showToast(err.message || '换色失败', 'error');
              });
          });
        })(pickers[j]);
      }
    }

    // =======================================================================
    // 4. 《评估项目台账》导入与预览弹窗
    // =======================================================================
    function renderLedgerImport() {
      var categories = store.getCategories();

      if (!ledgerParseState) {
        dialog.innerHTML =
          '<div class="modal-header">' +
          '<h2 id="modal-title" class="modal-title">导入《评估项目台账》</h2>' +
          '<button type="button" class="modal-close" data-modal-action="close" aria-label="关闭">×</button>' +
          '</div>' +
          '<div class="modal-body">' +
          '<div id="ledger-dropzone" class="dropzone" tabindex="0">' +
          '<div><strong>点击选择或拖入 Excel (.xlsx) / CSV (.csv) 文件</strong></div>' +
          '<div class="form-hint" style="margin-top:4px;">支持自动识别表头行、合并单元格沿用上一行、预/正式评估拆分为独立日程，不覆盖手工日程</div>' +
          '<input id="ledger-file-input" type="file" accept=".xlsx,.csv,.tsv,.txt,.xls" class="hidden">' +
          '</div>' +
          '<div class="form-field">' +
          '<div class="form-label-row">' +
          '<label class="form-label" for="ledger-paste-box">或直接从 Excel 复制表格粘贴到此处</label>' +
          '<button type="button" class="btn btn-subtle btn-sm" data-modal-action="fill-sample-ledger">填入示例台账测试</button>' +
          '</div>' +
          '<textarea id="ledger-paste-box" class="textarea-control" rows="6" placeholder="在 Excel 中选中含表头的数据区域按 Ctrl+C，再在此处按 Ctrl+V 粘贴..."></textarea>' +
          '</div>' +
          '<div id="ledger-parse-error" class="field-error hidden"></div>' +
          '</div>' +
          '<div class="modal-footer modal-footer-between">' +
          '<button type="button" class="btn btn-outline" data-modal-action="close">取消</button>' +
          '<button type="button" class="btn btn-primary" data-modal-action="parse-pasted-ledger">识别粘贴内容并预览</button>' +
          '</div>';

        var dropzone = document.getElementById('ledger-dropzone');
        var fileInput = document.getElementById('ledger-file-input');
        var errBox = document.getElementById('ledger-parse-error');

        var handleFile = function (file) {
          if (!file) return;
          errBox.classList.add('hidden');
          WorkCal.Importer.parseFileAsync(file)
            .then(function (gridRes) {
              var parsed = WorkCal.Importer.parseLedgerGrid(gridRes.rows, {
                date1904: gridRes.date1904
              });
              ledgerParseState = {
                rawParsed: parsed,
                customStageMap: null
              };
              renderLedgerImport();
            })
            .catch(function (err) {
              errBox.textContent = err.message || '文件解析失败';
              errBox.classList.remove('hidden');
            });
        };

        dropzone.addEventListener('click', function () {
          fileInput.click();
        });
        fileInput.addEventListener('change', function () {
          if (fileInput.files && fileInput.files[0]) handleFile(fileInput.files[0]);
        });
        dropzone.addEventListener('dragover', function (e) {
          e.preventDefault();
          dropzone.classList.add('is-dragover');
        });
        dropzone.addEventListener('dragleave', function () {
          dropzone.classList.remove('is-dragover');
        });
        dropzone.addEventListener('drop', function (e) {
          e.preventDefault();
          dropzone.classList.remove('is-dragover');
          if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
            handleFile(e.dataTransfer.files[0]);
          }
        });
        return;
      }

      var preview = WorkCal.Importer.buildImportPreview(
        ledgerParseState.rawParsed,
        store,
        ledgerParseState.customStageMap
      );
      ledgerParseState.latestPreview = preview;

      var stageMapRows = preview.stages
        .map(function (st) {
          var count = preview.stageCounts[st] || 0;
          var curCatId = preview.stageMap[st];
          var opts = categories
            .map(function (c) {
              return (
                '<option value="' +
                esc(c.id) +
                '"' +
                (c.id === curCatId ? ' selected' : '') +
                '>' +
                esc(c.name) +
                '</option>'
              );
            })
            .join('');
          return (
            '<div class="cat-row stage-map-row">' +
            '<span class="stage-map-label">' +
            esc(st) +
            '（' +
            count +
            ' 条）</span>' +
            '<span class="form-hint">映射到类别：</span>' +
            '<select class="select-control stage-map-select" data-stage-map="' +
            esc(st) +
            '">' +
            opts +
            '</select>' +
            '</div>'
          );
        })
        .join('');

      var tableRows = preview.entries
        .slice(0, 50)
        .map(function (e) {
          return (
            '<tr>' +
            '<td>' +
            e.rowNumber +
            '</td>' +
            '<td>' +
            esc(e.title) +
            '</td>' +
            '<td>' +
            esc(e.ledgerMeta.stage) +
            '</td>' +
            '<td>' +
            esc(e.startDate + ' ~ ' + e.endDate) +
            '</td>' +
            '<td>' +
            (e.isUpdate
              ? '<span class="tag-badge">更新已有</span>'
              : '<span class="tag-badge" style="background:#dcfce7;color:#166534;">新增</span>') +
            '</td>' +
            '</tr>'
          );
        })
        .join('');

      var skipHtml = preview.skipped.length
        ? '<div class="skip-list"><strong>已跳过 ' +
          preview.skipped.length +
          ' 行（含原因说明）：</strong><ul>' +
          preview.skipped
            .map(function (sk) {
              return (
                '<li>第 ' +
                sk.rowNumber +
                ' 行（' +
                esc(sk.projectName) +
                (sk.stage ? ' - ' + esc(sk.stage) : '') +
                '）：' +
                esc(sk.reason) +
                '</li>'
              );
            })
            .join('') +
          '</ul></div>'
        : '';

      dialog.innerHTML =
        '<div class="modal-header">' +
        '<h2 id="modal-title" class="modal-title">导入预览与确认</h2>' +
        '<button type="button" class="modal-close" data-modal-action="close" aria-label="关闭">×</button>' +
        '</div>' +
        '<div class="modal-body">' +
        '<div class="preview-stats-grid">' +
        '<div class="preview-stat-box"><div class="preview-stat-num">' +
        preview.summary.totalRecognized +
        '</div><div class="preview-stat-label">识别有效日程</div></div>' +
        '<div class="preview-stat-box"><div class="preview-stat-num" style="color:#166534;">' +
        preview.summary.newCount +
        '</div><div class="preview-stat-label">本次新增</div></div>' +
        '<div class="preview-stat-box"><div class="preview-stat-num" style="color:#2563eb;">' +
        preview.summary.updateCount +
        '</div><div class="preview-stat-label">更新已有台账</div></div>' +
        '<div class="preview-stat-box"><div class="preview-stat-num" style="color:#b45309;">' +
        preview.summary.skippedCount +
        '</div><div class="preview-stat-label">已跳过行数</div></div>' +
        '</div>' +
        (stageMapRows
          ? '<div class="form-field"><div class="form-label">评估阶段 → 类别映射（可调整）</div>' +
            stageMapRows +
            '</div>'
          : '') +
        (preview.entries.length
          ? '<div class="preview-table-wrap"><table class="preview-table"><thead><tr><th>行</th><th>项目名称</th><th>阶段</th><th>起止日期</th><th>动作</th></tr></thead><tbody>' +
            tableRows +
            '</tbody></table></div>'
          : '<div class="panel-empty">没有可导入的有效日程行</div>') +
        skipHtml +
        '</div>' +
        '<div class="modal-footer modal-footer-between">' +
        '<button type="button" class="btn btn-outline" data-modal-action="reset-ledger-import">重新选择文件</button>' +
        '<div class="modal-footer-actions">' +
        '<button type="button" class="btn btn-outline" data-modal-action="close">取消</button>' +
        '<button type="button" class="btn btn-primary" data-modal-action="confirm-ledger-import"' +
        (preview.entries.length === 0 ? ' disabled' : '') +
        '>确认导入（' +
        preview.entries.length +
        ' 条）</button>' +
        '</div>' +
        '</div>';

      var selects = dialog.querySelectorAll('[data-stage-map]');
      for (var i = 0; i < selects.length; i++) {
        (function (sel) {
          sel.addEventListener('change', function () {
            var stage = sel.getAttribute('data-stage-map');
            ledgerParseState.customStageMap =
              ledgerParseState.customStageMap || Object.assign({}, preview.stageMap);
            ledgerParseState.customStageMap[stage] = sel.value;
            renderLedgerImport();
          });
        })(selects[i]);
      }
    }

    // =======================================================================
    // 5. 更多菜单 / 数据备份 / 清空确认 / 本地旧数据迁移
    // =======================================================================
    function renderMoreMenu() {
      var user = getCurrentUser ? getCurrentUser() : null;
      var isAdmin = user && user.role === 'admin';

      dialog.innerHTML =
        '<div class="modal-header">' +
        '<h2 id="modal-title" class="modal-title">更多工具与数据管理</h2>' +
        '<button type="button" class="modal-close" data-modal-action="close" aria-label="关闭">×</button>' +
        '</div>' +
        '<div class="modal-body">' +
        '<div class="menu-grid">' +
        '<button type="button" class="menu-tile" data-modal-action="go-import"><strong>📥 导入《评估项目台账》</strong><span>上传 Excel / CSV 或粘贴表格批量生成日程</span></button>' +
        '<button type="button" class="menu-tile" data-modal-action="go-categories"><strong>⚙ 类别与颜色管理</strong><span>增删改类别、排序调整同日优先级</span></button>' +
        '<button type="button" class="menu-tile" data-modal-action="go-account"><strong>👤 账号设置与日历订阅</strong><span>修改密码、获取手机自动同步 .ics 订阅地址</span></button>' +
        '<button type="button" class="menu-tile" data-modal-action="go-backup"><strong>💾 JSON 备份与恢复</strong><span>导出全部日程与类别，或从 JSON 文件还原</span></button>' +
        '<button type="button" class="menu-tile" data-modal-action="export-ics"><strong>📅 下载 .ics 日历文件</strong><span>一次性导出当前全部日程到本地文件</span></button>' +
        '<button type="button" class="menu-tile" data-modal-action="print-month"><strong>🖨 打印当前月视图</strong><span>保留日期底色、类别颜色与跨天边框</span></button>' +
        (isAdmin
          ? '<button type="button" class="menu-tile" data-modal-action="go-admin"><strong>🛡 管理员后台</strong><span>账号管理、节假日同步与数据库备份</span></button>'
          : '') +
        '<button type="button" class="menu-tile" data-modal-action="go-clear"><strong style="color:#dc2626;">🗑 清空全部日程</strong><span>不可恢复操作，执行前将提示先备份</span></button>' +
        '</div>' +
        '</div>' +
        '<div class="modal-footer">' +
        '<button type="button" class="btn btn-outline" data-modal-action="close">关闭</button>' +
        '</div>';
    }

    function renderBackupModal() {
      dialog.innerHTML =
        '<div class="modal-header">' +
        '<h2 id="modal-title" class="modal-title">JSON 备份与恢复</h2>' +
        '<button type="button" class="modal-close" data-modal-action="close" aria-label="关闭">×</button>' +
        '</div>' +
        '<div class="modal-body">' +
        '<div class="form-field">' +
        '<div class="form-label">1. 导出个人全量备份</div>' +
        '<div class="form-hint">包含您云端账号下的所有日程与自定义类别设置。</div>' +
        '<div><button type="button" class="btn btn-primary" data-modal-action="download-json">下载 JSON 备份文件</button></div>' +
        '</div>' +
        '<div class="form-field" style="padding-top:10px;border-top:1px solid var(--border-subtle);">' +
        '<div class="form-label">2. 从备份文件恢复到云端</div>' +
        '<div class="form-hint">选择此前导出的 .json 备份文件：</div>' +
        '<input id="backup-file-input" type="file" accept=".json,application/json" class="input-control">' +
        '<div style="display:flex;gap:12px;margin-top:6px;flex-wrap:wrap;">' +
        '<label class="checkbox-label"><input type="radio" name="restore-mode" value="replace" checked><span>完全还原（覆盖当前日程与类别）</span></label>' +
        '<label class="checkbox-label"><input type="radio" name="restore-mode" value="merge"><span>合并导入（保留现有不重复项）</span></label>' +
        '</div>' +
        '<div id="backup-error" class="field-error hidden"></div>' +
        '</div>' +
        '</div>' +
        '<div class="modal-footer modal-footer-between">' +
        '<button type="button" class="btn btn-outline" data-modal-action="back-more">返回更多</button>' +
        '<button type="button" class="btn btn-primary" data-modal-action="restore-json">确认恢复备份</button>' +
        '</div>';
    }

    function renderClearConfirm() {
      var allEvts = store.getEvents();
      var manualCount = allEvts.filter(function (e) {
        return !e.evalProjectId;
      }).length;
      var evalCount = allEvts.length - manualCount;
      dialog.innerHTML =
        '<div class="modal-header">' +
        '<h2 id="modal-title" class="modal-title">清空全部普通日程</h2>' +
        '<button type="button" class="modal-close" data-modal-action="close" aria-label="关闭">×</button>' +
        '</div>' +
        '<div class="modal-body">' +
        '<div class="danger-box"><strong>⚠️ 不可恢复操作提醒：</strong><br>即将永久删除云端保存的 <strong>' +
        manualCount +
        '</strong> 条普通日程（类别设置会保留）。' +
        (evalCount > 0
          ? '<br>另有 <strong>' +
            evalCount +
            '</strong> 条由「评估项目管理平台」联动的日程将被自动保留（如需清空请前往「评估项目 → 设置」）。'
          : '') +
        '建议先下载 JSON 备份再继续。</div>' +
        '<div><button type="button" class="btn btn-outline btn-sm" data-modal-action="download-json">先导出 JSON 备份</button></div>' +
        '</div>' +
        '<div class="modal-footer modal-footer-between">' +
        '<button type="button" class="btn btn-outline" data-modal-action="back-more">取消返回</button>' +
        '<button type="button" class="btn btn-danger-solid" data-modal-action="confirm-clear-all">确认永久清空</button>' +
        '</div>';
    }

    function renderMigrateLocalModal() {
      var legacy = currentPayload.legacy;
      if (!legacy) {
        close();
        return;
      }
      dialog.innerHTML =
        '<div class="modal-header">' +
        '<h2 id="modal-title" class="modal-title">检测到本机旧版日程数据</h2>' +
        '<button type="button" class="modal-close" data-modal-action="close" aria-label="关闭">×</button>' +
        '</div>' +
        '<div class="modal-body">' +
        '<div class="info-box">' +
        '检测到当前浏览器本地存有旧版单机数据：<strong>' +
        legacy.events.length +
        '</strong> 条日程与 <strong>' +
        legacy.categories.length +
        '</strong> 个类别。是否将其一键合并迁移到当前云端账号？' +
        '</div>' +
        '<div class="form-hint">迁移采用合并模式，不会覆盖您云端已有的日程，迁移成功后会自动清理旧版浏览器缓存。</div>' +
        '</div>' +
        '<div class="modal-footer modal-footer-between">' +
        '<button type="button" class="btn btn-outline" data-modal-action="dismiss-legacy-local">忽略并清理本地旧缓存</button>' +
        '<div class="modal-footer-actions">' +
        '<button type="button" class="btn btn-outline" data-modal-action="close">暂不处理</button>' +
        '<button type="button" class="btn btn-primary" data-modal-action="confirm-migrate-local">一键迁移到云端</button>' +
        '</div>' +
        '</div>';
    }

    // =======================================================================
    // 6. 个人账号设置 & .ics 日历订阅
    // =======================================================================
    function renderAccountModal() {
      var user = getCurrentUser ? getCurrentUser() : null;
      if (!user) {
        close();
        return;
      }
      var icsUrl =
        window.location.origin + '/ics/' + encodeURIComponent(user.icsToken || '') + '.ics';

      dialog.innerHTML =
        '<div class="modal-header">' +
        '<h2 id="modal-title" class="modal-title">个人账号与日历订阅</h2>' +
        '<button type="button" class="modal-close" data-modal-action="close" aria-label="关闭">×</button>' +
        '</div>' +
        '<div class="modal-body">' +
        '<div class="account-summary-bar">' +
        '<div>' +
        '<div class="account-summary-name">' +
        esc(user.displayName) +
        ' <span class="tag-badge">' +
        (user.role === 'admin' ? '管理员' : '普通用户') +
        '</span></div>' +
        '<div class="form-hint">登录账号 ID：<strong>' +
        esc(user.username) +
        '</strong></div>' +
        '</div>' +
        '<button type="button" class="btn btn-danger btn-sm" data-modal-action="logout">退出登录</button>' +
        '</div>' +
        '<div class="section-block">' +
        '<div class="form-label">显示名称</div>' +
        '<div class="inline-form-row">' +
        '<input id="acct-display-name" type="text" class="input-control" maxlength="32" value="' +
        esc(user.displayName) +
        '" placeholder="请输入显示名称">' +
        '<button type="button" class="btn btn-primary btn-sm" data-modal-action="save-profile">保存</button>' +
        '</div>' +
        '</div>' +
        '<div class="section-block">' +
        '<div class="form-label">私有日历订阅链接（.ics 自动同步）</div>' +
        '<div class="form-hint">在 iPhone 日历、安卓日历或 Outlook 中添加「订阅日历」并粘贴以下地址，手机端会自动同步您的最新日程（只读）。请勿将此链接公开分享。</div>' +
        '<div class="inline-form-row">' +
        '<input id="acct-ics-url" type="text" class="input-control mono-input" readonly value="' +
        esc(icsUrl) +
        '">' +
        '<button type="button" class="btn btn-primary btn-sm" data-modal-action="copy-ics-url">复制</button>' +
        '</div>' +
        '<div class="ics-reset-row">' +
        '<span class="form-hint">若链接不慎泄露，可随时重置，旧链接将立即失效。</span>' +
        '<button type="button" class="btn btn-outline btn-sm" data-modal-action="ask-reset-ics">重置链接</button>' +
        '</div>' +
        '</div>' +
        '<div class="section-block">' +
        '<div class="form-label">修改登录密码</div>' +
        '<div class="form-field">' +
        '<input id="acct-cur-pwd" type="password" class="input-control" autocomplete="current-password" placeholder="当前密码">' +
        '</div>' +
        '<div class="form-row-2">' +
        '<input id="acct-new-pwd" type="password" class="input-control" autocomplete="new-password" placeholder="新密码（至少 6 位）">' +
        '<input id="acct-confirm-pwd" type="password" class="input-control" autocomplete="new-password" placeholder="再次确认新密码">' +
        '</div>' +
        '<div id="acct-pwd-error" class="field-error hidden"></div>' +
        '<div><button type="button" class="btn btn-outline btn-sm" data-modal-action="change-password">更新密码</button></div>' +
        '</div>' +
        '</div>' +
        '<div class="modal-footer">' +
        '<button type="button" class="btn btn-primary" data-modal-action="close">完成</button>' +
        '</div>';
    }

    function renderConfirmResetIcs() {
      dialog.innerHTML =
        '<div class="modal-header">' +
        '<h2 id="modal-title" class="modal-title">重置日历订阅链接</h2>' +
        '<button type="button" class="modal-close" data-modal-action="go-account" aria-label="关闭">×</button>' +
        '</div>' +
        '<div class="modal-body">' +
        '<div class="danger-box"><strong>确认重置您的私有 .ics 订阅链接吗？</strong><br>重置后，旧链接将立刻失效，此前已在手机或电脑日历订阅的链接需要重新订阅新地址。</div>' +
        '</div>' +
        '<div class="modal-footer modal-footer-between">' +
        '<button type="button" class="btn btn-outline" data-modal-action="go-account">取消返回</button>' +
        '<button type="button" class="btn btn-danger-solid" data-modal-action="confirm-reset-ics">确认重置</button>' +
        '</div>';
    }

    // =======================================================================
    // 7. 管理员后台（账号管理 / 节假日维护 / 数据库备份）
    // =======================================================================
    function loadAdminTabData(tab) {
      adminState.tab = tab;
      adminState.loading = true;
      renderAdminModal();

      var promise;
      if (tab === 'users') {
        promise = api.adminListUsers().then(function (res) {
          adminState.users = (res && res.users) || [];
        });
      } else if (tab === 'holidays') {
        promise = api.adminGetHolidays().then(function (res) {
          adminState.holidays = res;
          if (res && res.years && res.years.length && res.years.indexOf(adminState.selectedHolidayYear) === -1) {
            adminState.selectedHolidayYear = res.years[res.years.length - 1];
          }
        });
      } else {
        promise = api.adminListBackups().then(function (res) {
          adminState.backups = res;
        });
      }

      promise
        .catch(function (err) {
          showToast(err.message || '加载管理数据失败', 'error');
        })
        .finally(function () {
          adminState.loading = false;
          if (currentType === 'admin') renderAdminModal();
        });
    }

    function renderAdminUsersTab() {
      var me = getCurrentUser ? getCurrentUser() : null;
      var bannerHtml = '';
      if (adminState.credentialBanner) {
        var b = adminState.credentialBanner;
        bannerHtml =
          '<div class="credential-banner">' +
          '<div><strong>' +
          esc(b.title) +
          '</strong><div class="form-hint" style="margin-top:2px;">账号 ID：<code>' +
          esc(b.username) +
          '</code>　新密码：<code>' +
          esc(b.password) +
          '</code></div></div>' +
          '<button type="button" class="btn btn-primary btn-sm" data-modal-action="copy-admin-cred">复制账号密码</button>' +
          '</div>';
      }

      var rowsHtml = adminState.users
        .map(function (u) {
          var isSelf = me && me.id === u.id;
          var confirmDel = adminState.confirmDeleteUserId === u.id;
          var actionsHtml = '';
          if (confirmDel) {
            actionsHtml =
              '<button type="button" class="btn btn-danger-solid btn-sm" data-modal-action="admin-confirm-delete-user" data-user-id="' +
              esc(u.id) +
              '">确认删除</button>' +
              '<button type="button" class="btn btn-outline btn-sm" data-modal-action="admin-cancel-delete-user">取消</button>';
          } else {
            actionsHtml =
              '<button type="button" class="btn btn-outline btn-sm" data-modal-action="admin-reset-pwd" data-user-id="' +
              esc(u.id) +
              '" data-username="' +
              esc(u.username) +
              '">重置密码</button>' +
              (!isSelf
                ? '<button type="button" class="btn btn-subtle btn-sm" data-modal-action="admin-toggle-active" data-user-id="' +
                  esc(u.id) +
                  '" data-active="' +
                  (u.isActive ? '1' : '0') +
                  '">' +
                  (u.isActive ? '禁用' : '启用') +
                  '</button>' +
                  '<button type="button" class="btn btn-danger btn-sm" data-modal-action="admin-ask-delete-user" data-user-id="' +
                  esc(u.id) +
                  '">删除</button>'
                : '<span class="form-hint">当前账号</span>');
          }

          return (
            '<tr>' +
            '<td><strong>' +
            esc(u.username) +
            '</strong><div class="form-hint">' +
            esc(u.displayName) +
            '</div></td>' +
            '<td><span class="tag-badge">' +
            (u.role === 'admin' ? '管理员' : '普通用户') +
            '</span> ' +
            (u.isActive
              ? '<span class="tag-badge badge-ok">启用</span>'
              : '<span class="tag-badge badge-disabled">已禁用</span>') +
            '</td>' +
            '<td>' +
            (u.eventCount || 0) +
            ' 条</td>' +
            '<td>' +
            esc(formatDateTimeShort(u.lastLoginAt)) +
            '</td>' +
            '<td><div class="admin-row-actions">' +
            actionsHtml +
            '</div></td>' +
            '</tr>'
          );
        })
        .join('');

      return (
        bannerHtml +
        '<div class="preview-table-wrap">' +
        '<table class="preview-table admin-table">' +
        '<thead><tr><th>账号 / 名称</th><th>角色与状态</th><th>日程数</th><th>最近登录</th><th>操作</th></tr></thead>' +
        '<tbody>' +
        (rowsHtml || '<tr><td colspan="5" class="panel-empty">暂无账号</td></tr>') +
        '</tbody>' +
        '</table>' +
        '</div>' +
        '<div class="section-block">' +
        '<div class="form-label">新建账号</div>' +
        '<div class="form-row-2">' +
        '<input id="admin-new-username" type="text" class="input-control" maxlength="32" placeholder="账号 ID（字母/数字/_/-，如 zhangsan）">' +
        '<input id="admin-new-display" type="text" class="input-control" maxlength="32" placeholder="显示名称（如 张三，选填）">' +
        '</div>' +
        '<div class="form-row-2">' +
        '<input id="admin-new-password" type="text" class="input-control" maxlength="100" placeholder="初始密码（留空则自动生成强密码）">' +
        '<select id="admin-new-role" class="select-control"><option value="user">普通用户</option><option value="admin">管理员</option></select>' +
        '</div>' +
        '<div id="admin-user-error" class="field-error hidden"></div>' +
        '<div><button type="button" class="btn btn-primary btn-sm" data-modal-action="admin-create-user">+ 创建账号</button></div>' +
        '</div>'
      );
    }

    function renderAdminHolidaysTab() {
      var data = adminState.holidays || { years: [], entries: [] };
      var years = data.years || [];
      var curYear = adminState.selectedHolidayYear;
      var entries = (data.entries || []).filter(function (e) {
        return e.year === curYear;
      });
      var nextSuggestedYear = years.length ? years[years.length - 1] + 1 : new Date().getFullYear() + 1;

      var yearBtns = years
        .map(function (y) {
          return (
            '<button type="button" class="btn btn-sm ' +
            (y === curYear ? 'btn-primary' : 'btn-outline') +
            '" data-modal-action="admin-select-holiday-year" data-year="' +
            y +
            '">' +
            y +
            '年</button>'
          );
        })
        .join('');

      var rows = entries
        .map(function (e) {
          var badge =
            e.type === 'holiday'
              ? '<span class="day-badge badge-rest">休</span>'
              : '<span class="day-badge badge-work">班</span>';
          var srcLabel = e.source === 'manual' ? '手工' : e.source === 'sync' ? '公开源同步' : '内置';
          return (
            '<tr>' +
            '<td><code>' +
            esc(e.date) +
            '</code></td>' +
            '<td>' +
            badge +
            '</td>' +
            '<td>' +
            esc(e.name) +
            '</td>' +
            '<td><span class="tag-badge">' +
            srcLabel +
            '</span></td>' +
            '<td><button type="button" class="btn btn-danger btn-sm" data-modal-action="admin-delete-holiday" data-date="' +
            esc(e.date) +
            '">删除</button></td>' +
            '</tr>'
          );
        })
        .join('');

      return (
        '<div class="section-block">' +
        '<div class="form-label">1. 从公开数据源一键同步整年节假日（holiday-cn）</div>' +
        '<div class="inline-form-row">' +
        '<input id="admin-sync-year" type="number" class="input-control" style="max-width:130px;" min="2007" max="2100" value="' +
        nextSuggestedYear +
        '">' +
        '<label class="checkbox-label"><input id="admin-sync-overwrite" type="checkbox"><span>覆盖手工修改项</span></label>' +
        '<button type="button" class="btn btn-primary btn-sm" data-modal-action="admin-sync-holidays">立即同步该年份</button>' +
        '</div>' +
        '<div class="form-hint">后端自动从 jsDelivr CDN / GitHub 开源仓库拉取国务院放假调休安排并缓存入本地 SQLite，同时每年 11–12 月也会自动检查次年数据。</div>' +
        '</div>' +
        '<div class="section-block">' +
        '<div class="form-label">2. 手工添加或修改单日休/班</div>' +
        '<div class="holiday-edit-row">' +
        '<input id="admin-hol-date" type="date" class="input-control" value="' +
        curYear +
        '-01-01">' +
        '<select id="admin-hol-type" class="select-control"><option value="holiday">法定节假日（休）</option><option value="workday">调休上班日（班）</option></select>' +
        '<input id="admin-hol-name" type="text" class="input-control" maxlength="40" placeholder="名称，如：元旦 / 春节调休上班">' +
        '<button type="button" class="btn btn-outline btn-sm" data-modal-action="admin-save-holiday">保存日期</button>' +
        '</div>' +
        '</div>' +
        '<div class="section-block">' +
        '<div class="form-label">已入库年份（点击查看明细）</div>' +
        '<div class="year-pills">' +
        (yearBtns || '<span class="form-hint">暂无年份数据</span>') +
        '</div>' +
        '<div class="preview-table-wrap" style="max-height:220px;">' +
        '<table class="preview-table admin-table">' +
        '<thead><tr><th>日期</th><th>类型</th><th>名称</th><th>来源</th><th>操作</th></tr></thead>' +
        '<tbody>' +
        (rows || '<tr><td colspan="5" class="panel-empty">该年份暂无节假日记录</td></tr>') +
        '</tbody>' +
        '</table>' +
        '</div>' +
        '</div>'
      );
    }

    function renderAdminBackupsTab() {
      var info = adminState.backups || { dbSize: 0, backups: [] };
      var rows = (info.backups || [])
        .map(function (b) {
          return (
            '<tr>' +
            '<td><code>' +
            esc(b.filename) +
            '</code></td>' +
            '<td>' +
            esc(formatBytes(b.size)) +
            '</td>' +
            '<td>' +
            esc(formatDateTimeShort(b.createdAt)) +
            '</td>' +
            '<td><a class="btn btn-outline btn-sm" href="/api/admin/backups/download?file=' +
            encodeURIComponent(b.filename) +
            '">下载</a></td>' +
            '</tr>'
          );
        })
        .join('');

      return (
        '<div class="info-box">' +
        '当前 SQLite 主库大小：<strong>' +
        esc(formatBytes(info.dbSize)) +
        '</strong>。系统每日自动执行一次在线热备份（WAL 安全快照），默认保留最近 14 份。' +
        '</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
        '<button type="button" class="btn btn-primary btn-sm" data-modal-action="admin-create-backup">立即创建服务端备份</button>' +
        '<a class="btn btn-outline btn-sm" href="/api/admin/backups/download">下载当前实时数据库快照 (.db)</a>' +
        '</div>' +
        '<div class="preview-table-wrap">' +
        '<table class="preview-table admin-table">' +
        '<thead><tr><th>备份文件</th><th>大小</th><th>创建时间</th><th>操作</th></tr></thead>' +
        '<tbody>' +
        (rows || '<tr><td colspan="4" class="panel-empty">暂无历史自动备份，可点击上方按钮立即创建</td></tr>') +
        '</tbody>' +
        '</table>' +
        '</div>'
      );
    }

    function renderAdminModal() {
      var tab = adminState.tab;
      var bodyContent = adminState.loading
        ? '<div class="panel-empty" style="padding:32px 0;">正在加载数据...</div>'
        : tab === 'users'
          ? renderAdminUsersTab()
          : tab === 'holidays'
            ? renderAdminHolidaysTab()
            : renderAdminBackupsTab();

      dialog.innerHTML =
        '<div class="modal-header">' +
        '<h2 id="modal-title" class="modal-title">管理员后台</h2>' +
        '<button type="button" class="modal-close" data-modal-action="close" aria-label="关闭">×</button>' +
        '</div>' +
        '<div class="admin-tabs">' +
        '<button type="button" class="admin-tab' +
        (tab === 'users' ? ' is-active' : '') +
        '" data-modal-action="admin-tab" data-tab="users">账号管理</button>' +
        '<button type="button" class="admin-tab' +
        (tab === 'holidays' ? ' is-active' : '') +
        '" data-modal-action="admin-tab" data-tab="holidays">节假日维护</button>' +
        '<button type="button" class="admin-tab' +
        (tab === 'backups' ? ' is-active' : '') +
        '" data-modal-action="admin-tab" data-tab="backups">数据库备份</button>' +
        '</div>' +
        '<div class="modal-body">' +
        bodyContent +
        '</div>' +
        '<div class="modal-footer">' +
        '<button type="button" class="btn btn-outline" data-modal-action="close">关闭</button>' +
        '</div>';
    }

    // =======================================================================
    // 8. 统一事件委托
    // =======================================================================
    function downloadTextFile(filename, content, mimeType) {
      var blob = new Blob([content], { type: mimeType || 'text/plain;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 1000);
    }

    function dateStamp() {
      var d = new Date();
      return (
        d.getFullYear() +
        String(d.getMonth() + 1).padStart(2, '0') +
        String(d.getDate()).padStart(2, '0') +
        '_' +
        String(d.getHours()).padStart(2, '0') +
        String(d.getMinutes()).padStart(2, '0')
      );
    }

    dialog.addEventListener('click', function (e) {
      var target = e.target.closest('[data-modal-action]');
      if (!target) return;
      var action = target.getAttribute('data-modal-action');

      if (action === 'close') {
        savedEditorDraft = null;
        ledgerParseState = null;
        evalProjectImportState = {};
        evalTravelImportState = {};
        close();
      } else if (action === 'confirm-delete-eval-project') {
        var delPid = currentPayload.projectId;
        runBusy(target, function () {
          return evalStore.deleteProject(delPid).then(function () {
            onDataChanged();
            isBusy = false;
            close();
            showToast('已删除评估项目及对应工作日程', 'success');
          });
        });
      } else if (action === 'confirm-delete-eval-travel') {
        var delTid = currentPayload.travelId;
        runBusy(target, function () {
          return evalStore.deleteTravel(delTid).then(function () {
            onDataChanged();
            isBusy = false;
            close();
            showToast('已删除差旅记录', 'success');
          });
        });
      } else if (action === 'confirm-reset-eval-settings') {
        runBusy(target, function () {
          return evalStore.resetSettings().then(function () {
            onDataChanged();
            isBusy = false;
            close();
            showToast('已恢复默认天数规则与费率，费用已实时重算', 'success');
          });
        });
      } else if (action === 'confirm-clear-eval-all') {
        runBusy(target, function () {
          target.textContent = '清空中...';
          return evalStore.clearAllData().then(function () {
            onDataChanged();
            isBusy = false;
            close();
            showToast('已清空全部评估项目、差旅数据并恢复默认设置', 'success');
          });
        });
      } else if (action === 'confirm-restore-eval-json') {
        var backupData = currentPayload.backupData;
        runBusy(target, function () {
          target.textContent = '恢复中...';
          return evalStore.restoreBackup(backupData).then(function (res) {
            onDataChanged();
            isBusy = false;
            close();
            showToast(
              '已恢复 ' + res.projects + ' 条项目、' + res.travels + ' 笔差旅并同步工作日程',
              'success'
            );
          });
        });
      } else if (action === 'add-on-day') {
        open('event-editor', { date: target.getAttribute('data-date') });
      } else if (action === 'edit-event') {
        open('event-editor', { eventId: target.getAttribute('data-event-id') });
      } else if (action === 'ask-delete-event') {
        open('confirm-delete-event', {
          eventId: target.getAttribute('data-event-id'),
          from: target.getAttribute('data-from') || 'day-detail',
          date: target.getAttribute('data-date') || ''
        });
      } else if (action === 'cancel-delete-event') {
        if (currentPayload.from === 'day-detail' && currentPayload.date) {
          open('day-detail', { date: currentPayload.date });
        } else {
          open('event-editor', { eventId: currentPayload.eventId });
        }
      } else if (action === 'confirm-delete-event') {
        var delId = currentPayload.eventId;
        var fromView = currentPayload.from;
        var retDate = currentPayload.date;
        runBusy(target, function () {
          return store.deleteEvent(delId).then(function (res) {
            var syncedProj = res && res.deletedEvalProjectId;
            if (syncedProj && evalStore) {
              evalStore.removeProjectLocally(syncedProj);
            }
            showToast(
              syncedProj ? '已删除日程并同步删除关联的评估项目' : '已删除日程',
              'success'
            );
            onDataChanged();
            isBusy = false;
            if (fromView === 'day-detail' && retDate) {
              open('day-detail', { date: retDate });
            } else {
              close();
            }
          });
        });
      } else if (action === 'save-event') {
        validateAndSaveEditor(false, target);
      } else if (action === 'save-and-next') {
        validateAndSaveEditor(true, target);
      } else if (action === 'manage-cats-from-editor') {
        savedEditorDraft = {
          eventId: currentPayload.eventId || null,
          draft: readEditorForm()
        };
        open('categories', {});
      } else if (action === 'return-to-editor') {
        var restore = savedEditorDraft;
        savedEditorDraft = null;
        open('event-editor', restore || {});
      } else if (action === 'toggle-palette') {
        var tid = target.getAttribute('data-target-id');
        openPaletteForId = openPaletteForId === tid ? null : tid;
        renderCategoryManager();
      } else if (action === 'pick-preset-color') {
        var targetId = target.getAttribute('data-target-id');
        var color = target.getAttribute('data-color');
        if (targetId === '__new__') {
          newCatColor = color;
          openPaletteForId = null;
          renderCategoryManager();
        } else {
          runBusy(target, function () {
            return store.updateCategory(targetId, { color: color }).then(function () {
              openPaletteForId = null;
              onDataChanged();
              renderCategoryManager();
              showToast('已更新类别颜色', 'success');
            });
          });
        }
      } else if (action === 'move-cat-up') {
        var cidUp = target.getAttribute('data-cat-id');
        runBusy(target, function () {
          return store.moveCategory(cidUp, 'up').then(function () {
            onDataChanged();
            renderCategoryManager();
          });
        });
      } else if (action === 'move-cat-down') {
        var cidDown = target.getAttribute('data-cat-id');
        runBusy(target, function () {
          return store.moveCategory(cidDown, 'down').then(function () {
            onDataChanged();
            renderCategoryManager();
          });
        });
      } else if (action === 'ask-delete-cat') {
        open('confirm-delete-cat', { catId: target.getAttribute('data-cat-id') });
      } else if (action === 'cancel-delete-cat') {
        open('categories', {});
      } else if (action === 'confirm-delete-cat') {
        var delCatId = currentPayload.catId;
        runBusy(target, function () {
          return store.deleteCategory(delCatId).then(function () {
            onDataChanged();
            isBusy = false;
            open('categories', {});
            showToast('已删除类别（已有日程将使用默认配色兜底）', 'success');
          });
        });
      } else if (action === 'add-category') {
        var nameInput = document.getElementById('new-cat-name');
        var val = nameInput ? nameInput.value.trim() : '';
        if (!val) {
          showToast('请输入新类别名称', 'error');
          if (nameInput) nameInput.focus();
          return;
        }
        runBusy(target, function () {
          return store.addCategory(val, newCatColor).then(function (created) {
            if (savedEditorDraft && savedEditorDraft.draft) {
              savedEditorDraft.draft.categoryId = created.id;
            }
            openPaletteForId = null;
            onDataChanged();
            renderCategoryManager();
            showToast('已新增类别“' + created.name + '”', 'success');
          });
        });
      } else if (action === 'fill-sample-ledger') {
        var box = document.getElementById('ledger-paste-box');
        if (box) {
          var now = new Date();
          var ym = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
          box.value =
            '序号\t项目名称\t等级\t角色\t评估阶段\t开始时间\t结束时间\t备注\n' +
            '1\t示范区绿色建筑评估\t一级\t组长\t预评估\t' +
            ym +
            '-08\t' +
            ym +
            '-09\t提前对接资料\n' +
            '1\t\t\t\t正式评估\t' +
            ym +
            '-20\t' +
            ym +
            '-22\t现场核验\n' +
            '2\t园区能源审计项目\t二级\t组员\t预评估\t' +
            ym +
            '-26\t/\t时间待对方确认';
        }
      } else if (action === 'parse-pasted-ledger') {
        var pasteBox = document.getElementById('ledger-paste-box');
        var errBox = document.getElementById('ledger-parse-error');
        var text = pasteBox ? pasteBox.value : '';
        if (!text.trim()) {
          errBox.textContent = '请先上传文件或粘贴表格内容';
          errBox.classList.remove('hidden');
          return;
        }
        try {
          var rows = WorkCal.Importer.parseDelimitedText(text);
          var parsed = WorkCal.Importer.parseLedgerGrid(rows, { date1904: false });
          ledgerParseState = { rawParsed: parsed, customStageMap: null };
          renderLedgerImport();
        } catch (err) {
          errBox.textContent = err.message || '粘贴内容识别失败';
          errBox.classList.remove('hidden');
        }
      } else if (action === 'reset-ledger-import') {
        ledgerParseState = null;
        renderLedgerImport();
      } else if (action === 'confirm-ledger-import') {
        if (!ledgerParseState || !ledgerParseState.latestPreview) return;
        var pv = ledgerParseState.latestPreview;
        runBusy(target, function () {
          target.textContent = '导入中...';
          return store.applyLedgerEntries(pv.entries).then(function (res) {
            onDataChanged();
            if (pv.entries.length && onJumpToMonth) {
              var firstP = WorkCal.DateUtils.parseYMD(pv.entries[0].startDate);
              if (firstP) onJumpToMonth(firstP.year, firstP.month);
            }
            ledgerParseState = null;
            isBusy = false;
            close();
            showToast(
              '导入完成：新增 ' +
                res.added +
                ' 条，更新 ' +
                res.updated +
                ' 条，跳过 ' +
                pv.skipped.length +
                ' 行',
              'success'
            );
          });
        });
      } else if (action === 'go-import') {
        open('import', {}, true);
      } else if (action === 'go-categories') {
        open('categories', {});
      } else if (action === 'go-backup') {
        open('backup', {});
      } else if (action === 'go-account') {
        open('account', {});
      } else if (action === 'go-admin') {
        open('admin', {}, true);
        loadAdminTabData('users');
      } else if (action === 'go-clear') {
        open('clear-confirm', {});
      } else if (action === 'back-more') {
        open('more', {});
      } else if (action === 'download-json') {
        downloadTextFile(
          '工作日程备份_' + dateStamp() + '.json',
          store.exportBackupJSON(),
          'application/json;charset=utf-8'
        );
        showToast('已下载 JSON 备份文件', 'success');
      } else if (action === 'restore-json') {
        var inp = document.getElementById('backup-file-input');
        var err = document.getElementById('backup-error');
        if (!inp || !inp.files || !inp.files[0]) {
          err.textContent = '请先选择要恢复的 JSON 备份文件';
          err.classList.remove('hidden');
          return;
        }
        var modeInput = dialog.querySelector('input[name="restore-mode"]:checked');
        var mode = modeInput ? modeInput.value : 'replace';
        runBusy(target, function () {
          target.textContent = '恢复中...';
          return inp.files[0].text().then(function (txt) {
            var parsed = store.parseBackupJSON(txt);
            return store.restoreBackup(parsed, mode).then(function (out) {
              onDataChanged();
              isBusy = false;
              close();
              showToast(
                mode === 'merge'
                  ? '已合并恢复 ' + out.events + ' 条新日程'
                  : '已完整恢复 ' + out.categories + ' 个类别、' + out.events + ' 条日程',
                'success'
              );
            });
          });
        });
      } else if (action === 'export-ics') {
        if (!store.getEvents().length) {
          showToast('当前没有日程可导出', 'error');
          return;
        }
        downloadTextFile(
          '工作日程_' + dateStamp() + '.ics',
          store.exportICS(),
          'text/calendar;charset=utf-8'
        );
        showToast('已导出 .ics 日历文件', 'success');
      } else if (action === 'print-month') {
        close();
        if (ctx.ensureMonthViewForPrint) ctx.ensureMonthViewForPrint();
        setTimeout(function () {
          window.print();
        }, 120);
      } else if (action === 'confirm-clear-all') {
        runBusy(target, function () {
          target.textContent = '清空中...';
          return store.clearAllEvents().then(function (res) {
            onDataChanged();
            isBusy = false;
            close();
            var msg = '已清空 ' + res.deleted + ' 条普通日程';
            if (res.skippedEvalCount > 0) {
              msg += '（已保留 ' + res.skippedEvalCount + ' 条评估项目关联日程）';
            }
            showToast(msg, 'success');
          });
        });
      } else if (action === 'confirm-migrate-local') {
        var legacyData = currentPayload.legacy;
        runBusy(target, function () {
          target.textContent = '迁移中...';
          return store.restoreBackup(legacyData, 'merge').then(function (out) {
            store.clearLegacyLocalData();
            onDataChanged();
            isBusy = false;
            close();
            showToast('已将本机 ' + out.events + ' 条历史日程迁移至云端', 'success');
          });
        });
      } else if (action === 'dismiss-legacy-local') {
        store.clearLegacyLocalData();
        close();
        showToast('已清理本机旧版缓存', 'success');
      } else if (action === 'save-profile') {
        var dnEl = document.getElementById('acct-display-name');
        var dn = dnEl ? dnEl.value.trim() : '';
        if (!dn) {
          showToast('显示名称不能为空', 'error');
          return;
        }
        runBusy(target, function () {
          return api.updateProfile(dn).then(function (res) {
            if (res && res.user && onUserUpdated) onUserUpdated(res.user);
            renderAccountModal();
            showToast('显示名称已更新', 'success');
          });
        });
      } else if (action === 'copy-ics-url') {
        var icsEl = document.getElementById('acct-ics-url');
        if (icsEl && icsEl.value) {
          copyToClipboard(icsEl.value, icsEl, function () {
            showToast('日历订阅链接已复制', 'success');
          });
        }
      } else if (action === 'ask-reset-ics') {
        open('confirm-reset-ics', {});
      } else if (action === 'confirm-reset-ics') {
        runBusy(target, function () {
          return api.resetIcsToken().then(function (res) {
            var u = getCurrentUser ? getCurrentUser() : null;
            if (u && res && res.icsToken && onUserUpdated) {
              onUserUpdated(Object.assign({}, u, { icsToken: res.icsToken }));
            }
            isBusy = false;
            open('account', {});
            showToast('订阅链接已重置，请重新在日历软件中订阅', 'success');
          });
        });
      } else if (action === 'change-password') {
        var cur = document.getElementById('acct-cur-pwd').value;
        var nw = document.getElementById('acct-new-pwd').value;
        var cf = document.getElementById('acct-confirm-pwd').value;
        var pErr = document.getElementById('acct-pwd-error');
        pErr.classList.add('hidden');
        if (!cur || !nw) {
          pErr.textContent = '请填写当前密码和新密码';
          pErr.classList.remove('hidden');
          return;
        }
        if (nw.length < 6) {
          pErr.textContent = '新密码长度至少为 6 位';
          pErr.classList.remove('hidden');
          return;
        }
        if (nw !== cf) {
          pErr.textContent = '两次输入的新密码不一致';
          pErr.classList.remove('hidden');
          return;
        }
        runBusy(target, function () {
          return api.changePassword(cur, nw).then(function () {
            document.getElementById('acct-cur-pwd').value = '';
            document.getElementById('acct-new-pwd').value = '';
            document.getElementById('acct-confirm-pwd').value = '';
            showToast('密码已更新（其他设备需重新登录）', 'success');
          });
        });
      } else if (action === 'logout') {
        runBusy(target, function () {
          return api.logout().then(function () {
            isBusy = false;
            close();
            if (onLogout) onLogout();
          });
        });
      } else if (action === 'admin-tab') {
        var nextTab = target.getAttribute('data-tab');
        if (nextTab && nextTab !== adminState.tab) {
          adminState.credentialBanner = null;
          adminState.confirmDeleteUserId = null;
          loadAdminTabData(nextTab);
        }
      } else if (action === 'copy-admin-cred') {
        if (adminState.credentialBanner) {
          var b = adminState.credentialBanner;
          var textToCopy = '网址：' + window.location.origin + '\n账号：' + b.username + '\n密码：' + b.password;
          copyToClipboard(textToCopy, null, function () {
            showToast('账号与密码已复制到剪贴板', 'success');
          });
        }
      } else if (action === 'admin-create-user') {
        var uName = document.getElementById('admin-new-username').value.trim();
        var uDisp = document.getElementById('admin-new-display').value.trim();
        var uPwd = document.getElementById('admin-new-password').value;
        var uRole = document.getElementById('admin-new-role').value;
        var uErr = document.getElementById('admin-user-error');
        uErr.classList.add('hidden');
        if (!uName) {
          uErr.textContent = '请输入账号 ID';
          uErr.classList.remove('hidden');
          return;
        }
        runBusy(target, function () {
          return api
            .adminCreateUser({
              username: uName,
              displayName: uDisp || uName,
              password: uPwd,
              role: uRole
            })
            .then(function (res) {
              adminState.credentialBanner = {
                title: '账号创建成功，请将以下登录信息发给使用者：',
                username: res.user.username,
                password: res.initialPassword
              };
              return api.adminListUsers().then(function (listRes) {
                adminState.users = (listRes && listRes.users) || [];
                renderAdminModal();
                showToast('已创建账号 ' + res.user.username, 'success');
              });
            });
        });
      } else if (action === 'admin-toggle-active') {
        var uid = target.getAttribute('data-user-id');
        var currentlyActive = target.getAttribute('data-active') === '1';
        runBusy(target, function () {
          return api.adminUpdateUser(uid, { isActive: !currentlyActive }).then(function () {
            return api.adminListUsers().then(function (listRes) {
              adminState.users = (listRes && listRes.users) || [];
              renderAdminModal();
              showToast(currentlyActive ? '已禁用该账号并强制下线' : '已重新启用该账号', 'success');
            });
          });
        });
      } else if (action === 'admin-reset-pwd') {
        var rUid = target.getAttribute('data-user-id');
        runBusy(target, function () {
          return api.adminResetPassword(rUid, '').then(function (res) {
            adminState.credentialBanner = {
              title: '密码已重置（该账号原有登录会话已全部下线）：',
              username: res.username,
              password: res.password
            };
            renderAdminModal();
            showToast('已重置 ' + res.username + ' 的密码', 'success');
          });
        });
      } else if (action === 'admin-ask-delete-user') {
        adminState.confirmDeleteUserId = target.getAttribute('data-user-id');
        renderAdminModal();
      } else if (action === 'admin-cancel-delete-user') {
        adminState.confirmDeleteUserId = null;
        renderAdminModal();
      } else if (action === 'admin-confirm-delete-user') {
        var dUid = target.getAttribute('data-user-id');
        runBusy(target, function () {
          return api.adminDeleteUser(dUid).then(function () {
            adminState.confirmDeleteUserId = null;
            return api.adminListUsers().then(function (listRes) {
              adminState.users = (listRes && listRes.users) || [];
              renderAdminModal();
              showToast('已永久删除该账号及其日程数据', 'success');
            });
          });
        });
      } else if (action === 'admin-select-holiday-year') {
        adminState.selectedHolidayYear = parseInt(target.getAttribute('data-year'), 10);
        renderAdminModal();
      } else if (action === 'admin-sync-holidays') {
        var sYear = parseInt(document.getElementById('admin-sync-year').value, 10);
        var overwrite = document.getElementById('admin-sync-overwrite').checked;
        runBusy(target, function () {
          target.textContent = '同步中...';
          return api.adminSyncHolidays(sYear, overwrite).then(function (res) {
            adminState.holidays = res.holidays;
            adminState.selectedHolidayYear = res.summary.year;
            if (WorkCal.Holidays && WorkCal.Holidays.loadFromServer) {
              WorkCal.Holidays.loadFromServer(res.holidays);
            }
            onDataChanged();
            renderAdminModal();
            showToast(
              '已同步 ' +
                res.summary.year +
                ' 年：休 ' +
                res.summary.holidayCount +
                ' 天，调休班 ' +
                res.summary.workdayCount +
                ' 天',
              'success'
            );
          });
        });
      } else if (action === 'admin-save-holiday') {
        var hDate = document.getElementById('admin-hol-date').value;
        var hType = document.getElementById('admin-hol-type').value;
        var hName = document.getElementById('admin-hol-name').value.trim();
        if (!hDate || !hName) {
          showToast('请填写日期和节假日/调休名称', 'error');
          return;
        }
        runBusy(target, function () {
          return api.adminUpsertHoliday(hDate, hType, hName).then(function (res) {
            adminState.holidays = res.holidays;
            adminState.selectedHolidayYear = parseInt(hDate.slice(0, 4), 10);
            if (WorkCal.Holidays && WorkCal.Holidays.loadFromServer) {
              WorkCal.Holidays.loadFromServer(res.holidays);
            }
            onDataChanged();
            renderAdminModal();
            showToast('已保存 ' + hDate + ' 节假日配置', 'success');
          });
        });
      } else if (action === 'admin-delete-holiday') {
        var delDate = target.getAttribute('data-date');
        runBusy(target, function () {
          return api.adminDeleteHoliday(delDate).then(function (res) {
            adminState.holidays = res.holidays;
            if (WorkCal.Holidays && WorkCal.Holidays.loadFromServer) {
              WorkCal.Holidays.loadFromServer(res.holidays);
            }
            onDataChanged();
            renderAdminModal();
            showToast('已删除 ' + delDate, 'success');
          });
        });
      } else if (action === 'admin-create-backup') {
        runBusy(target, function () {
          target.textContent = '备份中...';
          return api.adminCreateBackup().then(function (res) {
            adminState.backups = Object.assign({}, adminState.backups, {
              backups: res.backups
            });
            renderAdminModal();
            showToast('已创建备份 ' + res.backup.filename, 'success');
          });
        });
      }
    });

    backdrop.addEventListener('click', function (e) {
      if (e.target === backdrop && !isBusy) {
        savedEditorDraft = null;
        ledgerParseState = null;
        evalProjectImportState = {};
        evalTravelImportState = {};
        close();
      }
    });

    return {
      open: open,
      openAdmin: function (tab) {
        open('admin', {}, true);
        loadAdminTabData(tab || 'users');
      },
      close: close,
      isOpen: isOpen
    };
  }

  WorkCal.Modals = {
    createModalManager: createModalManager
  };
})(typeof window !== 'undefined' ? window : globalThis);
