import json

from django.test import SimpleTestCase

CHAT = [{"role": "user", "content": "Hello Mr Reeves, how are you feeling today?"}]


class ApiTests(SimpleTestCase):
    def post(self, path, payload):
        return self.client.post(path, json.dumps(payload), content_type="application/json")

    def test_stream_emits_tokens_then_done(self):
        resp = self.post("/api/chat/stream", {"messages": CHAT})
        body = b"".join(resp.streaming_content).decode()
        self.assertEqual(resp["Content-Type"], "text/event-stream")
        self.assertIn('"t":', body.replace(" ", ""))
        self.assertTrue(body.rstrip().endswith("data: {}"))
        self.assertIn("event: done", body)

    def test_rejects_bad_input(self):
        for payload in ({}, {"messages": []}, {"messages": [{"role": "system", "content": "x"}]},
                        {"messages": [{"role": "user", "content": "  "}]}):
            self.assertEqual(self.post("/api/chat/stream", payload).status_code, 400)

    def test_chat_must_end_with_user_turn(self):
        msgs = CHAT + [{"role": "assistant", "content": "Fine."}]
        self.assertEqual(self.post("/api/chat/stream", {"messages": msgs}).status_code, 400)

    def test_feedback_shape(self):
        msgs = CHAT + [{"role": "assistant", "content": "Fine, thanks."}]
        data = self.post("/api/feedback", {"messages": msgs}).json()
        self.assertEqual(set(data["scores"]), {"open_questions", "empathy", "motivation", "summarising", "next_step"})
        self.assertTrue(all(1 <= v <= 5 for v in data["scores"].values()))

    def test_get_not_allowed_on_post_routes(self):
        self.assertEqual(self.client.get("/api/chat/stream").status_code, 405)
