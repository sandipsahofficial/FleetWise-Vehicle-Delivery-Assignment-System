const notificationRepository = require('../../repositories/notificationRepository');
const notificationService = require('../notificationService');
const logger = require('../../utils/logger');
const config = require('../../config');

class OutboxWorker {
  constructor(batchSize = 10) {
    this.batchSize = batchSize;
    this.timer = null;
    this.isRunning = false;
  }

  /**
   * Deterministic processing cycle.
   * Can be injected and triggered manually by tests without real timers.
   */
  async tick() {
    if (!config.notifications.enabled) {
      return { processed: 0, sent: 0, failed: 0 };
    }

    let batch = [];
    try {
      batch = notificationRepository.claimBatch(this.batchSize);
    } catch (err) {
      logger.error({ error: err.message }, 'Failed to claim outbox batch from database');
      return { processed: 0, sent: 0, failed: 0 };
    }

    if (batch.length === 0) {
      return { processed: 0, sent: 0, failed: 0 };
    }

    let sent = 0;
    let failed = 0;

    for (const entry of batch) {
      try {
        await notificationService.processOutboxEntry(entry);
        notificationRepository.markSent(entry.id);
        sent++;
      } catch (err) {
        // Exponential backoff: 60s, 120s, 240s...
        const delaySeconds = Math.pow(2, entry.attempts || 0) * 60;
        notificationRepository.markFailed(entry.id, err.message, delaySeconds);
        failed++;
        logger.warn({ error: err.message, notificationId: entry.id }, 'Outbox notification delivery failed; scheduled retry');
      }
    }

    return { processed: batch.length, sent, failed };
  }

  start(intervalMs = 10000) {
    if (this.isRunning) return;
    this.isRunning = true;

    // Prune old rows on startup
    try {
      notificationRepository.pruneOldOutbox(30);
    } catch (_) {}

    // Only run continuous background timer outside test runner
    if (!config.isTest) {
      this.timer = setInterval(async () => {
        try {
          await this.tick();
        } catch (err) {
          logger.error({ error: err.message }, 'Unhandled error in OutboxWorker tick loop');
        }
      }, intervalMs);

      // Unref timer so it doesn't prevent Node process from exiting
      if (this.timer && typeof this.timer.unref === 'function') {
        this.timer.unref();
      }
    }
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
  }
}

module.exports = new OutboxWorker();
module.exports.OutboxWorker = OutboxWorker;
