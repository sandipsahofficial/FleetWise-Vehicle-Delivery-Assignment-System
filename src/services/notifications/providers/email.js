const nodemailer = require('nodemailer');
const config = require('../../../config');
const logger = require('../../../utils/logger');

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function sanitizeHeader(str) {
  if (!str) return '';
  // Strip CR and LF to prevent email header injection
  return String(str).replace(/[\r\n]+/g, ' ').trim();
}

class EmailProvider {
  constructor() {
    this.providerType = config.notifications.provider;
    this.transporter = null;

    if (this.providerType === 'smtp') {
      this.transporter = nodemailer.createTransport({
        host: config.notifications.smtp.host,
        port: config.notifications.smtp.port,
        secure: config.notifications.smtp.secure,
        auth: {
          user: config.notifications.smtp.auth.user,
          pass: config.notifications.smtp.auth.pass
        }
      });
    }
  }

  /**
   * Sends an email notification.
   * In console/dev mode, logs ONLY event type and status. Never logs message content, OTP, or PII.
   */
  async send({ to, subject, htmlText, text, event }) {
    const cleanTo = sanitizeHeader(to);
    const cleanSubject = sanitizeHeader(subject);

    if (this.providerType === 'console' || config.isTest) {
      // Mask recipient email domain for privacy (e.g. j***@domain.com)
      const atIdx = cleanTo.indexOf('@');
      const maskedTo = atIdx > 1 ? `${cleanTo[0]}***${cleanTo.slice(atIdx)}` : 'recipient';
      logger.info({ event, channel: 'email', recipient: maskedTo, status: 'sent' }, 'Notification dispatched via console provider');
      return { success: true, messageId: `mock-msg-${Date.now()}` };
    }

    if (!this.transporter) {
      throw new Error('SMTP transporter is not initialized');
    }

    const info = await this.transporter.sendMail({
      from: config.notifications.smtp.from,
      to: cleanTo,
      subject: cleanSubject,
      text: text || '',
      html: htmlText || ''
    });

    return { success: true, messageId: info.messageId };
  }
}

module.exports = new EmailProvider();
module.exports.EmailProvider = EmailProvider;
module.exports.escapeHtml = escapeHtml;
module.exports.sanitizeHeader = sanitizeHeader;
