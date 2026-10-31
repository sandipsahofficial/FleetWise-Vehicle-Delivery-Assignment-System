const logger = require('../../../utils/logger');

class SmsProvider {
  async send({ to, text, event }) {
    logger.info({ event, channel: 'sms', status: 'stub_noop' }, 'SMS provider stub: message not sent via external gateway');
    return { success: true, stub: true };
  }
}

module.exports = new SmsProvider();
