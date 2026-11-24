/**
 * 评估项目管理平台手写 SVG 图表组件（零第三方依赖）
 * - 月度评估费用分布（已结深蓝 / 未结浅蓝 堆叠柱状图，§7.3）
 * - 月度评估天数分布（已发生深色 / 未来计划浅色，§8.3）
 * - 差旅费用结构（固定调色板降序柱状图，§6.7）
 */
(function (root) {
  'use strict';

  var WorkCal = (root.WorkCal = root.WorkCal || {});

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatCompactMoney(v) {
    var n = Number(v) || 0;
    if (n >= 10000) return (n / 10000).toFixed(n % 10000 === 0 ? 0 : 1) + '万';
    return n.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  }

  // 差旅类别固定调色板（同一类别在不同筛选下颜色稳定，§6.7）
  var TRAVEL_COLOR_MAP = {
    高铁: '#2563eb',
    飞机: '#0284c7',
    住宿: '#7c3aed',
    打车: '#ea580c',
    餐饮: '#16a34a',
    自驾: '#0d9488'
  };
  var FALLBACK_COLORS = ['#db2777', '#ca8a04', '#4f46e5', '#9333ea', '#0891b2', '#65a30d'];

  function colorForTravelCategory(name) {
    if (TRAVEL_COLOR_MAP[name]) return TRAVEL_COLOR_MAP[name];
    var hash = 0;
    var s = String(name || '');
    for (var i = 0; i < s.length; i++) {
      hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
    }
    return FALLBACK_COLORS[hash % FALLBACK_COLORS.length];
  }

  /**
   * 1. 月度评估费用分布（堆叠柱状图：已结深蓝 #1d4ed8 + 未结浅蓝 #93c5fd）
   */
  function renderMonthlyFeeChartHtml(rows) {
    if (!rows || !rows.length) {
      return '<div class="eval-chart-empty">当前筛选区间内暂无月度费用数据</div>';
    }

    var W = Math.max(640, rows.length * 64 + 80);
    var H = 250;
    var padL = 54;
    var padR = 20;
    var padT = 30;
    var padB = 42;
    var plotW = W - padL - padR;
    var plotH = H - padT - padB;

    var maxVal = 0;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].total > maxVal) maxVal = rows[i].total;
    }
    if (maxVal <= 0) maxVal = 1000;

    var slotW = plotW / rows.length;
    var barW = Math.min(36, Math.max(16, slotW * 0.56));
    var gridLines = [];
    for (var g = 0; g <= 4; g++) {
      var val = (maxVal * g) / 4;
      var y = padT + plotH - (plotH * g) / 4;
      gridLines.push(
        '<line x1="' +
          padL +
          '" y1="' +
          y.toFixed(1) +
          '" x2="' +
          (W - padR) +
          '" y2="' +
          y.toFixed(1) +
          '" stroke="#e2e8f0" stroke-dasharray="' +
          (g === 0 ? '0' : '3,3') +
          '"/>' +
          '<text x="' +
          (padL - 8) +
          '" y="' +
          (y + 4).toFixed(1) +
          '" text-anchor="end" font-size="11" fill="#64748b">' +
          esc(formatCompactMoney(val)) +
          '</text>'
      );
    }

    var bars = [];
    for (var idx = 0; idx < rows.length; idx++) {
      var item = rows[idx];
      var cx = padL + slotW * idx + slotW / 2;
      var x = cx - barW / 2;
      var totalH = (item.total / maxVal) * plotH;
      var settledH = (item.settled / maxVal) * plotH;
      var unsettledH = Math.max(0, totalH - settledH);
      var ySettled = padT + plotH - settledH;
      var yUnsettled = ySettled - unsettledH;

      var tooltip =
        item.month +
        '：合计 ¥' +
        item.total.toFixed(2) +
        '（已结 ¥' +
        item.settled.toFixed(2) +
        ' / 未结 ¥' +
        item.unsettled.toFixed(2) +
        '）';

      bars.push(
        '<g>' +
          '<title>' +
          esc(tooltip) +
          '</title>' +
          (settledH > 0
            ? '<rect x="' +
              x.toFixed(1) +
              '" y="' +
              ySettled.toFixed(1) +
              '" width="' +
              barW.toFixed(1) +
              '" height="' +
              settledH.toFixed(1) +
              '" rx="2" fill="#1d4ed8"/>'
            : '') +
          (unsettledH > 0
            ? '<rect x="' +
              x.toFixed(1) +
              '" y="' +
              yUnsettled.toFixed(1) +
              '" width="' +
              barW.toFixed(1) +
              '" height="' +
              unsettledH.toFixed(1) +
              '" rx="2" fill="#93c5fd"/>'
            : '') +
          '<text x="' +
          cx.toFixed(1) +
          '" y="' +
          Math.max(14, padT + plotH - totalH - 6).toFixed(1) +
          '" text-anchor="middle" font-size="11" font-weight="600" fill="#1e293b">' +
          esc(formatCompactMoney(item.total)) +
          '</text>' +
          '<text x="' +
          cx.toFixed(1) +
          '" y="' +
          (H - 16) +
          '" text-anchor="middle" font-size="11" fill="#475569">' +
          esc(item.month) +
          '</text>' +
          '</g>'
      );
    }

    return (
      '<div class="eval-chart-legend">' +
      '<span class="eval-legend-chip"><i style="background:#1d4ed8;"></i>已结</span>' +
      '<span class="eval-legend-chip"><i style="background:#93c5fd;"></i>未结</span>' +
      '</div>' +
      '<div class="eval-svg-scroll">' +
      '<svg class="eval-svg-chart" viewBox="0 0 ' +
      W +
      ' ' +
      H +
      '" preserveAspectRatio="xMidYMid meet">' +
      gridLines.join('') +
      bars.join('') +
      '</svg>' +
      '</div>'
    );
  }

  /**
   * 2. 月度评估天数分布（已发生含本月深色 #2563eb / 未来计划浅色 #bfdbfe）
   */
  function renderMonthlyDaysChartHtml(rows) {
    if (!rows || !rows.length) {
      return '<div class="eval-chart-empty">暂无已排期项目的月度天数数据</div>';
    }

    var W = Math.max(640, rows.length * 60 + 80);
    var H = 240;
    var padL = 44;
    var padR = 20;
    var padT = 28;
    var padB = 42;
    var plotW = W - padL - padR;
    var plotH = H - padT - padB;

    var maxVal = 0;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].days > maxVal) maxVal = rows[i].days;
    }
    if (maxVal <= 0) maxVal = 10;

    var slotW = plotW / rows.length;
    var barW = Math.min(34, Math.max(16, slotW * 0.56));
    var gridLines = [];
    for (var g = 0; g <= 4; g++) {
      var val = Math.round((maxVal * g) / 4);
      var y = padT + plotH - (plotH * g) / 4;
      gridLines.push(
        '<line x1="' +
          padL +
          '" y1="' +
          y.toFixed(1) +
          '" x2="' +
          (W - padR) +
          '" y2="' +
          y.toFixed(1) +
          '" stroke="#e2e8f0" stroke-dasharray="' +
          (g === 0 ? '0' : '3,3') +
          '"/>' +
          '<text x="' +
          (padL - 8) +
          '" y="' +
          (y + 4).toFixed(1) +
          '" text-anchor="end" font-size="11" fill="#64748b">' +
          val +
          '</text>'
      );
    }

    var bars = [];
    for (var idx = 0; idx < rows.length; idx++) {
      var item = rows[idx];
      var cx = padL + slotW * idx + slotW / 2;
      var x = cx - barW / 2;
      var barH = (item.days / maxVal) * plotH;
      var yTop = padT + plotH - barH;
      var fill = item.isFuture ? '#93c5fd' : '#2563eb';
      var tooltip =
        item.month +
        '：' +
        item.days +
        ' 天（涵盖 ' +
        item.projectCount +
        ' 个项目，' +
        (item.isFuture ? '未来计划' : '已发生/本月') +
        '）';

      bars.push(
        '<g>' +
          '<title>' +
          esc(tooltip) +
          '</title>' +
          '<rect x="' +
          x.toFixed(1) +
          '" y="' +
          yTop.toFixed(1) +
          '" width="' +
          barW.toFixed(1) +
          '" height="' +
          Math.max(2, barH).toFixed(1) +
          '" rx="3" fill="' +
          fill +
          '"/>' +
          '<text x="' +
          cx.toFixed(1) +
          '" y="' +
          Math.max(14, yTop - 6).toFixed(1) +
          '" text-anchor="middle" font-size="11" font-weight="600" fill="#1e293b">' +
          item.days +
          '天</text>' +
          '<text x="' +
          cx.toFixed(1) +
          '" y="' +
          (H - 16) +
          '" text-anchor="middle" font-size="11" fill="#475569">' +
          esc(item.month) +
          '</text>' +
          '</g>'
      );
    }

    return (
      '<div class="eval-chart-legend">' +
      '<span class="eval-legend-chip"><i style="background:#2563eb;"></i>已发生（含本月）</span>' +
      '<span class="eval-legend-chip"><i style="background:#93c5fd;"></i>未来计划</span>' +
      '</div>' +
      '<div class="eval-svg-scroll">' +
      '<svg class="eval-svg-chart" viewBox="0 0 ' +
      W +
      ' ' +
      H +
      '" preserveAspectRatio="xMidYMid meet">' +
      gridLines.join('') +
      bars.join('') +
      '</svg>' +
      '</div>'
    );
  }

  /**
   * 3. 差旅费用结构（降序柱状图，固定调色板）
   */
  function renderTravelCategoryChartHtml(rows) {
    if (!rows || !rows.length) {
      return '<div class="eval-chart-empty">当前统计范围内暂无差旅支出数据</div>';
    }

    var W = Math.max(560, rows.length * 76 + 80);
    var H = 230;
    var padL = 54;
    var padR = 20;
    var padT = 28;
    var padB = 42;
    var plotW = W - padL - padR;
    var plotH = H - padT - padB;

    var maxVal = 0;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].amount > maxVal) maxVal = rows[i].amount;
    }
    if (maxVal <= 0) maxVal = 100;

    var slotW = plotW / rows.length;
    var barW = Math.min(40, Math.max(18, slotW * 0.52));
    var gridLines = [];
    for (var g = 0; g <= 4; g++) {
      var val = (maxVal * g) / 4;
      var y = padT + plotH - (plotH * g) / 4;
      gridLines.push(
        '<line x1="' +
          padL +
          '" y1="' +
          y.toFixed(1) +
          '" x2="' +
          (W - padR) +
          '" y2="' +
          y.toFixed(1) +
          '" stroke="#e2e8f0" stroke-dasharray="' +
          (g === 0 ? '0' : '3,3') +
          '"/>' +
          '<text x="' +
          (padL - 8) +
          '" y="' +
          (y + 4).toFixed(1) +
          '" text-anchor="end" font-size="11" fill="#64748b">' +
          esc(formatCompactMoney(val)) +
          '</text>'
      );
    }

    var bars = [];
    for (var idx = 0; idx < rows.length; idx++) {
      var item = rows[idx];
      var cx = padL + slotW * idx + slotW / 2;
      var x = cx - barW / 2;
      var barH = (item.amount / maxVal) * plotH;
      var yTop = padT + plotH - barH;
      var fill = colorForTravelCategory(item.name);
      var tooltip = item.name + '：¥' + item.amount.toFixed(2) + '（' + item.count + ' 笔，占比 ' + item.pct + '%）';
      var shortLabel = item.name.length > 6 ? item.name.slice(0, 6) + '…' : item.name;

      bars.push(
        '<g>' +
          '<title>' +
          esc(tooltip) +
          '</title>' +
          '<rect x="' +
          x.toFixed(1) +
          '" y="' +
          yTop.toFixed(1) +
          '" width="' +
          barW.toFixed(1) +
          '" height="' +
          Math.max(2, barH).toFixed(1) +
          '" rx="3" fill="' +
          fill +
          '"/>' +
          '<text x="' +
          cx.toFixed(1) +
          '" y="' +
          Math.max(14, yTop - 6).toFixed(1) +
          '" text-anchor="middle" font-size="11" font-weight="600" fill="#1e293b">¥' +
          esc(formatCompactMoney(item.amount)) +
          '</text>' +
          '<text x="' +
          cx.toFixed(1) +
          '" y="' +
          (H - 16) +
          '" text-anchor="middle" font-size="11" fill="#475569">' +
          esc(shortLabel) +
          '</text>' +
          '</g>'
      );
    }

    return (
      '<div class="eval-svg-scroll">' +
      '<svg class="eval-svg-chart" viewBox="0 0 ' +
      W +
      ' ' +
      H +
      '" preserveAspectRatio="xMidYMid meet">' +
      gridLines.join('') +
      bars.join('') +
      '</svg>' +
      '</div>'
    );
  }

  WorkCal.EvalCharts = {
    renderMonthlyFeeChartHtml: renderMonthlyFeeChartHtml,
    renderMonthlyDaysChartHtml: renderMonthlyDaysChartHtml,
    renderTravelCategoryChartHtml: renderTravelCategoryChartHtml,
    colorForTravelCategory: colorForTravelCategory
  };
})(typeof window !== 'undefined' ? window : globalThis);
