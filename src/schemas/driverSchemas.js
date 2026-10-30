const { z } = require('zod');

const createDriverSchema = {
  body: z.object({
    id: z.string().trim().optional(),
    name: z.string().trim().min(1, 'Driver name is required'),
    phone: z.string().trim().min(1, 'Phone number is required'),
    availability_status: z.enum(['available', 'assigned', 'unavailable']).optional()
  })
};

const updateDriverStatusSchema = {
  body: z.object({
    status: z.enum(['available', 'assigned', 'unavailable'], {
      errorMap: () => ({ message: 'Invalid driver availability status. Allowed: available, assigned, unavailable' })
    })
  })
};

const updateDriverSchema = {
  body: z.object({
    name: z.string().trim().min(1).optional(),
    phone: z.string().trim().min(1).optional()
  })
};

const listDriverQuerySchema = {
  query: z.object({
    status: z.string().optional(),
    search: z.string().optional(),
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
    sortBy: z.enum(['id', 'name', 'phone', 'availability_status', 'created_at']).optional(),
    sortOrder: z.enum(['asc', 'desc']).optional()
  })
};

module.exports = {
  createDriverSchema,
  updateDriverStatusSchema,
  updateDriverSchema,
  listDriverQuerySchema
};

