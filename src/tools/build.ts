import type { EmailMode } from '../config.js';
import { formatDate, formatTime, formatWeekday, inclusiveDayCount } from '../time.js';
import type { Logger } from '../log.js';
import { DryRunEmailGateway, GmailGateway, type EmailGateway } from '../email/gateway.js';
import type { CalendarGateway } from '../google/calendar-gateway.js';
import type { OAuth2Client } from '../google/auth.js';
import { createGoogleCalendarGateway } from '../google/calendar.js';
import {
  createEventSchema,
  deleteEventSchema,
  getTodayDateSchema,
  listEmailsSchema,
  listEventsSchema,
  sendEmailSchema,
  updateEventSchema,
} from './schemas.js';
import { defineTool, ToolRegistry } from './registry.js';

export interface ToolDeps {
  calendar: CalendarGateway;
  email: EmailGateway;
  timeZone: string;
  now?: () => Date;
}

export function buildToolRegistry(deps: ToolDeps): ToolRegistry {
  const now = deps.now ?? (() => new Date());

  return new ToolRegistry([
    defineTool({
      name: 'getTodayDate',
      description:
        'Retorna a data de hoje no formato AAAA-MM-DD, o horário e o dia da semana. Chame uma única vez antes de datas relativas. Para os próximos N dias, use esta data como timeMin de listEvents e calcule timeMax como hoje mais N-1 dias (sete dias contando hoje: se hoje é 2026-05-01, timeMax é 2026-05-07). Depois chame listEvents uma única vez.',
      schema: getTodayDateSchema,
      handler: async () => {
        const current = now();
        return {
          date: formatDate(current, deps.timeZone),
          time: formatTime(current, deps.timeZone),
          weekday: formatWeekday(current, deps.timeZone),
          timeZone: deps.timeZone,
          iso: current.toISOString(),
        };
      },
    }),
    defineTool({
      name: 'listEvents',
      description:
        'Lista eventos do Google Calendar em um dia ou em um intervalo, numa única chamada. Para um dia, informe date (AAAA-MM-DD). Para vários dias, informe timeMin e timeMax (AAAA-MM-DD, ambos inclusive) e não informe date. Os próximos 7 dias a partir de 2026-05-01 usam timeMin 2026-05-01 e timeMax 2026-05-07. Não chame esta ferramenta uma vez por dia. O intervalo máximo é de 31 dias.',
      schema: listEventsSchema,
      handler: async (args) => {
        const range = resolveListRange(args);
        const listed = await deps.calendar.listEvents({
          startDate: range.startDate,
          endDate: range.endDate,
          timeZone: deps.timeZone,
        });
        return {
          startDate: range.startDate,
          endDate: range.endDate,
          timeZone: deps.timeZone,
          truncated: listed.truncated,
          events: listed.events,
        };
      },
    }),
    defineTool({
      name: 'createEvent',
      description:
        'Cria um evento no Google Calendar. Não envia convite. Para avisar alguém, use sendEmail depois.',
      schema: createEventSchema,
      handler: async (args) => {
        const event = await deps.calendar.createEvent({
          title: args.title,
          date: args.date,
          time: args.time,
          durationMinutes: args.durationMinutes ?? 60,
          attendees: args.attendees ?? [],
          ...(args.description !== undefined ? { description: args.description } : {}),
          timeZone: deps.timeZone,
        });
        return { created: true, event };
      },
    }),
    defineTool({
      name: 'updateEvent',
      description:
        'Atualiza um evento existente pelo id retornado em listEvents. Informe ao menos um campo além do eventId. Serve para remarcar horário, data, título, duração, descrição ou convidados.',
      schema: updateEventSchema,
      handler: async (args) => {
        const changes = [args.title, args.date, args.time, args.durationMinutes, args.attendees, args.description];
        if (changes.every((value) => value === undefined)) {
          throw new Error('Informe ao menos um campo para alterar, além do eventId.');
        }
        const event = await deps.calendar.updateEvent({
          eventId: args.eventId,
          ...(args.title !== undefined ? { title: args.title } : {}),
          ...(args.date !== undefined ? { date: args.date } : {}),
          ...(args.time !== undefined ? { time: args.time } : {}),
          ...(args.durationMinutes !== undefined ? { durationMinutes: args.durationMinutes } : {}),
          ...(args.attendees !== undefined ? { attendees: args.attendees } : {}),
          ...(args.description !== undefined ? { description: args.description } : {}),
          timeZone: deps.timeZone,
        });
        return { updated: true, event };
      },
    }),
    defineTool({
      name: 'deleteEvent',
      description: 'Apaga um evento do Google Calendar pelo id retornado em listEvents.',
      schema: deleteEventSchema,
      handler: async (args) => deps.calendar.deleteEvent({ eventId: args.eventId }),
    }),
    defineTool({
      name: 'listEmails',
      description:
        'Lista e-mails. No modo dry-run, devolve uma caixa de exemplo desta sessão, inclusive os e-mails simulados. No modo gmail, lê a caixa de entrada real.',
      schema: listEmailsSchema,
      handler: async (args) =>
        deps.email.listEmails({
          maxResults: args.maxResults ?? 10,
          ...(args.query !== undefined ? { query: args.query } : {}),
        }),
    }),
    defineTool({
      name: 'sendEmail',
      description:
        'Envia um e-mail. No modo dry-run, apenas imprime a mensagem e não envia. No modo gmail, envia pela API do Gmail. O destinatário precisa ser um e-mail.',
      schema: sendEmailSchema,
      handler: async (args) =>
        deps.email.sendEmail({
          to: args.to,
          subject: args.subject ?? defaultSubject(args.message),
          message: args.message,
        }),
    }),
  ]);
}

