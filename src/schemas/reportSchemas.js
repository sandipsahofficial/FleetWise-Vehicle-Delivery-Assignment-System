const { z } = require('zod');

const exportReportSchema = {
  query: z.object({
    start_date: z.string().trim().optional(),
    end_date: z.string().trim().optional(),
    format: z.enum(['csv', 'pdf']).optional()
  })
};

module.exports = {
  exportReportSchema
};

