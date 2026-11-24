/**
 * 评估项目管理平台零依赖 Excel (.xlsx) 读写引擎
 * 满足需求书第 10 章：
 * - 项目执行列表导出（12 列、同项目序号与名称合并、真实日期 yyyy/m/d、金额 #,##0.00、冻结首行、预设列宽、未排期写 "/"）
 * - 项目执行列表导入（前 15 行找含「项目名称」表头、合并单元格沿用、日期/等级/状态/结算归一、签名去重、保留原表费用开关）
 * - 项目差旅导出（10 列、同项目序号与名称合并、真实日期、两位小数）
 * - 项目差旅导入（前 15 行找表头、必填列校验、自定义类别保留、报销状态归一、关联项目带出等级与计划、6 字段去重）
 */
(function (root) {
  'use strict';

  var WorkCal = (root.WorkCal = root.WorkCal || {});

  function getCore() {
    return WorkCal.EvalCore;
  }

  // =========================================================================
  // 1. 零依赖 ZIP (Store) 打包器（用于生成标准 .xlsx）
  // =========================================================================
  var CRC_TABLE = (function () {
    var table = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    var c = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) {
      c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  function encodeUtf8(str) {
    if (typeof TextEncoder !== 'undefined') {
      return new TextEncoder().encode(str);
    }
    var buf = [];
    for (var i = 0; i < str.length; i++) {
      var code = str.charCodeAt(i);
      if (code < 0x80) buf.push(code);
      else if (code < 0x800) buf.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
      else {
        buf.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
      }
    }
    return new Uint8Array(buf);
  }

  function writeU16LE(view, off, val) {
    view.setUint16(off, val & 0xffff, true);
  }

  function writeU32LE(view, off, val) {
    view.setUint32(off, val >>> 0, true);
  }

  function buildZipBytes(entries) {
    var localParts = [];
    var centralParts = [];
    var offset = 0;

    for (var i = 0; i < entries.length; i++) {
      var nameBytes = encodeUtf8(entries[i].name);
      var dataBytes =
        entries[i].data instanceof Uint8Array
          ? entries[i].data
          : encodeUtf8(String(entries[i].data || ''));
      var crc = crc32(dataBytes);
      var len = dataBytes.length;

      var localHeader = new Uint8Array(30 + nameBytes.length);
      var lv = new DataView(localHeader.buffer);
      writeU32LE(lv, 0, 0x04034b50);
      writeU16LE(lv, 4, 20);
      writeU16LE(lv, 6, 0x0800); // UTF-8
      writeU16LE(lv, 8, 0); // STORE
      writeU16LE(lv, 10, 0);
      writeU16LE(lv, 12, 0);
      writeU32LE(lv, 14, crc);
      writeU32LE(lv, 18, len);
      writeU32LE(lv, 22, len);
      writeU16LE(lv, 26, nameBytes.length);
      writeU16LE(lv, 28, 0);
      localHeader.set(nameBytes, 30);

      localParts.push(localHeader, dataBytes);

      var centralHeader = new Uint8Array(46 + nameBytes.length);
      var cv = new DataView(centralHeader.buffer);
      writeU32LE(cv, 0, 0x02014b50);
      writeU16LE(cv, 4, 20);
      writeU16LE(cv, 6, 20);
      writeU16LE(cv, 8, 0x0800);
      writeU16LE(cv, 10, 0);
      writeU16LE(cv, 12, 0);
      writeU16LE(cv, 14, 0);
      writeU32LE(cv, 16, crc);
      writeU32LE(cv, 20, len);
      writeU32LE(cv, 24, len);
      writeU16LE(cv, 28, nameBytes.length);
      writeU16LE(cv, 30, 0);
      writeU16LE(cv, 32, 0);
      writeU16LE(cv, 34, 0);
      writeU16LE(cv, 36, 0);
      writeU32LE(cv, 38, 0);
      writeU32LE(cv, 42, offset);
      centralHeader.set(nameBytes, 46);
      centralParts.push(centralHeader);

      offset += localHeader.length + len;
    }

    var centralSize = 0;
    for (var j = 0; j < centralParts.length; j++) centralSize += centralParts[j].length;

    var eocd = new Uint8Array(22);
    var ev = new DataView(eocd.buffer);
    writeU32LE(ev, 0, 0x06054b50);
    writeU16LE(ev, 4, 0);
    writeU16LE(ev, 6, 0);
    writeU16LE(ev, 8, entries.length);
    writeU16LE(ev, 10, entries.length);
    writeU32LE(ev, 12, centralSize);
    writeU32LE(ev, 16, offset);
    writeU16LE(ev, 20, 0);

    var totalSize = offset + centralSize + 22;
    var out = new Uint8Array(totalSize);
    var cursor = 0;
    var k;
    for (k = 0; k < localParts.length; k++) {
      out.set(localParts[k], cursor);
      cursor += localParts[k].length;
    }
    for (k = 0; k < centralParts.length; k++) {
      out.set(centralParts[k], cursor);
      cursor += centralParts[k].length;
    }
    out.set(eocd, cursor);
    return out;
  }

  function xmlEsc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function colLetters(idx0) {
    var n = idx0 + 1;
    var s = '';
    while (n > 0) {
      var rem = (n - 1) % 26;
      s = String.fromCharCode(65 + rem) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  // YYYY-MM-DD -> Excel 1900 日期序列号
  function dateStrToExcelSerial(dateStr) {
    var Core = getCore();
    if (!Core.isValidDateStr(dateStr)) return null;
    var ms = Core.dateToUtcMs(dateStr);
    var epoch = Date.UTC(1899, 11, 30);
    return Math.round((ms - epoch) / 86400000);
  }

  /**
   * 构建标准单工作表 .xlsx 字节流
   * styles:
   *  0 = 常规居中
   *  1 = 表头（加粗、浅灰底、居中、细边框）
   *  2 = 文本左对齐（细边框）
   *  3 = 文本居中（细边框）
   *  4 = 整数右对齐（细边框）
   *  5 = 金额 #,##0.00 右对齐（细边框）
   *  6 = 日期 yyyy/m/d 居中（细边框）
   */
  function buildSingleSheetXlsx(opts) {
    var sheetName = String(opts.sheetName || 'Sheet1').slice(0, 31);
    var headers = opts.headers || [];
    var rows = opts.rows || [];
    var colWidths = opts.colWidths || [];
    var merges = opts.merges || [];

    var colsXml = colWidths.length
      ? '<cols>' +
        colWidths
          .map(function (w, i) {
            return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>';
          })
          .join('') +
        '</cols>'
      : '';

    var sheetRows = [];
    // 表头第 1 行
    var headerCells = headers
      .map(function (h, c) {
        return (
          '<c r="' +
          colLetters(c) +
          '1" t="inlineStr" s="1"><is><t>' +
          xmlEsc(h) +
          '</t></is></c>'
        );
      })
      .join('');
    sheetRows.push('<row r="1" ht="24" customHeight="1">' + headerCells + '</row>');

    // 数据行（第 2 行起）
    for (var r = 0; r < rows.length; r++) {
      var rowNum = r + 2;
      var cells = rows[r];
      var cellXml = [];
      for (var c = 0; c < cells.length; c++) {
        var cell = cells[c];
        var ref = colLetters(c) + rowNum;
        if (cell === null || cell === undefined) {
          cellXml.push('<c r="' + ref + '" s="3"/>');
          continue;
        }
        var type = cell.t || 'str';
        var style = cell.s !== undefined ? cell.s : 2;
        if (type === 'num' && typeof cell.v === 'number' && Number.isFinite(cell.v)) {
          cellXml.push('<c r="' + ref + '" s="' + style + '"><v>' + cell.v + '</v></c>');
        } else if (type === 'date' && typeof cell.v === 'number' && Number.isFinite(cell.v)) {
          cellXml.push('<c r="' + ref + '" s="6"><v>' + cell.v + '</v></c>');
        } else {
          var txt = cell.v === undefined || cell.v === null ? '' : String(cell.v);
          cellXml.push(
            '<c r="' + ref + '" t="inlineStr" s="' + style + '"><is><t>' + xmlEsc(txt) + '</t></is></c>'
          );
        }
      }
      sheetRows.push('<row r="' + rowNum + '" ht="21" customHeight="1">' + cellXml.join('') + '</row>');
    }

    var mergeXml = merges.length
      ? '<mergeCells count="' +
        merges.length +
        '">' +
        merges
          .map(function (m) {
            return '<mergeCell ref="' + m + '"/>';
          })
          .join('') +
        '</mergeCells>'
      : '';

    var sheetXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
      '<sheetFormatPr defaultRowHeight="21"/>' +
      colsXml +
      '<sheetData>' +
      sheetRows.join('') +
      '</sheetData>' +
      mergeXml +
      '</worksheet>';

    var stylesXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<numFmts count="2">' +
      '<numFmt numFmtId="164" formatCode="#,##0.00"/>' +
      '<numFmt numFmtId="165" formatCode="yyyy/m/d"/>' +
      '</numFmts>' +
      '<fonts count="2">' +
      '<font><sz val="11"/><name val="Microsoft YaHei"/></font>' +
      '<font><b/><sz val="11"/><name val="Microsoft YaHei"/></font>' +
      '</fonts>' +
      '<fills count="3">' +
      '<fill><patternFill patternType="none"/></fill>' +
      '<fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/><bgColor indexed="64"/></patternFill></fill>' +
      '</fills>' +
      '<borders count="2">' +
      '<border><left/><right/><top/><bottom/><diagonal/></border>' +
      '<border>' +
      '<left style="thin"><color rgb="FFD1D5DB"/></left>' +
      '<right style="thin"><color rgb="FFD1D5DB"/></right>' +
      '<top style="thin"><color rgb="FFD1D5DB"/></top>' +
      '<bottom style="thin"><color rgb="FFD1D5DB"/></bottom>' +
      '<diagonal/>' +
      '</border>' +
      '</borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="7">' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
      '<xf numFmtId="1" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>' +
      '<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>' +
      '<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
      '</cellXfs>' +
      '</styleSheet>';

    var contentTypesXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '</Types>';

    var rootRelsXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>';

    var wbXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="' +
      xmlEsc(sheetName) +
      '" sheetId="1" r:id="rId1"/></sheets>' +
      '</workbook>';

    var wbRelsXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>';

    return buildZipBytes([
      { name: '[Content_Types].xml', data: contentTypesXml },
      { name: '_rels/.rels', data: rootRelsXml },
      { name: 'xl/workbook.xml', data: wbXml },
      { name: 'xl/_rels/workbook.xml.rels', data: wbRelsXml },
      { name: 'xl/styles.xml', data: stylesXml },
      { name: 'xl/worksheets/sheet1.xml', data: sheetXml }
    ]);
  }

  function downloadBytes(bytes, filename) {
    var blob = new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
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

  function todayCompact() {
    return getCore().getTodayShanghai().replace(/-/g, '');
  }

  // =========================================================================
  // 2. 项目执行列表导出（§10.1）
  // =========================================================================
  function buildProjectsXlsxBytes(records, settings) {
    var Core = getCore();
    // 同名项目归组连续排列，导出时合并序号与项目名称列
    var groupOrder = [];
    var groupMap = {};
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      var key = String(r.name || '').trim();
      if (!groupMap[key]) {
        groupMap[key] = [];
        groupOrder.push(key);
      }
      groupMap[key].push(r);
    }

    var rows = [];
    var merges = [];
    var curRow = 2;

    for (var g = 0; g < groupOrder.length; g++) {
      var groupRecs = Core.sortGroupRecords(groupMap[groupOrder[g]]);
      var projectSeq = g + 1;
      var groupStartRow = curRow;

      for (var k = 0; k < groupRecs.length; k++) {
        var rec = groupRecs[k];
        var eff = Core.calcEffectiveFee(rec, settings);
        var startSerial = dateStrToExcelSerial(rec.start);
        var endSerial = dateStrToExcelSerial(rec.end);

        rows.push([
          { t: 'num', v: projectSeq, s: 3 },
          { t: 'str', v: rec.name, s: 3 },
          { t: 'str', v: rec.level, s: 3 },
          { t: 'str', v: rec.role, s: 3 },
          { t: 'str', v: rec.stage, s: 3 },
          startSerial !== null ? { t: 'date', v: startSerial, s: 6 } : { t: 'str', v: '/', s: 3 },
          endSerial !== null ? { t: 'date', v: endSerial, s: 6 } : { t: 'str', v: '/', s: 3 },
          { t: 'num', v: eff.days, s: 4 },
          { t: 'str', v: rec.status, s: 3 },
          eff.fee !== null ? { t: 'num', v: eff.fee, s: 5 } : { t: 'str', v: '待设置', s: 3 },
          { t: 'str', v: rec.settle, s: 3 },
          { t: 'str', v: rec.note || '', s: 2 }
        ]);
        curRow++;
      }

      if (groupRecs.length > 1) {
        var groupEndRow = curRow - 1;
        merges.push('A' + groupStartRow + ':A' + groupEndRow);
        merges.push('B' + groupStartRow + ':B' + groupEndRow);
      }
    }

    return buildSingleSheetXlsx({
      sheetName: '项目执行列表_' + todayCompact(),
      headers: [
        '序号',
        '项目名称',
        '等级',
        '角色',
        '评估阶段',
        '开始时间',
        '结束时间',
        '天数',
        '项目状态',
        '评估费用（元）',
        '费用状态',
        '备注'
      ],
      colWidths: [8, 28, 10, 10, 12, 14, 14, 9, 12, 16, 12, 32],
      rows: rows,
      merges: merges
    });
  }

  function exportProjectsXlsx(records, settings) {
    var bytes = buildProjectsXlsxBytes(records, settings);
    downloadBytes(bytes, '项目执行列表_' + todayCompact() + '.xlsx');
  }

  // =========================================================================
  // 3. 项目差旅导出（§10.3）
  // =========================================================================
  function buildTravelsXlsxBytes(travels, projects) {
    var Core = getCore();
    // 按项目归组以便合并序号与项目名称列，同时尽量保留当前筛选顺序
    var groupOrder = [];
    var groupMap = {};
    for (var i = 0; i < travels.length; i++) {
      var t = travels[i];
      var key = String(t.name || '').trim();
      if (!groupMap[key]) {
        groupMap[key] = [];
        groupOrder.push(key);
      }
      groupMap[key].push(t);
    }

    var rows = [];
    var merges = [];
    var curRow = 2;

    for (var g = 0; g < groupOrder.length; g++) {
      var list = groupMap[groupOrder[g]];
      var seq = g + 1;
      var startRow = curRow;

      for (var k = 0; k < list.length; k++) {
        var tr = list[k];
        var link = Core.resolveTravelDisplayLink(tr, projects);
        var dSerial = dateStrToExcelSerial(tr.date);
        rows.push([
          { t: 'num', v: seq, s: 3 },
          dSerial !== null ? { t: 'date', v: dSerial, s: 6 } : { t: 'str', v: tr.date || '', s: 3 },
          { t: 'str', v: tr.name, s: 3 },
          { t: 'str', v: tr.stage, s: 3 },
          { t: 'str', v: link.level || '', s: 3 },
          { t: 'str', v: link.planText || '', s: 3 },
          { t: 'str', v: Core.getTravelDisplayCat(tr), s: 3 },
          { t: 'num', v: Core.round2(tr.amount), s: 5 },
          { t: 'str', v: tr.detail || '', s: 2 },
          { t: 'str', v: tr.reimb, s: 3 }
        ]);
        curRow++;
      }

      if (list.length > 1) {
        var endRow = curRow - 1;
        merges.push('A' + startRow + ':A' + endRow);
        merges.push('C' + startRow + ':C' + endRow);
      }
    }

    return buildSingleSheetXlsx({
      sheetName: '项目差旅',
      headers: [
        '序号',
        '差旅日期',
        '项目名称',
        '评估阶段',
        '等级',
        '评估计划',
        '差旅类别',
        '差旅金额（元）',
        '差旅具体内容',
        '报销状态'
      ],
      colWidths: [8, 14, 26, 12, 10, 24, 14, 16, 30, 12],
      rows: rows,
      merges: merges
    });
  }

  function exportTravelsXlsx(travels, projects) {
    var bytes = buildTravelsXlsxBytes(travels, projects);
    downloadBytes(bytes, '项目差旅_' + todayCompact() + '.xlsx');
  }

  // =========================================================================
  // 4. 通用单元格日期 / 金额 / 枚举解析（§10.2 / §10.3 / §10.5）
  // =========================================================================
  function parseExcelDateCell(raw, date1904) {
    var Core = getCore();
    var s = String(raw == null ? '' : raw).trim();
    if (!s || s === '/' || s === '-' || s === '—' || s === '未排期') {
      return '';
    }
    if (Core.isValidDateStr(s)) return s;

    // Excel 序列号
    if (/^\d{4,6}(\.\d+)?$/.test(s)) {
      var num = parseFloat(s);
      if (num >= 20000 && num <= 80000) {
        var base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
        var dt = new Date(base + Math.floor(num) * 86400000);
        return (
          dt.getUTCFullYear() +
          '-' +
          String(dt.getUTCMonth() + 1).padStart(2, '0') +
          '-' +
          String(dt.getUTCDate()).padStart(2, '0')
        );
      }
    }

    // YYYY/M/D, YYYY.M.D, YYYY-M-D, YYYY年M月D日
    var m = s.match(/^(\d{4})[\/\.\-年](\d{1,2})[\/\.\-月](\d{1,2})日?/);
    if (m) {
      var cand =
        m[1] + '-' + String(parseInt(m[2], 10)).padStart(2, '0') + '-' + String(parseInt(m[3], 10)).padStart(2, '0');
      if (Core.isValidDateStr(cand)) return cand;
    }

    // 12月13日 -> 补当前年
    var m2 = s.match(/^(\d{1,2})月(\d{1,2})日?$/);
    if (m2) {
      var yr = Core.getTodayShanghai().slice(0, 4);
      var cand2 =
        yr + '-' + String(parseInt(m2[1], 10)).padStart(2, '0') + '-' + String(parseInt(m2[2], 10)).padStart(2, '0');
      if (Core.isValidDateStr(cand2)) return cand2;
    }

    return '';
  }

  function parseMoneyCell(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s || s === '待设置' || s === '/' || s === '—') return null;
    var cleaned = s.replace(/[¥￥,，元\s]/g, '');
    if (!cleaned || !/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
    var num = parseFloat(cleaned);
    if (!Number.isFinite(num)) return null;
    return getCore().round2(num);
  }

  function normalizeLevelCell(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s) return { value: '二级', mapped: false };
    if (s.indexOf('四') !== -1 || s.indexOf('4') !== -1) return { value: '四级', mapped: s !== '四级' };
    if (s.indexOf('三') !== -1 || s.indexOf('3') !== -1) return { value: '三级', mapped: s !== '三级' };
    if (s.indexOf('一') !== -1 || s.indexOf('1') !== -1) return { value: '一级', mapped: s !== '一级' };
    if (s.indexOf('二') !== -1 || s.indexOf('2') !== -1) return { value: '二级', mapped: s !== '二级' };
    return { value: '二级', mapped: true };
  }

  function normalizeRoleCell(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s) return '组员';
    if (s.indexOf('长') !== -1) return '组长';
    return '组员';
  }

  function normalizeStageCell(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s) return '预评估';
    if (s.indexOf('预') !== -1) return '预评估';
    return '正式评估';
  }

  function normalizeProjectStatusCell(raw) {
    var Core = getCore();
    var s = String(raw == null ? '' : raw).trim();
    if (!s) return { value: '待开始', mapped: false, raw: '' };
    if (Core.PROJECT_STATUSES.indexOf(s) !== -1) return { value: s, mapped: false, raw: s };
    if (/完成|交付|结项|结束|通过/.test(s)) return { value: '已完成', mapped: true, raw: s };
    if (/提交|审核|终审|复核/.test(s)) return { value: '已提交', mapped: true, raw: s };
    if (/进行|开展|实施|评估中|现场/.test(s)) return { value: '进行中', mapped: true, raw: s };
    return { value: '待开始', mapped: true, raw: s };
  }

  function normalizeSettleCell(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s) return { value: '未结', mapped: false, raw: '' };
    if (s === '已结') return { value: '已结', mapped: false, raw: s };
    if (s === '未结') return { value: '未结', mapped: false, raw: s };
    return { value: '未结', mapped: true, raw: s };
  }

  function normalizeReimbCell(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s) return { value: '未报', mapped: false, raw: '' };
    if (s === '未报' || s === '已报' || s === '已结') return { value: s, mapped: false, raw: s };
    if (s.indexOf('已结') !== -1) return { value: '已结', mapped: true, raw: s };
    if (s.indexOf('已报') !== -1) return { value: '已报', mapped: true, raw: s };
    return { value: '未报', mapped: true, raw: s };
  }

  // =========================================================================
  // 5. 项目执行列表导入解析（§10.2）
  // =========================================================================
  function parseEvalProjectsGrid(rows, existingProjects, settings, opts) {
    var Core = getCore();
    var date1904 = Boolean(opts && opts.date1904);
    var keepManualFee = Boolean(opts && opts.keepManualFee);

    var limit = Math.min(rows.length, 15);
    var headerIdx = -1;
    var cols = {};

    for (var r = 0; r < limit; r++) {
      var row = rows[r] || [];
      var foundName = false;
      for (var c = 0; c < row.length; c++) {
        var text = String(row[c] || '').replace(/\s+/g, '');
        if (text.indexOf('项目名称') !== -1) {
          foundName = true;
          break;
        }
      }
      if (foundName) {
        headerIdx = r;
        for (var ci = 0; ci < row.length; ci++) {
          var h = String(row[ci] || '').replace(/\s+/g, '');
          if (!h) continue;
          if (cols.name === undefined && h.indexOf('项目名称') !== -1) cols.name = ci;
          else if (cols.level === undefined && h.indexOf('等级') !== -1) cols.level = ci;
          else if (cols.role === undefined && h.indexOf('角色') !== -1) cols.role = ci;
          else if (cols.stage === undefined && h.indexOf('阶段') !== -1) cols.stage = ci;
          else if (cols.start === undefined && h.indexOf('开始') !== -1) cols.start = ci;
          else if (cols.end === undefined && h.indexOf('结束') !== -1) cols.end = ci;
          else if (cols.days === undefined && h.indexOf('天数') !== -1) cols.days = ci;
          else if (cols.fee === undefined && h.indexOf('费用') !== -1 && h.indexOf('元') !== -1) cols.fee = ci;
          else if (cols.settle === undefined && h.indexOf('费用状态') !== -1) cols.settle = ci;
          else if (cols.status === undefined && h.indexOf('状态') !== -1 && h.indexOf('费用') === -1) cols.status = ci;
          else if (cols.note === undefined && h.indexOf('备注') !== -1) cols.note = ci;
        }
        break;
      }
    }

    if (headerIdx === -1 || cols.name === undefined) {
      throw new Error('没找到表头行，请确认表头包含「项目名称」列');
    }

    var existingKeys = {};
    (existingProjects || []).forEach(function (p) {
      existingKeys[Core.projectDedupKey(p)] = true;
    });
    var seenInFile = {};

    var allRecognized = [];
    var toImport = [];
    var dupCount = 0;
    var unscheduledCount = 0;
    var projectSet = {};
    var mappingNotes = [];
    var mappingSeen = {};
    var lastName = '';

    var addNote = function (msg) {
      if (!mappingSeen[msg]) {
        mappingSeen[msg] = true;
        mappingNotes.push(msg);
      }
    };

    for (var ri = headerIdx + 1; ri < rows.length; ri++) {
      var rdata = rows[ri] || [];
      var get = function (key) {
        var idx = cols[key];
        return idx === undefined ? '' : String(rdata[idx] == null ? '' : rdata[idx]).trim();
      };

      var rawName = get('name');
      var rawLevel = get('level');
      var rawRole = get('role');
      var rawStage = get('stage');
      var rawStart = get('start');
      var rawEnd = get('end');
      var rawStatus = get('status');
      var rawFee = get('fee');
      var rawSettle = get('settle');
      var rawNote = get('note');

      // 跳过合计行
      if (/^(合计|总计|小计)/.test(rawName)) continue;

      // 等级、阶段、角色、起止时间全部为空的整行视为空行跳过（§10.2）
      if (!rawLevel && !rawStage && !rawRole && !rawStart && !rawEnd) {
        if (rawName) lastName = rawName;
        continue;
      }

      var name = rawName || lastName;
      if (rawName) lastName = rawName;
      if (!name) continue;

      var lvRes = normalizeLevelCell(rawLevel);
      var role = normalizeRoleCell(rawRole);
      var stage = normalizeStageCell(rawStage);
      var start = parseExcelDateCell(rawStart, date1904);
      var end = parseExcelDateCell(rawEnd, date1904);
      if (start && !end) {
        // 若只填了开始没填结束，不强制报错，保留为空或尝试不破坏原数据（§10.2 未填则按原值）
      }
      if (start && end && end < start) {
        addNote('存在结束时间早于开始时间的行（' + name + '），已清空其结束时间待补录');
        end = '';
      }

      var statusRes = normalizeProjectStatusCell(rawStatus);
      if (statusRes.mapped) {
        addNote('项目状态「' + statusRes.raw + '」已按规则映射为「' + statusRes.value + '」');
      }

      var settleRes = normalizeSettleCell(rawSettle);
      if (settleRes.mapped) {
        addNote('费用状态「' + settleRes.raw + '」已按规则映射为「' + settleRes.value + '」');
      }

      var parsedFee = parseMoneyCell(rawFee);
      var days = Core.calcDays(start, end);
      var feeManual = null;
      if (keepManualFee && parsedFee !== null && parsedFee >= 0) {
        feeManual = Core.normalizeFeeManual(parsedFee, days, lvRes.value, role, settings);
      }

      var item = {
        rowNumber: ri + 1,
        name: name,
        level: lvRes.value,
        role: role,
        stage: stage,
        start: start,
        end: end,
        status: statusRes.value,
        settle: settleRes.value,
        note: rawNote,
        rawFee: parsedFee,
        feeManual: feeManual
      };

      allRecognized.push(item);
      projectSet[name] = true;
      if (!start) unscheduledCount++;

      var sig = Core.projectDedupKey(item);
      if (existingKeys[sig] || seenInFile[sig]) {
        dupCount++;
        item._isDup = true;
      } else {
        seenInFile[sig] = true;
        toImport.push(item);
      }
    }

    return {
      allItems: allRecognized,
      toImport: toImport,
      summary: {
        recognizedCount: allRecognized.length,
        projectCount: Object.keys(projectSet).length,
        importCount: toImport.length,
        dupCount: dupCount,
        unscheduledCount: unscheduledCount
      },
      notes: mappingNotes
    };
  }

  function parseEvalProjectsFile(file, existingProjects, settings, opts) {
    var name = String((file && file.name) || '').toLowerCase();
    if (name.endsWith('.xls')) {
      return Promise.reject(new Error('不支持旧版 .xls 文件，请在 Excel 中另存为 .xlsx 后重新导入'));
    }
    return WorkCal.Importer.parseFileAsync(file).then(function (gridRes) {
      var parsed = parseEvalProjectsGrid(gridRes.rows, existingProjects, settings, {
        date1904: gridRes.date1904,
        keepManualFee: Boolean(opts && opts.keepManualFee)
      });
      return {
        rawRows: gridRes.rows,
        date1904: gridRes.date1904,
        parsed: parsed
      };
    });
  }

  // =========================================================================
  // 6. 项目差旅导入解析（§10.3）
  // =========================================================================
  function parseEvalTravelsGrid(rows, existingTravels, projects, opts) {
    var Core = getCore();
    var date1904 = Boolean(opts && opts.date1904);

    var limit = Math.min(rows.length, 15);
    var headerIdx = -1;
    var cols = {};

    for (var r = 0; r < limit; r++) {
      var row = rows[r] || [];
      var joined = row.map(function (v) { return String(v || '').replace(/\s+/g, ''); }).join('|');
      var hasTravelDate = joined.indexOf('差旅日期') !== -1;
      var hasTravelCombo =
        joined.indexOf('差旅') !== -1 && (joined.indexOf('金额') !== -1 || joined.indexOf('类别') !== -1);
      if (hasTravelDate || hasTravelCombo || (joined.indexOf('项目名称') !== -1 && joined.indexOf('报销') !== -1)) {
        headerIdx = r;
        for (var ci = 0; ci < row.length; ci++) {
          var h = String(row[ci] || '').replace(/\s+/g, '');
          if (!h) continue;
          if (cols.date === undefined && (h.indexOf('日期') !== -1 || h.indexOf('发生') !== -1)) cols.date = ci;
          else if (cols.name === undefined && h.indexOf('项目名称') !== -1) cols.name = ci;
          else if (cols.stage === undefined && h.indexOf('阶段') !== -1) cols.stage = ci;
          else if (cols.level === undefined && h.indexOf('等级') !== -1) cols.level = ci;
          else if (cols.plan === undefined && h.indexOf('评估计划') !== -1) cols.plan = ci;
          else if (cols.cat === undefined && (h.indexOf('类别') !== -1 || h.indexOf('类型') !== -1)) cols.cat = ci;
          else if (cols.amount === undefined && h.indexOf('金额') !== -1) cols.amount = ci;
          else if (
            cols.detail === undefined &&
            (h.indexOf('具体内容') !== -1 ||
              h.indexOf('内容') !== -1 ||
              h.indexOf('事由') !== -1 ||
              h.indexOf('说明') !== -1)
          ) {
            cols.detail = ci;
          } else if (cols.reimb === undefined && h.indexOf('报销') !== -1) cols.reimb = ci;
        }
        break;
      }
    }

    if (headerIdx === -1) {
      throw new Error('没找到差旅表头行，请确认表头包含「差旅日期」「项目名称」「差旅金额」列');
    }
    if (cols.date === undefined) throw new Error('导入失败：缺少必需列「差旅日期」');
    if (cols.name === undefined) throw new Error('导入失败：缺少必需列「项目名称」');
    if (cols.amount === undefined) throw new Error('导入失败：缺少必需列「差旅金额」');

    var existingKeys = {};
    (existingTravels || []).forEach(function (t) {
      existingKeys[Core.travelDedupKey(t)] = true;
    });
    var seenInFile = {};

    var allValid = [];
    var toImport = [];
    var invalidCount = 0;
    var dupCount = 0;
    var missingDetailCount = 0;
    var notes = [];
    var noteSeen = {};
    var lastName = '';

    var addNote = function (m) {
      if (!noteSeen[m]) {
        noteSeen[m] = true;
        notes.push(m);
      }
    };

    for (var ri = headerIdx + 1; ri < rows.length; ri++) {
      var rdata = rows[ri] || [];
      var get = function (key) {
        var idx = cols[key];
        return idx === undefined ? '' : String(rdata[idx] == null ? '' : rdata[idx]).trim();
      };

      var rawDate = get('date');
      var rawName = get('name');
      var rawStage = get('stage');
      var rawLevel = get('level');
      var rawPlan = get('plan');
      var rawCat = get('cat');
      var rawAmt = get('amount');
      var rawDetail = get('detail');
      var rawReimb = get('reimb');

      if (/^(合计|总计|小计)/.test(rawName || rawDate)) continue;
      if (!rawName && !rawAmt && !rawDate) continue;

      var name = rawName || lastName;
      if (rawName) lastName = rawName;

      var date = parseExcelDateCell(rawDate, date1904);
      var amt = parseMoneyCell(rawAmt);
      if (!date || !name || amt === null || amt <= 0) {
        invalidCount++;
        continue;
      }

      var stage = rawStage
        ? normalizeStageCell(rawStage)
        : Core.findNearestStageForProject(name, date, projects);

      var cat = rawCat || '打车';
      var catCustom = '';
      if (Core.TRAVEL_CATS.indexOf(cat) === -1 || cat === '自定义') {
        catCustom = cat === '自定义' ? '其他' : cat;
        cat = '自定义';
      }

      var reimbRes = normalizeReimbCell(rawReimb);
      if (reimbRes.mapped) {
        addNote('报销状态「' + reimbRes.raw + '」已归一为「' + reimbRes.value + '」');
      }

      // 等级与评估计划优先按项目执行列表关联带出（§10.3）
      var linked = Core.findLinkedProjectRecord(name, stage, date, projects);
      var level = linked ? linked.level : rawLevel;
      var planStart = linked ? linked.start : '';
      var planEnd = linked ? linked.end : '';
      var planText = linked ? Core.formatPlanText(linked.start, linked.end) : rawPlan;

      if (!rawDetail) missingDetailCount++;

      var item = {
        rowNumber: ri + 1,
        date: date,
        name: name,
        stage: stage,
        level: level,
        planStart: planStart,
        planEnd: planEnd,
        planText: planText,
        cat: cat,
        catCustom: catCustom,
        amount: Core.round2(amt),
        detail: rawDetail,
        reimb: reimbRes.value
      };

      allValid.push(item);
      var sig = Core.travelDedupKey(item);
      if (existingKeys[sig] || seenInFile[sig]) {
        dupCount++;
        item._isDup = true;
      } else {
        seenInFile[sig] = true;
        toImport.push(item);
      }
    }

    if (missingDetailCount > 0) {
      addNote(missingDetailCount + ' 笔缺少具体内容，建议导入后补充');
    }
    if (invalidCount > 0) {
      addNote('跳过 ' + invalidCount + ' 行无效数据（日期/项目名称缺失或金额 ≤ 0）');
    }

    return {
      allItems: allValid,
      toImport: toImport,
      summary: {
        recognizedCount: allValid.length,
        importCount: toImport.length,
        dupCount: dupCount,
        invalidCount: invalidCount,
        missingDetailCount: missingDetailCount
      },
      notes: notes
    };
  }

  function parseEvalTravelsFile(file, existingTravels, projects) {
    var name = String((file && file.name) || '').toLowerCase();
    if (name.endsWith('.xls')) {
      return Promise.reject(new Error('不支持旧版 .xls 文件，请在 Excel 中另存为 .xlsx 后重新导入'));
    }
    return WorkCal.Importer.parseFileAsync(file).then(function (gridRes) {
      var parsed = parseEvalTravelsGrid(gridRes.rows, existingTravels, projects, {
        date1904: gridRes.date1904
      });
      return {
        rawRows: gridRes.rows,
        date1904: gridRes.date1904,
        parsed: parsed
      };
    });
  }

  WorkCal.EvalXlsx = {
    buildProjectsXlsxBytes: buildProjectsXlsxBytes,
    exportProjectsXlsx: exportProjectsXlsx,
    buildTravelsXlsxBytes: buildTravelsXlsxBytes,
    exportTravelsXlsx: exportTravelsXlsx,
    parseEvalProjectsGrid: parseEvalProjectsGrid,
    parseEvalProjectsFile: parseEvalProjectsFile,
    parseEvalTravelsGrid: parseEvalTravelsGrid,
    parseEvalTravelsFile: parseEvalTravelsFile
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = WorkCal.EvalXlsx;
  }
})(typeof window !== 'undefined' ? window : globalThis);
