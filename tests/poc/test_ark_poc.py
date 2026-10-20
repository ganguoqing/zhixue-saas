import json
from pathlib import Path
import tempfile
import unittest

import httpx

from apps.inference.ark_poc import ArkConfig, ArkPoc, PocError


class ArkPocTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.task = {"task_id": "synthetic-1", "prompt": "Return synthetic JSON only.", "images": [],
                     "schema": {"type": "object", "properties": {"ok": {"type": "boolean"}},
                                "required": ["ok"], "additionalProperties": False}, "max_completion_tokens": 128}
        self.calls = 0

    def success(self, request):
        self.calls += 1
        self.assertEqual(request.headers["authorization"], "Bearer synthetic-secret")
        return httpx.Response(200, json={"id": "synthetic-response", "model": "synthetic",
            "usage": {"prompt_tokens": 20, "completion_tokens": 10},
            "choices": [{"finish_reason": "stop", "message": {"content": '{"ok":true}'}}]})

    def client(self, handler=None, budget="10"):
        return ArkPoc(ArkConfig("synthetic-secret"), self.root, budget,
                      transport=httpx.MockTransport(handler or self.success))

    def test_budget_rejects_before_http(self):
        with self.assertRaisesRegex(PocError, "budget_would_be_exceeded"):
            self.client(budget="0.001").run(self.task)
        self.assertEqual(self.calls, 0)

    def test_success_is_estimate_and_task_cannot_resend(self):
        result = self.client().run(self.task)
        self.assertEqual(result["output"], {"ok": True})
        self.assertEqual(result["invocation"]["cost_status"], "estimated_not_invoice_confirmed")
        with self.assertRaisesRegex(PocError, "task_already_attempted"):
            self.client().run(self.task)
        self.assertEqual(self.calls, 1)
        self.assertNotIn("synthetic-secret", (self.root / "ledger.json").read_text())

    def test_timeout_persists_unknown_and_blocks_new_task(self):
        def timeout(request):
            self.calls += 1
            ledger = json.loads((self.root / "ledger.json").read_text())
            self.assertEqual(ledger["invocations"][0]["state"], "send_unknown")
            raise httpx.ReadTimeout("must not leak provider or request text")
        with self.assertRaisesRegex(PocError, "transport_error_send_unknown_no_retry"):
            self.client(timeout).run(self.task)
        self.task["task_id"] = "synthetic-2"
        with self.assertRaisesRegex(PocError, "unresolved_invocation"):
            self.client().run(self.task)
        self.assertEqual(self.calls, 1)

    def test_extra_control_field_is_rejected(self):
        def invalid(request):
            response = self.success(request)
            body = response.json()
            body["choices"][0]["message"]["content"] = '{"ok":true,"publish":true}'
            return httpx.Response(200, json=body)
        with self.assertRaisesRegex(PocError, "schema_rejected_no_business_write"):
            self.client(invalid).run(self.task)
        self.assertFalse(list(self.root.glob("*.parsed.json")))

    def test_unauthorized_response_is_not_retried_or_logged(self):
        def denied(request):
            self.calls += 1
            return httpx.Response(401, text="synthetic-secret")
        with self.assertRaisesRegex(PocError, "provider_http_401_no_retry"):
            self.client(denied).run(self.task)
        self.assertNotIn("synthetic-secret", (self.root / "ledger.json").read_text())
        self.task["task_id"] = "synthetic-2"
        with self.assertRaisesRegex(PocError, "unresolved_invocation"):
            self.client().run(self.task)
        self.assertEqual(self.calls, 1)


if __name__ == "__main__":
    unittest.main()
