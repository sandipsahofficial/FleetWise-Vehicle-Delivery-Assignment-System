const express = require('express');
const deliveryService = require('../services/deliveryService');
const assignmentService = require('../services/assignmentService');

const router = express.Router();

// POST /deliveries - create pending delivery
router.post('/deliveries', (req, res, next) => {
  try {
    const delivery = deliveryService.createDelivery(req.body);
    res.status(201).json(delivery);
  } catch (err) {
    next(err);
  }
});

// GET /deliveries - list deliveries with filters & search
router.get('/deliveries', (req, res, next) => {
  try {
    const filters = {
      status: req.query.status,
      priority: req.query.priority,
      vehicle_id: req.query.vehicle_id,
      driver_id: req.query.driver_id,
      search: req.query.search
    };
    const deliveries = deliveryService.listDeliveries(filters);
    res.status(200).json(deliveries);
  } catch (err) {
    next(err);
  }
});

// GET /deliveries/queue - priority-based queue of pending deliveries
router.get('/deliveries/queue', (req, res, next) => {
  try {
    const queue = deliveryService.getPriorityQueue();
    res.status(200).json({
      count: queue.length,
      queue
    });
  } catch (err) {
    next(err);
  }
});

// GET /deliveries/:id - get single delivery
router.get('/deliveries/:id', (req, res, next) => {
  try {
    const delivery = deliveryService.getDeliveryById(req.params.id);
    res.status(200).json(delivery);
  } catch (err) {
    next(err);
  }
});

// GET /deliveries/:id/suggestions - get AI resource matching suggestions
router.get('/deliveries/:id/suggestions', (req, res, next) => {
  try {
    const suggestions = assignmentService.suggestResources(req.params.id);
    res.status(200).json(suggestions);
  } catch (err) {
    next(err);
  }
});

// GET /deliveries/:id/assignments - get assignment history
router.get('/deliveries/:id/assignments', (req, res, next) => {
  try {
    const history = assignmentService.getAssignmentHistory(req.params.id);
    res.status(200).json(history);
  } catch (err) {
    next(err);
  }
});

// POST /deliveries/:id/assign - assign vehicle and driver
router.post('/deliveries/:id/assign', (req, res, next) => {
  try {
    const { vehicle_id, driver_id } = req.body || {};
    const delivery = assignmentService.assignDelivery(req.params.id, vehicle_id, driver_id);
    res.status(200).json({
      message: 'Vehicle and driver successfully assigned to delivery',
      delivery
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /deliveries/:id/status - perform validated status transition
router.patch('/deliveries/:id/status', (req, res, next) => {
  try {
    const { status } = req.body || {};
    const delivery = deliveryService.updateDeliveryStatus(req.params.id, status);
    res.status(200).json({
      message: `Delivery status transitioned to '${status}'`,
      delivery
    });
  } catch (err) {
    next(err);
  }
});

// PUT /deliveries/:id - update pending delivery
router.put('/deliveries/:id', (req, res, next) => {
  try {
    const delivery = deliveryService.updateDelivery(req.params.id, req.body);
    res.status(200).json(delivery);
  } catch (err) {
    next(err);
  }
});

// DELETE /deliveries/:id - delete delivery (if safe)
router.delete('/deliveries/:id', (req, res, next) => {
  try {
    deliveryService.deleteDelivery(req.params.id);
    res.status(200).json({
      message: `Delivery '${req.params.id}' successfully deleted`,
      id: req.params.id
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

