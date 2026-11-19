/**
 * 数据持久化、类别与日程 CRUD、JSON 备份恢复、ICS 导出与同步链接编解码（FR-07 / FR-08 / FR-11 / AC-16）
 */
(function (root) {
  'use strict';

  var WorkCal = (root.WorkCal = root.WorkCal || {});

  function getConfig() {
    return WorkCal.Config;
  }

  function getDateUtils() {
    return WorkCal.DateUtils;
  }

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function generateId(prefix) {
    return (
      (prefix || 'id') +
      '-' +
      Date.now().toString(36) +
      '-' +
      Math.random().toString(36).slice(2, 7)
    );
  }

  function createDefaultState() {
    var cfg = getConfig();
    return {
      version: 1,
      categories: clone(cfg.defaultCategories),
      events: [],
      updatedAt: new Date().toISOString()
    };
  }

  function normalizeCategory(cat) {
    var Color = WorkCal.Color;
    var name = String((cat && cat.name) || '').trim().slice(0, 20) || '未命名类别';
    var color = Color
      ? Color.normalizeHex(cat && cat.color)
      : String((cat && cat.color) || '#2B6CD4').toUpperCase();
    return {
      id: (cat && cat.id) ? String(cat.id) : generateId('cat'),
      name: name,
      color: color
    };
  }

  function normalizeEvent(ev) {
    var title = String((ev && ev.title) || '').trim().slice(0, 60);
    var startDate = String((ev && ev.startDate) || '').trim();
    var endDate = String((ev && ev.endDate) || '').trim();
    if (!endDate || endDate <= startDate) {
      endDate = '';
    }
    var allDay = ev && ev.allDay === false ? false : true;
    var startTime = allDay ? '' : String((ev && ev.startTime) || '09:00').slice(0, 5);
    var endTime = allDay ? '' : String((ev && ev.endTime) || '18:00').slice(0, 5);
    var notes = String((ev && ev.notes) || '').slice(0, 500);
    var source = ev && ev.source === 'ledger' ? 'ledger' : 'manual';

    var out = {
      id: (ev && ev.id) ? String(ev.id) : generateId('evt'),
      title: title,
      categoryId: String((ev && ev.categoryId) || ''),
      startDate: startDate,
      endDate: endDate,
      allDay: allDay,
      startTime: startTime,
      endTime: endTime,
      notes: notes,
      source: source,
      createdAt: (ev && ev.createdAt) || new Date().toISOString(),
      updatedAt: (ev && ev.updatedAt) || new Date().toISOString()
    };
    if (source === 'ledger') {
      out.ledgerKey = String((ev && ev.ledgerKey) || '');
      if (ev && ev.ledgerMeta) {
        out.ledgerMeta = {
          projectName: String(ev.ledgerMeta.projectName || ''),
          stage: String(ev.ledgerMeta.stage || ''),
          level: String(ev.ledgerMeta.level || ''),
          role: String(ev.ledgerMeta.role || '')
        };
      }
    }
    return out;
  }

  function createStore(storageBackend) {
    var backend =
      storageBackend ||
      (typeof localStorage !== 'undefined' ? localStorage : createMemoryBackend());

    var state = load();

    function createMemoryBackend() {
      var mem = {};
      return {
        getItem: function (k) {
          return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null;
        },
        setItem: function (k, v) {
          mem[k] = String(v);
        },
        removeItem: function (k) {
          delete mem[k];
        }
      };
    }

    function load() {
      var key = getConfig().storageKey;
      try {
        var raw = backend.getItem(key);
        if (!raw) return createDefaultState();
        var parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.categories) || !Array.isArray(parsed.events)) {
          return createDefaultState();
        }
        return {
          version: 1,
          categories: parsed.categories.map(normalizeCategory),
          events: parsed.events
            .map(normalizeEvent)
            .filter(function (e) {
              return Boolean(e.title && e.startDate);
            }),
          updatedAt: parsed.updatedAt || new Date().toISOString()
        };
      } catch (err) {
        return createDefaultState();
      }
    }

    function save() {
      state.updatedAt = new Date().toISOString();
      try {
        backend.setItem(getConfig().storageKey, JSON.stringify(state));
        return true;
      } catch (err) {
        return false;
      }
    }

    function getState() {
      return state;
    }

    function getCategories() {
      return state.categories;
    }

    function getCategory(id) {
      for (var i = 0; i < state.categories.length; i++) {
        if (state.categories[i].id === id) return state.categories[i];
      }
      return getConfig().fallbackCategory;
    }

    function getCategoryPriorityMap() {
      var map = {};
      for (var i = 0; i < state.categories.length; i++) {
        map[state.categories[i].id] = i;
      }
      return map;
    }

    function addCategory(name, color) {
      var cleanName = String(name || '').trim().slice(0, 20);
      if (!cleanName) throw new Error('类别名称不能为空');
      var cat = normalizeCategory({
        id: generateId('cat'),
        name: cleanName,
        color: color || '#2B6CD4'
      });
      state.categories.push(cat);
      save();
      return cat;
    }

    function updateCategory(id, patch) {
      for (var i = 0; i < state.categories.length; i++) {
        if (state.categories[i].id === id) {
          if (patch.name !== undefined) {
            var n = String(patch.name).trim().slice(0, 20);
            if (n) state.categories[i].name = n;
          }
          if (patch.color !== undefined) {
            state.categories[i].color = WorkCal.Color
              ? WorkCal.Color.normalizeHex(patch.color)
              : patch.color;
          }
          save();
          return state.categories[i];
        }
      }
      return null;
    }

    function deleteCategory(id) {
      var before = state.categories.length;
      state.categories = state.categories.filter(function (c) {
        return c.id !== id;
      });
      if (state.categories.length !== before) {
        save();
        return true;
      }
      return false;
    }

    function moveCategory(id, direction) {
      var idx = -1;
      for (var i = 0; i < state.categories.length; i++) {
        if (state.categories[i].id === id) {
          idx = i;
          break;
        }
      }
      if (idx === -1) return false;
      var target = direction === 'up' ? idx - 1 : idx + 1;
      if (target < 0 || target >= state.categories.length) return false;
      var tmp = state.categories[idx];
      state.categories[idx] = state.categories[target];
      state.categories[target] = tmp;
      save();
      return true;
    }

    function getEvents() {
      return state.events;
    }

    function getEventById(id) {
      for (var i = 0; i < state.events.length; i++) {
        if (state.events[i].id === id) return state.events[i];
      }
      return null;
    }

    function addEvent(data) {
      var ev = normalizeEvent(data);
      if (!ev.title) throw new Error('日程标题不能为空');
      if (!ev.startDate) throw new Error('开始日期不能为空');
      state.events.push(ev);
      save();
      return ev;
    }

    function updateEvent(id, patch) {
      for (var i = 0; i < state.events.length; i++) {
        if (state.events[i].id === id) {
          var merged = Object.assign({}, state.events[i], patch, {
            id: id,
            createdAt: state.events[i].createdAt,
            updatedAt: new Date().toISOString()
          });
          var normalized = normalizeEvent(merged);
          if (!normalized.title) throw new Error('日程标题不能为空');
          state.events[i] = normalized;
          save();
          return normalized;
        }
      }
      return null;
    }

    function deleteEvent(id) {
      var before = state.events.length;
      state.events = state.events.filter(function (e) {
        return e.id !== id;
      });
      if (state.events.length !== before) {
        save();
        return true;
      }
      return false;
    }

    function clearAllEvents() {
      var count = state.events.length;
      state.events = [];
      save();
      return count;
    }

    function resetAll() {
      state = createDefaultState();
      save();
    }

    function getEventsOnDate(dateStr) {
      var priorityMap = getCategoryPriorityMap();
      var list = state.events.filter(function (ev) {
        var end = ev.endDate && ev.endDate >= ev.startDate ? ev.endDate : ev.startDate;
        return ev.startDate <= dateStr && end >= dateStr;
      });
      list.sort(function (a, b) {
        if (WorkCal.Layout) {
          return WorkCal.Layout.compareEvents(a, b, priorityMap);
        }
        return 0;
      });
      return list;
    }

    /**
     * BR-1：获取某日最高优先级的类别（用于日期顶部色条与年视图底色）
     */
    function getTopCategoryOnDate(dateStr) {
      var list = getEventsOnDate(dateStr);
      if (!list.length) return null;
      return getCategory(list[0].categoryId);
    }

    /**
     * 导入台账结果（FR-10 / BR-2：只新增/更新 source==='ledger'，绝不覆盖手填）
     */
    function applyLedgerEntries(entries) {
      var keyIndex = {};
      for (var i = 0; i < state.events.length; i++) {
        var existing = state.events[i];
        if (existing.source === 'ledger' && existing.ledgerKey) {
          keyIndex[existing.ledgerKey] = i;
        }
      }

      var added = 0;
      var updated = 0;
      var now = new Date().toISOString();

      for (var j = 0; j < entries.length; j++) {
        var item = entries[j];
        var endDate = item.endDate && item.endDate > item.startDate ? item.endDate : '';
        var idx = Object.prototype.hasOwnProperty.call(keyIndex, item.ledgerKey)
          ? keyIndex[item.ledgerKey]
          : -1;

        if (idx >= 0) {
          var prev = state.events[idx];
          state.events[idx] = normalizeEvent({
            id: prev.id,
            title: item.title,
            categoryId: item.categoryId,
            startDate: item.startDate,
            endDate: endDate,
            allDay: true,
            notes: item.notes,
            source: 'ledger',
            ledgerKey: item.ledgerKey,
            ledgerMeta: item.ledgerMeta,
            createdAt: prev.createdAt,
            updatedAt: now
          });
          updated++;
        } else {
          var created = normalizeEvent({
            id: generateId('evt'),
            title: item.title,
            categoryId: item.categoryId,
            startDate: item.startDate,
            endDate: endDate,
            allDay: true,
            notes: item.notes,
            source: 'ledger',
            ledgerKey: item.ledgerKey,
            ledgerMeta: item.ledgerMeta,
            createdAt: now,
            updatedAt: now
          });
          keyIndex[item.ledgerKey] = state.events.length;
          state.events.push(created);
          added++;
        }
      }

      save();
      return { added: added, updated: updated };
    }

    function exportBackupJSON() {
      return JSON.stringify(
        {
          app: 'work-calendar',
          version: 1,
          exportedAt: new Date().toISOString(),
          categories: state.categories,
          events: state.events
        },
        null,
        2
      );
    }

    function parseBackupJSON(text) {
      var parsed;
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        throw new Error('JSON 格式不正确，无法解析');
      }
      if (!parsed || !Array.isArray(parsed.categories) || !Array.isArray(parsed.events)) {
        throw new Error('备份文件缺少必要的 categories 或 events 数据');
      }
      var categories = parsed.categories.map(normalizeCategory);
      var events = parsed.events
        .map(normalizeEvent)
        .filter(function (e) {
          return Boolean(e.title && e.startDate);
        });
      return { categories: categories, events: events };
    }

    function restoreBackup(data, mode) {
      if (mode === 'merge') {
        var catMap = {};
        state.categories.forEach(function (c) {
          catMap[c.id] = true;
        });
        data.categories.forEach(function (c) {
          if (!catMap[c.id]) {
            state.categories.push(normalizeCategory(c));
            catMap[c.id] = true;
          }
        });
        var evtMap = {};
        state.events.forEach(function (e) {
          evtMap[e.id] = true;
        });
        var mergedCount = 0;
        data.events.forEach(function (e) {
          if (!evtMap[e.id]) {
            state.events.push(normalizeEvent(e));
            evtMap[e.id] = true;
            mergedCount++;
          }
        });
        save();
        return { categories: state.categories.length, events: mergedCount };
      }

      // 默认完全还原（AC-16）
      state = {
        version: 1,
        categories: data.categories.map(normalizeCategory),
        events: data.events.map(normalizeEvent),
        updatedAt: new Date().toISOString()
      };
      save();
      return {
        categories: state.categories.length,
        events: state.events.length
      };
    }

    function escapeICSText(str) {
      return String(str || '')
        .replace(/\\/g, '\\\\')
        .replace(/\r?\n/g, '\\n')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,');
    }

    function exportICS() {
      var DU = getDateUtils();
      var lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//WorkCalendar//Personal Schedule//CN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'X-WR-CALNAME:工作日程'
      ];

      var stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

      for (var i = 0; i < state.events.length; i++) {
        var ev = state.events[i];
        var cat = getCategory(ev.categoryId);
        var endDate = ev.endDate && ev.endDate >= ev.startDate ? ev.endDate : ev.startDate;
        var summary = '[' + cat.name + '] ' + ev.title;
        var descParts = [];
        if (ev.ledgerMeta && ev.ledgerMeta.stage) {
          descParts.push('评估阶段：' + ev.ledgerMeta.stage);
        }
        if (ev.ledgerMeta && ev.ledgerMeta.level) {
          descParts.push('等级：' + ev.ledgerMeta.level);
        }
        if (ev.ledgerMeta && ev.ledgerMeta.role) {
          descParts.push('角色：' + ev.ledgerMeta.role);
        }
        if (ev.notes) {
          descParts.push(ev.notes);
        }

        lines.push('BEGIN:VEVENT');
        lines.push('UID:' + escapeICSText(ev.id) + '@work-calendar.local');
        lines.push('DTSTAMP:' + stamp);

        if (ev.allDay !== false) {
          // RFC 5545：全天事件 DTEND 为排他次日
          var exclusiveEnd = DU.addDays(endDate, 1);
          lines.push('DTSTART;VALUE=DATE:' + ev.startDate.replace(/-/g, ''));
          lines.push('DTEND;VALUE=DATE:' + exclusiveEnd.replace(/-/g, ''));
        } else {
          var sTime = (ev.startTime || '09:00').replace(':', '') + '00';
          var eTime = (ev.endTime || '18:00').replace(':', '') + '00';
          lines.push('DTSTART:' + ev.startDate.replace(/-/g, '') + 'T' + sTime);
          lines.push('DTEND:' + endDate.replace(/-/g, '') + 'T' + eTime);
        }

        lines.push('SUMMARY:' + escapeICSText(summary));
        lines.push('CATEGORIES:' + escapeICSText(cat.name));
        if (descParts.length) {
          lines.push('DESCRIPTION:' + escapeICSText(descParts.join('\n')));
        }
        lines.push('END:VEVENT');
      }

      lines.push('END:VCALENDAR');
      return lines.join('\r\n');
    }

    function bytesToBase64Url(bytes) {
      var bin = '';
      var chunk = 0x8000;
      for (var i = 0; i < bytes.length; i += chunk) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
      }
      var b64 =
        typeof btoa === 'function'
          ? btoa(bin)
          : Buffer.from(bytes).toString('base64');
      return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    function base64UrlToBytes(b64url) {
      var b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      if (typeof atob === 'function') {
        var bin = atob(b64);
        var out = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) {
          out[i] = bin.charCodeAt(i);
        }
        return out;
      }
      return new Uint8Array(Buffer.from(b64, 'base64'));
    }

    function packCompactState() {
      return {
        v: 1,
        c: state.categories.map(function (c) {
          return [c.id, c.name, c.color];
        }),
        e: state.events.map(function (ev) {
          return [
            ev.id,
            ev.title,
            ev.categoryId,
            ev.startDate,
            ev.endDate || '',
            ev.allDay !== false ? 1 : 0,
            ev.startTime || '',
            ev.endTime || '',
            ev.notes || '',
            ev.source === 'ledger' ? 1 : 0,
            ev.ledgerKey || '',
            ev.ledgerMeta || null
          ];
        })
      };
    }

    function unpackCompactState(packed) {
      if (!packed || !Array.isArray(packed.c) || !Array.isArray(packed.e)) {
        throw new Error('同步数据格式无效');
      }
      return {
        categories: packed.c.map(function (row) {
          return normalizeCategory({ id: row[0], name: row[1], color: row[2] });
        }),
        events: packed.e.map(function (row) {
          return normalizeEvent({
            id: row[0],
            title: row[1],
            categoryId: row[2],
            startDate: row[3],
            endDate: row[4],
            allDay: row[5] !== 0,
            startTime: row[6],
            endTime: row[7],
            notes: row[8],
            source: row[9] === 1 ? 'ledger' : 'manual',
            ledgerKey: row[10],
            ledgerMeta: row[11]
          });
        })
      };
    }

    function encodeSyncTokenAsync() {
      var jsonStr = JSON.stringify(packCompactState());
      var encoder = new TextEncoder();
      var rawBytes = encoder.encode(jsonStr);

      if (typeof CompressionStream !== 'undefined') {
        try {
          var cs = new CompressionStream('deflate-raw');
          var writer = cs.writable.getWriter();
          writer.write(rawBytes);
          writer.close();
          return new Response(cs.readable)
            .arrayBuffer()
            .then(function (buf) {
              return 'z.' + bytesToBase64Url(new Uint8Array(buf));
            })
            .catch(function () {
              return 'p.' + bytesToBase64Url(rawBytes);
            });
        } catch (err) {
          return Promise.resolve('p.' + bytesToBase64Url(rawBytes));
        }
      }
      return Promise.resolve('p.' + bytesToBase64Url(rawBytes));
    }

    function decodeSyncTokenAsync(token) {
      if (!token || typeof token !== 'string') {
        return Promise.reject(new Error('同步参数为空'));
      }
      var clean = token.trim();
      if (clean.indexOf('z.') === 0) {
        var compressed = base64UrlToBytes(clean.slice(2));
        if (typeof DecompressionStream !== 'undefined') {
          var ds = new DecompressionStream('deflate-raw');
          var writer = ds.writable.getWriter();
          writer.write(compressed);
          writer.close();
          return new Response(ds.readable)
            .arrayBuffer()
            .then(function (buf) {
              var text = new TextDecoder('utf-8').decode(new Uint8Array(buf));
              return unpackCompactState(JSON.parse(text));
            });
        }
        if (WorkCal.Importer && WorkCal.Importer.inflateRaw) {
          var inflated = WorkCal.Importer.inflateRaw(compressed);
          var text2 = new TextDecoder('utf-8').decode(inflated);
          return Promise.resolve(unpackCompactState(JSON.parse(text2)));
        }
        return Promise.reject(new Error('当前浏览器不支持解压该同步链接'));
      }
      if (clean.indexOf('p.') === 0) {
        var bytes = base64UrlToBytes(clean.slice(2));
        var str = new TextDecoder('utf-8').decode(bytes);
        return Promise.resolve(unpackCompactState(JSON.parse(str)));
      }
      return Promise.reject(new Error('无法识别的同步链接格式'));
    }

    function buildSyncUrl(token, currentHref) {
      var base = currentHref || (typeof window !== 'undefined' ? window.location.href : 'https://example.com/');
      var url = new URL(base);
      // 保留所有现有查询参数（如访问参数 ?k=ryan2026），将同步数据放进 hash
      url.hash = 'sync=' + token;
      return url.toString();
    }

    /**
     * 在当前月一键加载贴近真实业务的示例日程（便于初版直观体验）
     */
    function loadSampleData(year, month) {
      var DU = getDateUtils();
      var pad = DU.pad2;
      var ym = year + '-' + pad(month);

      var samples = [
        {
          title: '华东新能源装备厂现场评估',
          categoryId: 'cat-assessment',
          startDate: ym + '-03',
          endDate: ym + '-05',
          allDay: true,
          notes: '联系人：李工 13800001111；需携带评估表与安全检查清单'
        },
        {
          title: '智能制造专项咨询出差（跨周）',
          categoryId: 'cat-consulting',
          startDate: ym + '-11',
          endDate: ym + '-16',
          allDay: true,
          notes: '高铁往返，周一上午与甲方项目组对齐评估范围'
        },
        {
          title: '某化工园区预评估（并行档期）',
          categoryId: 'cat-assessment',
          startDate: ym + '-13',
          endDate: ym + '-15',
          allDay: true,
          notes: '协助复核工艺安全资料'
        },
        {
          title: '华东项目初稿报告提交截止',
          categoryId: 'cat-deadline',
          startDate: ym + '-19',
          endDate: '',
          allDay: false,
          startTime: '17:00',
          endTime: '18:00',
          notes: '17:00 前发甲方邮箱并抄送内审组'
        },
        {
          title: '内部评估专家复核会',
          categoryId: 'cat-consulting',
          startDate: ym + '-19',
          endDate: '',
          allDay: false,
          startTime: '09:30',
          endTime: '11:30',
          notes: '三楼小会议室'
        },
        {
          title: '整理现场照片与归档台账',
          categoryId: 'cat-rest',
          startDate: ym + '-19',
          endDate: '',
          allDay: true,
          notes: '下午调休半天'
        }
      ];

      samples.forEach(function (item) {
        addEvent(item);
      });
      return samples.length;
    }

    return {
      getState: getState,
      getCategories: getCategories,
      getCategory: getCategory,
      getCategoryPriorityMap: getCategoryPriorityMap,
      addCategory: addCategory,
      updateCategory: updateCategory,
      deleteCategory: deleteCategory,
      moveCategory: moveCategory,
      getEvents: getEvents,
      getEventById: getEventById,
      addEvent: addEvent,
      updateEvent: updateEvent,
      deleteEvent: deleteEvent,
      clearAllEvents: clearAllEvents,
      resetAll: resetAll,
      getEventsOnDate: getEventsOnDate,
      getTopCategoryOnDate: getTopCategoryOnDate,
      applyLedgerEntries: applyLedgerEntries,
      exportBackupJSON: exportBackupJSON,
      parseBackupJSON: parseBackupJSON,
      restoreBackup: restoreBackup,
      exportICS: exportICS,
      encodeSyncTokenAsync: encodeSyncTokenAsync,
      decodeSyncTokenAsync: decodeSyncTokenAsync,
      buildSyncUrl: buildSyncUrl,
      loadSampleData: loadSampleData
    };
  }

  WorkCal.Storage = {
    createStore: createStore
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = WorkCal.Storage;
  }
})(typeof window !== 'undefined' ? window : globalThis);
