import { z } from 'zod';

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use AAAA-MM-DD.');
const timeSchema = z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:mm, 24 horas.');
const emailSchema = z.string().regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Informe um e-mail válido.');

export const getTodayDateSchema = z.object({}).describe('Sem parâmetros.');

export const listEventsSchema = z.object({
  date: dateSchema.describe('Dia consultado, no formato AAAA-MM-DD.'),
});

export const createEventSchema = z.object({
  title: z.string().min(1).max(200).describe('Título do evento.'),
  date: dateSchema.describe('Data do evento, no formato AAAA-MM-DD.'),
  time: timeSchema.describe('Horário de início, no formato HH:mm.'),
  durationMinutes: z
    .number()
    .int()
    .min(1)
    .max(1440)
    .optional()
    .describe('Duração em minutos. Padrão: 60.'),
  attendees: z.array(emailSchema).optional().describe('E-mails dos convidados.'),
  description: z.string().max(2000).optional().describe('Descrição opcional.'),
});

export const updateEventSchema = z.object({
  eventId: z.string().min(1).describe('Id do evento, obtido em listEvents.'),
  title: z.string().min(1).max(200).optional().describe('Novo título.'),
  date: dateSchema.optional().describe('Nova data, no formato AAAA-MM-DD.'),
  time: timeSchema.optional().describe('Novo horário, no formato HH:mm.'),
  durationMinutes: z
    .number()
    .int()
    .min(1)
    .max(1440)
    .optional()
    .describe('Nova duração em minutos.'),
  attendees: z.array(emailSchema).optional().describe('Nova lista de e-mails. Substitui a anterior.'),
  description: z.string().max(2000).optional().describe('Nova descrição.'),
});

export const deleteEventSchema = z.object({
  eventId: z.string().min(1).describe('Id do evento, obtido em listEvents.'),
});

export const listEmailsSchema = z.object({
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe('Quantidade máxima de e-mails. Padrão: 10.'),
  query: z.string().max(200).optional().describe('Filtro livre. No Gmail, usa a sintaxe de busca do Gmail.'),
});

export const sendEmailSchema = z.object({
  to: emailSchema.describe('E-mail do destinatário.'),
  subject: z.string().min(1).max(200).optional().describe('Assunto. Se omitido, um assunto curto é gerado.'),
  message: z.string().min(1).max(5000).describe('Corpo do e-mail, em texto.'),
});

export type ListEventsArgs = z.infer<typeof listEventsSchema>;
export type CreateEventArgs = z.infer<typeof createEventSchema>;
export type UpdateEventArgs = z.infer<typeof updateEventSchema>;
export type DeleteEventArgs = z.infer<typeof deleteEventSchema>;
export type ListEmailsArgs = z.infer<typeof listEmailsSchema>;
export type SendEmailArgs = z.infer<typeof sendEmailSchema>;
