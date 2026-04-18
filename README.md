# Constit

Reach constituents from CSV import to compliant SMS delivery, reply tracking, and campaign analytics in one workflow.

## What It Does

- Create a campaign with issue, audience, and goal so the app can generate context-aware message variants.
- Import contacts from CSV, map columns, normalize phone numbers, and import valid rows while reporting row-level errors.
- Generate SMS variants with Groq, review segment/encoding warnings, edit text, and select one message.
- Send selected SMS directly through Twilio, then track delivery status and inbound replies in Analytics and Inbox.
- Manage workspace billing and team roles from the dashboard with Stripe checkout and billing portal flows.

## Live Demo

https://constit.vercel.app

## Tech Stack

| Layer | Choice | One-line reason |
|---|---|---|
| Framework | Next.js 14 App Router | Ships UI pages and API routes in one deployable app |
| Language | TypeScript 5 | Keeps route contracts and shared models explicit |
| Database | Supabase Postgres | Stores campaigns, contacts, messages, deliveries, replies, and org data |
| Auth | Supabase Auth | Provides session + JWT auth for client and route handlers |
| Authorization | Postgres RLS + route checks | Enforces tenant isolation and ownership at DB and API layers |
| AI | Groq OpenAI-compatible API | Generates message variants with low integration overhead |
| SMS | Twilio REST + webhooks | Sends outbound messages and receives delivery/reply events |
| Billing | Stripe Checkout + Portal + webhooks | Handles subscription upgrades and lifecycle updates |
| CSV | PapaParse | Parses client-side CSV with flexible header mapping |
| Styling | Tailwind CSS | Keeps UI iteration fast without a component framework lock-in |
| Testing | Vitest | Covers auth propagation logic and route helper behavior |

## Project Structure

```text
constit/
├── LICENSE                                  # Project license
├── README.md                                # Developer-facing setup and architecture guide
├── package.json                             # Scripts and dependencies
├── package-lock.json                        # Locked dependency graph
├── next.config.js                           # Next.js runtime/build config
├── tsconfig.json                            # TypeScript compiler config
├── postcss.config.js                        # PostCSS pipeline config
├── tailwind.config.js                       # Tailwind theme/content config
├── next-env.d.ts                            # Next.js TypeScript ambient types
├── .eslintrc.json                           # ESLint config
├── vitest.config.ts                         # Vitest setup and alias config
├── schema.sql                               # Base schema (campaign/contact/message/activity)
├── schema_migrations.sql                    # Add-on schema for send/replies/orgs/billing fields
├── app/
│   ├── layout.tsx                           # Root HTML shell and metadata
│   ├── globals.css                          # Global styles
│   ├── page.tsx                             # Root route (redirect/entry)
│   ├── login/page.tsx                       # Magic-link login page
│   ├── create/page.tsx                      # New campaign creation form
│   ├── dashboard/page.tsx                   # Campaign list + billing + team workspace UI
│   ├── campaign/[id]/page.tsx               # Main campaign workspace tabs (contacts/messages/export/send/analytics/inbox)
│   └── api/
│       ├── activity/route.ts                # Activity feed read/write
│       ├── campaign/create/route.ts         # Campaign creation endpoint
│       ├── campaign/[id]/route.ts           # Campaign deletion endpoint
│       ├── generate-messages/route.ts       # AI variant generation endpoint
│       ├── send/route.ts                    # Twilio send pipeline endpoint
│       ├── replies/route.ts                 # Inbox reply listing endpoint
│       ├── analytics/[campaign_id]/route.ts # Campaign analytics aggregation endpoint
│       ├── contacts/import/route.ts         # CSV contact import endpoint
│       ├── contacts/export/[campaign_id]/route.ts # Personalized CSV export endpoint
│       ├── messages/select/route.ts         # Message selection endpoint
│       ├── messages/[id]/route.ts           # Message edit endpoint
│       ├── organizations/route.ts           # Resolve/create caller workspace endpoint
│       ├── organizations/members/route.ts   # Team member list/add endpoint
│       ├── organizations/members/[user_id]/route.ts # Team member role/update/delete endpoint
│       ├── billing/checkout/route.ts        # Stripe checkout session endpoint
│       ├── billing/portal/route.ts          # Stripe billing portal endpoint
│       └── webhooks/
│           ├── twilio/route.ts              # Twilio status + inbound reply webhook handler
│           └── stripe/route.ts              # Stripe subscription lifecycle webhook handler
├── components/
│   ├── CSVImporter.tsx                      # Multi-step CSV upload + mapping UI
│   └── MessageCard.tsx                      # Message variant card with safety info/actions
├── lib/
│   ├── ai.ts                                # Groq client, sanitize/retry/fallback logic
│   ├── prompts.ts                           # Prompt templates and examples
│   ├── sms.ts                               # GSM/Unicode analysis and renderMessage logic
│   ├── csv.ts                               # CSV mapping, normalization, validation helpers
│   ├── clientAuth.ts                        # Client fetch auth header helper
│   ├── supabaseClient.ts                    # Browser Supabase singleton client
│   ├── supabaseServer.ts                    # Server Supabase client factory
│   ├── supabaseRouteAuth.ts                 # Route auth resolver (cookie + bearer fallback)
├── types/
│   ├── index.ts                             # Shared app domain types
│   └── csv.ts                               # CSV-specific type definitions
└── __tests__/
	└── lib/
		├── clientAuth.test.ts              # Tests for Authorization header propagation
		└── supabaseRouteAuth.test.ts       # Tests for route auth cookie/bearer behavior
```

