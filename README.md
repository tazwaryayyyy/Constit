# Constit

**AI-powered civic campaign management. Write better constituent messages in minutes, not days.**

Constit helps political organizers and civic campaigns do one job really well: reach the right people with the right message. You describe your campaign — the issue, who you're talking to, and what you want them to do — and Constit generates five ready-to-send SMS variants tuned for tone, character limits, and carrier compliance. Import your contact list, pick a message, personalize it per recipient, and export a send-ready CSV.

No bloated CRM. No agency retainer. No guesswork.

---

## What it does

**1. Create a campaign**
Define your issue, target audience, and the one action you want people to take. That context drives everything — the AI uses it, the export uses it, the activity log tracks against it.

**2. Import your contact list**
Upload any CSV. Constit auto-detects your columns, normalizes phone numbers to E.164, catches invalid rows without killing the whole import, and flags duplicates before they touch your database.

**3. Generate 5 message variants**
One click. Llama 3.3 70B via Groq generates 2 formal, 2 conversational, and 1 urgent variant — each under 160 GSM characters, each with a concrete call-to-action. Few-shot examples and a rejection loop in the prompt ensure quality. SHAFT/spam keywords are filtered before anything reaches your database.

**4. Review the Safety Panel**
Every message shows its encoding (GSM or Unicode), exact segment count, and a live character progress bar. Multi-segment messages are flagged in red and require a deliberate second click to select — you always know what you're paying for.

**5. Edit inline**
Click Edit on any variant. Type. The Safety Panel updates live. Save — the API validates at the boundary before writing to the DB.

**6. Lock and export**
Lock the selected message before exporting to prevent accidental edits. The Export tab runs `renderMessage` across every pending contact before you download anything — it computes the worst-case segment count, flags contacts where name length or Unicode pushes them into a second segment, and warns separately if the opt-out suffix adds a segment. Only then does the export button appear.

The opt-out line (`Reply STOP to opt out.`) is **always appended** to every contact's message when enabled — it is never silently dropped to save a segment. If it would add a segment for some contacts, a warning tells you to shorten the template instead.

Use `{name}` in your message and each contact gets their first name. Blank names fall back to `"there"`. The exported CSV includes `message_sms`, `sms_segments`, and `sms_encoding` columns so your SMS platform sees the real values.

**7. Simulate before sending**
Enter any name in the simulator on the Export tab and see the exact text that recipient will receive — correct encoding, correct segment count, copy button included.

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 14 (App Router) | Server components + API routes in one repo |
| Language | TypeScript 5 | Strict types across the full stack |
| Database | Supabase (PostgreSQL) | RLS-enforced multi-tenant isolation |
| Auth | Supabase Auth | Built into the same project |
| AI | Groq — `llama-3.3-70b-versatile` | Fastest inference, OpenAI-compatible API |
| Styling | Tailwind CSS | No component library overhead |
| CSV parsing | PapaParse | Battle-tested, runs entirely client-side |
| Analytics | PostHog (optional) | Feature flags + usage analytics |

---

## Project structure

```
constit/
├── app/
│   ├── page.tsx                          # Redirects → /dashboard
│   ├── layout.tsx
│   ├── globals.css
│   ├── dashboard/page.tsx                # Campaign list
│   ├── create/page.tsx                   # New campaign form
│   ├── campaign/[id]/page.tsx            # Core product: contacts / messages / export
│   └── api/
│       ├── campaign/
│       │   ├── create/route.ts           # POST — create campaign
│       │   └── [id]/route.ts             # DELETE — campaign + cascade
│       ├── contacts/
│       │   ├── import/route.ts           # POST — CSV import with dup detection
│       │   └── export/[campaign_id]/     # GET  — personalized CSV download
│       ├── messages/
│       │   ├── [id]/route.ts             # PATCH — inline edit with validation
│       │   └── select/route.ts           # POST — select message variant
│       ├── generate-messages/route.ts    # POST — Groq generation + filtering
│       └── activity/route.ts             # GET/POST — audit log
├── components/
│   ├── MessageCard.tsx                   # Variant card + Safety Panel
│   └── CSVImporter.tsx                   # 4-step import flow
├── lib/
│   ├── sms.ts                            # GSM 7-bit segment math
│   ├── ai.ts                             # Groq layer + fallback + SHAFT filter
│   ├── prompts.ts                        # Few-shot prompt engineering
│   ├── csv.ts                            # Parsing + phone normalization
│   └── supabaseClient.ts
├── types/index.ts                        # Campaign, Contact, Message, ActivityLog
├── schema.sql                            # Full Supabase schema — run this first
└── .env.example
```

