const { z } = require('zod');
const { BadRequestError } = require('../utils/errors');

/**
 * Zod request validation middleware generator.
 * @param {object} schemas Object containing optional body, query, and params schemas.
 */
function validate(schemas = {}) {
  return (req, res, next) => {
    try {
      if (schemas.body) {
        req.body = schemas.body.parse(req.body || {});
      }
      if (schemas.query) {
        req.query = schemas.query.parse(req.query || {});
      }
      if (schemas.params) {
        req.params = schemas.params.parse(req.params || {});
      }
      next();
    } catch (err) {
      if (err instanceof z.ZodError) {
        const msg = err.issues.map(i => `${i.path.join('.') || 'root'}: ${i.message}`).join('; ');
        const badReqError = new BadRequestError(`Validation error: ${msg}`);
        badReqError.details = err.issues;
        return next(badReqError);
      }
      next(err);
    }
  };
}

module.exports = {
  validate
};

