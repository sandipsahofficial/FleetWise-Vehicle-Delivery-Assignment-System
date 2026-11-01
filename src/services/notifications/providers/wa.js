class WhatsAppProvider {
  async send(_to, _text) {
    // WhatsApp Business API provider stub (Meta Cloud API / Twilio WhatsApp)
    return { provider: 'whatsapp', status: 'sent', messageId: `wa-${Date.now()}` };
  }
}

module.exports = new WhatsAppProvider();
