'use strict';

const express = require('express');
const { generateId } = require('../auth');
const EvalCore = require('../../js/eval-core');
const {
  withTransaction,
  getEvalSettingsForUser,
  rowToEvalProject,
  rowToEvalTravel,
  syncProjectToCalendarEvent,
  deleteCalendarEventForProject,
  buildEvalStateResponse,
  buildCalendarStateResponse
} = require('../db');

function normalizeProjectPayload(raw, settings, opts = {}) {
  const existing = opts.existing || null;
  const allowUnscheduled = Boolean(opts.allowUnscheduled);

  const name = String(raw.name !== undefined ? raw.name : (existing ? existing.name : ''))
    .trim()
    .slice(0, 120);
  if (!name) {
    throw new Error('项目名称不能为空');
  }

  const level = String(raw.level !== undefined ? raw.level : (existing ? existing.level : '二级')).trim();
  if (!EvalCore.LEVELS.includes(level)) {
    throw new Error('项目等级无效（应为一级至四级）');
  }

  const role = String(raw.role !== undefined ? raw.role : (existing ? existing.role : '组员')).trim();
  if (!EvalCore.ROLES.includes(role)) {
    throw new Error('角色无效（应为组员或组长）');
  }

  const stage = String(raw.stage !== undefined ? raw.stage : (existing ? existing.stage : '预评估')).trim();
  if (!EvalCore.STAGES.includes(stage)) {
    throw new Error('评估阶段无效（应为预评估或正式评估）');
  }

  const start = String(raw.start !== undefined ? raw.start : (existing ? existing.start_date : '')).trim();
  if (!start) {
    if (!allowUnscheduled) {
      throw new Error('开始时间不能为空');
    }
  } else if (!EvalCore.isValidDateStr(start)) {
    throw new Error('开始时间格式无效（应为 YYYY-MM-DD）');
  }

  let end = String(raw.end !== undefined ? raw.end : (existing ? existing.end_date : '')).trim();
  if (end) {
    if (!EvalCore.isValidDateStr(end)) {
      throw new Error('结束时间格式无效（应为 YYYY-MM-DD）');
    }
    if (start && end < start) {
      throw new Error('结束时间早于开始时间');
    }
  }

  const status = String(raw.status !== undefined ? raw.status : (existing ? existing.status : '待开始')).trim();
  if (!EvalCore.PROJECT_STATUSES.includes(status)) {
    throw new Error('项目状态无效');
  }

  const settle = String(raw.settle !== undefined ? raw.settle : (existing ? existing.settle : '未结')).trim();
  if (!EvalCore.SETTLE_STATUSES.includes(settle)) {
    throw new Error('费用结算状态无效');
  }

  const note = String(raw.note !== undefined ? raw.note : (existing ? existing.note : '')).slice(0, 1000);

  const days = EvalCore.calcDays(start, end);
  let feeManual = existing && existing.fee_manual !== null && existing.fee_manual !== undefined
    ? Number(existing.fee_manual)
    : null;
  if (raw.feeManual !== undefined) {
    feeManual = EvalCore.normalizeFeeManual(raw.feeManual, days, level, role, settings);
  } else if (existing && feeManual !== null) {
    // 若用户没传 feeManual 但修改了天数/等级/角色，保留既有人工费用值（§4.4：人工值不随规则或费率自动覆写）
    feeManual = EvalCore.round2(feeManual);
  }

  return {
    name,
    level,
    role,
    stage,
    start,
    end,
    status,
    settle,
    note,
    feeManual
  };
}