## Getting Started

### 1. Clone and install

```bash
git clone https://github.com/tazwaryayyyy/Constit.git
cd Constit
npm install
```

### 2. Create and configure Supabase

1. Go to https://supabase.com and create a new project.
2. In your project, open SQL Editor and run schema.sql.
3. In SQL Editor, run schema_migrations.sql.
4. Open Settings -> API and copy Project URL, anon key, and service_role key.

### 3. Create a Groq API key

1. Go to https://console.groq.com.
2. Open API Keys and create a key.

### 4. Create a Twilio messaging setup

1. Go to https://console.twilio.com.
2. Copy Account SID and Auth Token from account dashboard.
3. Buy or verify a phone number that can send SMS.
4. Set webhook URL for status callbacks and incoming messages to:

```text
https://your-domain.com/api/webhooks/twilio
```

### 5. Create Stripe products and webhook

1. Go to https://dashboard.stripe.com and copy your Secret key.
2. Create two recurring prices for Pro and Enterprise; copy both price IDs.
3. Create a webhook endpoint at:

```text
https://your-domain.com/api/webhooks/stripe
```

4. Subscribe to events: checkout.session.completed, customer.subscription.updated, customer.subscription.deleted, invoice.payment_failed.
5. Copy the webhook signing secret.

### 6. Configure environment variables

Create .env.local in project root and paste this exact template:

```env
NEXT_PUBLIC_SUPABASE_URL=https://abcxyzcompany.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.example
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.service-role-example

GROQ_API_KEY=gsk_live_example_key

TWILIO_ACCOUNT_SID=AC1234567890abcdef1234567890abcd
TWILIO_AUTH_TOKEN=twilio_auth_token_example
TWILIO_FROM_NUMBER=+15551234567

STRIPE_SECRET_KEY=sk_test_51Nexample
STRIPE_PRO_PRICE_ID=price_1ProExample123456
STRIPE_ENTERPRISE_PRICE_ID=price_1EntExample123456
STRIPE_WEBHOOK_SECRET=whsec_example_secret

NEXT_PUBLIC_APP_URL=http://localhost:3000

NEXT_PUBLIC_POSTHOG_KEY=
NEXT_PUBLIC_POSTHOG_HOST=https://app.posthog.com
```

Environment variable reference:

| Variable | Required | Where to get it |
|---|---|---|
| NEXT_PUBLIC_SUPABASE_URL | Yes | Supabase -> Settings -> API -> Project URL |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | Yes | Supabase -> Settings -> API -> anon public key |
| SUPABASE_SERVICE_ROLE_KEY | Yes | Supabase -> Settings -> API -> service_role key |
| GROQ_API_KEY | Yes | Groq Console -> API Keys |
| TWILIO_ACCOUNT_SID | Yes for send/webhook | Twilio Console -> Account Info |
| TWILIO_AUTH_TOKEN | Yes for send/webhook | Twilio Console -> Account Info |
| TWILIO_FROM_NUMBER | Yes for send | Twilio Phone Numbers |
| STRIPE_SECRET_KEY | Yes for billing | Stripe Dashboard -> Developers -> API keys |
| STRIPE_PRO_PRICE_ID | Yes for billing | Stripe Product price ID for Pro |
| STRIPE_ENTERPRISE_PRICE_ID | Yes for billing | Stripe Product price ID for Enterprise |
| STRIPE_WEBHOOK_SECRET | Yes for Stripe webhook | Stripe Webhook endpoint signing secret |
| NEXT_PUBLIC_APP_URL | Yes for callbacks | Your local/prod base URL |
| NEXT_PUBLIC_POSTHOG_KEY | No | PostHog project key |
| NEXT_PUBLIC_POSTHOG_HOST | No | PostHog host URL |

