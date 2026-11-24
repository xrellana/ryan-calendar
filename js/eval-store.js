/**
 * 评估项目管理平台前端云端状态管理层
 * 负责维护 projects / travels / settings / mergeNames 以及会话级勾选集合，
 * 并在所有涉及项目的写操作后自动同步工作日程 store。
 */
(function (root) {
  'use strict';

  var WorkCal = (root.WorkCal = root.WorkCal || {});

  function createEvalStore(apiClient, calendarStore) {
    var api = apiClient || WorkCal.Api;
    var Core = WorkCal.EvalCore;

    var state = {
      projects: [],
      travels: [],
      settings: Core.createDefaultSettings(),
      mergeNames: true,
      updatedAt: '',
      lastRefreshedAt: ''
    };

    // 会话级勾选状态（不落盘，刷新后清空，§3.4）
    var selectedProjectIds = {};
    var selectedTravelIds = {};

    function nowClockStr() {
      var d = new Date();
      var pad = function (n) {
        return String(n).padStart(2, '0');
      };
      return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    }

    function pruneSelections() {
      var pMap = {};
      for (var i = 0; i < state.projects.length; i++) pMap[state.projects[i].id] = true;
      Object.keys(selectedProjectIds).forEach(function (id) {
        if (!pMap[id]) delete selectedProjectIds[id];
      });

      var tMap = {};
      for (var j = 0; j < state.travels.length; j++) tMap[state.travels[j].id] = true;
      Object.keys(selectedTravelIds).forEach(function (id) {
        if (!tMap[id]) delete selectedTravelIds[id];
      });
    }

    function applyServerPayload(payload) {
      if (!payload) return state;
      state.projects = Array.isArray(payload.projects) ? payload.projects : [];
      state.travels = Array.isArray(payload.travels) ? payload.travels : [];
      state.settings = Core.normalizeSettings(payload.settings);
      if (payload.mergeNames !== undefined) {
        state.mergeNames = Boolean(payload.mergeNames);
      }
      state.updatedAt = payload.updatedAt || new Date().toISOString();
      state.lastRefreshedAt = nowClockStr();
      pruneSelections();
      return state;
    }

    function syncCalendarIfPresent(res) {
      if (res && res.calendarState && calendarStore && calendarStore.applyServerState) {
        calendarStore.applyServerState(res.calendarState);
      }
    }

    function resetMemoryState() {
      state = {
        projects: [],
        travels: [],
        settings: Core.createDefaultSettings(),
        mergeNames: true,
        updatedAt: '',
        lastRefreshedAt: ''
      };
      selectedProjectIds = {};
      selectedTravelIds = {};
    }

    function todayLocal() {
      if (WorkCal.DateUtils && WorkCal.DateUtils.todayStr) {
        return WorkCal.DateUtils.todayStr();
      }
      return Core.getTodayShanghai();
    }

    function loadFromServer() {
      return api.evalGetState(todayLocal()).then(function (data) {
        return applyServerPayload(data);
      });
    }

    function refreshAll() {
      return Promise.all([
        loadFromServer(),
        calendarStore ? calendarStore.loadFromServer() : Promise.resolve()
      ]).then(function () {
        return state;
      });
    }

    function getProjects() {
      return state.projects;
    }

    function getProjectById(id) {
      for (var i = 0; i < state.projects.length; i++) {
        if (state.projects[i].id === id) return state.projects[i];
      }
      return null;
    }

    function getTravels() {
      return state.travels;
    }

    function getTravelById(id) {
      for (var i = 0; i < state.travels.length; i++) {
        if (state.travels[i].id === id) return state.travels[i];
      }
      return null;
    }

    function getSettings() {
      return state.settings;
    }

    function isMergeNames() {
      return state.mergeNames;
    }

    function getLastRefreshedAt() {
      return state.lastRefreshedAt || nowClockStr();
    }

    function getUniqueProjectNames() {
      var map = {};
      var list = [];
      for (var i = 0; i < state.projects.length; i++) {
        var n = state.projects[i].name;
        if (n && !map[n]) {
          map[n] = true;
          list.push(n);
        }
      }
      return list;
    }

    function getProjectStagesMap() {
      var map = {};
      for (var i = 0; i < state.projects.length; i++) {
        var p = state.projects[i];
        if (!map[p.name]) map[p.name] = [];
        if (map[p.name].indexOf(p.stage) === -1) map[p.name].push(p.stage);
      }
      return map;
    }

    // ---- 勾选管理 ----
    function getSelectedProjectIds() {
      return Object.keys(selectedProjectIds);
    }

    function isProjectSelected(id) {
      return Boolean(selectedProjectIds[id]);
    }

    function setProjectSelected(ids, checked) {
      var arr = Array.isArray(ids) ? ids : [ids];
      for (var i = 0; i < arr.length; i++) {
        if (checked) selectedProjectIds[arr[i]] = true;
        else delete selectedProjectIds[arr[i]];
      }
      pruneSelections();
    }

    function clearProjectSelection() {
      selectedProjectIds = {};
    }

    function getSelectedTravelIds() {
      return Object.keys(selectedTravelIds);
    }

    function isTravelSelected(id) {
      return Boolean(selectedTravelIds[id]);
    }

    function setTravelSelected(ids, checked) {
      var arr = Array.isArray(ids) ? ids : [ids];
      for (var i = 0; i < arr.length; i++) {
        if (checked) selectedTravelIds[arr[i]] = true;
        else delete selectedTravelIds[arr[i]];
      }
      pruneSelections();
    }

    function clearTravelSelection() {
      selectedTravelIds = {};
    }

    // ---- 写操作 API 封装（自动同步工作日程） ----
    function createProject(data) {
      var payload = Object.assign({ today: todayLocal() }, data);
      return api.evalCreateProject(payload).then(function (res) {
        if (res && res.evalState) applyServerPayload(res.evalState);
        syncCalendarIfPresent(res);
        return res;
      });
    }

    function updateProject(id, patch) {
      var payload = Object.assign({ today: todayLocal() }, patch);
      return api.evalUpdateProject(id, payload).then(function (res) {
        if (res && res.evalState) applyServerPayload(res.evalState);
        syncCalendarIfPresent(res);
        return res;
      });
    }

    function batchUpdateProjects(ids, patch) {
      var payload = Object.assign({ ids: ids, today: todayLocal() }, patch);
      return api.evalBatchProjects(payload).then(function (res) {
        if (res && res.evalState) applyServerPayload(res.evalState);
        syncCalendarIfPresent(res);
        return res;
      });
    }

    function deleteProject(id) {
      return api.evalDeleteProject(id, todayLocal()).then(function (res) {
        delete selectedProjectIds[id];
        if (res && res.evalState) applyServerPayload(res.evalState);
        syncCalendarIfPresent(res);
        return res;
      });
    }

    function removeProjectLocally(id) {
      if (!id) return;
      delete selectedProjectIds[id];
      state.projects = state.projects.filter(function (p) {
        return p.id !== id;
      });
    }

    function importProjects(items, mode) {
      return api.evalImportProjects(items, mode, todayLocal()).then(function (res) {
        if (mode === 'replace') clearProjectSelection();
        if (res && res.evalState) applyServerPayload(res.evalState);
        syncCalendarIfPresent(res);
        return res;
      });
    }

    function loadSampleProjects() {
      return api.evalLoadSampleProjects(todayLocal()).then(function (res) {
        if (res && res.evalState) applyServerPayload(res.evalState);
        syncCalendarIfPresent(res);
        return res;
      });
    }

    function createTravel(data) {
      return api.evalCreateTravel(data).then(function (res) {
        if (res && res.evalState) applyServerPayload(res.evalState);
        return res;
      });
    }

    function updateTravel(id, patch) {
      return api.evalUpdateTravel(id, patch).then(function (res) {
        if (res && res.evalState) applyServerPayload(res.evalState);
        return res;
      });
    }

    function batchUpdateTravels(ids, reimb) {
      return api.evalBatchTravels(ids, reimb).then(function (res) {
        clearTravelSelection();
        if (res && res.evalState) applyServerPayload(res.evalState);
        return res;
      });
    }

    function deleteTravel(id) {
      return api.evalDeleteTravel(id).then(function (res) {
        delete selectedTravelIds[id];
        if (res && res.evalState) applyServerPayload(res.evalState);
        return res;
      });
    }

    function importTravels(items, mode) {
      return api.evalImportTravels(items, mode).then(function (res) {
        if (mode === 'replace') clearTravelSelection();
        if (res && res.evalState) applyServerPayload(res.evalState);
        return res;
      });
    }

    function saveSettings(nextSettings) {
      return api.evalSaveSettings(nextSettings).then(function (res) {
        if (res && res.evalState) applyServerPayload(res.evalState);
        return res;
      });
    }

    function resetSettings() {
      return api.evalResetSettings().then(function (res) {
        if (res && res.evalState) applyServerPayload(res.evalState);
        return res;
      });
    }

    function setMergeNames(flag) {
      var next = Boolean(flag);
      state.mergeNames = next;
      return api.evalSavePreferences({ mergeNames: next }).catch(function () {
        return { mergeNames: next };
      });
    }

    function exportBackupJSON() {
      return JSON.stringify(
        {
          app: 'eval-projects',
          version: 1,
          exportedAt: new Date().toISOString(),
          projects: state.projects,
          settings: state.settings,
          travels: state.travels,
          mergeNames: state.mergeNames
        },
        null,
        2
      );
    }

    function restoreBackup(data) {
      var payload = Object.assign({ today: todayLocal() }, data);
      return api.evalRestoreBackup(payload).then(function (res) {
        clearProjectSelection();
        clearTravelSelection();
        if (res && res.evalState) applyServerPayload(res.evalState);
        syncCalendarIfPresent(res);
        return res;
      });
    }

    function clearAllData() {
      return api.evalClearAll(todayLocal()).then(function (res) {
        clearProjectSelection();
        clearTravelSelection();
        if (res && res.evalState) applyServerPayload(res.evalState);
        syncCalendarIfPresent(res);
        return res;
      });
    }

    return {
      loadFromServer: loadFromServer,
      refreshAll: refreshAll,
      resetMemoryState: resetMemoryState,
      getProjects: getProjects,
      getProjectById: getProjectById,
      getTravels: getTravels,
      getTravelById: getTravelById,
      getSettings: getSettings,
      isMergeNames: isMergeNames,
      getLastRefreshedAt: getLastRefreshedAt,
      getUniqueProjectNames: getUniqueProjectNames,
      getProjectStagesMap: getProjectStagesMap,
      getSelectedProjectIds: getSelectedProjectIds,
      isProjectSelected: isProjectSelected,
      setProjectSelected: setProjectSelected,
      clearProjectSelection: clearProjectSelection,
      getSelectedTravelIds: getSelectedTravelIds,
      isTravelSelected: isTravelSelected,
      setTravelSelected: setTravelSelected,
      clearTravelSelection: clearTravelSelection,
      createProject: createProject,
      updateProject: updateProject,
      batchUpdateProjects: batchUpdateProjects,
      deleteProject: deleteProject,
      removeProjectLocally: removeProjectLocally,
      importProjects: importProjects,
      loadSampleProjects: loadSampleProjects,
      createTravel: createTravel,
      updateTravel: updateTravel,
      batchUpdateTravels: batchUpdateTravels,
      deleteTravel: deleteTravel,
      importTravels: importTravels,
      saveSettings: saveSettings,
      resetSettings: resetSettings,
      setMergeNames: setMergeNames,
      exportBackupJSON: exportBackupJSON,
      restoreBackup: restoreBackup,
      clearAllData: clearAllData
    };
  }

  WorkCal.EvalStore = {
    createEvalStore: createEvalStore
  };
})(typeof window !== 'undefined' ? window : globalThis);
