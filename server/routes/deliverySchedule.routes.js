'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { badRequest } = require('../lib/errors');
const deliveryScheduleService = require('../services/deliveryScheduleService');
const deliverySchedulesRepo = require('../repos/deliverySchedules');
const googleChat = require('../services/googleChatService');
const googleSheets = require('../services/googleSheetsService');

const router = express.Router();
router.use(authenticate);

router.get('/pending', asyncHandler(async (req, res) => {
  res.json({ rows: deliveryScheduleService.options(req.scope) });
}));

router.post('/', asyncHandler(async (req, res) => {
  const { deliveryDate, lines, remarks } = req.body || {};
  let schedule;
  try {
    schedule = deliveryScheduleService.submit(req.user.id, req.scope, deliveryDate, lines, remarks);
  } catch (error) {
    throw badRequest(error.message);
  }

  const submittedAt = new Date().toISOString();
  let chatStatus = 'pending';
  let warning = null;

  try {
    const message = await googleChat.sendDeliverySchedule({
      deliveryDate,
      submittedBy: req.user.name,
      lines: schedule.lines,
      remarks,
    });
    deliverySchedulesRepo.updateChat(schedule.id, 'sent', message.name);
    chatStatus = 'sent';
  } catch (error) {
    deliverySchedulesRepo.updateChat(schedule.id, 'failed', null, error.message);
    chatStatus = 'failed';
    warning = error.message;
  }

  try {
    await googleSheets.appendSchedule({
      submittedAt,
      deliveryDate,
      submittedBy: req.user.name,
      lines: schedule.lines,
      chatStatus,
      remarks,
    });
  } catch (error) {
    warning = warning ? `${warning} | Sheets: ${error.message}` : error.message;
  }

  res.status(201).json({ id: schedule.id, chatStatus, warning });
}));

module.exports = router;
