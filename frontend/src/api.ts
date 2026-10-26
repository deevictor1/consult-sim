export type Msg = { role: "user" | "assistant"; content: string };
export type Scenario = { title: string; brief: string; rubric: Record<string, string>; provider: string };
export type Feedback = {
  scores: Record<string, number>;
  strengths: string[];
  improvements: string[];
  summary: string;
};

const json = { "Content-Type": "application/json" };

export async function getScenario(): Promise<Scenario> {
  const res = await fetch("/api/scenario");
  if (!res.ok) throw new Error("Could not load the scenario.");
  return res.json();
}

/** Reads the server-sent event stream and calls onToken for each model token. */
export async function streamReply(messages: Msg[], onToken: (t: string) => void, signal: AbortSignal) {
  const res = await fetch("/api/chat/stream", {
    method: "POST", headers: json, body: JSON.stringify({ messages }), signal,
  });
  if (!res.ok || !res.body) throw new Error("The patient could not reply. Try again.");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const ev of events) {
      if (ev.startsWith("event: error")) throw new Error("The model stream failed. Try again.");
      if (ev.startsWith("data: ")) onToken(JSON.parse(ev.slice(6)).t);
    }
  }
}

export async function getFeedback(messages: Msg[]): Promise<Feedback> {
  const res = await fetch("/api/feedback", { method: "POST", headers: json, body: JSON.stringify({ messages }) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Feedback failed.");
  return data;
}
