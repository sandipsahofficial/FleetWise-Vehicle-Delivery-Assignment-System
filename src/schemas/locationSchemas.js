const { z } = require('zod');

// Validate coordinate boundaries & reasonable timestamp freshness
const locationUpdateSchema = {
  body: z.object({
    lat: z.coerce.number().min(-90, 'Latitude must be between -90 and 90').max(90, 'Latitude must be between -90 and 90'),
    lng: z.coerce.number().min(-180, 'Longitude must be between -180 and 180').max(180, 'Longitude must be between -180 and 180'),
    speed: z.coerce.number().min(0, 'Speed must be non-negative').max(300, 'Speed unrealistic').optional().default(0),
    heading: z.coerce.number().min(0).max(360).optional().default(0),
    timestamp: z.string().optional().refine((val) => {
      if (!val) return true;
      const time = new Date(val).getTime();
      if (isNaN(time)) return false;
      const now = Date.now();
      // Reject stale (> 24 hours in past) or future (> 5 minutes in future) timestamps
      if (time < now - 24 * 60 * 60 * 1000) return false;
      if (time > now + 5 * 60 * 1000) return false;
      return true;
    }, { message: 'Timestamp cannot be older than 24 hours or in the future' })
  })
};

module.exports = {
  locationUpdateSchema
};

