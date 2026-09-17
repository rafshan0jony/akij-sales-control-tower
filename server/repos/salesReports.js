'use strict';

const { getDb } = require('../db');

function rowToReport(r) {
  if (!r) return null;
  return {
    id: r.id,
    userId: r.user_id,
    date: r.date,
    visitSchedule: r.visit_schedule,
    actualVisitPlan: r.actual_visit_plan,
    salesProjectionMt: r.sales_projection_mt,
    depositProjectionBdt: r.deposit_projection_bdt,
    actualSalesMt: r.actual_sales_mt,
    actualCollectionBdt: r.actual_collection_bdt,
    projectionSubmittedAt: r.projection_submitted_at,
    actualSubmittedAt: r.actual_submitted_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function get(userId, date) {
  return rowToReport(getDb().prepare('SELECT * FROM sales_reports WHERE user_id = ? AND date = ?').get(userId, date));
}

function listForDate(date) {
  return getDb().prepare('SELECT * FROM sales_reports WHERE date = ? ORDER BY id').all(date).map(rowToReport);
}

function listForMonth(month) {
  return getDb().prepare("SELECT * FROM sales_reports WHERE date LIKE ? ORDER BY date, id").all(month + '%').map(rowToReport);
}

function upsert(userId, date, fields) {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = get(userId, date);
  db.prepare(
    `INSERT INTO sales_reports (user_id, date, visit_schedule, actual_visit_plan, sales_projection_mt, deposit_projection_bdt, actual_sales_mt, actual_collection_bdt, projection_submitted_at, actual_submitted_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, date) DO UPDATE SET
       visit_schedule = excluded.visit_schedule,
       actual_visit_plan = excluded.actual_visit_plan,
       sales_projection_mt = excluded.sales_projection_mt,
       deposit_projection_bdt = excluded.deposit_projection_bdt,
       actual_sales_mt = excluded.actual_sales_mt,
       actual_collection_bdt = excluded.actual_collection_bdt,
       projection_submitted_at = excluded.projection_submitted_at,
       actual_submitted_at = excluded.actual_submitted_at,
       updated_at = excluded.updated_at`
  ).run(
    userId, date,
    fields.visitSchedule ?? (existing ? existing.visitSchedule : null),
    fields.actualVisitPlan ?? (existing ? existing.actualVisitPlan : null),
    fields.salesProjectionMt ?? (existing ? existing.salesProjectionMt : null),
    fields.depositProjectionBdt ?? (existing ? existing.depositProjectionBdt : null),
    fields.actualSalesMt ?? (existing ? existing.actualSalesMt : null),
    fields.actualCollectionBdt ?? (existing ? existing.actualCollectionBdt : null),
    fields.projectionSubmittedAt ?? (existing ? existing.projectionSubmittedAt : null),
    fields.actualSubmittedAt ?? (existing ? existing.actualSubmittedAt : null),
    existing ? existing.createdAt : now,
    now
  );
  return get(userId, date);
}

module.exports = { get, listForDate, listForMonth, upsert };
