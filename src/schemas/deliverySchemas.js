const { z } = require('zod');

const createDeliverySchema = {
  body: z.object({
    id: z.string().trim().optional(),
    pickup_address: z.string().trim().min(1, 'Pickup address is required'),
    dropoff_address: z.string().trim().min(1, 'Drop-off address is required'),
    scheduled_time: z.string().trim().min(1, 'Scheduled time is required'),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
    notes: z.string().trim().optional().nullable(),
    required_capacity: z.coerce.number().min(0).optional(),
    required_vehicle_type: z.string().trim().optional().nullable()
  })
};

const assignDeliverySchema = {
  body: z.object({
    vehicle_id: z.string().trim().min(1, 'Vehicle ID is required'),
    driver_id: z.string().trim().min(1, 'Driver ID is required')
  })
};

const updateDeliveryStatusSchema = {
  body: z.object({
    status: z.enum(['pending', 'assigned', 'in_transit', 'delivered', 'cancelled'], {
      errorMap: () => ({ message: 'Invalid delivery status. Allowed: pending, assigned, in_transit, delivered, cancelled' })
    })
  })
};

const updateDeliverySchema = {
  body: z.object({
    pickup_address: z.string().trim().min(1).optional(),
    dropoff_address: z.string().trim().min(1).optional(),
    scheduled_time: z.string().trim().min(1).optional(),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
    notes: z.string().trim().optional().nullable(),
    required_capacity: z.coerce.number().min(0).optional(),
    required_vehicle_type: z.string().trim().optional().nullable()
  })
};

const listDeliveryQuerySchema = {
  query: z.object({
    status: z.string().optional(),
    priority: z.string().optional(),
    vehicle_id: z.string().optional(),
    driver_id: z.string().optional(),
    search: z.string().optional(),
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
    sortBy: z.enum(['id', 'pickup_address', 'dropoff_address', 'scheduled_time', 'priority', 'status', 'created_at']).optional(),
    sortOrder: z.enum(['asc', 'desc']).optional()
  })
};

module.exports = {
  createDeliverySchema,
  assignDeliverySchema,
  updateDeliveryStatusSchema,
  updateDeliverySchema,
  listDeliveryQuerySchema
};

