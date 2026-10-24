import assert from 'node:assert/strict';
import test from 'node:test';
import { SYSTEM_PROMPT } from '../src/agent/prompt.js';
import { buildToolRegistry } from '../src/tools/build.js';
import type { CalendarEvent, CalendarGateway, CalendarList } from '../src/google/calendar-gateway.js';
import { DryRunEmailGateway } from '../src/email/gateway.js';
import { silentLogger } from '../src/log.js';

function calendarThatThrows(): CalendarGateway {
  const fail = async () => {
    throw new Error('rede');
  };
  return {
    listEvents: fail,
    createEvent: fail,
    updateEvent: fail,
    deleteEvent: fail,
  };
}

function registry() {
  return buildToolRegistry({
    calendar: calendarThatThrows(),
    email: new DryRunEmailGateway(silentLogger),
    timeZone: 'UTC',
    now: () => new Date('2026-05-01T15:04:00.000Z'),
  });
}

test('getTodayDate usa o fuso configurado e nao chama a rede', async () => {
  const outcome = await registry().execute('getTodayDate', {});
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.deepEqual(outcome.data, {
    date: '2026-05-01',
    time: '15:04',
    weekday: 'sexta-feira',
    timeZone: 'UTC',
    iso: '2026-05-01T15:04:00.000Z',
  });
});

test('rejeita data, horario e e-mail invalidos antes de chamar o calendario', async () => {
  const tools = registry();
  const listed = await tools.execute('listEvents', { date: '01/05/2026' });
  const created = await tools.execute('createEvent', {
    title: 'Planejamento',
    date: '2026-05-01',
    time: '15h',
    attendees: ['nao-e-email'],
  });
  const updated = await tools.execute('updateEvent', { eventId: 'abc' });

  assert.equal(listed.ok, false);
  assert.equal(created.ok, false);
  assert.equal(updated.ok, false);
  if (!listed.ok) assert.match(listed.error, /AAAA-MM-DD/);
  if (!created.ok) assert.match(created.error, /HH:mm|e-mail/);
  if (!updated.ok) assert.match(updated.error, /ao menos um campo/);
});

test('listEvents de um intervalo chama o calendario uma unica vez', async () => {
  const calls: Array<{ startDate: string; endDate: string; timeZone: string }> = [];
  const event: CalendarEvent = {
    id: 'evt-1',
    title: 'Almoco',
    date: '2026-05-03',
    time: '12:00',
    endTime: '13:00',
    allDay: false,
    timeZone: 'America/Sao_Paulo',
    attendees: [],
  };
  const calendar: CalendarGateway = {
    ...calendarThatThrows(),
    async listEvents(input): Promise<CalendarList> {
      calls.push(input);
      return { events: [event], truncated: false };
    },
  };
  const tools = buildToolRegistry({
    calendar,
    email: new DryRunEmailGateway(silentLogger),
    timeZone: 'America/Sao_Paulo',
    now: () => new Date('2026-05-01T15:04:00.000Z'),
  });

  const ranged = await tools.execute('listEvents', { timeMin: '2026-05-01', timeMax: '2026-05-07' });
  const single = await tools.execute('listEvents', { date: '2026-05-01' });
  const mixed = await tools.execute('listEvents', { date: '2026-05-01', timeMin: '2026-05-01', timeMax: '2026-05-07' });
  const backwards = await tools.execute('listEvents', { timeMin: '2026-05-07', timeMax: '2026-05-01' });
  const tooLong = await tools.execute('listEvents', { timeMin: '2026-05-01', timeMax: '2026-06-01' });
  const empty = await tools.execute('listEvents', {});

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], { startDate: '2026-05-01', endDate: '2026-05-07', timeZone: 'America/Sao_Paulo' });
  assert.deepEqual(calls[1], { startDate: '2026-05-01', endDate: '2026-05-01', timeZone: 'America/Sao_Paulo' });
  assert.equal(ranged.ok, true);
  if (ranged.ok) {
    const data = ranged.data as { startDate: string; endDate: string; events: CalendarEvent[] };
    assert.equal(data.startDate, '2026-05-01');
    assert.equal(data.endDate, '2026-05-07');
    assert.equal(data.events[0]?.id, 'evt-1');
  }
  assert.equal(single.ok, true);
  assert.equal(mixed.ok, false);
  assert.equal(backwards.ok, false);
  assert.equal(tooLong.ok, false);
  assert.equal(empty.ok, false);
  if (!mixed.ok) assert.match(mixed.error, /Não misture/);
  if (!backwards.ok) assert.match(backwards.error, /anterior/);
  if (!tooLong.ok) assert.match(tooLong.error, /31 dias/);
  if (!empty.ok) assert.match(empty.error, /única chamada/);
});

test('o prompt e a descricao de listEvents pedem uma chamada para o intervalo', () => {
  assert.match(SYSTEM_PROMPT, /timeMin 2026-05-01 e timeMax 2026-05-07/);
  assert.match(SYSTEM_PROMPT, /Não chame listEvents um dia de cada vez/);
  const listEvents = registry().list().find((tool) => tool.name === 'listEvents');
  assert.match(listEvents?.description ?? '', /única chamada/);
  assert.match(listEvents?.description ?? '', /Não chame esta ferramenta uma vez por dia/);
  const schema = registry().declarations().find((item) => item.name === 'listEvents')?.parametersJsonSchema as {
    properties?: Record<string, { description?: string }>;
    required?: string[];
  };
  assert.ok(schema.properties?.date);
  assert.ok(schema.properties?.timeMin);
  assert.ok(schema.properties?.timeMax);
  assert.equal(schema.required?.includes('date') ?? false, false);
  assert.match(schema.properties?.timeMax?.description ?? '', /2026-05-07/);
});

test('declaracoes das ferramentas saem do esquema Zod', () => {
  const declarations = registry().declarations();
  const names = declarations.map((item) => item.name);
  assert.deepEqual(names, [
    'getTodayDate',
    'listEvents',
    'createEvent',
    'updateEvent',
    'deleteEvent',
    'listEmails',
    'sendEmail',
  ]);
  const createEvent = declarations.find((item) => item.name === 'createEvent');
  const schema = createEvent?.parametersJsonSchema as { properties?: Record<string, unknown>; required?: string[] };
  assert.ok(schema.properties?.title);
  assert.ok(schema.required?.includes('title'));
  assert.ok(schema.required?.includes('date'));
});
