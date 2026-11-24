'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const { generateId, generateToken, hashPassword } = require('./auth');
const AppConfig = require('../js/config');
const BuiltinHolidays = require('../js/holidays');
const EvalCore = require('../js/eval-core');

const PROTECTED_ASSESSMENT_CAT_ID = AppConfig.protectedAssessmentCategoryId || 'cat-assessment';
const PROTECTED_ASSESSMENT_CAT_NAME = AppConfig.protectedAssessmentCategoryName || '外出评估';

function withTransaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore rollback errors
    }
    throw err;
  }
}

function initDatabase({ dbPath, backupDir } = {}) {
  const resolvedDbPath = path.resolve(dbPath || process.env.DB_PATH || path.join(__dirname, '..', 'data', 'calendar.db'));
  const resolvedBackupDir = path.resolve(
    backupDir || process.env.BACKUP_DIR || path.join(path.dirname(resolvedDbPath), 'backups')
  );

  fs.mkdirSync(path.dirname(resolvedDbPath), { recursive: true });
  fs.mkdirSync(resolvedBackupDir, { recursive: true });

  const db = new DatabaseSync(resolvedDbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin', 'user')),
      is_active INTEGER NOT NULL DEFAULT 1,
      ics_token TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_login_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      user_agent TEXT,
      ip TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, id)
    );
    CREATE INDEX IF NOT EXISTS idx_categories_user_order ON categories(user_id, sort_order);

    CREATE TABLE IF NOT EXISTS events (
      id TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      category_id TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL DEFAULT '',
      all_day INTEGER NOT NULL DEFAULT 1,
      start_time TEXT NOT NULL DEFAULT '',
      end_time TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual', 'ledger')),
      ledger_key TEXT NOT NULL DEFAULT '',
      ledger_meta TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, id)
    );
    CREATE INDEX IF NOT EXISTS idx_events_user_dates ON events(user_id, start_date, end_date);
    CREATE INDEX IF NOT EXISTS idx_events_user_ledger ON events(user_id, source, ledger_key);

    CREATE TABLE IF NOT EXISTS holiday_years (
      year INTEGER PRIMARY KEY,
      source TEXT NOT NULL DEFAULT 'builtin',
      synced_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS holidays (
      date TEXT PRIMARY KEY,
      year INTEGER NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('holiday', 'workday')),
      name TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'builtin',
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_holidays_year ON holidays(year);

    CREATE TABLE IF NOT EXISTS eval_projects (
      id TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      level TEXT NOT NULL,
      role TEXT NOT NULL,
      stage TEXT NOT NULL,
      start_date TEXT NOT NULL DEFAULT '',
      end_date TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '待开始',
      settle TEXT NOT NULL DEFAULT '未结',
      note TEXT NOT NULL DEFAULT '',
      fee_manual REAL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, id)
    );
    CREATE INDEX IF NOT EXISTS idx_eval_projects_user ON eval_projects(user_id, start_date);
    CREATE INDEX IF NOT EXISTS idx_eval_projects_name ON eval_projects(user_id, name);

    CREATE TABLE IF NOT EXISTS eval_travels (
      id TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      name TEXT NOT NULL,
      stage TEXT NOT NULL DEFAULT '预评估',
      level TEXT NOT NULL DEFAULT '',
      plan_start TEXT NOT NULL DEFAULT '',
      plan_end TEXT NOT NULL DEFAULT '',
      plan_text TEXT NOT NULL DEFAULT '',
      cat TEXT NOT NULL DEFAULT '打车',
      cat_custom TEXT NOT NULL DEFAULT '',
      amount REAL NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      reimb TEXT NOT NULL DEFAULT '未报',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, id)
    );
    CREATE INDEX IF NOT EXISTS idx_eval_travels_user ON eval_travels(user_id, date);

    CREATE TABLE IF NOT EXISTS eval_settings (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      settings_json TEXT NOT NULL,
      merge_names INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );
  `);

  // 兼容已有生产库：为 events 表补齐 eval_project_id 关联列
  const eventCols = db.prepare('PRAGMA table_info(events)').all();
  if (!eventCols.some((c) => c.name === 'eval_project_id')) {
    db.exec("ALTER TABLE events ADD COLUMN eval_project_id TEXT NOT NULL DEFAULT '';");
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_events_user_eval ON events(user_id, eval_project_id);');

  seedBuiltinHolidays(db);
  const bootstrapInfo = ensureInitialAdmin(db);

  // 为所有已有账号确保系统受保护类别「外出评估」存在且名称一致
  // 并把旧版「导入台账」生成的外出评估日程迁移为评估项目（幂等：已关联的日程不会重复处理）
  const allUsers = db.prepare('SELECT id FROM users').all();
  for (const u of allUsers) {
    withTransaction(db, () => {
      ensureProtectedAssessmentCategory(db, u.id);
      migrateLegacyLedgerEvents(db, u.id);
    });
  }

  return {
    db,
    dbPath: resolvedDbPath,
    backupDir: resolvedBackupDir,
    bootstrapInfo
  };
}

function ensureProtectedAssessmentCategory(db, userId) {
  const existing = db
    .prepare('SELECT id, name, color FROM categories WHERE user_id = ? AND id = ?')
    .get(userId, PROTECTED_ASSESSMENT_CAT_ID);
  const now = new Date().toISOString();
  if (!existing) {
    // 用户曾删掉原类别又自建了同名「外出评估」时，直接接管该类别（沿用其颜色与排序），避免出现两个同名类别
    const sameName = db
      .prepare(
        'SELECT id, color, sort_order FROM categories WHERE user_id = ? AND name = ? ORDER BY sort_order ASC LIMIT 1'
      )
      .get(userId, PROTECTED_ASSESSMENT_CAT_NAME);
    if (sameName) {
      db.prepare(
        `INSERT OR IGNORE INTO categories (id, user_id, name, color, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        PROTECTED_ASSESSMENT_CAT_ID,
        userId,
        PROTECTED_ASSESSMENT_CAT_NAME,
        sameName.color,
        sameName.sort_order,
        now,
        now
      );
      db.prepare(
        'UPDATE events SET category_id = ?, updated_at = ? WHERE user_id = ? AND category_id = ?'
      ).run(PROTECTED_ASSESSMENT_CAT_ID, now, userId, sameName.id);
      db.prepare('DELETE FROM categories WHERE user_id = ? AND id = ?').run(userId, sameName.id);
      return;
    }
    const maxRow = db
      .prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM categories WHERE user_id = ?')
      .get(userId);
    const sortOrder = (maxRow ? maxRow.m : -1) + 1;
    db.prepare(
      `INSERT OR IGNORE INTO categories (id, user_id, name, color, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(PROTECTED_ASSESSMENT_CAT_ID, userId, PROTECTED_ASSESSMENT_CAT_NAME, '#D97A12', sortOrder, now, now);
  } else if (existing.name !== PROTECTED_ASSESSMENT_CAT_NAME) {
    db.prepare(
      'UPDATE categories SET name = ?, updated_at = ? WHERE user_id = ? AND id = ?'
    ).run(PROTECTED_ASSESSMENT_CAT_NAME, now, userId, PROTECTED_ASSESSMENT_CAT_ID);
  }
}

function seedDefaultCategories(db, userId) {
  const now = new Date().toISOString();
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO categories (id, user_id, name, color, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const defaults = AppConfig.defaultCategories || [];
  defaults.forEach((cat, idx) => {
    stmt.run(cat.id, userId, cat.name, cat.color, idx, now, now);
  });
  ensureProtectedAssessmentCategory(db, userId);
}

function seedBuiltinHolidays(db) {
  const plans = BuiltinHolidays.YEAR_PLANS || {};
  const checkYear = db.prepare('SELECT year FROM holiday_years WHERE year = ?');
  const insertYear = db.prepare(
    'INSERT OR IGNORE INTO holiday_years (year, source, synced_at) VALUES (?, ?, ?)'
  );
  const insertEntry = db.prepare(
    `INSERT OR IGNORE INTO holidays (date, year, type, name, source, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const now = new Date().toISOString();

  withTransaction(db, () => {
    Object.keys(plans).forEach((yrKey) => {
      const year = parseInt(yrKey, 10);
      if (!Number.isFinite(year)) return;
      if (checkYear.get(year)) return;
      const plan = plans[yrKey];
      insertYear.run(year, 'builtin', now);
      if (plan && plan.holidays) {
        Object.keys(plan.holidays).forEach((dateStr) => {
          insertEntry.run(dateStr, year, 'holiday', String(plan.holidays[dateStr] || '法定节假日'), 'builtin', now);
        });
      }
      if (plan && plan.workdays) {
        Object.keys(plan.workdays).forEach((dateStr) => {
          insertEntry.run(dateStr, year, 'workday', String(plan.workdays[dateStr] || '调休上班'), 'builtin', now);
        });
      }
    });
  });
}

function ensureInitialAdmin(db) {
  const existingAdmin = db.prepare("SELECT id, username FROM users WHERE role = 'admin' LIMIT 1").get();
  if (existingAdmin) return null;

  const username = String(process.env.ADMIN_USERNAME || 'admin').trim() || 'admin';
  let password = String(process.env.ADMIN_PASSWORD || '').trim();
  let generated = false;

  if (!password) {
    password = crypto.randomBytes(9).toString('base64url');
    generated = true;
  }

  const now = new Date().toISOString();
  const userId = generateId('usr');
  const icsToken = generateToken(32);

  withTransaction(db, () => {
    db.prepare(
      `INSERT INTO users (id, username, display_name, password_hash, role, is_active, ics_token, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'admin', 1, ?, ?, ?)`
    ).run(userId, username, '管理员', hashPassword(password), icsToken, now, now);
    seedDefaultCategories(db, userId);
  });

  return { username, password, generated };
}

function getUserStateUpdatedAt(db, userId) {
  const e = db.prepare('SELECT MAX(updated_at) AS ts FROM events WHERE user_id = ?').get(userId);
  const c = db.prepare('SELECT MAX(updated_at) AS ts FROM categories WHERE user_id = ?').get(userId);
  const ep = db.prepare('SELECT MAX(updated_at) AS ts FROM eval_projects WHERE user_id = ?').get(userId);
  const et = db.prepare('SELECT MAX(updated_at) AS ts FROM eval_travels WHERE user_id = ?').get(userId);
  const es = db.prepare('SELECT updated_at AS ts FROM eval_settings WHERE user_id = ?').get(userId);
  const tsList = [e && e.ts, c && c.ts, ep && ep.ts, et && et.ts, es && es.ts].filter(Boolean).sort();
  return tsList.length ? tsList[tsList.length - 1] : null;
}

function listCategoriesForUser(db, userId) {
  const rows = db
    .prepare(
      `SELECT id, name, color, sort_order, created_at, updated_at
       FROM categories
       WHERE user_id = ?
       ORDER BY sort_order ASC, created_at ASC`
    )
    .all(userId);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    color: r.color,
    protected: r.id === PROTECTED_ASSESSMENT_CAT_ID
  }));
}

