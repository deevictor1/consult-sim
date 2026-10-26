# Consultation practice: voice role-play demo

A small voice-enabled role-play simulator. You play a clinician, an AI plays a patient, and a short
rubric-based review follows. Built to show a Django + React/TypeScript stack with a streaming voice loop.

**Scenario:** a smoking cessation conversation with a fictional patient (Mr Reeves). It is a communication
exercise only and gives no clinical advice.

## How it works

```
Browser (React + TS)                         Django
 mic -> SpeechRecognition  --POST /api/chat/stream-->  provider.stream()  -> Anthropic | OpenAI | mock
 tokens (SSE) <-----------------------------------------'
 tokens -> sentence buffer -> speechSynthesis   (speech starts before the reply has finished)
 "Finish" --POST /api/feedback--> rubric scoring (JSON, validated server-side)
```

- **Streaming:** the server forwards model tokens as server-sent events. The client speaks each sentence as soon
  as it completes, instead of waiting for the full reply.
- **Barge-in:** pressing Speak or sending a new message aborts the in-flight request and cancels queued speech.
- **Provider-agnostic:** `roleplay/llm.py` defines a small `Provider` interface with Anthropic, OpenAI and a
  keyless mock. Add another by implementing `stream()`.
- **No persistence:** there is no database. Transcripts are not stored, and failures are logged without message content.
- **Validated input:** message count, length, roles and ordering are checked before anything reaches a model.

## Run it

```bash
# backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export ANTHROPIC_API_KEY=...        # or OPENAI_API_KEY; with neither, a scripted mock patient is used
python manage.py runserver

# frontend (second terminal)
cd frontend
npm install
npm run dev                         # http://localhost:5173, /api is proxied to Django
```

Tests: `cd backend && python manage.py test`

## Limits (deliberate)

- Speech uses the browser's Web Speech API (best in Chrome or Edge). Typing works everywhere.
- Turn-based, not full-duplex realtime audio (no WebRTC), and no avatar.
- One scenario, one rubric. The mock feedback is keyword-based and only for demos.
- Run with `runserver` (WSGI) for simple streaming; production would use ASGI with an async view.
