import { google, type calendar_v3 } from 'googleapis';
import { addDays, addMinutesWallClock, dateSpanIso, durationMinutes, formatDate, formatTime } from '../time.js';
import type { OAuth2Client } from './auth.js';
import type { CalendarEvent, CalendarGateway } from './calendar-gateway.js';

export function createGoogleCalendarGateway(
  calendarId: string,
  getClient: () => Promise<OAuth2Client>,
): CalendarGateway {

  return {
    async listEvents(input) {
      try {
        const calendar = google.calendar({ version: 'v3', auth: await getClient() });
        const range = dateSpanIso(input.startDate, input.endDate, input.timeZone);
        const response = await calendar.events.list({
          calendarId,
          timeMin: range.timeMin,
          timeMax: range.timeMax,
          singleEvents: true,
          orderBy: 'startTime',
          maxResults: 250,
        });
        const events = (response.data.items ?? [])
          .map((item) => mapEvent(item, input.timeZone))
          .filter((item): item is CalendarEvent => item !== null);
        return { events, truncated: Boolean(response.data.nextPageToken) };
      } catch (error) {
        throw new Error(googleErrorMessage(error, 'Nao foi possivel listar os eventos.'), { cause: error });
      }
    },

    async createEvent(input) {
      try {
        const calendar = google.calendar({ version: 'v3', auth: await getClient() });
        const end = addMinutesWallClock(input.date, input.time, input.durationMinutes);
        const response = await calendar.events.insert({
          calendarId,
          sendUpdates: 'none',
          requestBody: {
            summary: input.title,
            description: input.description,
            start: { dateTime: `${input.date}T${input.time}:00`, timeZone: input.timeZone },
            end: { dateTime: end, timeZone: input.timeZone },
            attendees: input.attendees.map((email) => ({ email })),
          },
        });
        const event = mapEvent(response.data, input.timeZone);
        if (!event) throw new Error('O Google Calendar nao devolveu o evento criado.');
        return event;
      } catch (error) {
        throw new Error(googleErrorMessage(error, 'Nao foi possivel criar o evento.'), { cause: error });
      }
    },

    async updateEvent(input) {
      try {
        const calendar = google.calendar({ version: 'v3', auth: await getClient() });
        const current = await calendar.events.get({ calendarId, eventId: input.eventId });
        const requestBody = buildPatch(current.data, input);
        const response = await calendar.events.patch({
          calendarId,
          eventId: input.eventId,
          sendUpdates: 'none',
          requestBody,
        });
        const event = mapEvent(response.data, input.timeZone);
        if (!event) throw new Error('O Google Calendar nao devolveu o evento atualizado.');
        return event;
      } catch (error) {
        throw new Error(googleErrorMessage(error, 'Nao foi possivel atualizar o evento.'), { cause: error });
      }
    },

    async deleteEvent(input) {
      try {
        const calendar = google.calendar({ version: 'v3', auth: await getClient() });
        await calendar.events.delete({
          calendarId,
          eventId: input.eventId,
          sendUpdates: 'none',
        });
        return { eventId: input.eventId, deleted: true };
      } catch (error) {
        throw new Error(googleErrorMessage(error, 'Nao foi possivel apagar o evento.'), { cause: error });
      }
    },
  };
}

function buildPatch(
  current: calendar_v3.Schema$Event,
  input: {
    title?: string;
    date?: string;
    time?: string;
    durationMinutes?: number;
    attendees?: string[];
    description?: string;
    timeZone: string;
  },
): calendar_v3.Schema$Event {
  const patch: calendar_v3.Schema$Event = {};
  if (input.title) patch.summary = input.title;
  if (input.description !== undefined) patch.description = input.description;
  if (input.attendees) patch.attendees = input.attendees.map((email) => ({ email }));

  const scheduleChanges = input.date !== undefined || input.time !== undefined || input.durationMinutes !== undefined;
  if (!scheduleChanges) return patch;

  const allDay = Boolean(current.start?.date && !current.start.dateTime);
  if (allDay && input.date && input.time === undefined && input.durationMinutes === undefined) {
    patch.start = { date: input.date };
    patch.end = { date: addDays(input.date, 1) };
    return patch;
  }

  const currentDate = allDay
    ? (current.start?.date ?? input.date ?? '')
    : formatDate(new Date(current.start?.dateTime ?? Date.now()), input.timeZone);
  const currentTime = allDay ? '09:00' : formatTime(new Date(current.start?.dateTime ?? Date.now()), input.timeZone);
  const date = input.date ?? currentDate;
  const time = input.time ?? currentTime;
  const duration =
    input.durationMinutes ??
    (allDay || !current.start?.dateTime || !current.end?.dateTime
      ? 60
      : durationMinutes(current.start.dateTime, current.end.dateTime));

  patch.start = { dateTime: `${date}T${time}:00`, timeZone: input.timeZone };
  patch.end = { dateTime: addMinutesWallClock(date, time, duration), timeZone: input.timeZone };
  return patch;
}

function mapEvent(item: calendar_v3.Schema$Event, timeZone: string): CalendarEvent | null {
  if (!item.id) return null;
  const allDay = Boolean(item.start?.date && !item.start.dateTime);
  const startIso = item.start?.dateTime;
  const endIso = item.end?.dateTime;
  return {
    id: item.id,
    title: item.summary ?? '(sem titulo)',
    date: allDay ? (item.start?.date ?? '') : formatDate(new Date(startIso ?? Date.now()), timeZone),
    time: allDay || !startIso ? null : formatTime(new Date(startIso), timeZone),
    endTime: allDay || !endIso ? null : formatTime(new Date(endIso), timeZone),
    allDay,
    timeZone: item.start?.timeZone ?? timeZone,
    attendees: (item.attendees ?? []).flatMap((person) => (person.email ? [person.email] : [])),
    ...(item.description ? { description: item.description } : {}),
    ...(item.htmlLink ? { link: item.htmlLink } : {}),
  };
}

function googleErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null) {
    const candidate = error as {
      code?: number | string;
      message?: string;
      response?: { status?: number; data?: { error?: { message?: string } } };
    };
    const status = candidate.response?.status ?? Number(candidate.code);
    if (status === 404) return 'Evento nao encontrado.';
    if (status === 401 || status === 403) {
      return 'O Google recusou o acesso. Rode npm run auth novamente.';
    }
    const apiMessage = candidate.response?.data?.error?.message;
    if (apiMessage) return apiMessage;
    if (error instanceof Error && error.message.startsWith('Defina GOOGLE_')) return error.message;
    if (error instanceof Error && error.message.startsWith('Token nao encontrado')) return error.message;
    if (error instanceof Error && error.message.startsWith('O token nao tem')) return error.message;
    if (error instanceof Error && error.message.startsWith('Arquivo de credenciais')) return error.message;
  }
  if (error instanceof Error) return error.message;
  return fallback;
}
