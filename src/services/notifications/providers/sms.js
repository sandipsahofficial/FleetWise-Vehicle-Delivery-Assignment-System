class SmsProvider {
  async send(_to, _text) {
    // SMS provider integration stub (Twilio / AWS SNS / Vonage)
    return { provider: 'sms', status: 'sent', messageId: `sms-${Date.now()}` };
  }
}

module.exports = new SmsProvider();
