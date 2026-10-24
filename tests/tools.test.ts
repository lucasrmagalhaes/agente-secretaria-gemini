import assert from 'node:assert/strict';
import test from 'node:test';
import { buildToolRegistry } from '../src/tools/build.js';
import type { CalendarGateway } from '../src/google/calendar-gateway.js';
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
