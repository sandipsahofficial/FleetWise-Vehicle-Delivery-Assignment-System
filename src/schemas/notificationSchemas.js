const { z } = require('zod');

const registerContactSchema = {
  body: z.object({
    delivery_id: z.string().trim().min(1, 'Delivery ID is required'),
    name: z.string().trim().min(1, 'Customer name is required'),
    email: z.string().trim().email('Valid email address is required'),
    phone: z.string().trim().optional().nullable(),
    consent: z.coerce.boolean().optional()
  })
};

const queryOutboxSchema = {
  query: z.object({
    status: z.enum(['pending', 'processing', 'sent', 'failed']).optional(),
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).optional()
  })
};

module.exports = {
  registerContactSchema,
  queryOutboxSchema
};
