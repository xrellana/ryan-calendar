/**
 * 统一单浮层交互管理器（UI-4：同一时刻只出现一个浮层）
 * 包含：当天详情、新建/编辑日程（保存并加下一条 & 标题实时随类别变色）、
 * 类别增删改排与 28 色色板+自定义取色、台账导入预览、数据备份/ICS/同步链接/清空确认
 */
(function (root) {
  'use strict';

  var WorkCal = (root.WorkCal = root.WorkCal || {});

  function esc(str) {
    return WorkCal.Views.escapeHtml(str);
  }

  function createModalManager(ctx) {
    var store = ctx.store;
    var onDataChanged = ctx.onDataChanged;
    var onJumpToMonth = ctx.onJumpToMonth;
    var showToast = ctx.showToast;

    var backdrop = document.getElementById('modal-backdrop');
    var dialog = document.getElementById('modal-dialog');

    var currentType = null;
    var currentPayload = null;
    // 从日程编辑跳入类别管理时暂存未保存草稿，返回时完整恢复（FR-07 / UI-4）
    var savedEditorDraft = null;
    // 类别管理中当前展开色板的类别ID（或 '__new__'）
    var openPaletteForId = null;
    // 台账导入预览状态
    var ledgerParseState = null;

    function isOpen() {
      return Boolean(currentType && !backdrop.classList.contains('hidden'));
    }

    function close() {
      currentType = null;
      currentPayload = null;
      openPaletteForId = null;
      backdrop.classList.add('hidden');
      backdrop.setAttribute('aria-hidden', 'true');
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
    }

    function renderCurrent() {
      if (currentType === 'day-detail') renderDayDetail();
      else if (currentType === 'event-editor') renderEventEditor();
      else if (currentType === 'categories') renderCategoryManager();
      else if (currentType === 'import') renderLedgerImport();
      else if (currentType === 'more') renderMoreMenu();
      else if (currentType === 'backup') renderBackupModal();
      else if (currentType === 'sync') renderSyncModal();
      else if (currentType === 'sync-incoming') renderSyncIncoming();
      else if (currentType === 'clear-confirm') renderClearConfirm();
    }

    // =======================================================================
    // 1. 当天详情弹窗（FR-05 / FR-08 / AC-10）
    // =======================================================================
    function renderDayDetail() {
      var DU = WorkCal.DateUtils;
      var Lunar = WorkCal.Lunar;
      var Color = WorkCal.Color;
      var dateStr = currentPayload.date;
      var p = DU.parseYMD(dateStr);
      var meta = DU.getDayMeta(dateStr);
      var lunar = Lunar.getLunarInfo(p.year, p.month, p.day);
      var events = store.getEventsOnDate(dateStr);

      var dayTag = meta.badge ? (meta.badge === '休' ? '法定节假日（休）' : '调休上班日（班）') : (meta.isGray ? '周末休息日' : '工作日');
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
              (ev.source === 'ledger' ? '台账导入' : '手工录入') +
              '</span>';

            if (ev.ledgerMeta && ev.ledgerMeta.stage) {
              metaBadges +=
                '<span class="tag-badge">' + esc(ev.ledgerMeta.stage) + '</span>';
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
              '<button type="button" class="btn btn-danger btn-sm" data-modal-action="delete-event" data-event-id="' +
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
    // 2. 新建 / 编辑日程弹窗（FR-05 / FR-08 / FR-09 / AC-11 / AC-12）
    // =======================================================================
    function renderEventEditor() {
      var Color = WorkCal.Color;
      var DU = WorkCal.DateUtils;
      var categories = store.getCategories();
      var editing = currentPayload.eventId ? store.getEventById(currentPayload.eventId) : null;
      var draft = currentPayload.draft || null;

      var defaultCatId =
        (draft && draft.categoryId) ||
        (editing && editing.categoryId) ||
        currentPayload.categoryId ||
        (categories[0] ? categories[0].id : '__fallback__');

      // 如果有被删除的历史类别或暂无类别，下拉提供对应项或默认首位
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
      var allDayVal = draft
        ? draft.allDay
        : editing
          ? editing.allDay !== false
          : true;
      var startTimeVal = draft
        ? draft.startTime
        : editing
          ? editing.startTime || '09:00'
          : '09:00';
      var endTimeVal = draft
        ? draft.endTime
        : editing
          ? editing.endTime || '18:00'
          : '18:00';
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
          ? '<button type="button" class="btn btn-danger" data-modal-action="delete-editing-event" data-event-id="' +
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

      // 实时同步字数与标题类别颜色（FR-09 / AC-12）
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
      var title = document.getElementById('evt-title').value.trim();
      var categoryId = document.getElementById('evt-category').value;
      var startDate = document.getElementById('evt-start').value;
      var endDate = document.getElementById('evt-end').value;
      var allDay = document.getElementById('evt-allday').checked;
      var startTime = document.getElementById('evt-stime').value || '09:00';
      var endTime = document.getElementById('evt-etime').value || '18:00';
      var notes = document.getElementById('evt-notes').value;

      return {
        title: title,
        categoryId: categoryId,
        startDate: startDate,
        endDate: endDate,
        allDay: allDay,
        startTime: startTime,
        endTime: endTime,
        notes: notes
      };
    }

    function validateAndSaveEditor(keepOpenForNext) {
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
      if (editingId && !keepOpenForNext) {
        store.updateEvent(editingId, data);
        showToast('日程已更新', 'success');
        onDataChanged();
        close();
        return;
      }

      store.addEvent(data);
      onDataChanged();

      if (keepOpenForNext) {
        // 保存并加下一条：弹窗不关闭，保留类别与起止日期，清空标题与备注（FR-08 / AC-11）
        showToast('已保存，可继续录入下一条', 'success');
        document.getElementById('evt-title').value = '';
        document.getElementById('evt-notes').value = '';
        document.getElementById('evt-title-count').textContent = '0/60';
        document.getElementById('evt-notes-count').textContent = '0/500';
        errEl.classList.add('hidden');
        document.getElementById('evt-title').focus();
      } else {
        showToast('已新增日程', 'success');
        close();
      }
    }

    // =======================================================================
    // 3. 类别自主管理弹窗（FR-07 / AC-8 / AC-9）
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

    var newCatColor = '#7C3AED';

    function renderCategoryManager() {
      var cats = store.getCategories();

      var listHtml = cats.length
        ? cats
            .map(function (c, idx) {
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
                '" data-cat-rename="' +
                esc(c.id) +
                '" aria-label="类别名称">' +
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
                '<button type="button" class="btn btn-danger btn-sm" data-modal-action="delete-cat" data-cat-id="' +
                esc(c.id) +
                '" title="删除类别">删</button>' +
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
        '<div class="form-hint">提示：列表顺序即同日多条日程的取色优先级（第 1 位最高）。修改名称失焦即时生效，点击色块可展开 28 种预设色或自定义取色。</div>' +
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

      // 绑定改名（失焦或回车即时生效）与自定义取色器
      var renameInputs = dialog.querySelectorAll('[data-cat-rename]');
      for (var i = 0; i < renameInputs.length; i++) {
        (function (inp) {
          var commit = function () {
            var cid = inp.getAttribute('data-cat-rename');
            var val = inp.value.trim();
            if (val) {
              store.updateCategory(cid, { name: val });
              onDataChanged();
            }
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
              store.updateCategory(tid, { color: picker.value });
              onDataChanged();
              var trig2 = dialog.querySelector('[data-target-id="' + tid + '"].cat-color-trigger');
              if (trig2) trig2.style.background = picker.value;
            }
          });
        })(pickers[j]);
      }
    }

    // =======================================================================
    // 4. 《评估项目台账》导入与预览弹窗（FR-10 / AC-13~15）
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

      // 预览视图
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
            '<div class="cat-row" style="padding:6px 10px;">' +
            '<span style="flex:1;font-weight:600;">' +
            esc(st) +
            '（' +
            count +
            ' 条）</span>' +
            '<span class="form-hint">映射到类别：</span>' +
            '<select class="select-control" style="width:170px;" data-stage-map="' +
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
            (e.isUpdate ? '<span class="tag-badge">更新已有</span>' : '<span class="tag-badge" style="background:#dcfce7;color:#166534;">新增</span>') +
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
        '<div style="display:flex;gap:8px;">' +
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
            ledgerParseState.customStageMap = ledgerParseState.customStageMap || Object.assign({}, preview.stageMap);
            ledgerParseState.customStageMap[stage] = sel.value;
            renderLedgerImport();
          });
        })(selects[i]);
      }
    }

    // =======================================================================
    // 5. 更多菜单 / 数据备份 / 同步链接 / 清空确认（FR-11 / UI-3 / AC-16~17）
    // =======================================================================
    function renderMoreMenu() {
      dialog.innerHTML =
        '<div class="modal-header">' +
        '<h2 id="modal-title" class="modal-title">更多工具与数据管理</h2>' +
        '<button type="button" class="modal-close" data-modal-action="close" aria-label="关闭">×</button>' +
        '</div>' +
        '<div class="modal-body">' +
        '<div class="menu-grid">' +
        '<button type="button" class="menu-tile" data-modal-action="go-categories"><strong>⚙ 类别与颜色管理</strong><span>增删改类别、排序调整同日优先级</span></button>' +
        '<button type="button" class="menu-tile" data-modal-action="go-backup"><strong>💾 JSON 备份与恢复</strong><span>导出全部日程与类别，或从备份还原</span></button>' +
        '<button type="button" class="menu-tile" data-modal-action="go-sync"><strong>🔗 生成同步链接</strong><span>把日程压缩进分享链接，手机/电脑互通</span></button>' +
        '<button type="button" class="menu-tile" data-modal-action="export-ics"><strong>📅 导出 .ics 系统日历</strong><span>导入 iPhone / 安卓系统日历只读查看</span></button>' +
        '<button type="button" class="menu-tile" data-modal-action="print-month"><strong>🖨 打印当前月视图</strong><span>保留日期底色、类别颜色与跨天边框</span></button>' +
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
        '<div class="form-label">1. 导出全量备份</div>' +
        '<div class="form-hint">包含当前所有日程与自定义类别设置，换设备或清缓存前请先备份。</div>' +
        '<div><button type="button" class="btn btn-primary" data-modal-action="download-json">下载 JSON 备份文件</button></div>' +
        '</div>' +
        '<div class="form-field" style="padding-top:10px;border-top:1px solid var(--border-subtle);">' +
        '<div class="form-label">2. 从备份文件恢复</div>' +
        '<div class="form-hint">选择此前导出的 .json 备份文件：</div>' +
        '<input id="backup-file-input" type="file" accept=".json,application/json" class="input-control">' +
        '<div style="display:flex;gap:12px;margin-top:6px;">' +
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

    function renderSyncModal() {
      dialog.innerHTML =
        '<div class="modal-header">' +
        '<h2 id="modal-title" class="modal-title">生成跨设备同步链接</h2>' +
        '<button type="button" class="modal-close" data-modal-action="close" aria-label="关闭">×</button>' +
        '</div>' +
        '<div class="modal-body">' +
        '<div class="form-hint">本工具不依赖后端服务器，将全部日程与类别压缩到链接中并保留当前访问参数。复制到手机或另一台电脑打开即可导入。</div>' +
        '<textarea id="sync-url-output" class="textarea-control" rows="4" readonly placeholder="正在生成同步链接..."></textarea>' +
        '<div id="sync-url-note" class="form-hint"></div>' +
        '</div>' +
        '<div class="modal-footer modal-footer-between">' +
        '<button type="button" class="btn btn-outline" data-modal-action="back-more">返回更多</button>' +
        '<button type="button" class="btn btn-primary" data-modal-action="copy-sync-url">复制同步链接</button>' +
        '</div>';

      store.encodeSyncTokenAsync().then(function (token) {
        var url = store.buildSyncUrl(token);
        var out = document.getElementById('sync-url-output');
        var note = document.getElementById('sync-url-note');
        if (out) out.value = url;
        if (note) {
          note.textContent =
            '链接长度：' +
            url.length +
            ' 字符（含 ' +
            store.getEvents().length +
            ' 条日程与 ' +
            store.getCategories().length +
            ' 个类别）。';
        }
      });
    }

    function renderSyncIncoming() {
      var incoming = currentPayload.incoming;
      dialog.innerHTML =
        '<div class="modal-header">' +
        '<h2 id="modal-title" class="modal-title">检测到同步链接数据</h2>' +
        '<button type="button" class="modal-close" data-modal-action="close" aria-label="关闭">×</button>' +
        '</div>' +
        '<div class="modal-body">' +
        '<p style="margin:0;">此链接携带了 <strong>' +
        incoming.events.length +
        '</strong> 条日程与 <strong>' +
        incoming.categories.length +
        '</strong> 个类别。请选择导入方式：</p>' +
        '<div style="display:flex;flex-direction:column;gap:8px;">' +
        '<label class="checkbox-label"><input type="radio" name="sync-mode" value="replace" checked><span>完全替换本机日程与类别（推荐用于同步最新状态）</span></label>' +
        '<label class="checkbox-label"><input type="radio" name="sync-mode" value="merge"><span>与本机已有日程合并（跳过相同 ID）</span></label>' +
        '</div>' +
        '</div>' +
        '<div class="modal-footer">' +
        '<button type="button" class="btn btn-outline" data-modal-action="close">暂不导入</button>' +
        '<button type="button" class="btn btn-primary" data-modal-action="apply-sync-incoming">确认导入</button>' +
        '</div>';
    }

    function renderClearConfirm() {
      var count = store.getEvents().length;
      dialog.innerHTML =
        '<div class="modal-header">' +
        '<h2 id="modal-title" class="modal-title">清空全部日程</h2>' +
        '<button type="button" class="modal-close" data-modal-action="close" aria-label="关闭">×</button>' +
        '</div>' +
        '<div class="modal-body">' +
        '<div class="danger-box"><strong>⚠️ 不可恢复操作提醒（NFR-5 / FR-11）：</strong><br>即将永久删除本地保存的全部 <strong>' +
        count +
        '</strong> 条日程（类别设置会保留）。建议先下载 JSON 备份再继续。</div>' +
        '<div><button type="button" class="btn btn-outline btn-sm" data-modal-action="download-json">先导出 JSON 备份</button></div>' +
        '</div>' +
        '<div class="modal-footer modal-footer-between">' +
        '<button type="button" class="btn btn-outline" data-modal-action="back-more">取消返回</button>' +
        '<button type="button" class="btn btn-danger-solid" data-modal-action="confirm-clear-all">确认永久清空</button>' +
        '</div>';
    }

    // =======================================================================
    // 6. 统一事件委托
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
        close();
      } else if (action === 'add-on-day') {
        open('event-editor', { date: target.getAttribute('data-date') });
      } else if (action === 'edit-event') {
        open('event-editor', { eventId: target.getAttribute('data-event-id') });
      } else if (action === 'delete-event') {
        var eid = target.getAttribute('data-event-id');
        store.deleteEvent(eid);
        showToast('已删除日程', 'success');
        onDataChanged();
        renderDayDetail();
      } else if (action === 'delete-editing-event') {
        var eid2 = target.getAttribute('data-event-id');
        store.deleteEvent(eid2);
        showToast('已删除日程', 'success');
        onDataChanged();
        close();
      } else if (action === 'save-event') {
        validateAndSaveEditor(false);
      } else if (action === 'save-and-next') {
        validateAndSaveEditor(true);
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
          store.updateCategory(targetId, { color: color });
          openPaletteForId = null;
          onDataChanged();
          renderCategoryManager();
          showToast('已更新类别颜色', 'success');
        }
      } else if (action === 'move-cat-up') {
        store.moveCategory(target.getAttribute('data-cat-id'), 'up');
        onDataChanged();
        renderCategoryManager();
      } else if (action === 'move-cat-down') {
        store.moveCategory(target.getAttribute('data-cat-id'), 'down');
        onDataChanged();
        renderCategoryManager();
      } else if (action === 'delete-cat') {
        store.deleteCategory(target.getAttribute('data-cat-id'));
        onDataChanged();
        renderCategoryManager();
        showToast('已删除类别（已有日程将使用默认配色兜底）', 'success');
      } else if (action === 'add-category') {
        var nameInput = document.getElementById('new-cat-name');
        var val = nameInput ? nameInput.value.trim() : '';
        if (!val) {
          showToast('请输入新类别名称', 'error');
          if (nameInput) nameInput.focus();
          return;
        }
        var created = store.addCategory(val, newCatColor);
        if (savedEditorDraft && savedEditorDraft.draft) {
          savedEditorDraft.draft.categoryId = created.id;
        }
        openPaletteForId = null;
        onDataChanged();
        renderCategoryManager();
        showToast('已新增类别“' + created.name + '”', 'success');
      } else if (action === 'fill-sample-ledger') {
        var box = document.getElementById('ledger-paste-box');
        if (box) {
          var now = new Date();
          var ym = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
          box.value =
            '序号\t项目名称\t等级\t角色\t评估阶段\t开始时间\t结束时间\t备注\n' +
            '1\t示范区绿色建筑评估\t一级\t组长\t预评估\t' + ym + '-08\t' + ym + '-09\t提前对接资料\n' +
            '1\t\t\t\t正式评估\t' + ym + '-20\t' + ym + '-22\t现场核验\n' +
            '2\t园区能源审计项目\t二级\t组员\t预评估\t' + ym + '-26\t/\t时间待对方确认';
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
        var res = store.applyLedgerEntries(pv.entries);
        onDataChanged();
        // 自动跳转到导入数据首条所在月份（FR-10）
        if (pv.entries.length && onJumpToMonth) {
          var firstP = WorkCal.DateUtils.parseYMD(pv.entries[0].startDate);
          if (firstP) onJumpToMonth(firstP.year, firstP.month);
        }
        ledgerParseState = null;
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
      } else if (action === 'go-categories') {
        open('categories', {});
      } else if (action === 'go-backup') {
        open('backup', {});
      } else if (action === 'go-sync') {
        open('sync', {});
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
        inp.files[0].text().then(function (txt) {
          try {
            var parsed = store.parseBackupJSON(txt);
            var out = store.restoreBackup(parsed, mode);
            onDataChanged();
            close();
            showToast(
              mode === 'merge'
                ? '已合并恢复 ' + out.events + ' 条新日程'
                : '已完整恢复 ' + out.categories + ' 个类别、' + out.events + ' 条日程',
              'success'
            );
          } catch (e2) {
            err.textContent = e2.message || '恢复失败';
            err.classList.remove('hidden');
          }
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
      } else if (action === 'copy-sync-url') {
        var outEl = document.getElementById('sync-url-output');
        if (!outEl || !outEl.value) return;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard
            .writeText(outEl.value)
            .then(function () {
              showToast('同步链接已复制到剪贴板', 'success');
            })
            .catch(function () {
              outEl.select();
              document.execCommand('copy');
              showToast('同步链接已复制', 'success');
            });
        } else {
          outEl.select();
          document.execCommand('copy');
          showToast('同步链接已复制', 'success');
        }
      } else if (action === 'apply-sync-incoming') {
        var inc = currentPayload.incoming;
        var modeEl = dialog.querySelector('input[name="sync-mode"]:checked');
        var sMode = modeEl ? modeEl.value : 'replace';
        var result = store.restoreBackup(inc, sMode);
        // 清理地址栏中的 #sync= 参数（保留访问参数 ?k=...）
        if (window.history && window.history.replaceState) {
          var cleanUrl = new URL(window.location.href);
          cleanUrl.hash = '';
          window.history.replaceState(null, '', cleanUrl.toString());
        }
        onDataChanged();
        close();
        showToast('已同步导入 ' + result.events + ' 条日程', 'success');
      } else if (action === 'confirm-clear-all') {
        var deleted = store.clearAllEvents();
        onDataChanged();
        close();
        showToast('已清空全部 ' + deleted + ' 条日程', 'success');
      }
    });

    backdrop.addEventListener('click', function (e) {
      if (e.target === backdrop) {
        savedEditorDraft = null;
        ledgerParseState = null;
        close();
      }
    });

    return {
      open: open,
      close: close,
      isOpen: isOpen
    };
  }

  WorkCal.Modals = {
    createModalManager: createModalManager
  };
})(typeof window !== 'undefined' ? window : globalThis);
