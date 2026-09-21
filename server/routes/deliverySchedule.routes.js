'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { badRequest } = require('../lib/errors');
const deliveryScheduleService = require('../services/deliveryScheduleService');
const deliverySchedulesRepo = require('../repos/deliverySchedules');
const googleChat = require('../services/googleChatService');

const router = express.Router();
router.use(authenticate);

router.get('/pending', asyncHandler(async (req, res) => {
  res.json({ rows: deliveryScheduleService.options(req.scope) });
}));

router.post('/', asyncHandler(async (req, res) => {
  const { deliveryDate, lines } = req.body || {};
  let schedule;
  try {
    schedule = deliveryScheduleService.submit(req.user.id, req.scope, deliveryDate, lines);
  } catch (error) {
    throw badRequest(error.message);
  }

  try {
    const message = await googleChat.sendDeliverySchedule({
      deliveryDate,
      submittedBy: req.user.name,
      lines: schedule.lines,
    });
    deliverySchedulesRepo.updateChat(schedule.id, 'sent', message.name);
    res.status(201).json({ id: schedule.id, chatStatus: 'sent' });
  } catch (error) {
    deliverySchedulesRepo.updateChat(schedule.id, 'failed', null, error.message);
    res.status(201).json({ id: schedule.id, chatStatus: 'failed', warning: error.message });
  }
}));

module.exports = router;
