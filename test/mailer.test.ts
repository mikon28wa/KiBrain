import nodemailer from 'nodemailer';
import { describe, expect, it } from 'vitest';
import { createSmtpMailer, smtpConfigFromEnv } from '../src/auth/mailer';

describe('smtpConfigFromEnv', () => {
  it('reads SMTP settings from environment variables', () => {
    const config = smtpConfigFromEnv({
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '465',
      SMTP_SECURE: 'true',
      SMTP_USER: 'user',
      SMTP_PASSWORD: 'pass',
      SMTP_FROM: 'from@example.com',
    });

    expect(config).toEqual({
      host: 'smtp.example.com',
      port: 465,
      secure: true,
      user: 'user',
      password: 'pass',
      from: 'from@example.com',
    });
  });
});

describe('SmtpMailer (mock SMTP via nodemailer jsonTransport)', () => {
  it('sends a password-reset email with correct from/to/subject/body', async () => {
    const transporter = nodemailer.createTransport({ jsonTransport: true });
    const mailer = createSmtpMailer(
      { host: 'smtp.example.com', port: 587, secure: false, from: 'no-reply@example.com' },
      transporter,
    );

    const result = (await mailer.sendMail({
      to: 'user@example.com',
      subject: 'Passwort zurücksetzen',
      text: 'Code: token-abc123',
    })) as { message: string };

    const json = JSON.parse(result.message);
    expect(json.from.address).toBe('no-reply@example.com');
    expect(json.to[0].address).toBe('user@example.com');
    expect(json.subject).toBe('Passwort zurücksetzen');
    expect(json.text).toContain('token-abc123');
  });
});
