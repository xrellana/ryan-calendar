'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../index');
require('../../js/date-utils');
const EvalCore = require('../../js/eval-core');
const Importer = require('../../js/importer');
const EvalXlsx = require('../../js/eval-xlsx');

function createClient(baseUrl) {
  let cookie = '';

  async function req(method, urlPath, body, opts = {}) {
    const headers = {
      Accept: 'application/json',
      ...(opts.omitCsrf ? {} : { 'X-Requested-With': 'WorkCal' }),
      ...(opts.headers || {})
    };
    if (cookie) headers.Cookie = cookie;
    let payload;
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }

    const resp = await fetch(baseUrl + urlPath, {
      method,
      headers,
      body: payload,
      redirect: 'manual'
    });

    const setCookie = resp.headers.get('set-cookie');
    if (setCookie) {
      const m = setCookie.match(/workcal_sid=([^;]*)/);
      if (m) {
        cookie = m[1] ? `workcal_sid=${m[1]}` : '';
      }
    }

    const text = await resp.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: resp.status, headers: resp.headers, text, json };
  }

  return { req };
}

test('EvalCore rules: days, auto end date, fee calculation, manual override, overlap, and group status', () => {
  const settings = EvalCore.createDefaultSettings();

  // AC-01: 三级 / 组长 / 正式评估 / 开始 2026-12-13 -> 结束 2026-12-15, 天数 3, 费用 9000
  const autoEnd = EvalCore.calcAutoEndDate('2026-12-13', '三级', '正式评估', settings);
  assert.equal(autoEnd, '2026-12-15');
  assert.equal(EvalCore.calcDays('2026-12-13', '2026-12-15'), 3);
  const eff1 = EvalCore.calcEffectiveFee(
    { start: '2026-12-13', end: '2026-12-15', level: '三级', role: '组长', feeManual: null },
    settings
  );
  assert.equal(eff1.fee, 9000);
  assert.equal(eff1.isManual, false);

  // AC-02: 手改结束时间为 2026-12-16 -> 天数 4, 费用 12000, 标记手动结束
  const p2 = {
    start: '2026-12-13',
    end: '2026-12-16',
    level: '三级',
    role: '组长',
    stage: '正式评估',
    feeManual: null
  };
  assert.equal(EvalCore.isEndDateManual(p2, settings), true);
  const eff2 = EvalCore.calcEffectiveFee(p2, settings);
  assert.equal(eff2.days, 4);
  assert.equal(eff2.fee, 12000);

  // AC-03: 手改费用为 8000 -> 显示 8000 并带改；手改费用等于规则值 9000 -> 不记手动
  assert.equal(EvalCore.normalizeFeeManual(8000, 3, '三级', '组长', settings), 8000);
  assert.equal(EvalCore.normalizeFeeManual(9000, 3, '三级', '组长', settings), null);

  // AC-04: 一级/组员（费率留空）-> 待设置 (fee = null, pendingRate = true)
  const eff4 = EvalCore.calcEffectiveFee(
    { start: '2026-12-01', end: '2026-12-02', level: '一级', role: '组员', feeManual: null },
    settings
  );
  assert.equal(eff4.fee, null);
  assert.equal(eff4.pendingRate, true);

  // AC-22: 跨月项目按实际重叠拆分天数
  assert.equal(EvalCore.calcOverlapDays('2026-11-30', '2026-12-02', '2026-11-01', '2026-11-30'), 1);
  assert.equal(EvalCore.calcOverlapDays('2026-11-30', '2026-12-02', '2026-12-01', '2026-12-31'), 2);

  // AC-05: 合并态项目整体状态取正式评估
  assert.equal(
    EvalCore.getMergedGroupStatus([
      { stage: '预评估', status: '已完成' },
      { stage: '正式评估', status: '进行中' }
    ]),
    '进行中'
  );
});

