import { ArrowRight } from "@phosphor-icons/react";
import { useFlueAgent } from "@flue/react";
import { BorderBeam } from "border-beam";
import { useEffect, useMemo, useRef, useState } from "react";
import { ThinkingOrb } from "thinking-orbs";
import { PortfolioCursor } from "./PortfolioCursor.jsx";

const PORTFOLIO_URL = "https://jon-devlapaz.github.io/project-portfolio-site/";
const TAB_CONVERSATION_KEY = "ask_jdp_conversation_id";
const CONVERSATION_ID_PATTERN = /^c_[A-Za-z0-9_-]{40,}$/;
const BUSY_AGENT_STATUSES = new Set(["connecting", "submitted", "streaming"]);

export const PENDING_ANSWER_REFRESH_INTERVAL_MS = 5_000;
export const STALLED_ANSWER_TIMEOUT_MS = 60_000;

const MODEL_SOURCE_LABEL =
  /\s*Reviewed resume(?: and portfolio|, portfolio, and public code)\s*[·•]\s*(?:aggregate outcomes only|aggregate and explicitly qualified individual results)\.?\s*$/i;

export const EVIDENCE_DISCLOSURE =
  "Reviewed résumé, portfolio, and public code · aggregate outcomes and explicitly qualified individual results";

export const PRIVACY_NOTICE =
  "Completed anonymous conversations are deleted within 24 hours; interrupted requests may take longer to recover safely. Do not include personal or health information.";

export function isBusyAgentStatus(status) {
  return BUSY_AGENT_STATUSES.has(status);
}

export function shouldShowAgentError(status, error) {
  return Boolean(error) && !isBusyAgentStatus(status);
}

export function recoveryMode({ hasSessionError, hasFailedSend, hasAgentError, isStalled, isUnansweredTerminal }) {
  if (hasSessionError) return "fresh-session";
  if (hasFailedSend) return "resend";
  if (hasAgentError || isStalled || isUnansweredTerminal) return "fresh-session";
  return "refresh";
}

export function recoveryIdentity(sessionId, submittedQuestion) {
  return sessionId && submittedQuestion ? JSON.stringify([sessionId, submittedQuestion]) : "";
}

export function activeSubmittedQuestion({ submittedQuestion, isBusy, pendingQuestion, latestAnswerQuestion }) {
  if (submittedQuestion) return submittedQuestion;
  if (!isBusy) return "";
  return pendingQuestion || latestAnswerQuestion || "";
}

export function submittedAnswerState({
  sessionId,
  submittedQuestion,
  isBusy,
  hasAgentError,
  latestAnswerQuestion,
}) {
  const identity = recoveryIdentity(sessionId, submittedQuestion);

  return {
    identity,
    shouldRecover: Boolean(identity && isBusy),
    isComplete: Boolean(identity && !isBusy && !hasAgentError && latestAnswerQuestion === submittedQuestion),
  };
}

export function isUnansweredTerminal({
  identity,
  observedBusyIdentity,
  isBusy,
  isComplete,
  hasAgentError,
  hasFailedSend,
}) {
  return Boolean(
    identity &&
      identity === observedBusyIdentity &&
      !isBusy &&
      !isComplete &&
      !hasAgentError &&
      !hasFailedSend,
  );
}

function textFromMessage(message) {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("")
    .trim();
}

function splitOutcome(text) {
  const sentences = [...new Intl.Segmenter("en", { granularity: "sentence" }).segment(text)]
    .map(({ segment }) => segment.trim())
    .filter(Boolean);
  if (sentences.length < 2) return { body: text, outcome: "" };

  return {
    body: sentences.slice(0, -1).join(" "),
    outcome: sentences.at(-1),
  };
}

export function answerContent(text) {
  return text.replace(MODEL_SOURCE_LABEL, "").trim();
}

export function MessagePair({ question, answer }) {
  const { body, outcome } = splitOutcome(answerContent(answer));

  return (
    <article className="answer" aria-label="Answer from Ask JDP">
      {question ? <p className="question">{question}</p> : null}
      <div className="answer-copy">
        {body ? <p>{body}</p> : null}
        {outcome ? <p className="outcome">{outcome}</p> : null}
      </div>
      <p className="evidence-source" aria-label="Evidence source and outcome scope">
        {EVIDENCE_DISCLOSURE}
      </p>
    </article>
  );
}

export function PrivacyNotice() {
  return (
    <p className="privacy-notice" role="note">
      {PRIVACY_NOTICE}
    </p>
  );
}

export function Welcome() {
  return (
    <div className="welcome">
      <p className="welcome-title">Ask about Jonathan’s work.</p>
      <p className="welcome-copy">
        Clinical operations, automation, and measurable outcomes—answered from his résumé, portfolio, and public code.
      </p>
    </div>
  );
}