function normalizeTravelPayload(raw, opts = {}) {
  const existing = opts.existing || null;
  const allowEmptyDetail = Boolean(opts.allowEmptyDetail);

  const date = String(raw.date !== undefined ? raw.date : (existing ? existing.date : '')).trim();
  if (!EvalCore.isValidDateStr(date)) {
    throw new Error('差旅发生日期格式无效（应为 YYYY-MM-DD）');
  }

  const name = String(raw.name !== undefined ? raw.name : (existing ? existing.name : ''))
    .trim()
    .slice(0, 120);
  if (!name) {
    throw new Error('项目名称不能为空');
  }

  const stage = String(raw.stage !== undefined ? raw.stage : (existing ? existing.stage : '预评估')).trim();
  if (!EvalCore.STAGES.includes(stage)) {
    throw new Error('评估阶段无效');
  }

  const level = String(raw.level !== undefined ? raw.level : (existing ? existing.level : '')).trim().slice(0, 20);
  const planStart = String(
    raw.planStart !== undefined ? raw.planStart : (existing ? existing.plan_start : '')
  ).trim();
  const planEnd = String(
    raw.planEnd !== undefined ? raw.planEnd : (existing ? existing.plan_end : '')
  ).trim();
  const planText = String(
    raw.planText !== undefined ? raw.planText : (existing ? existing.plan_text : '')
  )
    .trim()
    .slice(0, 80);

  let cat = String(raw.cat !== undefined ? raw.cat : (existing ? existing.cat : '打车')).trim();
  let catCustom = String(
    raw.catCustom !== undefined ? raw.catCustom : (existing ? existing.cat_custom : '')
  )
    .trim()
    .slice(0, 40);

  if (!EvalCore.TRAVEL_CATS.includes(cat)) {
    if (cat) {
      catCustom = cat.slice(0, 40);
      cat = '自定义';
    } else {
      cat = '打车';
    }
  }
  if (cat === '自定义' && !catCustom) {
    throw new Error('差旅类别选择“自定义”时必须填写自定义类别名称');
  }
  if (cat !== '自定义') {
    catCustom = '';
  }

  const rawAmt = raw.amount !== undefined ? raw.amount : (existing ? existing.amount : null);
  const numAmt = Number(rawAmt);
  if (!Number.isFinite(numAmt) || numAmt <= 0) {
    throw new Error('差旅金额必须大于 0');
  }
  const amount = EvalCore.round2(numAmt);

  const detail = String(raw.detail !== undefined ? raw.detail : (existing ? existing.detail : ''))
    .trim()
    .slice(0, 500);
  if (!detail && !allowEmptyDetail) {
    throw new Error('差旅具体内容不能为空');
  }

  const reimb = String(raw.reimb !== undefined ? raw.reimb : (existing ? existing.reimb : '未报')).trim();
  if (!EvalCore.REIMB_STATUSES.includes(reimb)) {
    throw new Error('报销状态无效（应为未报/已报/已结）');
  }

  return {
    date,
    name,
    stage,
    level,
    planStart: EvalCore.isValidDateStr(planStart) ? planStart : '',
    planEnd: EvalCore.isValidDateStr(planEnd) ? planEnd : '',
    planText,
    cat,
    catCustom,
    amount,
    detail,
    reimb
  };
}

function getTodayParam(req) {
  const q = (req.query && req.query.today) || (req.body && req.body.today);
  return EvalCore.isValidDateStr(q) ? String(q) : EvalCore.getTodayShanghai();
}

