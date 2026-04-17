// lib/sms.ts
// SMS encoding detection and segment calculation.
// This is the core billing logic — get it wrong and users overpay silently.

// GSM 7-bit basic character set (every char here = 1 GSM unit)
const GSM_BASIC = new Set<string>([
    "@", "£", "$", "¥", "è", "é", "ù", "ì", "ò", "Ç", "\n", "Ø", "ø", "\r", "Å", "å",
    "Δ", "_", "Φ", "Γ", "Λ", "Ω", "Π", "Ψ", "Σ", "Θ", "Ξ", "\x1b", "Æ", "æ", "ß", "É",
    " ", "!", '"', "#", "¤", "%", "&", "'", "(", ")", "*", "+", ",", "-", ".", "/",
    "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", ":", ";", "<", "=", ">", "?",
    "¡", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O",
    "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z", "Ä", "Ö", "Ñ", "Ü", "§",
    "¿", "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o",
    "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z", "ä", "ö", "ñ", "ü", "à",
]);

// GSM extended character set — each costs 2 GSM units (escape + char)
const GSM_EXTENDED = new Set<string>(["|", "^", "€", "{", "}", "[", "]", "~", "\\"]);

export type SMSEncoding = "GSM" | "Unicode";

export interface SMSAnalysis {
    encoding: SMSEncoding;
    charCount: number;
    gsmUnits: number;        // effective units for billing (extended chars = 2)
    segments: number;
    charsPerSegment: number; // chars allowed per segment at this message length
    maxSingleSegment: number;
    isOverSingleSegment: boolean;
    isMultiSegment: boolean;
    // Human-readable warning shown in the UI. Null when safe.
    // Does NOT include dollar amounts — pricing varies by country, route, and carrier.
    costWarning: string | null;
}

export function analyzeSMS(text: string): SMSAnalysis {
    let isGSM = true;
    let gsmUnits = 0;

    for (const char of text) {
        if (GSM_EXTENDED.has(char)) {
            gsmUnits += 2;
        } else if (GSM_BASIC.has(char)) {
            gsmUnits += 1;
        } else {
            isGSM = false;
            break;
        }
    }

    const charCount = [...text].length; // proper Unicode codepoint count

    if (isGSM) {
        const maxSingle = 160;
        const maxMulti = 153;
        const segments = gsmUnits <= maxSingle ? 1 : Math.ceil(gsmUnits / maxMulti);
        const charsPerSegment = segments === 1 ? maxSingle : maxMulti;
        const costWarning =
            segments > 1
                ? `${segments} SMS segments — cost varies by provider/country`
                : null;
        return {
            encoding: "GSM",
            charCount,
            gsmUnits,
            segments,
            charsPerSegment,
            maxSingleSegment: maxSingle,
            isOverSingleSegment: gsmUnits > maxSingle,
            isMultiSegment: segments > 1,
            costWarning,
        };
    }

    // Unicode (any char outside GSM set)
    const maxSingle = 70;
    const maxMulti = 67;
    const segments = charCount <= maxSingle ? 1 : Math.ceil(charCount / maxMulti);
    const charsPerSegment = segments === 1 ? maxSingle : maxMulti;
    const costWarning =
        segments > 1
            ? `Unicode encoding + ${segments} segments — cost varies by provider/country`
            : "Unicode encoding — 70 char limit per segment";
    return {
        encoding: "Unicode",
        charCount,
        gsmUnits: charCount,
        segments,
        charsPerSegment,
        maxSingleSegment: maxSingle,
        isOverSingleSegment: charCount > maxSingle,
        isMultiSegment: segments > 1,
        costWarning,
    };
}

// ── renderMessage ─────────────────────────────────────────────────────────
// The ONE canonical function that produces the final SMS string to send.
// Always run analyzeSMS on the RESULT, never on the template.
// This prevents segment mismatch, encoding surprises, and lying previews.

export interface RenderedMessage {
    text: string;
    analysis: SMSAnalysis;
    // Whether opt-out suffix was actually appended (false if already contained "reply stop")
    optOutApplied: boolean;
    // Whether the opt-out suffix pushed the message into an additional segment.
    // UI should WARN the user — but NEVER silently drop the suffix.
    // Dropping it would violate the user's intent and may be a compliance issue.
    optOutAddsSegment: boolean;
}

const OPT_OUT_SUFFIX = " Reply STOP to opt out.";

export function renderMessage(
    contact: { name?: string | null },
    template: string,
    options: { optOut: boolean }
): RenderedMessage {
    const rawFirst = contact.name?.split(" ")[0]?.trim() ?? "";
    const firstName = rawFirst.length > 0 ? rawFirst : "there";
    const baseText = template.replace(/\{name\}/gi, firstName);
    const baseAnalysis = analyzeSMS(baseText);

    let text = baseText;
    let optOutApplied = false;
    let optOutAddsSegment = false;

    if (options.optOut && !baseText.toLowerCase().includes("reply stop")) {
        // ALWAYS append — never silently drop. The segment cost is a warning, not a gate.
        text = baseText + OPT_OUT_SUFFIX;
        optOutApplied = true;
        optOutAddsSegment = analyzeSMS(text).segments > baseAnalysis.segments;
    }

    return { text, analysis: analyzeSMS(text), optOutApplied, optOutAddsSegment };
}
