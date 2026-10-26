"""Provider-agnostic LLM layer. Add a provider by subclassing Provider.stream()."""
import json
import os
import time
from functools import lru_cache
from typing import Iterator


class Provider:
    name = "base"

    def stream(self, system: str, messages: list[dict]) -> Iterator[str]:
        raise NotImplementedError

    def complete(self, system: str, messages: list[dict]) -> str:
        return "".join(self.stream(system, messages))


class AnthropicProvider(Provider):
    name = "anthropic"

    def __init__(self):
        import anthropic

        self.client = anthropic.Anthropic()
        self.model = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-5-5")

    def stream(self, system, messages):
        with self.client.messages.stream(
            model=self.model, max_tokens=500, system=system, messages=messages
        ) as s:
            yield from s.text_stream


class OpenAIProvider(Provider):
    name = "openai"

    def __init__(self):
        from openai import OpenAI

        self.client = OpenAI()
        self.model = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")

    def stream(self, system, messages):
        resp = self.client.chat.completions.create(
            model=self.model,
            stream=True,
            messages=[{"role": "system", "content": system}, *messages],
        )
        for chunk in resp:
            if chunk.choices and chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content


class MockProvider(Provider):
    """Keyless demo mode: scripted patient replies and heuristic feedback."""

    name = "mock"
    REPLIES = [
        "Morning. I'm just here for my blood pressure check, to be honest.",
        "Yeah, I smoke. About twenty a day. Have done since I was nineteen.",
        "I know it's not good for me. But I tried to stop once and it didn't stick.",
        "My granddaughter was born in March. I'd like to see her grow up, I suppose.",
        "Hmm. Maybe. What would that actually involve?",
    ]

    def stream(self, system, messages):
        if "Return ONLY a JSON" in system:
            yield self._feedback(messages)
            return
        turn = sum(1 for m in messages if m["role"] == "user") - 1
        reply = self.REPLIES[min(turn, len(self.REPLIES) - 1)]
        for word in reply.split(" "):
            yield word + " "
            time.sleep(0.03)

    @staticmethod
    def _feedback(messages):
        said = [m["content"].lower() for m in messages if m["role"] == "user"]
        text = " ".join(said)
        opens = sum(1 for s in said if "?" in s and s.split()[0] in ("what", "how", "tell", "could"))
        scores = {
            "open_questions": min(5, 1 + opens),
            "empathy": 4 if any(w in text for w in ("understand", "sounds", "hard")) else 2,
            "motivation": 4 if "why" in text or "matter" in text else 2,
            "summarising": 4 if "so " in text else 2,
            "next_step": 4 if any(w in text for w in ("shall we", "would you", "next")) else 2,
        }
        return json.dumps(
            {
                "scores": scores,
                "strengths": ["Demo mode: scores are keyword heuristics.", "Connect a model for real feedback."],
                "improvements": ["Set ANTHROPIC_API_KEY or OPENAI_API_KEY.", "Then rerun this consultation."],
                "summary": "Mock feedback only; no model reviewed this consultation.",
            }
        )


@lru_cache(maxsize=1)
def get_provider() -> Provider:
    choice = os.environ.get("LLM_PROVIDER")
    if not choice:
        if os.environ.get("ANTHROPIC_API_KEY"):
            choice = "anthropic"
        elif os.environ.get("OPENAI_API_KEY"):
            choice = "openai"
        else:
            choice = "mock"
    return {"anthropic": AnthropicProvider, "openai": OpenAIProvider, "mock": MockProvider}[choice]()
