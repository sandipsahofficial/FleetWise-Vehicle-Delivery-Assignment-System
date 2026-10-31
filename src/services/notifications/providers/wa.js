const logger = require('../../../utils/logger');

class WhatsAppProvider {
  async send({ to, text, event }) {
    logger.info({ event, channel: 'whatsapp', status: 'stub_noop' }, 'WhatsApp provider stub: message not sent via external gateway');
    return { success: true, stub: true };
  }
}

module.exports = new WhatsAppProvider();
