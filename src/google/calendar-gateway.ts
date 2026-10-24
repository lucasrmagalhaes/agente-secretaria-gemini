export interface CalendarEvent {
  id: string;
  title: string;
  date: string;
  time: string | null;
  endTime: string | null;
  allDay: boolean;
  timeZone: string;
  attendees: string[];
  description?: string;
  link?: string;
}

export interface CalendarGateway {
  listEvents(input: { date: string; timeZone: string }): Promise<CalendarEvent[]>;
  createEvent(input: {
    title: string;
    date: string;
    time: string;
    durationMinutes: number;
    attendees: string[];
    description?: string;
    timeZone: string;
  }): Promise<CalendarEvent>;
  updateEvent(input: {
    eventId: string;
    title?: string;
    date?: string;
    time?: string;
    durationMinutes?: number;
    attendees?: string[];
    description?: string;
    timeZone: string;
  }): Promise<CalendarEvent>;
  deleteEvent(input: { eventId: string }): Promise<{ eventId: string; deleted: true }>;
}
