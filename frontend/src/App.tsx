import { useEffect, useMemo, useRef, useState } from "react";
import { Feedback, Msg, Scenario, getFeedback, getScenario, streamReply } from "./api";
import { canListen, createSpeaker, listen } from "./speech";

const LABELS: Record<string, string> = {
  open_questions: "Open questions",
  empathy: "Empathy",
  motivation: "Exploring motivation",
  summarising: "Summarising",
  next_step: "Agreeing a next step",
};

export default function App() {
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [micStarting, setMicStarting] = useState(false);
  const [patientSpeaking, setPatientSpeaking] = useState(false);
  const [speak, setSpeak] = useState(true);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [error, setError] = useState("");
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const saved = window.localStorage.getItem("consult-theme");
    return saved === "dark" ? "dark" : "light";
  });
  const [voiceActive, setVoiceActive] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const recognition = useRef<{ stop: () => void } | null>(null);
  const voiceActiveRef = useRef(false);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const speakOn = useRef(speak);
  speakOn.current = speak;
  const speaker = useMemo(() => createSpeaker(() => speakOn.current), []);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => { getScenario().then(setScenario).catch((e) => setError(e.message)); }, []);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [messages]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("consult-theme", theme);
  }, [theme]);

  function startListening() {
    if (!canListen()) {
      setError("Voice input is not available in this browser. You can type your turn instead.");
      voiceActiveRef.current = false;
      setVoiceActive(false);
      return;
    }
    try {
      setMicStarting(true);
      recognition.current = listen((spoken) => {
        recognition.current = null;
        void send(spoken, messagesRef.current);
      }, (on) => {
        setListening(on);
        if (on) setMicStarting(false);
      }, (reason) => {
        setMicStarting(false);
        setListening(false);
        if (reason !== "aborted" && voiceActiveRef.current) {
          voiceActiveRef.current = false;
          setVoiceActive(false);
          setError(reason === "not-allowed" || reason === "service-not-allowed"
            ? "Microphone access was blocked. Allow microphone access, then start the voice conversation again."
            : reason === "no-speech"
              ? "No speech was detected. Start the voice conversation again when you’re ready."
              : "Voice input stopped. Start the voice conversation again when you’re ready.");
        }
      });
    } catch {
      setMicStarting(false);
      setError("Could not start the microphone. Check your browser’s microphone permission.");
      voiceActiveRef.current = false;
      setVoiceActive(false);
    }
  }

  function toggleVoiceSession() {
    if (voiceActiveRef.current) {
      voiceActiveRef.current = false;
      setVoiceActive(false);
      recognition.current?.stop();
      recognition.current = null;
      abort.current?.abort();
      speaker.cancel();
      setListening(false);
      setMicStarting(false);
      setPatientSpeaking(false);
      return;
    }
    setError("");
    voiceActiveRef.current = true;
    setVoiceActive(true);
    startListening();
  }

  async function send(content: string, history: Msg[]) {
    const clean = content.trim();
    if (!clean) return;
    abort.current?.abort(); // barge-in: stop any reply still streaming
    speaker.cancel();
    setError("");
    setText("");
    setPatientSpeaking(false);
    const convo: Msg[] = [...history.filter((m) => m.content), { role: "user", content: clean }];
    setMessages([...convo, { role: "assistant", content: "" }]);
    const ctl = new AbortController();
    abort.current = ctl;
    setBusy(true);
    try {
      await streamReply(convo, (tok) => {
        if (speakOn.current) setPatientSpeaking(true);
        speaker.push(tok);
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          next[next.length - 1] = { ...last, content: last.content + tok };
          return next;
        });
      }, ctl.signal);
      speaker.flush(() => {
        setPatientSpeaking(false);
        if (voiceActiveRef.current) startListening();
      });
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setError((e as Error).message);
        setPatientSpeaking(false);
        setMicStarting(false);
        if (voiceActiveRef.current) startListening();
      }
    } finally {
      if (abort.current === ctl) setBusy(false);
    }
  }

  async function finish() {
    abort.current?.abort();
    voiceActiveRef.current = false;
    setVoiceActive(false);
    recognition.current?.stop();
    recognition.current = null;
    setListening(false);
    setMicStarting(false);
    setPatientSpeaking(false);
    speaker.cancel();
    setBusy(true);
    setError("");
    try { setFeedback(await getFeedback(messages.filter((m) => m.content))); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  function reset() {
    abort.current?.abort();
    recognition.current?.stop();
    recognition.current = null;
    speaker.cancel();
    voiceActiveRef.current = false;
    setVoiceActive(false);
    setListening(false);
    setMicStarting(false);
    setPatientSpeaking(false);
    setMessages([]); setFeedback(null); setError(""); setBusy(false);
  }

  const turns = messages.filter((m) => m.role === "user").length;
  const conversationStatus = !voiceActive ? "Voice conversation paused" : listening ? "Listening to you" : patientSpeaking ? "Alan is speaking" : busy ? "Alan is thinking" : micStarting ? "Opening microphone" : "Microphone paused";
  const conversationHint = listening ? "Speak naturally. Alan is listening." : patientSpeaking ? "Listen to Alan’s response." : busy ? "Alan is preparing his response." : micStarting ? "Allow your browser to open the microphone." : voiceActive ? "The microphone is not active. End and restart the voice conversation." : "Start a voice conversation to speak with Alan.";

  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Consultation practice home"><span className="brand-mark">C</span> Consult<span>Practice</span></a>
        <div className="topbar-right"><span className="session-label">COMMUNICATION SKILLS</span><span className="provider-pill">{scenario?.provider === "mock" ? "Demo mode" : "AI patient"}</span><button className="theme-toggle" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}>{theme === "dark" ? "☼" : "☾"}<span>{theme === "dark" ? "Light" : "Dark"}</span></button></div>
      </header>

      <section className="workspace" aria-label="Consultation practice">
        <section className="consult" aria-label="Consultation">
          <div className="scenario-heading">
            <div><p className="eyebrow">TODAY’S SCENARIO</p><h1>{scenario?.title ?? "Consultation practice"}</h1></div>
            <button className="quiet restart" onClick={reset} aria-label="Start a new consultation">↻ <span>Restart</span></button>
          </div>
          <p className="brief">{scenario?.brief}</p>
          {scenario?.provider === "mock" && <p className="note">Demo mode: patient replies are scripted.</p>}

          <div className="patient-bar">
            <img className="avatar" src="/images/alan-reeves.png" alt="Portrait of Alan Reeves" />
            <div className="patient-meta"><span className="eyebrow">YOUR PATIENT</span><strong>Alan Reeves <span className="age">54</span></strong><span className="patient-context">Routine blood pressure check <i>·</i> Smokes 20 a day</span></div>
            <span className={`presence ${patientSpeaking ? "is-speaking" : ""}`}><i />{patientSpeaking ? "Responding" : "Patient"}</span>
          </div>

          <div className={`voice-stage ${listening ? "is-listening" : ""} ${patientSpeaking ? "is-speaking" : ""}`} aria-live="polite">
            <div className="voice-orb-wrap"><div className="voice-orb"><img src="/images/alan-reeves.png" alt="" /></div><span className="sound-wave wave-one" /><span className="sound-wave wave-two" /></div>
            <strong>{conversationStatus}</strong>
            <p>{conversationHint}</p>
            <button className={`voice-button ${voiceActive ? "active" : ""}`} onClick={toggleVoiceSession} disabled={!canListen()} aria-pressed={voiceActive}>{voiceActive ? <><span className="voice-button-icon">■</span> End voice conversation</> : <><span className="voice-button-icon">🎙</span> Start voice conversation</>}</button>
            {!canListen() && <span className="browser-note">Voice input works best in Chrome or Edge. You can type below.</span>}
            <span className="turn-count">{turns} {turns === 1 ? "turn" : "turns"} completed</span>
          </div>

          {error && <p className="error" role="alert">{error}</p>}

          <details className="transcript-panel">
            <summary>View conversation transcript <span>{turns} {turns === 1 ? "turn" : "turns"}</span></summary>
            <div className="transcript" aria-label="Conversation transcript">
              {messages.length === 0 && <p className="empty-transcript">Your spoken conversation will appear here.</p>}
              {messages.map((m, i) => <div key={i} className={`message-row ${m.role === "user" ? "from-clinician" : "from-patient"}`}>{m.role === "assistant" && <img className="message-avatar" src="/images/alan-reeves.png" alt="" />}<div className="message"><span className="who">{m.role === "user" ? "You · Clinician" : "Alan · Patient"}</span><p>{m.content || <span className="typing">Thinking<span>.</span><span>.</span><span>.</span></span>}</p></div></div>)}<div ref={end} />
            </div>
          </details>

          <details className="text-fallback">
            <summary>Prefer to type?</summary>
            <form className="composer" onSubmit={(e) => { e.preventDefault(); send(text, messages); }}>
              <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type your response…" aria-label="Your reply" />
              <button type="submit" className="send" disabled={!text.trim() || busy}>Send <span aria-hidden="true">↑</span></button>
            </form>
          </details>
          <div className="consult-footer"><label><input type="checkbox" checked={speak} onChange={(e) => setSpeak(e.target.checked)} /> Patient replies aloud</label><button className="reset-link" onClick={reset}>↻ Start again</button></div>
        </section>

        <aside className="review" aria-label="Feedback">
          <div className="review-heading"><div><p className="eyebrow">YOUR SESSION</p><h2>Consultation review</h2></div><span className="review-icon">✧</span></div>
        {!feedback ? (
          <>
            <p className="review-intro">When you’re ready, get feedback on your communication skills.</p>
            <div className="rubric-list">{Object.entries(scenario?.rubric ?? LABELS).map(([key, description], index) => <div className="rubric-item" key={key}><span className="rubric-number">0{index + 1}</span><span>{LABELS[key] ?? key}<small>{description}</small></span><span className="rubric-pending">—</span></div>)}</div>
            <button className="finish-button" onClick={finish} disabled={turns < 2 || busy}>{busy ? "Preparing feedback…" : "Finish and get feedback"}<span aria-hidden="true">→</span></button>
            <p className="review-hint">Complete at least two clinician turns to unlock your review.</p>
          </>
        ) : (
          <>
            <p className="feedback-summary">{feedback.summary}</p>
            <ul className="scores">
              {Object.entries(feedback.scores).map(([k, v]) => (
                <li key={k}>
                  <span>{LABELS[k] ?? k}</span>
                  <meter min={1} max={5} value={v} aria-label={`${LABELS[k] ?? k}: ${v} out of 5`} />
                  <b>{v}/5</b>
                </li>
              ))}
            </ul>
            <h3>Went well</h3>
            <ul>{feedback.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
            <h3>Try next time</h3>
            <ul>{feedback.improvements.map((s, i) => <li key={i}>{s}</li>)}</ul>
            <button className="finish-button" onClick={reset}>Start a new consultation <span aria-hidden="true">→</span></button>
          </>
        )}
          <div className="review-footnote">Practice conversation only <span>·</span> No clinical advice</div>
      </aside>
      </section>
    </main>
  );
}
