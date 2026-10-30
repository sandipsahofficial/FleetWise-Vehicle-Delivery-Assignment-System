const express = require('express');
const deliveryService = require('../services/deliveryService');
const assignmentService = require('../services/assignmentService');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { paginate } = require('../utils/pagination');
const { ForbiddenError } = require('../utils/errors');
const {
  createDeliverySchema,
  assignDeliverySchema,
  updateDeliveryStatusSchema,
  updateDeliverySchema,
  listDeliveryQuerySchema
} = require('../schemas/deliverySchemas');

const router = express.Router();

// Helper to assert driver delivery ownership
function assertDriverOwnership(delivery, req) {
  if (req.user && req.user.role === 'driver') {
    const assignedDriverId = delivery?.assignment?.driver?.id;
    if (!req.user.driver_id || assignedDriverId !== req.user.driver_id) {
      throw new ForbiddenError('Access denied. Drivers can only view or update their own assigned deliveries.');
    }
  }
}

// POST /deliveries - create pending delivery (requires admin or dispatcher)
router.post(
  '/deliveries',
  authenticate(),
  requireRole(['admin', 'dispatcher']),
  validate(createDeliverySchema),
  (req, res, next) => {
    try {
      const delivery = deliveryService.createDelivery(req.body, req.performedBy || 'dispatcher');
      res.status(201).json(delivery);
    } catch (err) {
      next(err);
    }
  }
);

// GET /deliveries - list deliveries with filters and pagination
router.get(
  '/deliveries',
  authenticate({ optional: true }),
  validate(listDeliveryQuerySchema),
  (req, res, next) => {
    try {
      const filters = {
        status: req.query.status,
        priority: req.query.priority,
        vehicle_id: req.query.vehicle_id,
        driver_id: req.query.driver_id,
        search: req.query.search
      };

      // Drivers can only see deliveries assigned to them through the assignments table
      if (req.user && req.user.role === 'driver') {
        if (!req.user.driver_id) {
          // Driver user not linked to a driver entity yet
          const response = paginate([], req, res);
          return res.status(200).json(response);
        }
        filters.driver_id = req.user.driver_id;
      }

      const deliveries = deliveryService.listDeliveries(filters);
      const response = paginate(deliveries, req, res);
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }
);

// GET /deliveries/queue - priority-based queue of pending deliveries
router.get(
  '/deliveries/queue',
  authenticate({ optional: true }),
  requireRole(['admin', 'dispatcher']),
  (req, res, next) => {
    try {
      const queue = deliveryService.getPriorityQueue();
      res.status(200).json({
        count: queue.length,
        queue
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /deliveries/:id - get single delivery (scoped for drivers)
router.get(
  '/deliveries/:id',
  authenticate({ optional: true }),
  (req, res, next) => {
    try {
      const delivery = deliveryService.getDeliveryById(req.params.id);
      assertDriverOwnership(delivery, req);
      res.status(200).json(delivery);
    } catch (err) {
      next(err);
    }
  }
);

// GET /deliveries/:id/suggestions - get resource matching suggestions
router.get(
  '/deliveries/:id/suggestions',
  authenticate({ optional: true }),
  requireRole(['admin', 'dispatcher']),
  (req, res, next) => {
    try {
      const suggestions = assignmentService.suggestResources(req.params.id);
      res.status(200).json(suggestions);
    } catch (err) {
      next(err);
    }
  }
);

// GET /deliveries/:id/assignments - get assignment history
router.get(
  '/deliveries/:id/assignments',
  authenticate({ optional: true }),
  requireRole(['admin', 'dispatcher']),
  (req, res, next) => {
    try {
      const history = assignmentService.getAssignmentHistory(req.params.id);
      res.status(200).json(history);
    } catch (err) {
      next(err);
    }
  }
);

// POST /deliveries/:id/assign - assign vehicle and driver
router.post(
  '/deliveries/:id/assign',
  authenticate(),
  requireRole(['admin', 'dispatcher']),
  validate(assignDeliverySchema),
  (req, res, next) => {
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
  }
);

// PATCH /deliveries/:id/status - perform validated status transition (scoped for drivers)
router.patch(
  '/deliveries/:id/status',
  authenticate(),
  validate(updateDeliveryStatusSchema),
  (req, res, next) => {
    try {
      const delivery = deliveryService.getDeliveryById(req.params.id);
      assertDriverOwnership(delivery, req);

      const { status, reason } = req.body || {};

      // Requirement 2: Block drivers from directly marking status=delivered
      if (req.user && req.user.role === 'driver' && status === 'delivered') {
        throw new ForbiddenError('Drivers cannot mark deliveries as delivered via status update. Completion requires verified proof of delivery (complete-otp or complete-photo).');
      }

      const overrideReason = reason || (status === 'delivered' ? 'Dispatcher/Admin operational override' : null);
      const updated = deliveryService.updateDeliveryStatus(req.params.id, status, req.user?.username || req.performedBy || 'system', overrideReason);
      res.status(200).json({
        message: `Delivery status transitioned to '${status}'`,
        delivery: updated
      });
    } catch (err) {
      next(err);
    }
  }
);

// PUT /deliveries/:id - update delivery request
router.put(
  '/deliveries/:id',
  authenticate(),
  requireRole(['admin', 'dispatcher']),
  validate(updateDeliverySchema),
  (req, res, next) => {
    try {
      const delivery = deliveryService.updateDelivery(req.params.id, req.body);
      res.status(200).json(delivery);
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /deliveries/:id - delete pending or safe delivery
router.delete(
  '/deliveries/:id',
  authenticate(),
  requireRole(['admin', 'dispatcher']),
  (req, res, next) => {
    try {
      deliveryService.deleteDelivery(req.params.id);
      res.status(200).json({
        message: `Delivery '${req.params.id}' successfully deleted`,
        id: req.params.id
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
