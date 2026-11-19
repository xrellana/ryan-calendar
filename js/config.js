/**
 * 工作日程表全局配置
 * 支持无构建直接修改刷新生效（NFR-2）
 */
(function (root) {
  'use strict';

  var WorkCal = (root.WorkCal = root.WorkCal || {});

  WorkCal.Config = {
    appName: '工作日程',
    storageKey: 'work_calendar_v1',

    /**
     * 公网访问参数门禁配置（FR-01）
     * - 对外分享公网链接需带访问参数，例如 ?k=ryan2026
     * - 本地 file:// 或 localhost/127.0.0.1 默认放行方便直接打开（带 ?enforceAccess=1 时强制校验）
     */
    accessGate: {
      enabled: true,
      allowLocal: true,
      paramName: 'k',
      validTokens: ['ryan2026']
    },

    /**
     * 默认四大类别（按同日取色优先级从高到低排列，FR-04 / BR-1）
     * 列表顺序即优先级：索引 0 优先级最高
     */
    defaultCategories: [
      { id: 'cat-deadline', name: '提交截止', color: '#D93A3A' },
      { id: 'cat-assessment', name: '外出评估', color: '#D97A12' },
      { id: 'cat-consulting', name: '咨询出差', color: '#2B6CD4' },
      { id: 'cat-rest', name: '休息', color: '#2E9E5B' }
    ],

    /**
     * 当所属类别被删除时的兜底外观（FR-07 / AC-8）
     */
    fallbackCategory: {
      id: '__fallback__',
      name: '未归类（原类别已删除）',
      color: '#64748B',
      isFallback: true
    }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = WorkCal.Config;
  }
})(typeof window !== 'undefined' ? window : globalThis);
