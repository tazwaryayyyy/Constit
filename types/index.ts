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

export interface Delivery {
  id: string;
  campaign_id: string;
  contact_id: string;
  message_id: string | null;
  twilio_sid: string | null;
  status: "queued" | "sending" | "sent" | "delivered" | "failed" | "undelivered";
  error_code: string | null;
  error_message: string | null;
  segments_billed: number | null;
  sent_at: string;
  delivered_at: string | null;
  created_at: string;
}

export interface Reply {
  id: string;
  campaign_id: string | null;
  contact_id: string | null;
  from_phone: string;
  body: string;
  twilio_sid: string | null;
  intent: "positive" | "negative" | "question" | "opt_out" | "unclassified";
  ai_summary: string | null;
  received_at: string;
  created_at: string;
}

export interface CampaignAnalytics {
  campaign_id: string;
  contacts: Record<string, number>;
  deliveries: {
    total: number;
    delivered: number;
    failed: number;
    delivery_rate_pct: number;
    segments_billed: number;
    by_status: Record<string, number>;
  };
  replies: {
    total: number;
    reply_rate_pct: number;
    by_intent: Record<string, number>;
    recent: Array<{
      intent: string;
      summary: string | null;
      received_at: string;
      from_phone: string;
    }>;
  };
  variants: Array<{
    message_id: string;
    tone: string;
    sms_preview: string;
    selected: boolean;
    delivered: number;
    total_sent: number;
  }>;
}

export interface Organization {
  id: string;
  name: string;
  owner_id: string;
  plan: "free" | "pro" | "enterprise";
  contacts_used_this_month: number;
  contacts_limit: number;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: "inactive" | "active" | "past_due" | "canceled";
  created_at: string;
}

export type OrganizationRole = "owner" | "admin" | "editor" | "viewer" | "member";

export interface OrganizationMember {
  user_id: string;
  role: OrganizationRole;
  joined_at: string | null;
}
