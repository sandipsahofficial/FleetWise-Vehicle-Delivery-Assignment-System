const auditRepository = require('../repositories/auditRepository');

class AuditService {
  log(entry) {
    try {
      return auditRepository.createLog(entry);
    } catch (err) {
      console.error('[AuditService] Failed to record audit log:', err);
      return null;
    }
  }

  getLogs(filters = {}) {
    return auditRepository.findAll(filters);
  }
}

module.exports = new AuditService();