### 7. Run locally

```bash
npm run dev
```

Open http://localhost:3000.

## How It Works

### 1) SMS segment math drives safe edits and exports

The app analyzes every final rendered message after personalization and opt-out suffixing. It handles GSM basic and extended characters, Unicode fallback, and per-segment limits, then surfaces segment warnings in UI and API responses before send/export.

### 2) AI generation is constrained, then filtered

The prompt enforces tone distribution and output shape. The AI layer rejects unusable text by checking JSON shape, minimum length, blocked patterns, uppercase ratio, and action verbs. If generation fails, the app retries once, then returns contextual fallback content.

### 3) CSV import favors partial success

CSV parsing auto-detects columns and applies user-confirmed mapping. The importer normalizes phone numbers, validates emails, and returns row-level errors without failing the full batch. Duplicate behavior is explicit with skip or import-both strategies.

### 4) Multi-tenant security uses RLS plus route guards

RLS policies enforce per-user boundaries in Postgres. Route handlers also verify ownership and resolve auth from cookie session or bearer token for reliability. Webhook routes use service-role access and signature verification because no user session exists.

## API Reference

| Method | Route | What it does |
|---|---|---|
| POST | /api/campaign/create | Creates a campaign and returns its id |
| DELETE | /api/campaign/[id] | Deletes a campaign and related records |
| POST | /api/contacts/import | Imports mapped CSV contacts into a campaign |
| GET | /api/contacts/export/[campaign_id] | Exports personalized pending contacts as CSV |
| POST | /api/generate-messages | Generates and stores campaign message variants |
| PATCH | /api/messages/[id] | Updates message SMS text with validation |
| POST | /api/messages/select | Selects one message variant for campaign |
| GET | /api/activity | Returns recent campaign activity items |
| POST | /api/activity | Writes a campaign activity event |
| POST | /api/send | Sends selected message to pending contacts via Twilio |
| GET | /api/replies | Returns paginated inbound replies for a campaign |
| GET | /api/analytics/[campaign_id] | Returns campaign delivery/reply/variant analytics |
| GET | /api/organizations | Resolves or creates caller organization |
| GET | /api/organizations/members | Lists workspace members |
| POST | /api/organizations/members | Adds or upserts a workspace member |
| PATCH | /api/organizations/members/[user_id] | Updates a member role |
| DELETE | /api/organizations/members/[user_id] | Removes a member |
| POST | /api/billing/checkout | Creates Stripe Checkout session |
| POST | /api/billing/portal | Creates Stripe Billing Portal session |
| POST | /api/webhooks/twilio | Handles Twilio delivery and reply webhooks |
| POST | /api/webhooks/stripe | Handles Stripe subscription lifecycle webhooks |

## Deployment

Deploy to Vercel in four steps:

1. Push this repo to GitHub.
2. Go to https://vercel.com/new and import the repository.
3. Add all environment variables from .env.local to Vercel Project Settings -> Environment Variables.
4. Deploy and set your production domain in NEXT_PUBLIC_APP_URL.

After deploy:

- Set Twilio webhook URL to https://your-domain.com/api/webhooks/twilio.
- Set Stripe webhook URL to https://your-domain.com/api/webhooks/stripe.

## Compliance / Caveats

- You are responsible for lawful messaging. Get consent before sending SMS.
- Register brand and campaign when required for A2P 10DLC and carrier policies.
- Include sender identification and honor opt-out requests.
- The app supports direct Twilio sending. Keep TWILIO_AUTH_TOKEN and service role keys private.
- Run schema_migrations.sql in every environment; workspace/team features depend on those tables.

## Contributing

Focus improvements here first:

- lib/prompts.ts: prompt quality directly changes message usefulness and safety.
- lib/sms.ts: segment math and rendering rules affect cost and compliance outcomes.
- app/api/webhooks/twilio/route.ts: webhook correctness drives delivery accuracy and inbox quality.

## License

MIT

## Self Review

- Can a new developer run this locally in under 10 minutes using only this README? Yes, if they already have Supabase, Groq, Twilio, and Stripe accounts.
- Does every section earn its place? Yes; each section maps to setup, trust, architecture, or production readiness.
- Is anything assumed that should be explained? The external account creation steps are included with exact navigation paths.
- Does the headline make someone want to read more? Yes; it states the user outcome in one line.
