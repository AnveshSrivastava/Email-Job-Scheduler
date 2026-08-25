export interface SendEmailPayload {
  from: string;
  to: string;
  subject: string;
  body: string;
}

export interface SendEmailResult {
  messageId?: string;
  success: boolean;
  error?: string;
}

export interface IEmailSender {
  send(payload: SendEmailPayload): Promise<SendEmailResult>;
}