function createEvalRouter(db, authMw) {
  const router = express.Router();
  router.use(authMw.requireAuth);

  // 获取当前用户完整评估平台状态（自动执行 待开始->进行中 扫描）
  router.get('/state', (req, res) => {
    const today = getTodayParam(req);
    const evalState = buildEvalStateResponse(db, req.user.id, today);
    res.json(evalState);
  });

  // -------------------------------------------------------------------------
  // 评估项目 CRUD & 批量操作 & 导入 & 示例数据
  // -------------------------------------------------------------------------
  router.post('/projects', (req, res) => {
    const userId = req.user.id;
    const { settings } = getEvalSettingsForUser(db, userId);
    let data;
    try {
      data = normalizeProjectPayload(req.body || {}, settings, { allowUnscheduled: false });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const id = generateId('p');
    const now = new Date().toISOString();
    const today = getTodayParam(req);
    let createdProject;
    let syncedEvent;

    try {
      withTransaction(db, () => {
        db.prepare(
          `INSERT INTO eval_projects (
             id, user_id, name, level, role, stage, start_date, end_date,
             status, settle, note, fee_manual, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          id,
          userId,
          data.name,
          data.level,
          data.role,
          data.stage,
          data.start,
          data.end,
          data.status,
          data.settle,
          data.note,
          data.feeManual,
          now,
          now
        );

        const row = db
          .prepare('SELECT * FROM eval_projects WHERE user_id = ? AND id = ?')
          .get(userId, id);
        createdProject = rowToEvalProject(row);
        syncedEvent = syncProjectToCalendarEvent(db, userId, createdProject);
      });
    } catch (err) {
      return res.status(400).json({ error: err.message || '保存项目失败' });
    }

    res.status(201).json({
      project: createdProject,
      event: syncedEvent,
      evalState: buildEvalStateResponse(db, userId, today),
      calendarState: buildCalendarStateResponse(db, userId)
    });
  });

  router.patch('/projects/:id', (req, res) => {
    const userId = req.user.id;
    const pid = String(req.params.id || '');
    const existing = db
      .prepare('SELECT * FROM eval_projects WHERE user_id = ? AND id = ?')
      .get(userId, pid);
    if (!existing) {
      return res.status(404).json({ error: '项目记录不存在' });
    }

    const { settings } = getEvalSettingsForUser(db, userId);
    const body = req.body || {};
    const today = getTodayParam(req);

    // 合并态下统一修改同名项目全部记录的状态（§4.7 / AC-06）
    if (body.syncGroupStatus === true && body.status !== undefined) {
      const nextStatus = String(body.status).trim();
      if (!EvalCore.PROJECT_STATUSES.includes(nextStatus)) {
        return res.status(400).json({ error: '项目状态无效' });
      }
      const now = new Date().toISOString();
      let affectedCount = 0;

      withTransaction(db, () => {
        const groupRows = db
          .prepare('SELECT * FROM eval_projects WHERE user_id = ? AND name = ?')
          .all(userId, existing.name);
        const upd = db.prepare(
          'UPDATE eval_projects SET status = ?, updated_at = ? WHERE user_id = ? AND id = ?'
        );
        for (const r of groupRows) {
          upd.run(nextStatus, now, userId, r.id);
          const refreshed = rowToEvalProject(Object.assign({}, r, { status: nextStatus, updated_at: now }));
          syncProjectToCalendarEvent(db, userId, refreshed);
          affectedCount++;
        }
      });

      const updatedRow = db
        .prepare('SELECT * FROM eval_projects WHERE user_id = ? AND id = ?')
        .get(userId, pid);
      return res.json({
        project: rowToEvalProject(updatedRow),
        affectedCount,
        evalState: buildEvalStateResponse(db, userId, today),
        calendarState: buildCalendarStateResponse(db, userId)
      });
    }

    let data;
    try {
      // 允许更新既有未排期记录的其他字段（如行内改状态/结算），但如果是表单完整提交且清空开始时间也可支持
      const allowUnscheduled = body.start === undefined ? !existing.start_date : Boolean(body.allowUnscheduled);
      data = normalizeProjectPayload(body, settings, { existing, allowUnscheduled });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const now = new Date().toISOString();
    let updatedProject;
    let syncedEvent;

    try {
      withTransaction(db, () => {
        db.prepare(
          `UPDATE eval_projects
           SET name = ?, level = ?, role = ?, stage = ?, start_date = ?, end_date = ?,
               status = ?, settle = ?, note = ?, fee_manual = ?, updated_at = ?
           WHERE user_id = ? AND id = ?`
        ).run(
          data.name,
          data.level,
          data.role,
          data.stage,
          data.start,
          data.end,
          data.status,
          data.settle,
          data.note,
          data.feeManual,
          now,
          userId,
          pid
        );

        const row = db
          .prepare('SELECT * FROM eval_projects WHERE user_id = ? AND id = ?')
          .get(userId, pid);
        updatedProject = rowToEvalProject(row);
        syncedEvent = syncProjectToCalendarEvent(db, userId, updatedProject);
      });
    } catch (err) {
      return res.status(400).json({ error: err.message || '更新项目失败' });
    }

    res.json({
      project: updatedProject,
      event: syncedEvent,
      evalState: buildEvalStateResponse(db, userId, today),
      calendarState: buildCalendarStateResponse(db, userId)
    });
  });

  router.post('/projects/batch', (req, res) => {
    const userId = req.user.id;
    const body = req.body || {};
    const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean) : [];
    if (!ids.length) {
      return res.status(400).json({ error: '请先选择要批量处理的项目记录' });
    }
    if (ids.length > 2000) {
      return res.status(400).json({ error: '单次批量处理上限 2000 条' });
    }

    const hasStatus = body.status !== undefined;
    const hasSettle = body.settle !== undefined;
    if (!hasStatus && !hasSettle) {
      return res.status(400).json({ error: '请指定要更新的状态字段' });
    }
    if (hasStatus && !EvalCore.PROJECT_STATUSES.includes(String(body.status))) {
      return res.status(400).json({ error: '项目状态无效' });
    }
    if (hasSettle && !EvalCore.SETTLE_STATUSES.includes(String(body.settle))) {
      return res.status(400).json({ error: '费用状态无效' });
    }

    const now = new Date().toISOString();
    const today = getTodayParam(req);
    let updatedCount = 0;
    const affectedNames = new Set();

    withTransaction(db, () => {
      const sel = db.prepare('SELECT * FROM eval_projects WHERE user_id = ? AND id = ?');
      const upd = db.prepare(
        'UPDATE eval_projects SET status = ?, settle = ?, updated_at = ? WHERE user_id = ? AND id = ?'
      );
      for (const id of ids) {
        const row = sel.get(userId, id);
        if (!row) continue;
        const nextStatus = hasStatus ? String(body.status) : row.status;
        const nextSettle = hasSettle ? String(body.settle) : row.settle;
        upd.run(nextStatus, nextSettle, now, userId, id);
        const refreshed = rowToEvalProject(
          Object.assign({}, row, { status: nextStatus, settle: nextSettle, updated_at: now })
        );
        syncProjectToCalendarEvent(db, userId, refreshed);
        affectedNames.add(row.name);
        updatedCount++;
      }
    });

    res.json({
      updatedCount,
      projectCount: affectedNames.size,
      evalState: buildEvalStateResponse(db, userId, today),
      calendarState: buildCalendarStateResponse(db, userId)
    });
  });

  router.delete('/projects/:id', (req, res) => {
    const userId = req.user.id;
    const pid = String(req.params.id || '');
    const today = getTodayParam(req);

    let deleted = false;
    withTransaction(db, () => {
      const info = db
        .prepare('DELETE FROM eval_projects WHERE user_id = ? AND id = ?')
        .run(userId, pid);
      if (info.changes > 0) {
        deleted = true;
        deleteCalendarEventForProject(db, userId, pid);
      }
    });

    if (!deleted) {
      return res.status(404).json({ error: '项目记录不存在' });
    }

    res.json({
      ok: true,
      evalState: buildEvalStateResponse(db, userId, today),
      calendarState: buildCalendarStateResponse(db, userId)
    });
  });

  // 批量导入评估项目（Excel 预览确认后写入，自动联动工作日程）
  router.post('/projects/import', (req, res) => {
    const userId = req.user.id;
    const mode = req.body && req.body.mode === 'replace' ? 'replace' : 'append';
    const items = req.body && req.body.items;
    if (!Array.isArray(items)) {
      return res.status(400).json({ error: '导入数据格式无效' });
    }
    if (items.length > 3000) {
      return res.status(400).json({ error: '单次最多导入 3000 条项目记录' });
    }

    const { settings } = getEvalSettingsForUser(db, userId);
    const now = new Date().toISOString();
    const today = getTodayParam(req);
    let imported = 0;
    let skippedDup = 0;

    try {
      withTransaction(db, () => {
        if (mode === 'replace') {
          db.prepare('DELETE FROM eval_projects WHERE user_id = ?').run(userId);
          db.prepare("DELETE FROM events WHERE user_id = ? AND eval_project_id != ''").run(userId);
        }

        const existingKeys = new Set();
        if (mode === 'append') {
          const rows = db
            .prepare('SELECT name, stage, start_date FROM eval_projects WHERE user_id = ?')
            .all(userId);
          for (const r of rows) {
            existingKeys.add(EvalCore.projectDedupKey({ name: r.name, stage: r.stage, start: r.start_date }));
          }
        }

        const insertStmt = db.prepare(
          `INSERT INTO eval_projects (
             id, user_id, name, level, role, stage, start_date, end_date,
             status, settle, note, fee_manual, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );

        for (const raw of items) {
          const data = normalizeProjectPayload(raw || {}, settings, { allowUnscheduled: true });
          const sig = EvalCore.projectDedupKey(data);
          if (existingKeys.has(sig)) {
            skippedDup++;
            continue;
          }
          existingKeys.add(sig);

          const id = generateId('p');
          insertStmt.run(
            id,
            userId,
            data.name,
            data.level,
            data.role,
            data.stage,
            data.start,
            data.end,
            data.status,
            data.settle,
            data.note,
            data.feeManual,
            now,
            now
          );
          const proj = Object.assign({ id, createdAt: now, updatedAt: now }, data);
          syncProjectToCalendarEvent(db, userId, proj);
          imported++;
        }
      });
    } catch (err) {
      return res.status(400).json({ error: err.message || '项目导入失败' });
    }

    res.json({
      imported,
      skippedDup,
      mode,
      evalState: buildEvalStateResponse(db, userId, today),
      calendarState: buildCalendarStateResponse(db, userId)
    });
  });

  // 载入示例项目（§5.12 / AC-26：7 条演示记录，含 2 个双阶段项目，并自动联动工作日程）
  router.post('/projects/sample', (req, res) => {
    const userId = req.user.id;
    const today = getTodayParam(req);
    const { settings } = getEvalSettingsForUser(db, userId);
    const samples = EvalCore.buildSampleProjects(today);
    const now = new Date().toISOString();
    let added = 0;

    withTransaction(db, () => {
      const insertStmt = db.prepare(
        `INSERT INTO eval_projects (
           id, user_id, name, level, role, stage, start_date, end_date,
           status, settle, note, fee_manual, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const s of samples) {
        const data = normalizeProjectPayload(s, settings, { allowUnscheduled: false });
        const id = generateId('p');
        insertStmt.run(
          id,
          userId,
          data.name,
          data.level,
          data.role,
          data.stage,
          data.start,
          data.end,
          data.status,
          data.settle,
          data.note,
          data.feeManual,
          now,
          now
        );
        syncProjectToCalendarEvent(db, userId, Object.assign({ id, createdAt: now, updatedAt: now }, data));
        added++;
      }
    });

    res.json({
      count: added,
      evalState: buildEvalStateResponse(db, userId, today),
      calendarState: buildCalendarStateResponse(db, userId)
    });
  });

  // -------------------------------------------------------------------------
  // 项目差旅 CRUD & 批量维护 & 导入
  // -------------------------------------------------------------------------
  router.post('/travels', (req, res) => {
    const userId = req.user.id;
    let data;
    try {
      data = normalizeTravelPayload(req.body || {}, { allowEmptyDetail: false });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const id = generateId('t');
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO eval_travels (
         id, user_id, date, name, stage, level, plan_start, plan_end, plan_text,
         cat, cat_custom, amount, detail, reimb, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      userId,
      data.date,
      data.name,
      data.stage,
      data.level,
      data.planStart,
      data.planEnd,
      data.planText,
      data.cat,
      data.catCustom,
      data.amount,
      data.detail,
      data.reimb,
      now,
      now
    );

    const row = db
      .prepare('SELECT * FROM eval_travels WHERE user_id = ? AND id = ?')
      .get(userId, id);
    res.status(201).json({
      travel: rowToEvalTravel(row),
      evalState: buildEvalStateResponse(db, userId, getTodayParam(req))
    });
  });

  router.patch('/travels/:id', (req, res) => {
    const userId = req.user.id;
    const tid = String(req.params.id || '');
    const existing = db
      .prepare('SELECT * FROM eval_travels WHERE user_id = ? AND id = ?')
      .get(userId, tid);
    if (!existing) {
      return res.status(404).json({ error: '差旅记录不存在' });
    }

    let data;
    try {
      // 行内只改报销状态时允许既有记录保留原 detail（例如导入的无具体内容行）
      const allowEmptyDetail = req.body && req.body.detail === undefined && !existing.detail;
      data = normalizeTravelPayload(req.body || {}, { existing, allowEmptyDetail });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const now = new Date().toISOString();
    db.prepare(
      `UPDATE eval_travels
       SET date = ?, name = ?, stage = ?, level = ?, plan_start = ?, plan_end = ?, plan_text = ?,
           cat = ?, cat_custom = ?, amount = ?, detail = ?, reimb = ?, updated_at = ?
       WHERE user_id = ? AND id = ?`
    ).run(
      data.date,
      data.name,
      data.stage,
      data.level,
      data.planStart,
      data.planEnd,
      data.planText,
      data.cat,
      data.catCustom,
      data.amount,
      data.detail,
      data.reimb,
      now,
      userId,
      tid
    );

    const row = db
      .prepare('SELECT * FROM eval_travels WHERE user_id = ? AND id = ?')
      .get(userId, tid);
    res.json({
      travel: rowToEvalTravel(row),
      evalState: buildEvalStateResponse(db, userId, getTodayParam(req))
    });
  });

  router.post('/travels/batch', (req, res) => {
    const userId = req.user.id;
    const body = req.body || {};
    const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean) : [];
    const reimb = String(body.reimb || '').trim();
    if (!ids.length) {
      return res.status(400).json({ error: '请先选择要处理的差旅记录' });
    }
    if (!EvalCore.REIMB_STATUSES.includes(reimb)) {
      return res.status(400).json({ error: '报销状态无效' });
    }

    const now = new Date().toISOString();
    let updatedCount = 0;
    withTransaction(db, () => {
      const upd = db.prepare(
        'UPDATE eval_travels SET reimb = ?, updated_at = ? WHERE user_id = ? AND id = ?'
      );
      for (const id of ids) {
        const info = upd.run(reimb, now, userId, id);
        if (info.changes > 0) updatedCount++;
      }
    });

    res.json({
      updatedCount,
      evalState: buildEvalStateResponse(db, userId, getTodayParam(req))
    });
  });

  router.delete('/travels/:id', (req, res) => {
    const userId = req.user.id;
    const tid = String(req.params.id || '');
    const info = db
      .prepare('DELETE FROM eval_travels WHERE user_id = ? AND id = ?')
      .run(userId, tid);
    if (info.changes === 0) {
      return res.status(404).json({ error: '差旅记录不存在' });
    }
    res.json({
      ok: true,
      evalState: buildEvalStateResponse(db, userId, getTodayParam(req))
    });
  });

  router.post('/travels/import', (req, res) => {
    const userId = req.user.id;
    const mode = req.body && req.body.mode === 'replace' ? 'replace' : 'append';
    const items = req.body && req.body.items;
    if (!Array.isArray(items)) {
      return res.status(400).json({ error: '导入数据格式无效' });
    }
    if (items.length > 5000) {
      return res.status(400).json({ error: '单次最多导入 5000 笔差旅记录' });
    }

    const now = new Date().toISOString();
    let imported = 0;
    let skippedDup = 0;

    try {
      withTransaction(db, () => {
        if (mode === 'replace') {
          db.prepare('DELETE FROM eval_travels WHERE user_id = ?').run(userId);
        }

        const existingKeys = new Set();
        if (mode === 'append') {
          const rows = db
            .prepare('SELECT date, name, stage, cat, cat_custom, amount, detail FROM eval_travels WHERE user_id = ?')
            .all(userId);
          for (const r of rows) {
            existingKeys.add(
              EvalCore.travelDedupKey({
                date: r.date,
                name: r.name,
                stage: r.stage,
                cat: r.cat,
                catCustom: r.cat_custom,
                amount: r.amount,
                detail: r.detail
              })
            );
          }
        }

        const insertStmt = db.prepare(
          `INSERT INTO eval_travels (
             id, user_id, date, name, stage, level, plan_start, plan_end, plan_text,
             cat, cat_custom, amount, detail, reimb, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );

        for (const raw of items) {
          const data = normalizeTravelPayload(raw || {}, { allowEmptyDetail: true });
          const sig = EvalCore.travelDedupKey(data);
          if (existingKeys.has(sig)) {
            skippedDup++;
            continue;
          }
          existingKeys.add(sig);

          insertStmt.run(
            generateId('t'),
            userId,
            data.date,
            data.name,
            data.stage,
            data.level,
            data.planStart,
            data.planEnd,
            data.planText,
            data.cat,
            data.catCustom,
            data.amount,
            data.detail,
            data.reimb,
            now,
            now
          );
          imported++;
        }
      });
    } catch (err) {
      return res.status(400).json({ error: err.message || '差旅导入失败' });
    }

    res.json({
      imported,
      skippedDup,
      mode,
      evalState: buildEvalStateResponse(db, userId, getTodayParam(req))
    });
  });

  // -------------------------------------------------------------------------
  // 基础数据设置 / 偏好 / JSON 完整备份恢复 / 清空全部评估数据
  // -------------------------------------------------------------------------
  router.put('/settings', (req, res) => {
    const userId = req.user.id;
    const normalized = EvalCore.normalizeSettings(req.body || {});
    const { mergeNames } = getEvalSettingsForUser(db, userId);
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO eval_settings (user_id, settings_json, merge_names, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = excluded.updated_at`
    ).run(userId, JSON.stringify(normalized), mergeNames ? 1 : 0, now);

    res.json({
      settings: normalized,
      evalState: buildEvalStateResponse(db, userId, getTodayParam(req))
    });
  });

  router.post('/settings/reset', (req, res) => {
    const userId = req.user.id;
    const defaults = EvalCore.createDefaultSettings();
    const { mergeNames } = getEvalSettingsForUser(db, userId);
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO eval_settings (user_id, settings_json, merge_names, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = excluded.updated_at`
    ).run(userId, JSON.stringify(defaults), mergeNames ? 1 : 0, now);

    res.json({
      settings: defaults,
      evalState: buildEvalStateResponse(db, userId, getTodayParam(req))
    });
  });

  router.put('/preferences', (req, res) => {
    const userId = req.user.id;
    const { settings } = getEvalSettingsForUser(db, userId);
    const mergeNames = req.body && req.body.mergeNames !== false ? 1 : 0;
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO eval_settings (user_id, settings_json, merge_names, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET merge_names = excluded.merge_names, updated_at = excluded.updated_at`
    ).run(userId, JSON.stringify(settings), mergeNames, now);

    res.json({ mergeNames: mergeNames !== 0 });
  });

  // 兼容原 eval-projects.html JSON 备份格式（{ projects, settings, travels }）
  router.post('/backup/restore', (req, res) => {
    const userId = req.user.id;
    const body = req.body || {};
    const rawProjects = Array.isArray(body.projects) ? body.projects : null;
    const rawTravels = Array.isArray(body.travels) ? body.travels : [];
    const rawSettings = body.settings && typeof body.settings === 'object' ? body.settings : null;

    if (!rawProjects) {
      return res.status(400).json({ error: '备份文件缺少 projects 数组' });
    }
    if (rawProjects.length > 5000 || rawTravels.length > 10000) {
      return res.status(400).json({ error: '单次恢复数据量超出上限' });
    }

    const nextSettings = EvalCore.normalizeSettings(rawSettings);
    const mergeNames = body.mergeNames !== undefined ? (body.mergeNames ? 1 : 0) : getEvalSettingsForUser(db, userId).mergeNames ? 1 : 0;
    const now = new Date().toISOString();
    const today = getTodayParam(req);
    let restoredProjects = 0;
    let restoredTravels = 0;

    try {
      withTransaction(db, () => {
        db.prepare('DELETE FROM eval_projects WHERE user_id = ?').run(userId);
        db.prepare('DELETE FROM eval_travels WHERE user_id = ?').run(userId);
        db.prepare("DELETE FROM events WHERE user_id = ? AND eval_project_id != ''").run(userId);

        db.prepare(
          `INSERT INTO eval_settings (user_id, settings_json, merge_names, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET settings_json = excluded.settings_json, merge_names = excluded.merge_names, updated_at = excluded.updated_at`
        ).run(userId, JSON.stringify(nextSettings), mergeNames, now);

        const insProj = db.prepare(
          `INSERT INTO eval_projects (
             id, user_id, name, level, role, stage, start_date, end_date,
             status, settle, note, fee_manual, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        const seenProjIds = new Set();
        for (const rp of rawProjects) {
          if (!rp || !rp.name) continue;
          let d;
          try {
            d = normalizeProjectPayload(rp, nextSettings, { allowUnscheduled: true });
          } catch {
            continue;
          }
          let pid = String(rp.id || generateId('p')).slice(0, 80);
          if (seenProjIds.has(pid)) pid = generateId('p');
          seenProjIds.add(pid);
          const createdAt = typeof rp.createdAt === 'string' && rp.createdAt ? rp.createdAt : now;
          const updatedAt = typeof rp.updatedAt === 'string' && rp.updatedAt ? rp.updatedAt : now;
          insProj.run(
            pid,
            userId,
            d.name,
            d.level,
            d.role,
            d.stage,
            d.start,
            d.end,
            d.status,
            d.settle,
            d.note,
            d.feeManual,
            createdAt,
            updatedAt
          );
          syncProjectToCalendarEvent(db, userId, Object.assign({ id: pid, createdAt, updatedAt }, d));
          restoredProjects++;
        }

        const insTrv = db.prepare(
          `INSERT INTO eval_travels (
             id, user_id, date, name, stage, level, plan_start, plan_end, plan_text,
             cat, cat_custom, amount, detail, reimb, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        const seenTrvIds = new Set();
        for (const rt of rawTravels) {
          if (!rt || !rt.name || !rt.date) continue;
          let d;
          try {
            d = normalizeTravelPayload(rt, { allowEmptyDetail: true });
          } catch {
            continue;
          }
          let tid = String(rt.id || generateId('t')).slice(0, 80);
          if (seenTrvIds.has(tid)) tid = generateId('t');
          seenTrvIds.add(tid);
          const createdAt = typeof rt.createdAt === 'string' && rt.createdAt ? rt.createdAt : now;
          const updatedAt = typeof rt.updatedAt === 'string' && rt.updatedAt ? rt.updatedAt : now;
          insTrv.run(
            tid,
            userId,
            d.date,
            d.name,
            d.stage,
            d.level,
            d.planStart,
            d.planEnd,
            d.planText,
            d.cat,
            d.catCustom,
            d.amount,
            d.detail,
            d.reimb,
            createdAt,
            updatedAt
          );
          restoredTravels++;
        }
      });
    } catch (err) {
      return res.status(400).json({ error: err.message || '恢复评估备份失败' });
    }

    res.json({
      projects: restoredProjects,
      travels: restoredTravels,
      evalState: buildEvalStateResponse(db, userId, today),
      calendarState: buildCalendarStateResponse(db, userId)
    });
  });

  // 清空当前用户全部评估数据（项目、差旅、设置恢复默认，并同步移除评估关联日程）
  router.delete('/all', (req, res) => {
    const userId = req.user.id;
    const now = new Date().toISOString();
    const today = getTodayParam(req);
    const defaults = EvalCore.createDefaultSettings();

    withTransaction(db, () => {
      db.prepare('DELETE FROM eval_projects WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM eval_travels WHERE user_id = ?').run(userId);
      db.prepare("DELETE FROM events WHERE user_id = ? AND eval_project_id != ''").run(userId);
      db.prepare(
        `INSERT INTO eval_settings (user_id, settings_json, merge_names, updated_at)
         VALUES (?, ?, 1, ?)
         ON CONFLICT(user_id) DO UPDATE SET settings_json = excluded.settings_json, merge_names = 1, updated_at = excluded.updated_at`
      ).run(userId, JSON.stringify(defaults), now);
    });

    res.json({
      ok: true,
      evalState: buildEvalStateResponse(db, userId, today),
      calendarState: buildCalendarStateResponse(db, userId)
    });
  });

  return router;
}

module.exports = createEvalRouter;
