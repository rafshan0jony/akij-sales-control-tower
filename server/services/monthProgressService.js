'use strict';

const dates = require('../lib/dates');
const configRepo = require('../repos/config');

/**
 * Month Progress Engine.
 * Computes calendar/business day progress and target pacing metrics.
 * All logic is configurable via the `monthProgress` config block.
 */
function computeMonthProgress(year, month, uptoStr = dates.todayStr()) {
  const totalDays = dates.daysInMonth(year, month);
  const totalBusinessDays = dates.businessDaysInMonth(year, month);
  const elapsedCalendar = dates.diffDays(`${year}-${dates.pad(month)}-01`, uptoStr) + 1;
  const elapsedBusiness = dates.elapsedBusinessDays(year, month, uptoStr);
  const remainingBusiness = dates.remainingBusinessDays(year, month, uptoStr);

  const mode = (configRepo.get('monthProgress') || {}).mode || 'business';
  const monthPct = mode === 'calendar'
    ? (elapsedCalendar / totalDays) * 100
    : (elapsedBusiness / totalBusinessDays) * 100;

  return {
    year,
    month,
    totalDays,
    totalBusinessDays,
    elapsedCalendar,
    elapsedBusiness,
    remainingBusiness,
    monthProgressPct: round1(monthPct),
    mode,
  };
}

/**
 * Pacing metrics given target and achievement (same units).
 */
function computePacing(target, achievement, progress) {
  const remainingTarget = Math.max(target - achievement, 0);
  const requiredDaily = progress.remainingBusiness > 0
    ? remainingTarget / progress.remainingBusiness
    : remainingTarget;
  const requiredRunRate = progress.totalBusinessDays > 0
    ? target / progress.totalBusinessDays
    : 0;
  const forecast = progress.elapsedBusiness > 0
    ? (achievement / progress.elapsedBusiness) * progress.totalBusinessDays
    : 0;
  const runRate = requiredRunRate > 0 ? (achievement / progress.elapsedBusiness) / requiredRunRate * 100 : 0;

  return {
    target,
    achievement,
    remainingTarget,
    requiredDaily,
    requiredRunRate,
    forecast,
    runRatePct: round1(runRate),
    achievementPct: target > 0 ? (achievement / target) * 100 : 0,
  };
}

/**
 * Performance status: On Track / At Risk / Behind / Exceeding.
 */
function performanceStatus(achievementPct, monthProgressPct, thresholds = configRepo.get('achievementThresholds')) {
  const t = thresholds || {};
  if (achievementPct >= (t.exceeding ?? 105)) return 'Exceeding';
  const expected = monthProgressPct;
  if (achievementPct >= expected) return 'On Track';
  if (achievementPct >= expected - ((t.atRisk ?? 90) === 90 ? 10 : (t.atRisk - 90))) return 'At Risk';
  return 'Behind';
}

function round1(n) {
  return Math.round((Number(n) || 0) * 10) / 10;
}

module.exports = { computeMonthProgress, computePacing, performanceStatus };