test('EvalXlsx roundtrip: export projects & travels with merged cells and re-import with dedup and validation', async () => {
  const settings = EvalCore.createDefaultSettings();
  const sampleProjects = [
    {
      id: 'p1',
      name: '示例制造厂',
      level: '三级',
      role: '组长',
      stage: '预评估',
      start: '2026-12-01',
      end: '2026-12-02',
      status: '已完成',
      settle: '已结',
      note: '预审',
      feeManual: null
    },
    {
      id: 'p2',
      name: '示例制造厂',
      level: '三级',
      role: '组长',
      stage: '正式评估',
      start: '2026-12-13',
      end: '2026-12-15',
      status: '待开始',
      settle: '未结',
      note: '协议价',
      feeManual: 8000
    }
  ];

  // Export projects -> parse back with Importer.parseXlsxAsync -> verify merged cell carry-over & keepManualFee (AC-13, AC-14, AC-24)
  const projBytes = EvalXlsx.buildProjectsXlsxBytes(sampleProjects, settings);
  const parsedXlsx = await Importer.parseXlsxAsync(projBytes.buffer);
  const resWithManual = EvalXlsx.parseEvalProjectsGrid(parsedXlsx.rows, [], settings, {
    date1904: parsedXlsx.date1904,
    keepManualFee: true
  });
  assert.equal(resWithManual.summary.recognizedCount, 2);
  assert.equal(resWithManual.summary.projectCount, 1);
  assert.equal(resWithManual.toImport[0].name, '示例制造厂');
  assert.equal(resWithManual.toImport[1].name, '示例制造厂');
  assert.equal(resWithManual.toImport[0].feeManual, null); // 与规则一致不标改
  assert.equal(resWithManual.toImport[1].feeManual, 8000); // 不同于规则 9000 -> 记手动

  // AC-15: 重复导入同一文件全部跳过
  const resDup = EvalXlsx.parseEvalProjectsGrid(parsedXlsx.rows, sampleProjects, settings, {
    date1904: parsedXlsx.date1904
  });
  assert.equal(resDup.summary.importCount, 0);
  assert.equal(resDup.summary.dupCount, 2);

  // Travels export & re-import (AC-34, AC-35, AC-36)
  const sampleTravels = [
    {
      id: 't1',
      date: '2026-12-13',
      name: '示例制造厂',
      stage: '正式评估',
      level: '三级',
      planStart: '2026-12-13',
      planEnd: '2026-12-15',
      planText: '2026/12/13 ~ 2026/12/15',
      cat: '自定义',
      catCustom: '机场停车费',
      amount: 326.5,
      detail: 'T2停车场三天',
      reimb: '未报'
    }
  ];
  const trvBytes = EvalXlsx.buildTravelsXlsxBytes(sampleTravels, sampleProjects);
  const parsedTrvXlsx = await Importer.parseXlsxAsync(trvBytes.buffer);
  const trvRes = EvalXlsx.parseEvalTravelsGrid(parsedTrvXlsx.rows, [], sampleProjects, {
    date1904: parsedTrvXlsx.date1904
  });
  assert.equal(trvRes.summary.importCount, 1);
  assert.equal(trvRes.toImport[0].cat, '自定义');
  assert.equal(trvRes.toImport[0].catCustom, '机场停车费');
  assert.equal(trvRes.toImport[0].amount, 326.5);

  // AC-34: 报销状态归一
  const normTrv = EvalXlsx.parseEvalTravelsGrid(
    [
      ['差旅日期', '项目名称', '差旅金额', '差旅类别', '报销状态', '具体内容'],
      ['2026/12/14', '示例制造厂', '128.5', '打车', '已报销', '机场往返']
    ],
    [],
    sampleProjects,
    {}
  );
  assert.equal(normTrv.toImport[0].reimb, '已报');
  assert.ok(normTrv.notes.some((n) => n.includes('已报销')));

  // AC-35: 缺少差旅金额列直接报错
  assert.throws(
    () =>
      EvalXlsx.parseEvalTravelsGrid(
        [
          ['差旅日期', '项目名称', '差旅类别'],
          ['2026/12/14', '示例制造厂', '打车']
        ],
        [],
        sampleProjects,
        {}
      ),
    /差旅金额/
  );
});

