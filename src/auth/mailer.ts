import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Abstraction over the email transport so tests can use a mock. */
export interface Mailer {
  sendMail(mail: EmailMessage): Promise<unknown>;
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
  from: string;
}

/** Read SMTP configuration from environment variables. */
export function smtpConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SmtpConfig {
  return {
    host: env.SMTP_HOST ?? 'localhost',
    port: Number(env.SMTP_PORT ?? 587),
    secure: env.SMTP_SECURE === 'true',
    user: env.SMTP_USER,
    password: env.SMTP_PASSWORD,
    from: env.SMTP_FROM ?? 'no-reply@kibrain.local',
  };
}

/**
 * SMTP-backed mailer (nodemailer). An optional transporter can be injected for
 * tests (e.g. nodemailer's `jsonTransport` acts as a mock SMTP).
 */
export function createSmtpMailer(config: SmtpConfig, transporter?: Transporter): Mailer {
  const transport =
    transporter ??
    nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.user ? { user: config.user, pass: config.password } : undefined,
    });

  return {
    async sendMail(mail) {
      return transport.sendMail({
        from: config.from,
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      });
    },
  };
}
