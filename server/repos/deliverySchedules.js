'use strict';

const { getDb } = require('../db');

function create(userId, deliveryDate, lines, remarks) {
  const db = getDb();
  const now = new Date().toISOString();
  db.exec('BEGIN');
  try {
    const result = db.prepare(
      'INSERT INTO delivery_schedules (user_id, delivery_date, submitted_at, remarks) VALUES (?, ?, ?, ?)'
    ).run(userId, deliveryDate, now, remarks || null);
    const add = db.prepare(
      `INSERT INTO delivery_schedule_lines
       (schedule_id, order_no, customer, territory, item, uom, weight, order_qty_bags, pending_qty_bags, schedule_qty_bags)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const line of lines) {
      add.run(result.lastInsertRowid, line.orderNo, line.customer, line.territory || null,
        line.item, line.uom || null, line.weight || null, line.orderQtyBags,
        line.pendingQtyBags, line.scheduleQtyBags);
    }
    db.exec('COMMIT');
    return Number(result.lastInsertRowid);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function restoreSchedule(userId, deliveryDate, submittedAt, chatStatus, lines, remarks) {
  const db = getDb();
  db.exec('BEGIN');
  try {
    const result = db.prepare(
      'INSERT INTO delivery_schedules (user_id, delivery_date, submitted_at, chat_status, remarks) VALUES (?, ?, ?, ?, ?)'
    ).run(userId, deliveryDate, submittedAt || new Date().toISOString(), chatStatus || 'pending', remarks || null);
    const add = db.prepare(
      `INSERT INTO delivery_schedule_lines
       (schedule_id, order_no, customer, territory, item, uom, weight, order_qty_bags, pending_qty_bags, schedule_qty_bags)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const line of lines) {
      add.run(result.lastInsertRowid, line.orderNo, line.customer, line.territory || null,
        line.item, line.uom || null, line.weight ?? null, line.orderQtyBags,
        line.pendingQtyBags, line.scheduleQtyBags);
    }
    db.exec('COMMIT');
    return Number(result.lastInsertRowid);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function count() {
  return getDb().prepare('SELECT COUNT(*) AS c FROM delivery_schedules').get().c;
}

function updateChat(id, status, messageName, error) {
  getDb().prepare(
    'UPDATE delivery_schedules SET chat_status = ?, chat_message_name = ?, chat_error = ? WHERE id = ?'
  ).run(status, messageName || null, error || null, id);
}

function listAll() {
  return getDb().prepare(
    `SELECT s.id, s.delivery_date AS deliveryDate, s.submitted_at AS submittedAt,
            s.chat_status AS chatStatus, s.remarks, u.name AS submittedBy,
            l.order_no AS orderNo, l.customer, l.territory, l.item, l.uom,
            l.order_qty_bags AS orderQtyBags, l.pending_qty_bags AS pendingQtyBags,
            l.schedule_qty_bags AS scheduleQtyBags
     FROM delivery_schedules s
     LEFT JOIN users u ON u.id = s.user_id
     INNER JOIN delivery_schedule_lines l ON l.schedule_id = s.id
     ORDER BY s.delivery_date DESC, s.submitted_at DESC, l.id ASC`
  ).all();
}

module.exports = { create, restoreSchedule, count, updateChat, listAll };