test('Backend eval platform: strict user_id isolation, protected assessment category, and bidirectional calendar sync', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ryan-eval-test-'));
  const dbPath = path.join(tmpDir, 'calendar.db');
  const backupDir = path.join(tmpDir, 'backups');

  process.env.ADMIN_USERNAME = 'admin';
  process.env.ADMIN_PASSWORD = 'AdminPassword123!';

  const { app, db } = createApp({ dbPath, backupDir });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const admin = createClient(baseUrl);
  const alice = createClient(baseUrl);
  const bob = createClient(baseUrl);

  await admin.req('POST', '/api/auth/login', { username: 'admin', password: 'AdminPassword123!' });
  await admin.req('POST', '/api/admin/users', {
    username: 'alice',
    displayName: '爱丽丝',
    password: 'AlicePassword123',
    role: 'user'
  });
  await admin.req('POST', '/api/admin/users', {
    username: 'bob',
    displayName: '鲍勃',
    password: 'BobPassword123',
    role: 'user'
  });
  await alice.req('POST', '/api/auth/login', { username: 'alice', password: 'AlicePassword123' });
  await bob.req('POST', '/api/auth/login', { username: 'bob', password: 'BobPassword123' });

  // 1. Protected「外出评估」category: cannot rename or delete, CAN change color
  const renameProtected = await alice.req('PATCH', '/api/categories/cat-assessment', { name: '随便改名' });
  assert.equal(renameProtected.status, 400);
  const delProtected = await alice.req('DELETE', '/api/categories/cat-assessment');
  assert.equal(delProtected.status, 400);
  const colorProtected = await alice.req('PATCH', '/api/categories/cat-assessment', { color: '#EA580C' });
  assert.equal(colorProtected.status, 200);
  assert.equal(colorProtected.json.category.color, '#EA580C');
  assert.equal(colorProtected.json.category.protected, true);

  // 2. Create dual-stage eval project -> automatically syncs to calendar events with title keeping stage & category cat-assessment
  const pPre = await alice.req('POST', '/api/eval/projects', {
    name: '华东新能源装备',
    level: '三级',
    role: '组长',
    stage: '预评估',
    start: '2026-12-01',
    end: '2026-12-02',
    status: '待开始',
    settle: '未结',
    note: '前期访谈',
    today: '2026-11-24'
  });
  assert.equal(pPre.status, 201);
  assert.equal(pPre.json.event.categoryId, 'cat-assessment');
  assert.equal(pPre.json.event.title, '华东新能源装备（预评估）');
  assert.equal(pPre.json.event.startDate, '2026-12-01');
  assert.equal(pPre.json.event.endDate, '2026-12-02');
  assert.equal(pPre.json.event.evalProjectId, pPre.json.project.id);

  const pFormal = await alice.req('POST', '/api/eval/projects', {
    name: '华东新能源装备',
    level: '三级',
    role: '组长',
    stage: '正式评估',
    start: '2026-12-13',
    end: '2026-12-15',
    status: '待开始',
    settle: '未结',
    note: '现场核验',
    today: '2026-11-24'
  });
  assert.equal(pFormal.status, 201);
  assert.equal(pFormal.json.event.title, '华东新能源装备（正式评估）');

  // Verify ICS subscription automatically carries the synced assessment events
  const aliceMe = await alice.req('GET', '/api/auth/me');
  const icsText = await (await fetch(`${baseUrl}/ics/${aliceMe.json.user.icsToken}.ics`)).text();
  assert.ok(icsText.includes('华东新能源装备（预评估）'));
  assert.ok(icsText.includes('华东新能源装备（正式评估）'));

  // 3. Strict user_id isolation: Bob sees 0 projects, 0 events, and cannot touch Alice's project
  const bobEval = await bob.req('GET', '/api/eval/state?today=2026-11-24');
  assert.equal(bobEval.status, 200);
  assert.equal(bobEval.json.projects.length, 0);
  const bobCal = await bob.req('GET', '/api/state');
  assert.equal(bobCal.json.events.length, 0);
  assert.equal(
    (await bob.req('PATCH', `/api/eval/projects/${pPre.json.project.id}`, { status: '已完成' })).status,
    404
  );
  assert.equal(
    (await bob.req('DELETE', `/api/eval/projects/${pPre.json.project.id}`)).status,
    404
  );

  // 4. Merged-mode status sync updates BOTH pre and formal records (AC-06)
  const grpUpd = await alice.req('PATCH', `/api/eval/projects/${pPre.json.project.id}`, {
    status: '已完成',
    syncGroupStatus: true,
    today: '2026-11-24'
  });
  assert.equal(grpUpd.status, 200);
  assert.equal(grpUpd.json.affectedCount, 2);
  assert.ok(grpUpd.json.evalState.projects.every((p) => p.status === '已完成'));

  // 5. Auto-promote 待开始 -> 进行中 when start <= today (AC-07)
  const pastProj = await alice.req('POST', '/api/eval/projects', {
    name: '已进场待自动推进项目',
    level: '二级',
    role: '组员',
    stage: '预评估',
    start: '2026-11-20',
    end: '2026-11-20',
    status: '待开始',
    settle: '未结',
    today: '2026-11-24'
  });
  assert.equal(pastProj.status, 201);
  // buildEvalStateResponse runs autoPromote immediately
  const promoted = pastProj.json.evalState.projects.find((p) => p.id === pastProj.json.project.id);
  assert.equal(promoted.status, '进行中');

  // 6. Calendar-side protections & bidirectional deletion
  const linkedEvtId = pastProj.json.event.id;
  // Cannot change category of linked event
  const badCatChange = await alice.req('PATCH', `/api/events/${linkedEvtId}`, {
    categoryId: 'cat-rest'
  });
  assert.equal(badCatChange.status, 400);

  // Add a manual non-eval event and a travel record for that project
  await alice.req('POST', '/api/events', {
    title: '普通手工会议',
    categoryId: 'cat-consulting',
    startDate: '2026-11-25',
    allDay: true
  });
  const trvRes = await alice.req('POST', '/api/eval/travels', {
    date: '2026-11-20',
    name: '已进场待自动推进项目',
    stage: '预评估',
    cat: '高铁',
    amount: 326.5,
    detail: '往返二等座',
    reimb: '未报'
  });
  assert.equal(trvRes.status, 201);

  // Deleting linked calendar event ALSO deletes eval project, while preserving historical travel!
  const delEvt = await alice.req('DELETE', `/api/events/${linkedEvtId}`);
  assert.equal(delEvt.status, 200);
  assert.equal(delEvt.json.deletedEvalProjectId, pastProj.json.project.id);

  const afterDelEval = await alice.req('GET', '/api/eval/state?today=2026-11-24');
  assert.equal(afterDelEval.json.projects.some((p) => p.id === pastProj.json.project.id), false);
  assert.equal(afterDelEval.json.travels.length, 1); // 历史差旅保留 (§3.5)

  // Clear all calendar events skips eval-linked events
  const clrCal = await alice.req('DELETE', '/api/events');
  assert.equal(clrCal.status, 200);
  assert.equal(clrCal.json.deleted, 1); // only 普通手工会议
  assert.equal(clrCal.json.skippedEvalCount, 2); // 华东新能源装备 预/正式评估 retained

  // 7. Settings save, reset, JSON backup restore, and clear all eval data (AC-37, AC-38, AC-40)
  const saveSet = await alice.req('PUT', '/api/eval/settings', {
    daysRules: EvalCore.createDefaultSettings().daysRules,
    feeRates: Object.assign({}, EvalCore.createDefaultSettings().feeRates, {
      三级: { 组员: 1500, 组长: 3500 }
    })
  });
  assert.equal(saveSet.status, 200);
  assert.equal(saveSet.json.settings.feeRates['三级']['组长'], 3500);

  const resetSet = await alice.req('POST', '/api/eval/settings/reset', {});
  assert.equal(resetSet.status, 200);
  assert.equal(resetSet.json.settings.feeRates['三级']['组长'], 3000);

  const snapshotBeforeClear = (await alice.req('GET', '/api/eval/state?today=2026-11-24')).json;
  const clearAll = await alice.req('DELETE', '/api/eval/all?today=2026-11-24');
  assert.equal(clearAll.status, 200);
  assert.equal(clearAll.json.evalState.projects.length, 0);
  assert.equal(clearAll.json.evalState.travels.length, 0);
  assert.equal(clearAll.json.calendarState.events.length, 0);

  const restoreRes = await alice.req('POST', '/api/eval/backup/restore', {
    projects: snapshotBeforeClear.projects,
    travels: snapshotBeforeClear.travels,
    settings: snapshotBeforeClear.settings,
    today: '2026-11-24'
  });
  assert.equal(restoreRes.status, 200);
  assert.equal(restoreRes.json.projects, 2);
  assert.equal(restoreRes.json.travels, 1);
  assert.equal(restoreRes.json.calendarState.events.length, 2);
});
