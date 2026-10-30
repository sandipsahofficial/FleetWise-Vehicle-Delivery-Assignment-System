const { z } = require('zod');

const registerSchema = {
  body: z.object({
    username: z.string().trim().min(3, 'Username must be at least 3 characters').max(50),
    password: z.string().min(8, 'Password must be at least 8 characters').max(100),
    role: z.enum(['admin', 'dispatcher', 'driver', 'fleet_manager']).default('dispatcher'),
    driver_id: z.string().trim().nullable().optional()
  })
};

const loginSchema = {
  body: z.object({
    username: z.string().trim().min(1, 'Username is required'),
    password: z.string().min(1, 'Password is required')
  })
};

const refreshSchema = {
  body: z.object({
    refreshToken: z.string().trim().min(1, 'Refresh token is required')
  })
};

module.exports = {
  registerSchema,
  loginSchema,
  refreshSchema
};

