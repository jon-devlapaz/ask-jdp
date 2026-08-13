import { createElement, type FunctionComponent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

const appModule = (await import("../src/ui/App.jsx")) as unknown as {
  answerContent(text: string): string;
  EVIDENCE_DISCLOSURE: string;
  MessagePair: FunctionComponent<{ question: string; answer: string }>;
  PRIVACY_NOTICE: string;
  PENDING_ANSWER_REFRESH_INTERVAL_MS: number;
  PrivacyNotice: FunctionComponent;
  activeSubmittedQuestion(options: {
    submittedQuestion: string;
    isBusy: boolean;
    pendingQuestion?: string;
    latestAnswerQuestion?: string;
  }): string;
  recoveryIdentity(sessionId: string, submittedQuestion: string): string;
  recoveryMode(options: {
    hasSessionError: boolean;
    hasFailedSend: boolean;
    hasAgentError: boolean;
    isStalled: boolean;
    isUnansweredTerminal?: boolean;
  }): string;
  isUnansweredTerminal(options: {
    identity: string;
    observedBusyIdentity: string;
    isBusy: boolean;
    isComplete: boolean;
    hasAgentError: boolean;
    hasFailedSend: boolean;
  }): boolean;
  STALLED_ANSWER_TIMEOUT_MS: number;
  submittedAnswerState(options: {
    sessionId: string;
    submittedQuestion: string;
    isBusy: boolean;
    hasAgentError: boolean;
    latestAnswerQuestion?: string;
  }): { identity: string; shouldRecover: boolean; isComplete: boolean };
  shouldShowAgentError(status: string, error: Error | undefined): boolean;
  Welcome: FunctionComponent;
};
const {
  answerContent,
  activeSubmittedQuestion,
  EVIDENCE_DISCLOSURE,
  isUnansweredTerminal,
  MessagePair,
  PENDING_ANSWER_REFRESH_INTERVAL_MS,
  PRIVACY_NOTICE,
  PrivacyNotice,
  recoveryIdentity,
  recoveryMode,
  STALLED_ANSWER_TIMEOUT_MS,
  submittedAnswerState,
  shouldShowAgentError,
  Welcome,
} = appModule;

describe("Ask JDP answer provenance", () => {
  it("uses bounded polling and a local 60-second stalled-answer threshold", () => {
    expect(PENDING_ANSWER_REFRESH_INTERVAL_MS).toBeGreaterThan(0);
    expect(PENDING_ANSWER_REFRESH_INTERVAL_MS).toBeLessThan(STALLED_ANSWER_TIMEOUT_MS);
    expect(STALLED_ANSWER_TIMEOUT_MS).toBe(60_000);
  });

  it("keeps admission retries in-session and starts fresh for unknown terminal work", () => {
    expect(
      recoveryMode({ hasSessionError: false, hasFailedSend: true, hasAgentError: true, isStalled: true }),
    ).toBe("resend");
    expect(
      recoveryMode({ hasSessionError: false, hasFailedSend: false, hasAgentError: true, isStalled: false }),
    ).toBe("fresh-session");
    expect(
      recoveryMode({ hasSessionError: false, hasFailedSend: false, hasAgentError: false, isStalled: true }),
    ).toBe("fresh-session");
    expect(
      recoveryMode({ hasSessionError: false, hasFailedSend: false, hasAgentError: false, isStalled: false }),
    ).toBe("refresh");
    expect(
      recoveryMode({
        hasSessionError: false,
        hasFailedSend: false,
        hasAgentError: false,
        isStalled: false,
        isUnansweredTerminal: true,
      }),
    ).toBe("fresh-session");
  });

  it("offers fresh recovery only after a submission was observed busy and settles without an answer", () => {
    const base = {
      identity: '["c_first","What operational result did Jonathan achieve?"]',
      observedBusyIdentity: '["c_first","What operational result did Jonathan achieve?"]',
      isBusy: false,
      isComplete: false,
      hasAgentError: false,
      hasFailedSend: false,
    };

    expect(isUnansweredTerminal(base)).toBe(true);
    expect(isUnansweredTerminal({ ...base, observedBusyIdentity: "" })).toBe(false);
    expect(isUnansweredTerminal({ ...base, isComplete: true })).toBe(false);
    expect(isUnansweredTerminal({ ...base, hasAgentError: true })).toBe(false);
    expect(isUnansweredTerminal({ ...base, hasFailedSend: true })).toBe(false);
  });

  it("keeps recovery identity stable without coupling it to agent callbacks", () => {
    const question = "What operational result did Jonathan achieve?";

    expect(recoveryIdentity("c_first", question)).toBe(recoveryIdentity("c_first", question));
    expect(recoveryIdentity("c_second", question)).not.toBe(recoveryIdentity("c_first", question));
    expect(recoveryIdentity("c_first", "What did Jonathan build?")).not.toBe(recoveryIdentity("c_first", question));
    expect(recoveryIdentity("", question)).toBe("");
  });

  it("adopts only a busy stored session's observable question for recovery", () => {
    const question = "What operational result did Jonathan achieve?";

    expect(
      activeSubmittedQuestion({ submittedQuestion: "", isBusy: true, pendingQuestion: question }),
    ).toBe(question);
    expect(
      activeSubmittedQuestion({ submittedQuestion: "", isBusy: true, latestAnswerQuestion: question }),
    ).toBe(question);
    expect(
      activeSubmittedQuestion({ submittedQuestion: "", isBusy: false, latestAnswerQuestion: question }),
    ).toBe("");
    expect(
      activeSubmittedQuestion({ submittedQuestion: "New question", isBusy: true, pendingQuestion: question }),
    ).toBe("New question");
  });

  it("continues recovery through partial streamed output until the submitted answer is terminal", () => {
    const partialStream = submittedAnswerState({
      sessionId: "c_first",
      submittedQuestion: "What operational result did Jonathan achieve?",
      isBusy: true,
      hasAgentError: false,
      latestAnswerQuestion: "What operational result did Jonathan achieve?",
    });
    const completedAnswer = submittedAnswerState({
      sessionId: "c_first",
      submittedQuestion: "What operational result did Jonathan achieve?",
      isBusy: false,
      hasAgentError: false,
      latestAnswerQuestion: "What operational result did Jonathan achieve?",
    });

    expect(partialStream.shouldRecover).toBe(true);
    expect(partialStream.isComplete).toBe(false);
    expect(completedAnswer.shouldRecover).toBe(false);
    expect(completedAnswer.isComplete).toBe(true);
  });

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
