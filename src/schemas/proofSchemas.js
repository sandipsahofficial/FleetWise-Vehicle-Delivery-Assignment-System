const { z } = require('zod');

const completeOtpSchema = {
  body: z.object({
    otp: z.string().trim().regex(/^\d{6}$/, 'OTP must be exactly 6 numeric digits'),
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional()
  })
};

const completePhotoSchema = {
  body: z.object({
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional()
  })
};

const overrideStatusSchema = {
  body: z.object({
    status: z.enum(['pending', 'assigned', 'in_transit', 'delivered', 'cancelled']),
    reason: z.string().trim().min(3, 'Override reason is required for status transitions').optional()
  })
};

module.exports = {
  completeOtpSchema,
  completePhotoSchema,
  overrideStatusSchema
};
