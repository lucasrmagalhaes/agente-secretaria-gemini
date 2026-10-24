import { google } from 'googleapis';
import type { Logger } from '../log.js';
import type { OAuth2Client } from '../google/auth.js';

export interface EmailMessage {
  id: string;
  from: string;
  to: string;
  subject: string;
  snippet: string;
  date: string;
}

export interface EmailGateway {
  listEmails(input: { maxResults: number; query?: string }): Promise<{
    dryRun: boolean;
    messages: EmailMessage[];
  }>;
  sendEmail(input: { to: string; subject: string; message: string }): Promise<{
    dryRun: boolean;
    sent: boolean;
    to: string;
    subject: string;
    message: string;
    id?: string;
    note: string;
  }>;
}

const SAMPLE_INBOX: EmailMessage[] = [
  {
    id: 'dry-1',
    from: 'mae@example.com',
    to: 'eu@example.com',
    subject: 'Jantar de domingo',
    snippet: 'Voce vem no domingo?',
    date: '2026-05-01T12:00:00.000Z',
  },
  {
    id: 'dry-2',
    from: 'camila@example.com',
    to: 'eu@example.com',
    subject: 'Reuniao de planejamento',
    snippet: 'Podemos confirmar o horario?',
    date: '2026-05-02T15:00:00.000Z',
  },
];

export class DryRunEmailGateway implements EmailGateway {
  private readonly inbox: EmailMessage[];
  private sequence = 0;

  constructor(
    private readonly logger: Logger,
    seed: EmailMessage[] = SAMPLE_INBOX,
  ) {
    this.inbox = seed.map((message) => ({ ...message }));
  }

  async listEmails(input: { maxResults: number; query?: string }) {
    const query = input.query?.trim().toLowerCase();
    const messages = this.inbox
      .filter((message) => {
        if (!query) return true;
        const haystack = `${message.from} ${message.to} ${message.subject} ${message.snippet}`.toLowerCase();
        return haystack.includes(query);
      })
      .slice(-input.maxResults)
      .reverse();
    return { dryRun: true, messages };
  }

  async sendEmail(input: { to: string; subject: string; message: string }) {
    this.sequence += 1;
    const stored: EmailMessage = {
      id: `dry-sent-${this.sequence}`,
      from: 'eu@example.com',
      to: input.to,
      subject: input.subject,
      snippet: input.message.slice(0, 160),
      date: new Date().toISOString(),
    };
    this.inbox.push(stored);
    this.logger.info(
      [
        '[dry-run] E-mail não enviado.',
        `Para: ${input.to}`,
        `Assunto: ${input.subject}`,
        `Mensagem: ${input.message}`,
      ].join('\n'),
    );
    return {
      dryRun: true,
      sent: false,
      to: input.to,
      subject: input.subject,
      message: input.message,
      id: stored.id,
      note: 'E-mail não enviado. EMAIL_MODE está em dry-run. Defina EMAIL_MODE=gmail e rode npm run auth para enviar de verdade.',
    };
  }
}

export class GmailGateway implements EmailGateway {
  constructor(private readonly getClient: () => Promise<OAuth2Client>) {}

  async listEmails(input: { maxResults: number; query?: string }) {
    const gmail = google.gmail({ version: 'v1', auth: await this.getClient() });
    const list = await gmail.users.messages.list({
      userId: 'me',
      maxResults: input.maxResults,
      q: input.query,
    });
    const messages: EmailMessage[] = [];
    for (const item of list.data.messages ?? []) {
      if (!item.id) continue;
      const full = await gmail.users.messages.get({
        userId: 'me',
        id: item.id,
        format: 'metadata',
        metadataHeaders: ['From', 'To', 'Subject', 'Date'],
      });
      const headers = full.data.payload?.headers ?? [];
      const header = (name: string) =>
        headers.find((entry) => entry.name?.toLowerCase() === name.toLowerCase())?.value ?? '';
      messages.push({
        id: item.id,
        from: header('From'),
        to: header('To'),
        subject: header('Subject'),
        snippet: full.data.snippet ?? '',
        date: header('Date'),
      });
    }
    return { dryRun: false, messages };
  }

  async sendEmail(input: { to: string; subject: string; message: string }) {
    const gmail = google.gmail({ version: 'v1', auth: await this.getClient() });
    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: encodeRawEmail(input) },
    });
    return {
      dryRun: false,
      sent: true,
      to: input.to,
      subject: input.subject,
      message: input.message,
      ...(response.data.id ? { id: response.data.id } : {}),
      note: 'E-mail enviado pela API do Gmail.',
    };
  }
}

function encodeRawEmail(input: { to: string; subject: string; message: string }): string {
  const lines = [
    `To: ${input.to}`,
    `Subject: ${encodeHeader(input.subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    input.message,
  ];
  return Buffer.from(lines.join('\r\n'), 'utf8').toString('base64url');
}

function encodeHeader(value: string): string {
  const ascii = [...value].every((char) => {
    const code = char.charCodeAt(0);
    return code >= 32 && code <= 126;
  });
  if (ascii) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}