function conversationState(messages) {
  const visible = messages.filter(
    (message) => message.display === "visible" && ["user", "assistant"].includes(message.role),
  );
  const pairs = [];
  let question = "";

  for (const message of visible) {
    const text = textFromMessage(message);
    if (!text) continue;
    if (message.role === "user") {
      question = text;
    } else if (question) {
      pairs.push({ id: message.id, question, answer: text });
      question = "";
    }
  }

  return { pairs, pendingQuestion: question };
}

function readTabConversation() {
  try {
    const conversationId = window.sessionStorage.getItem(TAB_CONVERSATION_KEY);
    return conversationId && CONVERSATION_ID_PATTERN.test(conversationId) ? conversationId : "";
  } catch {
    return "";
  }
}

function storeTabConversation(conversationId) {
  try {
    window.sessionStorage.setItem(TAB_CONVERSATION_KEY, conversationId);
  } catch {
    // A fresh server-owned conversation still works when storage is unavailable.
  }
}

function clearTabConversation() {
  try {
    window.sessionStorage.removeItem(TAB_CONVERSATION_KEY);
  } catch {
    // Storage may be unavailable in hardened browsing modes.
  }
}

function ReplyComposer({ value, onChange, onSubmit, disabled, busy, hasReply }) {
  const fieldId = "ask-jdp-question";

  return (
    <BorderBeam
      active={!disabled && !busy}
      borderRadius={30}
      className="composer-beam"
      colorVariant="colorful"
      duration={4.8}
      size="pulse-outside"
      strength={0.32}
      theme="dark"
    >
      <form className="composer" onSubmit={onSubmit} aria-busy={busy}>
        <label className="sr-only" htmlFor={fieldId}>
          Ask a question about Jonathan’s experience
        </label>
        <input
          id={fieldId}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={hasReply ? "Ask another question" : "Ask about Jonathan’s work"}
          disabled={disabled}
          autoComplete="off"
        />
        <button
          className="send"
          type="submit"
          disabled={disabled || !value.trim()}
          aria-label={busy ? "Waiting for answer" : "Send question"}
        >
          <ArrowRight aria-hidden="true" size={29} strokeWidth={1.35} weight="regular" />
        </button>
      </form>
    </BorderBeam>
  );
}