---

## Getting started

### 1. Clone and install

```bash
git clone https://github.com/tazwaryayyyy/Constit.git
cd Constit
npm install
```

### 2. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** and paste the entire contents of `schema.sql` — run it
3. Copy your project URL and anon key from **Settings → API**

### 3. Get a Groq API key

1. Sign up at [console.groq.com](https://console.groq.com)
2. Go to **API Keys** → Create new key

### 4. Configure environment variables

```bash
cp .env.example .env.local
```

Open `.env.local` and fill in:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
GROQ_API_KEY=gsk_your-key-here
```

PostHog is optional — leave those blank to skip analytics.

### 5. Run it

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). You'll land on the dashboard.

---

## Database schema

Four tables. All with RLS. No user ever touches another user's data.

```
campaigns      — one per outreach effort (issue, audience, goal)
contacts       — constituent list, per campaign
messages       — AI-generated SMS variants, per campaign
activity_log   — audit trail (import, generate, edit, export events)
```

Every FK cascades on delete. `messages.sms_char_count` is a generated column — it cannot lie. All contact queries use composite indexes so the pending-count stat loads instantly even at scale.

---

## SMS encoding — why it matters

Constit implements the full GSM 7-bit standard in `lib/sms.ts`.

| Encoding | Single segment | Multi-segment |
|---|---|---|
| GSM 7-bit | 160 units | 153 units/segment |
| Unicode (UCS-2) | 70 characters | 67 chars/segment |

**Extended GSM characters** (`{ } [ ] ~ \ ^ | €`) each cost **2 units**, not 1. One emoji switches the entire message to Unicode and halves your character budget. Constit catches all of this before you export.

Multi-segment messages are allowed but never silent — they show a red warning and require a confirmation click. Costs are shown as segment counts only, never dollar amounts, because pricing varies by carrier and country.

---

## AI message generation

### The prompt (`lib/prompts.ts`)

The prompt is the competitive moat. Every generation includes:

- **Campaign context** — issue, audience, goal injected directly
- **Tone distribution** — 2 formal, 2 conversational, 1 urgent (always)
- **Absolute rules** — 160-char limit, no partisan framing, no fabricated facts, one concrete action
- **Rejection criteria** — clichés (`"make your voice heard"`), corporate jargon, vague promises, spam triggers listed explicitly
- **3 few-shot examples** — shows the model the quality bar before it writes a single word

### The safety layer (`lib/ai.ts`)

- Attempt → retry once on failure → contextual fallback (never generic boilerplate)
- `sanitize()` filters each message: minimum 20 chars, valid tone, no SHAFT/spam patterns, at least one concrete action verb
- SHAFT filter blocks: `FREE`, `WINNER`, `GUARANTEED`, `ACT NOW`, all-caps words 4+ letters (3-letter acronyms like EPA, SMS, USA are allowed), repeated punctuation
- Fallback templates rotate randomly across 3 variants — repeated failures don't look identical
- Over-limit messages are filtered out, never silently truncated

---

## CSV import

### What it handles

- Auto-detects `name`, `phone`, `email`, `tags`, `notes` columns by fuzzy header matching
- Phone normalization: `017xxxxxxxx` → `+88017xxxxxxxx`, US 10-digit → `+1`, E.164 passthrough
- **Partial success** — valid rows are imported even if some rows have errors
- Error rows returned as a downloadable `errors.csv` — nothing is silently dropped

### Duplicate handling

Before insert, the API queries existing contacts by phone. You choose:

| Strategy | Behavior |
|---|---|
| **Keep existing, skip new** (default) | The record already in the campaign survives. New row ignored. |
| **Import both** | Both rows are inserted. You may have the same number twice. |

---

## Export and personalization

### `{name}` variable

Use `{name}` anywhere in your message text. On export, each contact row gets their first name substituted. Contacts with blank names receive `"there"` as a fallback — never `"Hi , we need you."`.

### Opt-out compliance

The opt-out checkbox appends `"Reply STOP to opt out."` — but only when the composed message (after name substitution) still fits within a single segment. The export route uses full `analyzeSMS()` math for this check, not a simple `.length <= 160` comparison.

### Pre-export validation

Before you download, the Export tab runs a full pre-flight check on the actual composed message for the first contact:

- ✓ **green** — selected message, 1 segment, contacts ready
- ⚠ **amber** — multi-segment, or opt-out suffix pushes to a second segment
- ○ **grey** — no message selected yet

---

## Activity log

Every meaningful action is timestamped and shown in a timeline at the bottom of the campaign page:

| Event | When |
|---|---|
| Imported contacts | CSV import completes |
| Generated messages | Groq returns variants |
| Edited message | Inline edit saved |
| Exported CSV | Download link clicked |

---

## API reference

| Method | Route | What it does |
|---|---|---|
| `POST` | `/api/campaign/create` | Create campaign, returns `{ id }` |
| `POST` | `/api/generate-messages` | Generate variants via Groq, insert to DB |
| `POST` | `/api/contacts/import` | Import CSV rows with dup detection |
| `GET` | `/api/contacts/export/[id]` | Stream personalized CSV |
| `PATCH` | `/api/messages/[id]` | Update SMS text, validated at boundary |
| `POST` | `/api/messages/select` | Select variant (deselects all others first) |
| `GET` | `/api/activity` | Get last 10 log events for a campaign |
| `POST` | `/api/activity` | Insert an activity event |

---

## Environment variables

| Variable | Required | Where to get it |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | supabase.com → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | supabase.com → Settings → API |
| `GROQ_API_KEY` | Yes | console.groq.com → API Keys |
| `NEXT_PUBLIC_POSTHOG_KEY` | No | posthog.com → Project → Settings |
| `NEXT_PUBLIC_POSTHOG_HOST` | No | Default: `https://app.posthog.com` |

---

## Deployment

Constit deploys to Vercel in under 2 minutes.

1. Push to GitHub
2. Import the repo at [vercel.com/new](https://vercel.com/new)
3. Add all environment variables from `.env.example` in the Vercel dashboard
4. Deploy

No build config needed — Next.js is auto-detected.

---

## Compliance notes

Constit generates and exports messages. It does not send them. Sending responsibility — and compliance — sits with your SMS platform of choice.

**Before you send:**
- Register your brand and campaign with [The Campaign Registry (TCR)](https://www.campaignregistry.com/) for A2P 10DLC compliance
- Political campaigns require a Campaign Verify token — budget 3–10 days and a $95 fee
- Every message must include sender identification and honor opt-out requests within 10 business days
- TCPA restricts sending before 8 AM or after 9 PM in the recipient's local timezone

The opt-out line Constit appends (`"Reply STOP to opt out."`) is a starting point, not legal advice.

---

## Contributing

Issues and PRs are welcome. The places most worth improving:

- `lib/prompts.ts` — the prompt is the product, iterate ruthlessly
- `lib/sms.ts` — carrier-specific edge cases in segment math
- `lib/csv.ts` — phone normalization for additional country formats

---

## License

MIT
