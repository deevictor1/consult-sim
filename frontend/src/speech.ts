/** Speaks the reply sentence by sentence while tokens are still arriving. */
export function createSpeaker(enabled: () => boolean) {
  let buffer = "";
  let queued = 0;
  let onDrained: (() => void) | null = null;
  let generation = 0;
  const say = (text: string) => {
    if (!enabled() || !text.trim() || !("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-GB";
    const currentGeneration = generation;
    queued += 1;
    const done = () => {
      if (generation !== currentGeneration) return;
      queued = Math.max(0, queued - 1);
      if (queued === 0 && onDrained) {
        const callback = onDrained;
        onDrained = null;
        callback();
      }
    };
    u.onend = done;
    u.onerror = done;
    window.speechSynthesis.speak(u);
  };
  return {
    push(token: string) {
      buffer += token;
      let m: RegExpMatchArray | null;
      while ((m = buffer.match(/^([\s\S]*?[.!?])\s+([\s\S]*)$/))) {
        say(m[1]);
        buffer = m[2];
      }
    },
    flush(onComplete?: () => void) {
      say(buffer);
      buffer = "";
      if (!onComplete) return;
      if (queued === 0) onComplete();
      else onDrained = onComplete;
    },
    /** Barge-in: drop queued speech immediately. */
    cancel() {
      generation += 1;
      buffer = "";
      queued = 0;
      onDrained = null;
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    },
  };
}

export const canListen = () =>
  "SpeechRecognition" in window || "webkitSpeechRecognition" in window;

export function listen(onText: (t: string) => void, onState: (on: boolean) => void, onFailure?: (reason: string) => void) {
  const w = window as any;
  const Rec = w.SpeechRecognition || w.webkitSpeechRecognition;
  const rec = new Rec();
  rec.lang = "en-GB";
  rec.interimResults = false;
  rec.continuous = false;
  rec.onstart = () => onState(true);
  rec.onend = () => onState(false);
  rec.onerror = (event: any) => {
    onState(false);
    onFailure?.(event.error ?? "unknown");
  };
  rec.onresult = (e: any) => onText(e.results[0][0].transcript);
  rec.start();
  return { stop: () => rec.stop() };
}