export function createRuntimeTools(options: {
  config: { calendarId: string; timeZone: string; emailMode: EmailMode; credentialsPath?: string; tokenPath?: string };
  logger: Logger;
  getClient: () => Promise<OAuth2Client>;
  now?: () => Date;
}): ToolRegistry {
  const calendar = createGoogleCalendarGateway(options.config.calendarId, options.getClient);
  const email =
    options.config.emailMode === 'gmail'
      ? new GmailGateway(options.getClient)
      : new DryRunEmailGateway(options.logger);

  return buildToolRegistry({
    calendar,
    email,
    timeZone: options.config.timeZone,
    ...(options.now ? { now: options.now } : {}),
  });
}

const MAX_LIST_DAYS = 31;

export function resolveListRange(args: {
  date?: string;
  timeMin?: string;
  timeMax?: string;
}): { startDate: string; endDate: string } {
  const hasDate = args.date !== undefined;
  const hasMin = args.timeMin !== undefined;
  const hasMax = args.timeMax !== undefined;
  if (hasDate && (hasMin || hasMax)) {
    throw new Error('Use date para um dia, ou timeMin e timeMax para um intervalo. Não misture os dois.');
  }
  if (hasDate && args.date) {
    return { startDate: args.date, endDate: args.date };
  }
  if (hasMin && hasMax && args.timeMin && args.timeMax) {
    if (args.timeMax < args.timeMin) {
      throw new Error('timeMax não pode ser anterior a timeMin.');
    }
    if (inclusiveDayCount(args.timeMin, args.timeMax) > MAX_LIST_DAYS) {
      throw new Error('O intervalo pode ter no máximo 31 dias.');
    }
    return { startDate: args.timeMin, endDate: args.timeMax };
  }
  throw new Error(
    'Informe date para um dia, ou timeMin e timeMax juntos para o intervalo. Para vários dias, faça uma única chamada.',
  );
}

function defaultSubject(message: string): string {
  const line = message.split('\n')[0]?.trim() ?? 'Mensagem';
  const short = line.length > 80 ? `${line.slice(0, 77)}...` : line;
  return short || 'Mensagem da secretaria virtual';
}
