import assert from 'node:assert/strict';
import test from 'node:test';
import { DryRunEmailGateway } from '../src/email/gateway.js';
import type { Logger } from '../src/log.js';
import { addDays, addMinutesWallClock, dayRangeIso, formatDate, formatTime } from '../src/time.js';

test('converte o dia local de Sao Paulo para UTC', () => {
  const range = dayRangeIso('2026-05-01', 'America/Sao_Paulo');
  assert.equal(range.timeMin, '2026-05-01T03:00:00.000Z');
  assert.equal(range.timeMax, '2026-05-02T03:00:00.000Z');
  assert.equal(formatDate(new Date('2026-05-01T02:30:00.000Z'), 'America/Sao_Paulo'), '2026-04-30');
  assert.equal(formatTime(new Date('2026-05-01T02:30:00.000Z'), 'America/Sao_Paulo'), '23:30');
});

test('soma minutos no relogio de parede e atravessa o dia', () => {
  assert.equal(addMinutesWallClock('2026-05-01', '23:30', 90), '2026-05-02T01:00:00');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('dry-run imprime o e-mail e nao marca como enviado', async () => {
  const lines: string[] = [];
  const logger: Logger = {
    info(message) {
      lines.push(message);
    },
    error(message) {
      lines.push(message);
    },
  };
  const email = new DryRunEmailGateway(logger);
  const sent = await email.sendEmail({
    to: 'ana@example.com',
    subject: 'Horario novo',
    message: 'O almoco foi para as 15:00.',
  });
  const listed = await email.listEmails({ maxResults: 10, query: 'ana@example.com' });

  assert.equal(sent.sent, false);
  assert.equal(sent.dryRun, true);
  assert.match(lines.join('\n'), /\[dry-run\] E-mail não enviado/);
  assert.equal(listed.messages.some((message) => message.to === 'ana@example.com'), true);
});
