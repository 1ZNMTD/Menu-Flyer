"""IPP エンコード/デコードと送信のテスト (擬似 IPP サーバー使用)."""

from __future__ import annotations

import http.server
import struct
import threading
import unittest

from printdrop import ipp


def build_fake_response(
    status_code: int = 0x0000, request_id: int = 1, job_id: int | None = 123
) -> bytes:
    body = struct.pack(">BBHI", 2, 0, status_code, request_id)
    body += struct.pack(">B", ipp.TAG_OPERATION_ATTRS)
    body += _attr(ipp.TAG_CHARSET, "attributes-charset", b"utf-8")
    body += _attr(ipp.TAG_NATURAL_LANGUAGE, "attributes-natural-language", b"en")
    if job_id is not None:
        body += struct.pack(">B", ipp.TAG_JOB_ATTRS)
        body += _attr(ipp.TAG_INTEGER, "job-id", struct.pack(">i", job_id))
        body += _attr(
            ipp.TAG_KEYWORD, "job-state-reasons", b"job-hold-until-specified"
        )
    body += struct.pack(">B", ipp.TAG_END_OF_ATTRS)
    return body


def _attr(tag: int, name: str, value: bytes) -> bytes:
    name_b = name.encode()
    return (
        struct.pack(">B", tag)
        + struct.pack(">H", len(name_b))
        + name_b
        + struct.pack(">H", len(value))
        + value
    )


class EncodeTests(unittest.TestCase):
    def test_print_job_request_roundtrip_header(self) -> None:
        doc = b"%PDF-1.4 fake"
        req = ipp.build_print_job_request(
            "ipp://printer.local:631/ipp/print",
            doc,
            job_name="menu.pdf",
            requesting_user_name="tester",
            job_attributes={"job-hold-until": "indefinite", "copies": 2},
        )
        major, minor, op, req_id = struct.unpack(">BBHI", req[:8])
        self.assertEqual((major, minor), (2, 0))
        self.assertEqual(op, ipp.OP_PRINT_JOB)
        self.assertEqual(req_id, 1)
        self.assertTrue(req.endswith(doc))
        self.assertIn(b"job-hold-until", req)
        self.assertIn(b"indefinite", req)
        self.assertIn(b"application/pdf", req)

    def test_tag_inference(self) -> None:
        self.assertEqual(ipp.tag_for_python_value(True), ipp.TAG_BOOLEAN)
        self.assertEqual(ipp.tag_for_python_value(3), ipp.TAG_INTEGER)
        self.assertEqual(ipp.tag_for_python_value("indefinite"), ipp.TAG_KEYWORD)


class ParseTests(unittest.TestCase):
    def test_parse_success_response(self) -> None:
        resp = ipp.parse_response(build_fake_response(job_id=42))
        self.assertTrue(resp.ok)
        self.assertEqual(resp.status_name, "successful-ok")
        self.assertEqual(resp.job_id, 42)

    def test_parse_error_response(self) -> None:
        resp = ipp.parse_response(build_fake_response(status_code=0x0501, job_id=None))
        self.assertFalse(resp.ok)
        self.assertEqual(resp.status_name, "server-error-operation-not-supported")

    def test_parse_multivalue_attribute(self) -> None:
        body = struct.pack(">BBHI", 2, 0, 0, 1)
        body += struct.pack(">B", ipp.TAG_PRINTER_ATTRS)
        body += _attr(ipp.TAG_KEYWORD, "job-hold-until-supported", b"no-hold")
        body += _attr(ipp.TAG_KEYWORD, "", b"indefinite")  # 追加値 (名前なし)
        body += struct.pack(">B", ipp.TAG_END_OF_ATTRS)
        resp = ipp.parse_response(body)
        values = resp.groups[ipp.TAG_PRINTER_ATTRS][0]["job-hold-until-supported"]
        self.assertEqual(values, ["no-hold", "indefinite"])

    def test_parse_truncated_raises(self) -> None:
        with self.assertRaises(ipp.IppError):
            ipp.parse_response(b"\x02\x00")


class _FakeIppHandler(http.server.BaseHTTPRequestHandler):
    received: list[bytes] = []

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("Content-Length", 0))
        _FakeIppHandler.received.append(self.rfile.read(length))
        payload = build_fake_response(job_id=777)
        self.send_response(200)
        self.send_header("Content-Type", "application/ipp")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args: object) -> None:
        pass


class EndToEndTests(unittest.TestCase):
    def setUp(self) -> None:
        _FakeIppHandler.received = []
        self.server = http.server.HTTPServer(("127.0.0.1", 0), _FakeIppHandler)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()

    def test_print_pdf_over_http(self) -> None:
        uri = f"http://127.0.0.1:{self.port}/ipp/print"
        resp = ipp.print_pdf(
            uri,
            b"%PDF-1.4 test-document",
            job_name="flyer.pdf",
            requesting_user_name="tester",
            job_attributes={"job-hold-until": "indefinite"},
        )
        self.assertTrue(resp.ok)
        self.assertEqual(resp.job_id, 777)
        # サーバー側にドキュメントと保留属性が届いていること
        sent = _FakeIppHandler.received[0]
        self.assertTrue(sent.endswith(b"%PDF-1.4 test-document"))
        self.assertIn(b"job-hold-until", sent)


if __name__ == "__main__":
    unittest.main()
