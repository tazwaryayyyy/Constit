// types/index.ts

export interface Campaign {
  id: string;
  user_id: string;
  name: string;
  issue: string;
  audience: string;
  goal: string;
  created_at: string;
}

export interface Contact {
  id: string;
  campaign_id: string;
  name: string;
  phone: string;
  email: string;
  tags: string[];
  status: "pending" | "contacted" | "replied" | "opted_out";
  notes: string;
  created_at: string;
}

export interface Message {
  id: string;
  campaign_id: string;
  tone: string;
  sms: string;
  sms_char_count: number;  // computed column — always accurate
  long_text: string;
  script: string;
  call_to_action: string;
  selected: boolean;
  performance_score: number | null;
  created_at: string;
}

export interface Volunteer {
  id: string;
  campaign_id: string;
  name: string;
  contact: string;
  role: "manager" | "organizer" | "volunteer";
}

export interface Task {
  id: string;
  volunteer_id: string;
  message_id: string | null;
  contact_id: string;
  status: "pending" | "in_progress" | "done" | "failed";
  created_at: string;
  completed_at: string | null;
}
