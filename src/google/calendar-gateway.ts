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

export interface CalendarList {
  events: CalendarEvent[];
  truncated: boolean;
}

export interface CalendarGateway {
  listEvents(input: { startDate: string; endDate: string; timeZone: string }): Promise<CalendarList>;
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
