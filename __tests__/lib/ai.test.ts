// __tests__/lib/ai.test.ts
// Domain behavioral tests for the sanitize() spam/safety filter.
// Each test case documents a carrier rejection pattern or CTIA rule.

import { describe, expect, test, vi } from "vitest";

// Mock pino-dependent logger before importing the module under test
vi.mock("@/lib/logger", () => ({
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { sanitize } from "@/lib/ai";

function validMsg(sms: string) {
    return { tone: "formal", sms, call_to_action: "Call your representative today" };
}

describe("sanitize — spam pattern rejection", () => {
    test("rejects message containing carrier-blocked word 'free'", () => {
        // Carrier ML filters flag 'free' in bulk SMS — generates spam folders + fines
        expect(sanitize(validMsg("Please call your rep about the community program today. Free resources available."))).toBeNull();
    });

    test("rejects message containing 'winner'", () => {
        expect(sanitize(validMsg("You are a winner in your community — call your rep today to support change."))).toBeNull();
    });

    test("rejects message containing 'guaranteed'", () => {
        expect(sanitize(validMsg("Guaranteed results — call your representative now to support the proposal."))).toBeNull();
    });

    test("rejects cliché phrase 'make your voice heard'", () => {
        // Generic output indicator — model is not grounding on campaign specifics
        expect(sanitize(validMsg("Please make your voice heard on the housing proposal before Friday's vote."))).toBeNull();
    });

    test("rejects 'act now' urgency bait", () => {
        expect(sanitize(validMsg("You must act now and call your city council representative today."))).toBeNull();
    });
});

describe("sanitize — structural quality checks", () => {
    test("rejects all-caps message (>50% uppercase letters)", () => {
        // Spam heuristic: shouting-caps tone signals bulk spam to carriers
        expect(sanitize(validMsg("CALL YOUR REPRESENTATIVE TODAY ABOUT THE LOCAL WATER QUALITY ISSUE PLEASE"))).toBeNull();
    });

    test("rejects message with no concrete action verb", () => {
        // A message with no ask is not a civic SMS — it's noise
        const noVerb = "The council discussed the situation at Tuesday's session. The outcome remains uncertain.";
        expect(sanitize(validMsg(noVerb))).toBeNull();
    });

    test("rejects message shorter than 20 characters", () => {
        expect(sanitize(validMsg("Call today"))).toBeNull();
    });

    test("rejects non-object input", () => {
        expect(sanitize(null)).toBeNull();
        expect(sanitize("string")).toBeNull();
        expect(sanitize(42)).toBeNull();
    });

    test("rejects object with invalid tone", () => {
        expect(sanitize({ tone: "aggressive", sms: "Please call your representative today about local water quality.", call_to_action: "Call rep" })).toBeNull();
    });
});

describe("sanitize — valid civic messages pass through", () => {
    test("clean civic message returns typed GeneratedMessage", () => {
        const sms = "Please call your representative today about the local water quality proposal.";
        const result = sanitize(validMsg(sms));
        expect(result).not.toBeNull();
        expect(result?.tone).toBe("formal");
        expect(result?.sms).toBe(sms);
        expect(result?.call_to_action).toBe("Call your representative today");
    });

    test("accepts >formal tone prefix and normalises to 'formal'", () => {
        // Model sometimes prefixes tone with '>' — sanitize should normalise it
        const msg = { tone: ">formal", sms: "Please join us at the town hall meeting to vote on the water proposal.", call_to_action: "Attend the meeting" };
        const result = sanitize(msg);
        expect(result).not.toBeNull();
        expect(result?.tone).toBe("formal");
    });

    test("accepts 'conversational' and 'urgent' tones", () => {
        const conv = { tone: "conversational", sms: "Hey! Come to the town hall tonight and share your thoughts on the proposal.", call_to_action: "Attend tonight" };
        const urg = { tone: "urgent", sms: "Vote closes Friday — call your city council rep now to support clean water.", call_to_action: "Call now" };
        expect(sanitize(conv)).not.toBeNull();
        expect(sanitize(urg)).not.toBeNull();
    });

    test("mixed-case message with <50% uppercase passes", () => {
        // "Vote" is capitalised at sentence start but ratio is low — should pass
        const sms = "Vote for cleaner parks by calling your council rep before Thursday.";
        expect(sanitize(validMsg(sms))).not.toBeNull();
    });
});
