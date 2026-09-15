'use strict';

const { getDb } = require('../db');

function rowToEntry(r) {
  if (!r) return null;
  return {
    id: r.id,
    userId: r.user_id,
    month: r.month,
    day: r.day,
    salesOrderMt: r.sales_order_mt,
    visitPlanChange: r.visit_plan_change,
    taDaDetails: r.ta_da_details,
    taDaBill: r.ta_da_bill,
    updatedAt: r.updated_at,
  };
}

/** All entries for a month (for joining the sheet data). */
function listForMonth(month) {
  return getDb().prepare('SELECT * FROM tour_plan_entries WHERE month = ?').all(month).map(rowToEntry);
}

/** Entries for a single user + month. */
function listForUser(userId, month) {
  return getDb().prepare('SELECT * FROM tour_plan_entries WHERE user_id = ? AND month = ? ORDER BY day').all(userId, month).map(rowToEntry);
}

function get(userId, month, day) {
  return rowToEntry(getDb().prepare('SELECT * FROM tour_plan_entries WHERE user_id = ? AND month = ? AND day = ?').get(userId, month, day));
}

function upsert(userId, month, day, fields) {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO tour_plan_entries (user_id, month, day, sales_order_mt, visit_plan_change, ta_da_details, ta_da_bill, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, month, day) DO UPDATE SET
       sales_order_mt = excluded.sales_order_mt,
       visit_plan_change = excluded.visit_plan_change,
       ta_da_details = excluded.ta_da_details,
       ta_da_bill = excluded.ta_da_bill,
       updated_at = excluded.updated_at`
  ).run(
    userId, month, day,
    fields.salesOrderMt ?? null,
    fields.visitPlanChange ?? null,
    fields.taDaDetails ?? null,
    fields.taDaBill ?? null,
    now
  );
  return get(userId, month, day);
}

module.exports = { listForMonth, listForUser, get, upsert };