function rowToEvent(r) {
  const evalProjectId = r.eval_project_id || '';
  const ev = {
    id: r.id,
    title: r.title,
    categoryId: r.category_id,
    startDate: r.start_date,
    endDate: r.end_date || '',
    allDay: r.all_day !== 0,
    startTime: r.start_time || '',
    endTime: r.end_time || '',
    notes: r.notes || '',
    source: evalProjectId ? 'eval' : r.source === 'ledger' ? 'ledger' : 'manual',
    evalProjectId: evalProjectId,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
  if (ev.source === 'ledger' || ev.source === 'eval') {
    ev.ledgerKey = r.ledger_key || '';
    if (r.ledger_meta) {
      try {
        ev.ledgerMeta = JSON.parse(r.ledger_meta);
      } catch {
        // ignore invalid json
      }
    }
  }
  return ev;
}

function listEventsForUser(db, userId) {
  const rows = db
    .prepare(
      `SELECT id, title, category_id, start_date, end_date, all_day, start_time, end_time,
              notes, source, ledger_key, ledger_meta, eval_project_id, created_at, updated_at
       FROM events
       WHERE user_id = ?
       ORDER BY start_date ASC, created_at ASC`
    )
    .all(userId);
  return rows.map(rowToEvent);
}

function buildCalendarStateResponse(db, userId) {
  ensureProtectedAssessmentCategory(db, userId);
  return {
    version: 1,
    categories: listCategoriesForUser(db, userId),
    events: listEventsForUser(db, userId),
    updatedAt: getUserStateUpdatedAt(db, userId) || new Date().toISOString()
  };
}

// =========================================================================
// 评估项目管理平台数据访问与工作日程双向联动
// =========================================================================
function rowToEvalProject(r) {
  return {
    id: r.id,
    name: r.name,
    level: r.level,
    role: r.role,
    stage: r.stage,
    start: r.start_date || '',
    end: r.end_date || '',
    status: r.status || '待开始',
    settle: r.settle || '未结',
    note: r.note || '',
    feeManual: r.fee_manual === null || r.fee_manual === undefined ? null : Number(r.fee_manual),
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

function rowToEvalTravel(r) {
  return {
    id: r.id,
    date: r.date,
    name: r.name,
    stage: r.stage || '预评估',
    level: r.level || '',
    planStart: r.plan_start || '',
    planEnd: r.plan_end || '',
    planText: r.plan_text || '',
    cat: r.cat || '打车',
    catCustom: r.cat_custom || '',
    amount: Number(r.amount) || 0,
    detail: r.detail || '',
    reimb: r.reimb || '未报',
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

function getEvalSettingsForUser(db, userId) {
  const row = db
    .prepare('SELECT settings_json, merge_names, updated_at FROM eval_settings WHERE user_id = ?')
    .get(userId);
  if (!row) {
    return {
      settings: EvalCore.createDefaultSettings(),
      mergeNames: true,
      updatedAt: null
    };
  }
  let parsed = null;
  try {
    parsed = JSON.parse(row.settings_json);
  } catch {
    parsed = null;
  }
  return {
    settings: EvalCore.normalizeSettings(parsed),
    mergeNames: row.merge_names !== 0,
    updatedAt: row.updated_at || null
  };
}

function listEvalProjectsForUser(db, userId) {
  const rows = db
    .prepare(
      `SELECT * FROM eval_projects
       WHERE user_id = ?
       ORDER BY start_date DESC, created_at DESC`
    )
    .all(userId);
  return rows.map(rowToEvalProject);
}

function listEvalTravelsForUser(db, userId) {
  const rows = db
    .prepare(
      `SELECT * FROM eval_travels
       WHERE user_id = ?
       ORDER BY date DESC, name ASC, created_at DESC`
    )
    .all(userId);
  return rows.map(rowToEvalTravel);
}

/**
 * 同步单条评估项目记录到当前用户的工作日程（category_id 固定为 cat-assessment「外出评估」）
 * - 有开始时间：创建或更新对应的全天日程（标题保留“预评估/正式评估”）
 * - 未排期（无开始时间）：若此前有关联日程则自动删除
 */
function syncProjectToCalendarEvent(db, userId, projectObj) {
  ensureProtectedAssessmentCategory(db, userId);
  const existing = db
    .prepare('SELECT * FROM events WHERE user_id = ? AND eval_project_id = ? LIMIT 1')
    .get(userId, projectObj.id);

  if (!projectObj || !projectObj.start) {
    if (existing) {
      db.prepare('DELETE FROM events WHERE user_id = ? AND id = ?').run(userId, existing.id);
    }
    return null;
  }

  const title = EvalCore.formatEventTitleForProject(projectObj.name, projectObj.stage);
  const startDate = projectObj.start;
  const endDate =
    projectObj.end && projectObj.end > startDate ? projectObj.end : '';
  const notes = EvalCore.buildProjectEventNotes(projectObj);
  const ledgerMetaJson = JSON.stringify({
    projectName: projectObj.name,
    stage: projectObj.stage,
    level: projectObj.level,
    role: projectObj.role,
    status: projectObj.status,
    settle: projectObj.settle
  });
  const now = new Date().toISOString();

  if (existing) {
    db.prepare(
      `UPDATE events
       SET title = ?, category_id = ?, start_date = ?, end_date = ?, all_day = 1,
           start_time = '', end_time = '', notes = ?, source = 'ledger',
           ledger_meta = ?, updated_at = ?
       WHERE user_id = ? AND id = ?`
    ).run(
      title,
      PROTECTED_ASSESSMENT_CAT_ID,
      startDate,
      endDate,
      notes,
      ledgerMetaJson,
      now,
      userId,
      existing.id
    );
    const updated = db
      .prepare('SELECT * FROM events WHERE user_id = ? AND id = ?')
      .get(userId, existing.id);
    return rowToEvent(updated);
  }

  const eventId = generateId('evt');
  db.prepare(
    `INSERT INTO events (
       id, user_id, title, category_id, start_date, end_date, all_day,
       start_time, end_time, notes, source, ledger_key, ledger_meta, eval_project_id,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, 1, '', '', ?, 'ledger', '', ?, ?, ?, ?)`
  ).run(
    eventId,
    userId,
    title,
    PROTECTED_ASSESSMENT_CAT_ID,
    startDate,
    endDate,
    notes,
    ledgerMetaJson,
    projectObj.id,
    now,
    now
  );
  const created = db
    .prepare('SELECT * FROM events WHERE user_id = ? AND id = ?')
    .get(userId, eventId);
  return rowToEvent(created);
}

function deleteCalendarEventForProject(db, userId, projectId) {
  db.prepare('DELETE FROM events WHERE user_id = ? AND eval_project_id = ?').run(userId, projectId);
}

/**
 * 关联日程在日历侧改了日期时，回写到评估项目并重新同步日程（标题/备注仍以项目为准）
 * 单日日程的 endDate 为空，回写时视为结束日 = 开始日，避免项目天数变成 0
 */
function applyEventDatesToProject(db, userId, projectId, startDate, endDate) {
  const row = db
    .prepare('SELECT * FROM eval_projects WHERE user_id = ? AND id = ?')
    .get(userId, projectId);
  if (!row) return null;
  const nextEnd = endDate && endDate > startDate ? endDate : startDate;
  const now = new Date().toISOString();
  db.prepare(
    'UPDATE eval_projects SET start_date = ?, end_date = ?, updated_at = ? WHERE user_id = ? AND id = ?'
  ).run(startDate, nextEnd, now, userId, projectId);
  const updated = db
    .prepare('SELECT * FROM eval_projects WHERE user_id = ? AND id = ?')
    .get(userId, projectId);
  return syncProjectToCalendarEvent(db, userId, rowToEvalProject(updated));
}

// =========================================================================
// 旧版「导入台账」日程 -> 评估项目 迁移
// =========================================================================
const LEGACY_LEVEL_MAP = {
  1: '一级', 2: '二级', 3: '三级', 4: '四级',
  一: '一级', 二: '二级', 三: '三级', 四: '四级'
};

function parseLegacyLevel(raw) {
  const m = String(raw || '').match(/[一二三四1-4]/);
  return m ? LEGACY_LEVEL_MAP[m[0]] : null;
}

function parseLegacyRole(raw) {
  const s = String(raw || '').trim();
  if (s.includes('组长') || s === '长') return '组长';
  if (s.includes('组员') || s.includes('成员') || s === '员') return '组员';
  return null;
}

function parseLegacyStage(raw) {
  const s = String(raw || '').trim();
  if (s.includes('正式')) return '正式评估';
  if (s.includes('预')) return '预评估';
  return null;
}

// 旧台账日程备注格式为「阶段：X | 等级：Y | 角色：Z | 原始备注」，只保留原始备注部分
function extractLegacyUserNote(notes) {
  return String(notes || '')
    .split(' | ')
    .filter((part) => !/^(阶段|等级|角色|状态)：/.test(part.trim()))
    .join(' | ')
    .trim();
}

function inferLegacyStatus(start, end, today) {
  if (end < today) return '已完成';
  if (start <= today) return '进行中';
  return '待开始';
}

/**
 * 把旧版台账导入的「外出评估」日程（source='ledger' 且未关联项目）转成评估项目并建立关联
 * - 等级/角色/阶段识别不出时使用默认值（二级/组员/预评估），并在项目备注里标记待核对
 * - 已存在同名+同阶段+同开始日期的项目时：该项目还没有关联日程则直接认领，已有关联日程则删除这条重复的旧日程
 * - 只处理类别为 cat-assessment 的日程；调用方负责包事务
 */
function migrateLegacyLedgerEvents(db, userId, todayStr) {
  const today = EvalCore.isValidDateStr(todayStr) ? todayStr : EvalCore.getTodayShanghai();
  const legacyRows = db
    .prepare(
      `SELECT * FROM events
       WHERE user_id = ? AND source = 'ledger' AND eval_project_id = '' AND category_id = ?
       ORDER BY start_date ASC, created_at ASC`
    )
    .all(userId, PROTECTED_ASSESSMENT_CAT_ID);
  const result = { migrated: 0, linked: 0, removedDuplicates: 0 };
  if (!legacyRows.length) return result;

  const findProject = db.prepare(
    'SELECT * FROM eval_projects WHERE user_id = ? AND name = ? AND stage = ? AND start_date = ? LIMIT 1'
  );
  const findLinkedEvent = db.prepare(
    'SELECT id FROM events WHERE user_id = ? AND eval_project_id = ? LIMIT 1'
  );
  const linkEvent = db.prepare('UPDATE events SET eval_project_id = ? WHERE user_id = ? AND id = ?');
  const deleteEvent = db.prepare('DELETE FROM events WHERE user_id = ? AND id = ?');
  const insertProject = db.prepare(
    `INSERT INTO eval_projects (
       id, user_id, name, level, role, stage, start_date, end_date,
       status, settle, note, fee_manual, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '未结', ?, NULL, ?, ?)`
  );
  const getProject = db.prepare('SELECT * FROM eval_projects WHERE user_id = ? AND id = ?');

  for (const ev of legacyRows) {
    let meta = null;
    try {
      meta = ev.ledger_meta ? JSON.parse(ev.ledger_meta) : null;
    } catch {
      meta = null;
    }
    meta = meta || {};
    const name = String(meta.projectName || ev.title || '').trim().slice(0, 120);
    const start = ev.start_date;
    if (!name || !EvalCore.isValidDateStr(start)) continue;
    const end = EvalCore.isValidDateStr(ev.end_date) && ev.end_date > start ? ev.end_date : start;

    const level = parseLegacyLevel(meta.level);
    const role = parseLegacyRole(meta.role);
    const stage = parseLegacyStage(meta.stage);
    const unresolved = [];
    if (!level) unresolved.push('等级');
    if (!role) unresolved.push('角色');
    if (!stage) unresolved.push('阶段');
    const finalStage = stage || '预评估';

    const existingProject = findProject.get(userId, name, finalStage, start);
    if (existingProject) {
      if (findLinkedEvent.get(userId, existingProject.id)) {
        deleteEvent.run(userId, ev.id);
        result.removedDuplicates++;
      } else {
        linkEvent.run(existingProject.id, userId, ev.id);
        syncProjectToCalendarEvent(db, userId, rowToEvalProject(existingProject));
        result.linked++;
      }
      continue;
    }

    const noteParts = [];
    const userNote = extractLegacyUserNote(ev.notes);
    if (userNote) noteParts.push(userNote);
    if (unresolved.length) {
      noteParts.push(`（由旧版台账日程自动迁移，请核对：${unresolved.join('、')}）`);
    }
    const pid = generateId('p');
    const now = new Date().toISOString();
    insertProject.run(
      pid,
      userId,
      name,
      level || '二级',
      role || '组员',
      finalStage,
      start,
      end,
      inferLegacyStatus(start, end, today),
      noteParts.join(' ').slice(0, 1000),
      now,
      now
    );
    linkEvent.run(pid, userId, ev.id);
    syncProjectToCalendarEvent(db, userId, rowToEvalProject(getProject.get(userId, pid)));
    result.migrated++;
  }
  return result;
}

/**
 * 项目状态自动推进（§4.6 / AC-07）：待开始且开始时间 <= 今天，单向改为进行中
 */
function autoPromoteEvalProjects(db, userId, todayStr) {
  const today = EvalCore.isValidDateStr(todayStr) ? todayStr : EvalCore.getTodayShanghai();
  const candidates = db
    .prepare(
      `SELECT * FROM eval_projects
       WHERE user_id = ? AND status = '待开始' AND start_date != '' AND start_date <= ?`
    )
    .all(userId, today);
  if (!candidates.length) return 0;

  const now = new Date().toISOString();
  withTransaction(db, () => {
    const upd = db.prepare(
      "UPDATE eval_projects SET status = '进行中', updated_at = ? WHERE user_id = ? AND id = ?"
    );
    for (const r of candidates) {
      upd.run(now, userId, r.id);
      const promoted = rowToEvalProject(Object.assign({}, r, { status: '进行中', updated_at: now }));
      syncProjectToCalendarEvent(db, userId, promoted);
    }
  });
  return candidates.length;
}

function buildEvalStateResponse(db, userId, todayStr) {
  autoPromoteEvalProjects(db, userId, todayStr);
  const cfg = getEvalSettingsForUser(db, userId);
  return {
    projects: listEvalProjectsForUser(db, userId),
    travels: listEvalTravelsForUser(db, userId),
    settings: cfg.settings,
    mergeNames: cfg.mergeNames,
    updatedAt: getUserStateUpdatedAt(db, userId) || new Date().toISOString()
  };
}

function getAllHolidaysPayload(db) {
  const years = db
    .prepare('SELECT year, source, synced_at FROM holiday_years ORDER BY year ASC')
    .all()
    .map((r) => ({
      year: r.year,
      source: r.source,
      syncedAt: r.synced_at
    }));
  const entries = db
    .prepare('SELECT date, year, type, name, source, updated_at FROM holidays ORDER BY date ASC')
    .all()
    .map((r) => ({
      date: r.date,
      year: r.year,
      type: r.type,
      name: r.name,
      source: r.source,
      updatedAt: r.updated_at
    }));
  return {
    years: years.map((y) => y.year),
    yearMeta: years,
    entries
  };
}

function formatBackupStamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    date.getFullYear() +
    pad(date.getMonth() + 1) +
    pad(date.getDate()) +
    '_' +
    pad(date.getHours()) +
    pad(date.getMinutes()) +
    pad(date.getSeconds())
  );
}

function createBackupSnapshot(db, backupDir, keepCount) {
  fs.mkdirSync(backupDir, { recursive: true });
  const filename = `calendar_${formatBackupStamp()}.db`;
  const targetPath = path.join(backupDir, filename);
  if (fs.existsSync(targetPath)) {
    fs.unlinkSync(targetPath);
  }
  db.prepare('VACUUM INTO ?').run(targetPath);
  const stat = fs.statSync(targetPath);

  // 清理超出保留数量的旧备份
  const keep = Number.isFinite(keepCount) && keepCount >= 1 ? keepCount : parseInt(process.env.BACKUP_KEEP_DAYS || '14', 10) || 14;
  const files = listBackups(backupDir);
  if (files.length > keep) {
    files.slice(keep).forEach((item) => {
      try {
        fs.unlinkSync(path.join(backupDir, item.filename));
      } catch {
        // ignore
      }
    });
  }

  return {
    filename,
    size: stat.size,
    createdAt: stat.mtime.toISOString(),
    path: targetPath
  };
}

function listBackups(backupDir) {
  if (!fs.existsSync(backupDir)) return [];
  return fs
    .readdirSync(backupDir)
    .filter((f) => /^calendar_\d{8}_\d{6}\.db$/.test(f))
    .map((f) => {
      const st = fs.statSync(path.join(backupDir, f));
      return {
        filename: f,
        size: st.size,
        createdAt: st.mtime.toISOString()
      };
    })
    .sort((a, b) => b.filename.localeCompare(a.filename));
}

module.exports = {
  initDatabase,
  withTransaction,
  ensureProtectedAssessmentCategory,
  seedDefaultCategories,
  getUserStateUpdatedAt,
  listCategoriesForUser,
  listEventsForUser,
  rowToEvent,
  buildCalendarStateResponse,
  rowToEvalProject,
  rowToEvalTravel,
  getEvalSettingsForUser,
  listEvalProjectsForUser,
  listEvalTravelsForUser,
  syncProjectToCalendarEvent,
  deleteCalendarEventForProject,
  applyEventDatesToProject,
  migrateLegacyLedgerEvents,
  autoPromoteEvalProjects,
  buildEvalStateResponse,
  getAllHolidaysPayload,
  createBackupSnapshot,
  listBackups,
  PROTECTED_ASSESSMENT_CAT_ID,
  PROTECTED_ASSESSMENT_CAT_NAME
};
