import json
import logging

from django.http import JsonResponse, StreamingHttpResponse
from django.views.decorators.http import require_GET, require_POST

from . import scenario as sc
from .llm import get_provider

log = logging.getLogger(__name__)
MAX_MESSAGES, MAX_CHARS = 40, 1000


class BadRequest(Exception):
    pass


def _messages(request, last_must_be_user: bool) -> list[dict]:
    try:
        body = json.loads(request.body)
    except ValueError:
        raise BadRequest("Body must be valid JSON.")
    msgs = body.get("messages") if isinstance(body, dict) else None
    if not isinstance(msgs, list) or not 1 <= len(msgs) <= MAX_MESSAGES:
        raise BadRequest(f"Send 1 to {MAX_MESSAGES} messages.")
    clean = []
    for m in msgs:
        ok = (
            isinstance(m, dict)
            and m.get("role") in ("user", "assistant")
            and isinstance(m.get("content"), str)
            and m["content"].strip()
        )
        if not ok:
            raise BadRequest("Each message needs a role and non-empty text.")
        clean.append({"role": m["role"], "content": m["content"][:MAX_CHARS]})
    if clean[0]["role"] != "user" or (last_must_be_user and clean[-1]["role"] != "user"):
        raise BadRequest("The conversation must start with, and for chat end with, a user message.")
    return clean


def _api(fn):
    def wrapper(request, *a, **kw):
        try:
            return fn(request, *a, **kw)
        except BadRequest as e:
            return JsonResponse({"error": str(e)}, status=400)

    return wrapper


@require_GET
def scenario(request):
    return JsonResponse(
        {"title": sc.TITLE, "brief": sc.BRIEF, "rubric": sc.RUBRIC, "provider": get_provider().name}
    )


@require_POST
@_api
def chat_stream(request):
    msgs = _messages(request, last_must_be_user=True)

    def events():
        try:
            for token in get_provider().stream(sc.PATIENT_PROMPT, msgs):
                yield f"data: {json.dumps({'t': token})}\n\n"
        except Exception:
            # Log the failure, never the conversation content.
            log.exception("Model stream failed")
            yield "event: error\ndata: {}\n\n"
        yield "event: done\ndata: {}\n\n"

    resp = StreamingHttpResponse(events(), content_type="text/event-stream")
    resp["Cache-Control"] = "no-cache"
    resp["X-Accel-Buffering"] = "no"
    return resp


@require_POST
@_api
def feedback(request):
    msgs = _messages(request, last_must_be_user=False)
    transcript = [{"role": "user", "content": "Transcript to assess:\n" + "\n".join(
        f"{'Clinician' if m['role'] == 'user' else 'Patient'}: {m['content']}" for m in msgs)}]
    system = sc.FEEDBACK_PROMPT.format(
        rubric="\n".join(f"- {k}: {v}" for k, v in sc.RUBRIC.items())
    )
    try:
        raw = get_provider().complete(system, transcript)
        data = json.loads(raw[raw.index("{") : raw.rindex("}") + 1])
        scores = {k: max(1, min(5, int(data["scores"][k]))) for k in sc.RUBRIC}
        return JsonResponse(
            {
                "scores": scores,
                "strengths": [str(s) for s in data.get("strengths", [])][:3],
                "improvements": [str(s) for s in data.get("improvements", [])][:3],
                "summary": str(data.get("summary", "")),
            }
        )
    except Exception:
        log.exception("Feedback generation failed")
        return JsonResponse({"error": "Feedback could not be generated. Try again."}, status=502)
