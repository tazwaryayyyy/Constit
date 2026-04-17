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
  last_contacted_at: string | null;
  created_at: string;
}

export interface Message {
  id: string;
  campaign_id: string;
  tone: string;
  sms: string;
  sms_char_count: number;  // computed column — always accurate
  call_to_action: string;
  selected: boolean;
  created_at: string;
}

export interface ActivityLog {
  id: string;
  campaign_id: string;
  event: string;
  details: string | null;
  created_at: string;
}
