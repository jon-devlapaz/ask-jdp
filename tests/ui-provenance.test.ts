import { createElement, type FunctionComponent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

const appModule = (await import("../src/ui/App.jsx")) as unknown as {
  answerContent(text: string): string;
  EVIDENCE_DISCLOSURE: string;
  MessagePair: FunctionComponent<{ question: string; answer: string }>;
  PRIVACY_NOTICE: string;
  PrivacyNotice: FunctionComponent;
  shouldShowAgentError(status: string, error: Error | undefined): boolean;
  Welcome: FunctionComponent;
};
const {
  answerContent,
  EVIDENCE_DISCLOSURE,
  MessagePair,
  PRIVACY_NOTICE,
  PrivacyNotice,
  shouldShowAgentError,
  Welcome,
} = appModule;

describe("Ask JDP answer provenance", () => {
  it("does not flash retryable transport errors while an answer is still active", () => {
    const retryableError = new Error("stream reconnecting");

    expect(shouldShowAgentError("connecting", retryableError)).toBe(false);
    expect(shouldShowAgentError("submitted", retryableError)).toBe(false);
    expect(shouldShowAgentError("streaming", retryableError)).toBe(false);
    expect(shouldShowAgentError("error", retryableError)).toBe(true);
    expect(shouldShowAgentError("idle", undefined)).toBe(false);
  });

  it("renders an accurate evidence disclosure for the featured answer", () => {
    const html = renderToStaticMarkup(
      createElement(MessagePair, {
        question: "What changed?",
        answer: "Jonathan improved the workflow. Routine lookup fell below 30 seconds.",
      }),
    );

    expect(html).toContain('aria-label="Evidence source and outcome scope"');
    expect(html).toContain(EVIDENCE_DISCLOSURE);
    expect(html).toContain("public code");
    expect(html).toContain("explicitly qualified individual results");
  });

  it("moves the legacy generated label out of the answer body without hiding provenance", () => {
    const generated =
      "Observed individual throughput increased from 5 to 25 authorizations per hour.\n\n" +
      "Reviewed resume and portfolio · aggregate outcomes only";
    const html = renderToStaticMarkup(
      createElement(MessagePair, {
        question: "What was the observed result?",
        answer: generated,
      }),
    );

    expect(answerContent(generated)).toBe(
      "Observed individual throughput increased from 5 to 25 authorizations per hour.",
    );
    expect(html).toContain(EVIDENCE_DISCLOSURE);
    expect(html).not.toContain("aggregate outcomes only");
    expect(html).toContain("Observed individual throughput increased from 5 to 25");
  });

  it("moves the current public-code source label out of the answer body", () => {
    const generated =
      "Jonathan built Tink as an open-source Rust CLI.\n\n" +
      "Reviewed resume, portfolio, and public code · aggregate and explicitly qualified individual results";

    expect(answerContent(generated)).toBe("Jonathan built Tink as an open-source Rust CLI.");
  });

  it("preserves the opening sentence when an answer contains a repository URL", () => {
    const html = renderToStaticMarkup(
      createElement(MessagePair, {
        question: "What is tink-skills?",
        answer:
          "Jonathan built tink-skills at github.com/jon-devlapaz/tink-skills. " +
          "The repository treats local results as bounded evidence.",
      }),
    );

    expect(html).toContain("Jonathan built tink-skills");
    expect(html).toContain("github.com/jon-devlapaz/tink-skills");
    expect(html).toContain("bounded evidence");
  });

  it("renders the anonymous retention and sensitive-input warning as a note", () => {
    const html = renderToStaticMarkup(createElement(PrivacyNotice));

    expect(html).toContain('role="note"');
    expect(html).toContain(PRIVACY_NOTICE);
    expect(html).toContain("Completed anonymous conversations are deleted within 24 hours");
    expect(html).toContain("interrupted requests may take longer");
    expect(html).toContain("Do not include personal or health information");
  });

  it("renders a fresh welcome as an invitation rather than a simulated conversation", () => {
    const html = renderToStaticMarkup(createElement(Welcome));

    expect(html).toContain("Ask about Jonathan’s work.");
    expect(html).toContain("Clinical operations, automation, and measurable outcomes");
    expect(html).not.toContain("Answer from Ask JDP");
  });
});
