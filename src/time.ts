interface ZonedParts {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
}

export function formatDate(date: Date, timeZone: string): string {
  const parts = zonedParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function formatTime(date: Date, timeZone: string): string {
  const parts = zonedParts(date, timeZone);
  return `${parts.hour}:${parts.minute}`;
}

export function formatWeekday(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone, weekday: 'long' }).format(date);
}

export function addDays(date: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error('Data invalida. Use AAAA-MM-DD.');
  const utc = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

/** Adds minutes on the wall clock, without converting time zones. */
export function addMinutesWallClock(date: string, time: string, minutes: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match || !timeMatch) throw new Error('Data ou horario invalido.');

  const total = Number(timeMatch[1]) * 60 + Number(timeMatch[2]) + minutes;
  const dayDelta = Math.floor(total / 1440);
  const remainder = total - dayDelta * 1440;
  const nextDate = addDays(date, dayDelta);
  const hour = String(Math.floor(remainder / 60)).padStart(2, '0');
  const minute = String(remainder % 60).padStart(2, '0');
  return `${nextDate}T${hour}:${minute}:00`;
}

/** Inclusive calendar dates. timeMax is the UTC instant of the next local midnight. */
export function dateSpanIso(
  startDate: string,
  endDateInclusive: string,
  timeZone: string,
): { timeMin: string; timeMax: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDateInclusive)) {
    throw new Error('Data invalida. Use AAAA-MM-DD.');
  }
  if (endDateInclusive < startDate) {
    throw new Error('timeMax nao pode ser anterior a timeMin.');
  }
  const start = zonedTimeToUtc(`${startDate}T00:00:00`, timeZone);
  const end = zonedTimeToUtc(`${addDays(endDateInclusive, 1)}T00:00:00`, timeZone);
  return { timeMin: start.toISOString(), timeMax: end.toISOString() };
}

export function inclusiveDayCount(startDate: string, endDateInclusive: string): number {
  const start = utcDate(startDate);
  const end = utcDate(endDateInclusive);
  return Math.round((end - start) / 86_400_000) + 1;
}

export function dayRangeIso(date: string, timeZone: string): { timeMin: string; timeMax: string } {
  return dateSpanIso(date, date, timeZone);
}

function utcDate(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error('Data invalida. Use AAAA-MM-DD.');
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

export function zonedTimeToUtc(localDateTime: string, timeZone: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(localDateTime);
  if (!match) throw new Error('Data invalida.');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  const offset = timeZoneOffsetMs(new Date(utcGuess), timeZone);
  let instant = utcGuess - offset;
  const offsetAtInstant = timeZoneOffsetMs(new Date(instant), timeZone);
  if (offsetAtInstant !== offset) {
    instant = utcGuess - offsetAtInstant;
  }
  return new Date(instant);
}

export function durationMinutes(startIso: string, endIso: string): number {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  const minutes = Math.round(ms / 60000);
  return minutes > 0 ? minutes : 60;
}

function zonedParts(date: Date, timeZone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const map: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  return {
    year: map.year ?? '0000',
    month: map.month ?? '01',
    day: map.day ?? '01',
    hour: map.hour === '24' ? '00' : (map.hour ?? '00'),
    minute: map.minute ?? '00',
    second: map.second ?? '00',
  };
}

function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = zonedParts(date, timeZone);
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - date.getTime();
}
