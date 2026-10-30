const { z } = require('zod');

const createVehicleSchema = {
  body: z.object({
    id: z.string().trim().optional(),
    registration_number: z.string().trim().min(1, 'Registration number is required'),
    type: z.string().trim().min(1, 'Vehicle type is required'),
    capacity: z.coerce.number().positive('Capacity must be a positive number'),
    status: z.enum(['available', 'assigned', 'maintenance', 'inactive']).optional()
  })
};

const updateVehicleStatusSchema = {
  body: z.object({
    status: z.enum(['available', 'assigned', 'maintenance', 'inactive'], {
      errorMap: () => ({ message: 'Invalid vehicle status. Allowed: available, assigned, maintenance, inactive' })
    })
  })
};

const updateVehicleSchema = {
  body: z.object({
    registration_number: z.string().trim().min(1).optional(),
    type: z.string().trim().min(1).optional(),
    capacity: z.coerce.number().positive().optional(),
    status: z.enum(['available', 'assigned', 'maintenance', 'inactive']).optional()
  })
};

const listVehicleQuerySchema = {
  query: z.object({
    status: z.string().optional(),
    type: z.string().optional(),
    search: z.string().optional(),
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
    sortBy: z.enum(['id', 'registration_number', 'type', 'capacity', 'status', 'created_at']).optional(),
    sortOrder: z.enum(['asc', 'desc']).optional()
  })
};

module.exports = {
  createVehicleSchema,
  updateVehicleStatusSchema,
  updateVehicleSchema,
  listVehicleQuerySchema
};
