export type VisitorStatus = 'waiting' | 'called' | 'served' | 'cancelled';

export interface Queue {
  id: string;
  name: string;
  avg_service_seconds: number;
  alert_at_position: number;
  created_at: string;
}

export interface Visitor {
  id: string;
  queue_id: string;
  ticket_no: number;
  name: string;
  phone?: string | null;
  status: VisitorStatus;
  joined_at: string;
  called_at?: string | null;
  served_at?: string | null;
}

export interface ServiceEvent {
  id: string;
  queue_id: string;
  visitor_id: string;
  duration_seconds: number;
  created_at: string;
}
