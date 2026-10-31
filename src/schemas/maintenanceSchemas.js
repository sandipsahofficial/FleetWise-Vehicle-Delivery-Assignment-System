const { z } = require('zod');

const createScheduleSchema = {
  body: z.object({
    vehicle_id: z.string().trim().min(1, 'Vehicle ID is required'),
    service_type: z.string().trim().min(1, 'Service type is required'),
    due_date: z.string().trim().optional().nullable(),
    due_odometer: z.coerce.number().positive('Due odometer must be positive').optional().nullable(),
    notes: z.string().trim().optional().nullable()
  })
};

const createRecordSchema = {
  body: z.object({
    vehicle_id: z.string().trim().min(1, 'Vehicle ID is required'),
    service_type: z.string().trim().min(1, 'Service type is required'),
    odometer: z.coerce.number().min(0, 'Odometer must be non-negative'),
    cost: z.coerce.number().min(0, 'Maintenance cost must be non-negative'),
    performed_by: z.string().trim().optional(),
    notes: z.string().trim().optional().nullable()
  })
};

const createFuelLogSchema = {
  body: z.object({
    vehicle_id: z.string().trim().min(1, 'Vehicle ID is required'),
    liters: z.coerce
      .number()
      .min(0.1, 'Liters must be at least 0.1')
      .max(1000, 'Liters cannot exceed 1000'),
    cost: z.coerce.number().positive('Fuel cost must be greater than zero'),
    odometer: z.coerce.number().positive('Odometer reading must be greater than zero'),
    logged_at: z.string().trim().optional().nullable()
  })
};

module.exports = {
  createScheduleSchema,
  createRecordSchema,
  createFuelLogSchema
};
