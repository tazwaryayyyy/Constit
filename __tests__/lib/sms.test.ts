// __tests__/lib/sms.test.ts
// Domain behavioral tests for SMS encoding math.
// These protect the core billing logic — wrong segment counts = users overpay silently.

import { describe, expect, test } from "vitest";
import { analyzeSMS, renderMessage } from "@/lib/sms";

// ── analyzeSMS ────────────────────────────────────────────────────────────

describe("analyzeSMS — GSM encoding", () => {
    test("160 GSM chars = 1 segment", () => {
        const result = analyzeSMS("a".repeat(160));
        expect(result.encoding).toBe("GSM");
        expect(result.gsmUnits).toBe(160);
        expect(result.segments).toBe(1);
        expect(result.isOverSingleSegment).toBe(false);
    });

    test("161 GSM chars = 2 segments (ceil(161/153))", () => {
        const result = analyzeSMS("a".repeat(161));
        expect(result.encoding).toBe("GSM");
        expect(result.gsmUnits).toBe(161);
        expect(result.segments).toBe(2);
        expect(result.isOverSingleSegment).toBe(true);
    });

    test("306 GSM chars = 2 segments (ceil(306/153))", () => {
        const result = analyzeSMS("a".repeat(306));
        expect(result.segments).toBe(2);
    });

    test("€ (extended GSM char) costs 2 GSM units", () => {
        // € is in GSM_EXTENDED — each occurrence adds 2 units to the count
        const result = analyzeSMS("€");
        expect(result.encoding).toBe("GSM");
        expect(result.gsmUnits).toBe(2);
        expect(result.charCount).toBe(1);
    });

    test("158 plain chars + 1 extended (€) = 160 units = 1 segment", () => {
        const text = "a".repeat(158) + "€"; // 158 + 2 = 160 units
        const result = analyzeSMS(text);
        expect(result.gsmUnits).toBe(160);
        expect(result.segments).toBe(1);
    });

    test("158 plain chars + 2 extended (€€) = 162 units = 2 segments", () => {
        const text = "a".repeat(158) + "€€"; // 158 + 4 = 162 units
        const result = analyzeSMS(text);
        expect(result.gsmUnits).toBe(162);
        expect(result.segments).toBe(2);
    });
});

describe("analyzeSMS — Unicode encoding", () => {
    test("non-GSM character forces Unicode encoding", () => {
        // Ā (U+0100) is Latin Extended-A, not in the GSM 7-bit set
        const result = analyzeSMS("Ā");
        expect(result.encoding).toBe("Unicode");
    });

    test("70 Unicode chars = 1 segment", () => {
        // 69 ASCII + 1 non-GSM char = 70 chars total, all counted as Unicode
        const text = "a".repeat(69) + "Ā";
        const result = analyzeSMS(text);
        expect(result.encoding).toBe("Unicode");
        expect(result.charCount).toBe(70);
        expect(result.segments).toBe(1);
        expect(result.isOverSingleSegment).toBe(false);
    });

    test("71 Unicode chars = 2 segments (ceil(71/67))", () => {
        const text = "a".repeat(70) + "Ā";
        const result = analyzeSMS(text);
        expect(result.encoding).toBe("Unicode");
        expect(result.charCount).toBe(71);
        expect(result.segments).toBe(2);
        expect(result.isOverSingleSegment).toBe(true);
    });
});

// ── renderMessage ─────────────────────────────────────────────────────────

describe("renderMessage — name substitution", () => {
    test("replaces {name} with first name", () => {
        const { text } = renderMessage({ name: "Alice Smith" }, "Hi {name}, please vote today.", { optOut: false });
        expect(text).toBe("Hi Alice, please vote today.");
    });

    test("null name falls back to 'there'", () => {
        const { text } = renderMessage({ name: null }, "Hi {name}, please vote today.", { optOut: false });
        expect(text).toBe("Hi there, please vote today.");
    });

    test("empty string name falls back to 'there'", () => {
        const { text } = renderMessage({ name: "" }, "Hi {name}, please vote today.", { optOut: false });
        expect(text).toBe("Hi there, please vote today.");
    });

    test("{name} replacement is case-insensitive", () => {
        const { text } = renderMessage({ name: "Bob" }, "Hi {NAME}, call us.", { optOut: false });
        expect(text).toBe("Hi Bob, call us.");
    });
});

describe("renderMessage — opt-out suffix", () => {
    test("appends opt-out suffix when optOut=true", () => {
        const { text, optOutApplied } = renderMessage({ name: "Bob" }, "Please vote today.", { optOut: true });
        expect(text).toContain("Reply STOP to opt out.");
        expect(optOutApplied).toBe(true);
    });

    test("does not append opt-out when optOut=false", () => {
        const { text, optOutApplied } = renderMessage({ name: "Bob" }, "Please vote today.", { optOut: false });
        expect(text).toBe("Please vote today.");
        expect(optOutApplied).toBe(false);
    });

    test("does not double-append if template already contains 'reply stop'", () => {
        const template = "Please vote today. Reply STOP to opt out.";
        const { text, optOutApplied } = renderMessage({ name: "Bob" }, template, { optOut: true });
        expect(text).toBe(template); // unchanged
        expect(optOutApplied).toBe(false);
    });

    test("detects optOutAddsSegment when suffix pushes into new segment", () => {
        // Build a message that is exactly 160 chars — adding the suffix will push it to 2 segments
        const base = "a".repeat(160);
        const { optOutAddsSegment, analysis } = renderMessage({ name: null }, base, { optOut: true });
        expect(analysis.segments).toBe(2);
        expect(optOutAddsSegment).toBe(true);
    });
});
