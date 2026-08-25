import nodemailer from 'nodemailer';
import { config } from '../../config/env';
import { IEmailSender, SendEmailPayload, SendEmailResult } from './email.types';

export class SmtpClient implements IEmailSender {
  private transporter: nodemailer.Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      auth:
        config.SMTP_USER && config.SMTP_PASSWORD
          ? {
              user: config.SMTP_USER,
              pass: config.SMTP_PASSWORD,
            }
          : undefined,
    });
  }

  async send(payload: SendEmailPayload): Promise<SendEmailResult> {
    try {
      const info = await this.transporter.sendMail({
        from: payload.from,
        to: payload.to,
        subject: payload.subject,
        text: payload.body,
        // Ethereal usually displays HTML well, but keeping it text if body is simple text
      });

      return {
        success: true,
        messageId: info.messageId,
      };
    } catch (error) {
      console.error('SMTP Delivery failed', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown SMTP Error',
      };
    }
  }
}
