/**
 * 工作日程表全局配置
 */
(function (root) {
  'use strict';

  var WorkCal = (root.WorkCal = root.WorkCal || {});

  WorkCal.Config = {
    appName: '工作日程',
    legacyStorageKey: 'work_calendar_v1',

    /**
     * 系统受保护的评估类别 ID（不可删除，允许改名、改色与调优先级）
     * 日程与评估项目的联动只认这个 ID，因此改名不会影响双向同步
     */
    protectedAssessmentCategoryId: 'cat-assessment',
    /**
     * 评估类别的默认名称：仅用于新账号初始化与找不到该类别时的文案兜底
     */
    protectedAssessmentCategoryName: '外出评估',

    /**
     * 默认四大类别（按同日取色优先级从高到低排列）
     * 列表顺序即优先级：索引 0 优先级最高
     */
    defaultCategories: [
      { id: 'cat-deadline', name: '提交截止', color: '#D93A3A' },
      { id: 'cat-assessment', name: '外出评估', color: '#D97A12', protected: true },
      { id: 'cat-consulting', name: '咨询出差', color: '#2B6CD4' },
      { id: 'cat-rest', name: '休息', color: '#2E9E5B' }
    ],

    /**
     * 当所属类别被删除时的兜底外观
     */
    fallbackCategory: {
      id: '__fallback__',
      name: '未归类（原类别已删除）',
      color: '#64748B',
      isFallback: true
    }
  };

  /**
   * 取评估类别的当前显示名称（用户可能已改名），找不到时回退到默认名称
   */
  WorkCal.Config.getAssessmentCategoryName = function (categories) {
    var cfg = WorkCal.Config;
    var list = categories || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === cfg.protectedAssessmentCategoryId && list[i].name) {
        return list[i].name;
      }
    }
    return cfg.protectedAssessmentCategoryName;
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = WorkCal.Config;
  }
})(typeof window !== 'undefined' ? window : globalThis);