export function App() {
  const [sessionId, setSessionId] = useState("");
  const [sessionError, setSessionError] = useState("");
  const [draft, setDraft] = useState("");
  const [submittedQuestion, setSubmittedQuestion] = useState("");
  const [stalledQuestion, setStalledQuestion] = useState("");
  const [observedBusyIdentity, setObservedBusyIdentity] = useState("");
  const sessionController = useRef(null);
  const refreshAgent = useRef(null);

  const createSession = async ({ fresh = true } = {}) => {
    sessionController.current?.abort();
    const controller = new AbortController();
    sessionController.current = controller;
    setSessionError("");
    setSessionId("");
    setSubmittedQuestion("");
    setStalledQuestion("");
    setObservedBusyIdentity("");

    try {
      const response = await fetch(fresh ? "/api/session?fresh=1" : "/api/session", {
        method: "GET",
        credentials: "same-origin",
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("A private conversation could not be started.");
      const payload = await response.json();
      const id = payload.id ?? payload.conversationId ?? payload.sessionId;
      if (typeof id !== "string" || !id) throw new Error("The conversation service returned an invalid session.");
      storeTabConversation(id);
      setSessionId(id);
    } catch (error) {
      if (error.name !== "AbortError") {
        setSessionError(error instanceof Error ? error.message : "A private conversation could not be started.");
      }
    }
  };

  useEffect(() => {
    const tabConversation = readTabConversation();
    if (tabConversation) {
      setSessionId(tabConversation);
    } else {
      createSession({ fresh: true });
    }
    return () => sessionController.current?.abort();
  }, []);

  const agent = useFlueAgent({
    url: sessionId ? `/api/agents/assistant/${encodeURIComponent(sessionId)}` : undefined,
  });
  const { pairs, pendingQuestion } = useMemo(() => conversationState(agent.messages), [agent.messages]);
  const latestPair = pairs.at(-1);
  const hasConversation = Boolean(latestPair || pendingQuestion);
  const isBusy = isBusyAgentStatus(agent.status);
  const showAgentError = shouldShowAgentError(agent.status, agent.error);
  const isUnavailable = !sessionId || Boolean(sessionError);
  const activeQuestion = activeSubmittedQuestion({
    submittedQuestion,
    isBusy,
    pendingQuestion,
    latestAnswerQuestion: latestPair?.question,
  });
  const submission = submittedAnswerState({
    sessionId,
    submittedQuestion: activeQuestion,
    isBusy,
    hasAgentError: Boolean(agent.error),
    latestAnswerQuestion: latestPair?.question,
  });
  const isStalled = stalledQuestion === submission.identity && Boolean(submission.identity);
  const failedQuestion = agent.failedSends.at(-1)?.message;
  const isTerminalUnanswered = isUnansweredTerminal({
    identity: submission.identity,
    observedBusyIdentity,
    isBusy,
    isComplete: submission.isComplete,
    hasAgentError: Boolean(agent.error),
    hasFailedSend: Boolean(failedQuestion),
  });
  const isRecoveryOffered = isStalled || isTerminalUnanswered;
  const isRecovering = isBusy && !isRecoveryOffered;

  useEffect(() => {
    refreshAgent.current = agent.refresh;
  }, [agent.refresh]);

  useEffect(() => {
    if (!submittedQuestion && activeQuestion) setSubmittedQuestion(activeQuestion);
  }, [activeQuestion, submittedQuestion]);

  useEffect(() => {
    if (submission.shouldRecover) setObservedBusyIdentity(submission.identity);
  }, [submission.identity, submission.shouldRecover]);

  useEffect(() => {
    if (!submission.shouldRecover) return undefined;

    const refreshInterval = window.setInterval(() => {
      refreshAgent.current?.();
    }, PENDING_ANSWER_REFRESH_INTERVAL_MS);
    const stalledTimer = window.setTimeout(() => {
      setStalledQuestion(submission.identity);
    }, STALLED_ANSWER_TIMEOUT_MS);

    return () => {
      window.clearInterval(refreshInterval);
      window.clearTimeout(stalledTimer);
    };
  }, [submission.identity, submission.shouldRecover]);

  useEffect(() => {
    if (!submission.shouldRecover || submission.isComplete) setStalledQuestion("");
  }, [submission.isComplete, submission.shouldRecover]);

  useEffect(() => {
    if (submission.isComplete) setSubmittedQuestion("");
  }, [submission.isComplete]);

  useEffect(() => {
    if (!submission.identity || submission.isComplete) setObservedBusyIdentity("");
  }, [submission.identity, submission.isComplete]);

  async function submit(event) {
    event.preventDefault();
    const question = draft.trim();
    if (!question || isBusy || isUnavailable) return;

    setDraft("");
    setSubmittedQuestion(question);
    setStalledQuestion("");
    setObservedBusyIdentity("");
    try {
      await agent.sendMessage(question);
    } catch {
      setDraft(question);
    }
  }

  const retry = async () => {
    const mode = recoveryMode({
      hasSessionError: Boolean(sessionError),
      hasFailedSend: Boolean(failedQuestion),
      hasAgentError: Boolean(agent.error),
      isStalled,
      isUnansweredTerminal: isTerminalUnanswered,
    });

    if (mode === "resend") {
      setSubmittedQuestion(failedQuestion);
      setStalledQuestion("");
      setObservedBusyIdentity("");
      try {
        await agent.sendMessage(failedQuestion);
      } catch {
        // The hook retains failed sends; preserve the quiet retry affordance.
      }
      return;
    }

    if (mode === "fresh-session") {
      const questionToPreserve = activeQuestion || pendingQuestion;
      if (questionToPreserve) setDraft(questionToPreserve);
      clearTabConversation();
      await createSession({ fresh: true });
      return;
    }

    agent.refresh();
  };

  const recoveryMessage = sessionError
    ? sessionError
    : isStalled
      ? "This answer is taking longer than expected. Start fresh to keep your question in the composer."
      : "The answer could not be completed.";

  return (
    <main className="ask-jdp-shell">
      <PortfolioCursor />
      <div className="wash" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />
      <section className="conversation" aria-label="Ask JDP">
        <div className="identity-row">
          <p className="wordmark">JDP.</p>
          <a className="portfolio-link" href={PORTFOLIO_URL}>
            <span aria-hidden="true">←</span>
            Portfolio
          </a>
        </div>

        <div className="transcript" aria-live="polite" aria-busy={isRecovering}>
          {pendingQuestion ? (
            <article className="answer answer-pending" aria-label="Question being considered">
              <p className="question">{pendingQuestion}</p>
            </article>
          ) : latestPair ? (
            <MessagePair {...latestPair} />
          ) : (
            <Welcome />
          )}
          {isRecovering && activeQuestion ? (
            <p className="thinking">
              <ThinkingOrb state="connecting" size={64} speed={1.25} theme="dark" aria-hidden="true" />
              <span>Considering the evidence…</span>
            </p>
          ) : null}
          {sessionError || showAgentError || isRecoveryOffered ? (
            <div className="error-state" role="alert">
              <p>{recoveryMessage}</p>
              <button type="button" onClick={retry}>
                {isRecoveryOffered ? "Start fresh" : "Try again"}
              </button>
            </div>
          ) : null}
        </div>

        <ReplyComposer
          value={draft}
          onChange={setDraft}
          onSubmit={submit}
          disabled={isUnavailable || isBusy || isTerminalUnanswered}
          busy={isRecovering}
          hasReply={hasConversation}
        />
        <PrivacyNotice />
      </section>
    </main>
  );
}
