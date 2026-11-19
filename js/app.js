/**
 * 应用入口：门禁校验（FR-01）、兼容检查（NFR-3）、状态驱动与全局事件绑定
 */
(function (root) {
  'use strict';

  var WorkCal = (root.WorkCal = root.WorkCal || {});

  function checkBrowserCompatibility() {
    var missing = [];
    if (typeof Promise === 'undefined') missing.push('Promise');
    if (typeof URLSearchParams === 'undefined') missing.push('URLSearchParams');
    if (typeof TextDecoder === 'undefined') missing.push('TextDecoder');
    if (typeof Uint8Array === 'undefined') missing.push('Uint8Array');
    if (typeof JSON === 'undefined') missing.push('JSON');
    return missing;
  }

  function checkAccessGate() {
    var cfg = WorkCal.Config && WorkCal.Config.accessGate;
    if (!cfg || !cfg.enabled) return true;

    var params = new URLSearchParams(window.location.search);
    var enforce = params.get('enforceAccess') === '1';
    var host = window.location.hostname;
    var isLocal =
      window.location.protocol === 'file:' ||
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '[::1]';

    if (cfg.allowLocal && isLocal && !enforce) {
      return true;
    }

    var token = params.get(cfg.paramName || 'k');
    if (!token) return false;
    return cfg.validTokens.indexOf(token) !== -1;
  }

  function showToast(message, type) {
    var container = document.getElementById('toast-container');
    if (!container) return;
    var el = document.createElement('div');
    el.className = 'toast' + (type ? ' is-' + type : '');
    el.textContent = message;
    container.appendChild(el);
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 3200);
  }

  function boot() {
    var missing = checkBrowserCompatibility();
    if (missing.length) {
      var warn = document.getElementById('compat-warning');
      var detail = document.getElementById('compat-warning-detail');
      if (detail) detail.textContent = '缺少关键能力：' + missing.join('、') + '。';
      if (warn) warn.classList.remove('hidden');
      return;
    }

    if (!checkAccessGate()) {
      var denied = document.getElementById('access-denied');
      if (denied) denied.classList.remove('hidden');
      return;
    }

    var shell = document.getElementById('app-shell');
    if (shell) shell.classList.remove('hidden');

    var DU = WorkCal.DateUtils;
    var store = WorkCal.Storage.createStore();

    var now = new Date();
    var state = {
      view: 'month',
      anchorYear: now.getFullYear(),
      anchorMonth: now.getMonth() + 1,
      anchorDate: DU.fromLocalDate(now)
    };

    var render = function () {
      WorkCal.Views.renderAll(state, store);
    };

    var modals = WorkCal.Modals.createModalManager({
      store: store,
      onDataChanged: render,
      onJumpToMonth: function (year, month) {
        state.view = 'month';
        state.anchorYear = year;
        state.anchorMonth = month;
        state.anchorDate = DU.formatDate(year, month, 1);
        render();
      },
      ensureMonthViewForPrint: function () {
        if (state.view !== 'month') {
          state.view = 'month';
          render();
        }
      },
      showToast: showToast
    });

    function stepPeriod(dir) {
      if (state.view === 'year') {
        state.anchorYear += dir;
        state.anchorDate = DU.formatDate(state.anchorYear, state.anchorMonth, 1);
      } else if (state.view === 'month') {
        var nextMonth = state.anchorMonth + dir;
        var dt = new Date(state.anchorYear, nextMonth - 1, 1);
        state.anchorYear = dt.getFullYear();
        state.anchorMonth = dt.getMonth() + 1;
        state.anchorDate = DU.fromLocalDate(dt);
      } else {
        state.anchorDate = DU.addDays(state.anchorDate, dir * 7);
        var p = DU.parseYMD(state.anchorDate);
        state.anchorYear = p.year;
        state.anchorMonth = p.month;
      }
      render();
    }

    function jumpToday() {
      var today = new Date();
      state.anchorYear = today.getFullYear();
      state.anchorMonth = today.getMonth() + 1;
      state.anchorDate = DU.fromLocalDate(today);
      render();
    }

    // 顶栏按钮绑定
    document.getElementById('btn-prev').addEventListener('click', function () {
      stepPeriod(-1);
    });
    document.getElementById('btn-next').addEventListener('click', function () {
      stepPeriod(1);
    });
    document.getElementById('btn-today').addEventListener('click', jumpToday);

    var viewTabs = document.querySelectorAll('.view-tab');
    for (var i = 0; i < viewTabs.length; i++) {
      (function (tab) {
        tab.addEventListener('click', function () {
          var nextView = tab.getAttribute('data-view');
          if (!nextView || nextView === state.view) return;
          state.view = nextView;
          render();
        });
      })(viewTabs[i]);
    }

    document.getElementById('btn-new-event').addEventListener('click', function () {
      modals.open('event-editor', { date: DU.todayStr() });
    });
    document.getElementById('btn-import').addEventListener('click', function () {
      modals.open('import', {}, true);
    });
    document.getElementById('btn-more').addEventListener('click', function () {
      modals.open('more', {});
    });

    // 日历区、图例与侧边栏事件委托
    document.getElementById('app-shell').addEventListener('click', function (e) {
      var actionEl = e.target.closest('[data-action]');
      if (!actionEl) return;
      var action = actionEl.getAttribute('data-action');

      if (action === 'open-event') {
        e.stopPropagation();
        modals.open('event-editor', { eventId: actionEl.getAttribute('data-event-id') });
      } else if (action === 'open-day') {
        modals.open('day-detail', { date: actionEl.getAttribute('data-date') });
      } else if (action === 'new-event-date') {
        e.stopPropagation();
        modals.open('event-editor', { date: actionEl.getAttribute('data-date') });
      } else if (action === 'jump-month') {
        var yr = parseInt(actionEl.getAttribute('data-year'), 10);
        var mo = parseInt(actionEl.getAttribute('data-month'), 10);
        state.view = 'month';
        state.anchorYear = yr;
        state.anchorMonth = mo;
        state.anchorDate = DU.formatDate(yr, mo, 1);
        render();
      } else if (action === 'open-categories') {
        modals.open('categories', {});
      } else if (action === 'load-sample') {
        var cnt = store.loadSampleData(state.anchorYear, state.anchorMonth);
        render();
        showToast('已加载 ' + cnt + ' 条示例日程', 'success');
      }
    });

    // 键盘快捷键（Esc 关闭浮层，左右方向键翻页）
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modals.isOpen()) {
        modals.close();
        return;
      }
      if (modals.isOpen()) return;
      var tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'ArrowLeft') stepPeriod(-1);
      else if (e.key === 'ArrowRight') stepPeriod(1);
    });

    // 视口跨断点时自适应重排
    var lastIsMobile = window.innerWidth <= 640;
    window.addEventListener('resize', function () {
      var nowIsMobile = window.innerWidth <= 640;
      if (nowIsMobile !== lastIsMobile) {
        lastIsMobile = nowIsMobile;
        render();
      }
    });

    render();

    // 检查 URL 是否携带跨设备同步数据（#sync=... 或 ?sync=...）
    var syncToken = null;
    if (window.location.hash && window.location.hash.indexOf('sync=') !== -1) {
      var hashParams = new URLSearchParams(window.location.hash.slice(1));
      syncToken = hashParams.get('sync');
    } else {
      var searchParams = new URLSearchParams(window.location.search);
      syncToken = searchParams.get('sync');
    }

    if (syncToken) {
      store
        .decodeSyncTokenAsync(syncToken)
        .then(function (incoming) {
          modals.open('sync-incoming', { incoming: incoming });
        })
        .catch(function (err) {
          showToast(err.message || '同步链接解析失败', 'error');
        });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(typeof window !== 'undefined' ? window : globalThis);
