// The shapes the whole app agrees on.
//
// These mirror the three Supabase tables exactly. Touseef builds the SQL from
// this file, so if you change a field here, tell him.

// Where a visitor is in their visit. They start "waiting", become "called" when
// staff call their ticket, then end as "served" or "cancelled".
export type VisitorStatus = "waiting" | "called" | "served" | "cancelled";

// Table: queues
export interface Queue {
  id: string;
  name: string;
  // How long one person takes on average, in SECONDS. Default 300 (= 5 min).
  avgServiceSeconds: number;
  // A visitor gets an alert when this many people are ahead of them.
  // Default 3.
  alertAtPosition: number;
  // Staff can speed the queue up or slow it down. 1 is normal, 2 is twice as
  // fast. Allowed range 0.25 to 4. Default 1.
  speedMultiplier: number;
  createdAt: string;
}

// Table: visitors
export interface Visitor {
  id: string;
  queueId: string;
  // The number on the ticket, in order of arrival.
  ticketNo: number;
  name: string;
  // Optional. Only used if we add SMS later.
  phone: string | null;
  status: VisitorStatus;
  // True once we have told this visitor they are nearly up. Stops us texting
  // the same person over and over.
  alerted: boolean;
  joinedAt: string;
  calledAt: string | null;
  servedAt: string | null;
}

// Table: service_events
// One row per finished visitor. We read these to work out how fast the desk is
// really moving, which is what makes the prediction adapt.
export interface ServiceEvent {
  id: string;
  queueId: string;
  visitorId: string;
  // How long that visitor actually took, in seconds.
  durationSeconds: number;
  createdAt: string;
}

// The wait estimate we show a visitor. This is exactly what GET /status returns.
export interface PredictionResult {
  // 1 means you are next.
  position: number;
  // How many people are ahead of you right now.
  peopleAhead: number;
  minMinutes: number;
  maxMinutes: number;
  // True when you are close enough to turn to be worth alerting.
  shouldAlert: boolean;
}