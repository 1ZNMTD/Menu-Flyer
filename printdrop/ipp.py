"""最小限の IPP (Internet Printing Protocol) クライアント実装.

標準ライブラリのみで Print-Job / Get-Printer-Attributes を送信する。
RFC 8010 (エンコーディング) / RFC 8011 (セマンティクス) に準拠。
"""

from __future__ import annotations

import http.client
import ssl
import struct
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

# 操作コード
OP_PRINT_JOB = 0x0002
OP_GET_PRINTER_ATTRIBUTES = 0x000B

# デリミタタグ
TAG_OPERATION_ATTRS = 0x01
TAG_JOB_ATTRS = 0x02
TAG_END_OF_ATTRS = 0x03
TAG_PRINTER_ATTRS = 0x04
TAG_UNSUPPORTED_ATTRS = 0x05

# 値タグ
TAG_INTEGER = 0x21
TAG_BOOLEAN = 0x22
TAG_ENUM = 0x23
TAG_TEXT = 0x41
TAG_NAME = 0x42
TAG_KEYWORD = 0x44
TAG_URI = 0x45
TAG_CHARSET = 0x47
TAG_NATURAL_LANGUAGE = 0x48
TAG_MIME_TYPE = 0x49

SUCCESS_STATUS_CODES = frozenset({0x0000, 0x0001, 0x0002})

STATUS_MESSAGES = {
    0x0000: "successful-ok",
    0x0001: "successful-ok-ignored-or-substituted-attributes",
    0x0002: "successful-ok-conflicting-attributes",
    0x0400: "client-error-bad-request",
    0x0401: "client-error-forbidden",
    0x0402: "client-error-not-authenticated",
    0x0403: "client-error-not-authorized",
    0x0404: "client-error-not-possible",
    0x0406: "client-error-not-found",
    0x040A: "client-error-document-format-not-supported",
    0x0413: "client-error-attributes-not-settable",
    0x0500: "server-error-internal-error",
    0x0501: "server-error-operation-not-supported",
    0x0506: "server-error-busy",
    0x0507: "server-error-job-canceled",
}


class IppError(Exception):
    """IPP 通信/プロトコルエラー."""


def _encode_attr(value_tag: int, name: str, value: Any) -> bytes:
    """属性 1 件をエンコードする."""
    name_b = name.encode("utf-8")
    if value_tag in (TAG_INTEGER, TAG_ENUM):
        value_b = struct.pack(">i", int(value))
    elif value_tag == TAG_BOOLEAN:
        value_b = struct.pack(">b", 1 if value else 0)
    else:
        value_b = str(value).encode("utf-8")
    return (
        struct.pack(">B", value_tag)
        + struct.pack(">H", len(name_b))
        + name_b
        + struct.pack(">H", len(value_b))
        + value_b
    )


def tag_for_python_value(value: Any) -> int:
    """設定ファイルの値の型から IPP 値タグを推定する."""
    if isinstance(value, bool):
        return TAG_BOOLEAN
    if isinstance(value, int):
        return TAG_INTEGER
    return TAG_KEYWORD


def build_print_job_request(
    printer_uri: str,
    document: bytes,
    *,
    job_name: str,
    requesting_user_name: str,
    document_format: str = "application/pdf",
    job_attributes: Optional[Dict[str, Any]] = None,
    request_id: int = 1,
) -> bytes:
    """Print-Job リクエスト全体 (ヘッダ + 属性 + ドキュメント) を構築する."""
    body = struct.pack(">BBHI", 2, 0, OP_PRINT_JOB, request_id)
    body += struct.pack(">B", TAG_OPERATION_ATTRS)
    body += _encode_attr(TAG_CHARSET, "attributes-charset", "utf-8")
    body += _encode_attr(TAG_NATURAL_LANGUAGE, "attributes-natural-language", "en")
    body += _encode_attr(TAG_URI, "printer-uri", printer_uri)
    body += _encode_attr(TAG_NAME, "requesting-user-name", requesting_user_name)
    body += _encode_attr(TAG_NAME, "job-name", job_name)
    body += _encode_attr(TAG_MIME_TYPE, "document-format", document_format)

    if job_attributes:
        body += struct.pack(">B", TAG_JOB_ATTRS)
        for name, value in job_attributes.items():
            body += _encode_attr(tag_for_python_value(value), name, value)

    body += struct.pack(">B", TAG_END_OF_ATTRS)
    body += document
    return body


def build_get_printer_attributes_request(
    printer_uri: str, *, requesting_user_name: str = "printdrop", request_id: int = 1
) -> bytes:
    """Get-Printer-Attributes リクエストを構築する."""
    body = struct.pack(">BBHI", 2, 0, OP_GET_PRINTER_ATTRIBUTES, request_id)
    body += struct.pack(">B", TAG_OPERATION_ATTRS)
    body += _encode_attr(TAG_CHARSET, "attributes-charset", "utf-8")
    body += _encode_attr(TAG_NATURAL_LANGUAGE, "attributes-natural-language", "en")
    body += _encode_attr(TAG_URI, "printer-uri", printer_uri)
    body += _encode_attr(TAG_NAME, "requesting-user-name", requesting_user_name)
    body += struct.pack(">B", TAG_END_OF_ATTRS)
    return body


@dataclass
class IppResponse:
    """IPP レスポンスの解析結果."""

    version: Tuple[int, int]
    status_code: int
    request_id: int
    # グループタグ -> [属性名 -> 値リスト] のリスト (同タグの複数グループに対応)
    groups: Dict[int, List[Dict[str, List[Any]]]] = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return self.status_code in SUCCESS_STATUS_CODES

    @property
    def status_name(self) -> str:
        return STATUS_MESSAGES.get(self.status_code, f"0x{self.status_code:04x}")

    def first(self, group_tag: int, name: str) -> Optional[Any]:
        """指定グループから属性の先頭値を返す."""
        for group in self.groups.get(group_tag, []):
            if name in group and group[name]:
                return group[name][0]
        return None

    @property
    def job_id(self) -> Optional[int]:
        return self.first(TAG_JOB_ATTRS, "job-id")

    @property
    def status_message(self) -> Optional[str]:
        return self.first(TAG_OPERATION_ATTRS, "status-message")


def parse_response(data: bytes) -> IppResponse:
    """IPP レスポンスのバイト列を解析する."""
    if len(data) < 8:
        raise IppError(f"IPP レスポンスが短すぎます ({len(data)} bytes)")
    major, minor, status_code, request_id = struct.unpack(">BBHI", data[:8])
    resp = IppResponse(
        version=(major, minor), status_code=status_code, request_id=request_id
    )

    pos = 8
    current_group: Optional[Dict[str, List[Any]]] = None
    last_attr_name: Optional[str] = None
    while pos < len(data):
        tag = data[pos]
        pos += 1
        if tag == TAG_END_OF_ATTRS:
            break
        if tag < 0x10:  # デリミタタグ = 新しい属性グループ
            current_group = {}
            resp.groups.setdefault(tag, []).append(current_group)
            last_attr_name = None
            continue

        if pos + 2 > len(data):
            raise IppError("IPP レスポンスの属性名長が壊れています")
        (name_len,) = struct.unpack(">H", data[pos : pos + 2])
        pos += 2
        name = data[pos : pos + name_len].decode("utf-8", "replace")
        pos += name_len

        if pos + 2 > len(data):
            raise IppError("IPP レスポンスの属性値長が壊れています")
        (value_len,) = struct.unpack(">H", data[pos : pos + 2])
        pos += 2
        raw = data[pos : pos + value_len]
        pos += value_len

        if tag in (TAG_INTEGER, TAG_ENUM) and value_len == 4:
            value: Any = struct.unpack(">i", raw)[0]
        elif tag == TAG_BOOLEAN and value_len == 1:
            value = bool(raw[0])
        else:
            value = raw.decode("utf-8", "replace")

        if name_len == 0:
            # 直前の属性への追加値 (1setOf)
            if current_group is None or last_attr_name is None:
                continue
            current_group[last_attr_name].append(value)
        else:
            if current_group is None:
                current_group = {}
                resp.groups.setdefault(TAG_OPERATION_ATTRS, []).append(current_group)
            current_group.setdefault(name, []).append(value)
            last_attr_name = name

    return resp


def send_request(
    printer_uri: str,
    payload: bytes,
    *,
    timeout: float = 60.0,
    tls_verify: bool = False,
) -> IppResponse:
    """IPP リクエストを HTTP POST で送信し、レスポンスを解析して返す."""
    parsed = urlparse(printer_uri)
    scheme = parsed.scheme.lower()
    host = parsed.hostname
    if not host:
        raise IppError(f"プリンター URI が不正です: {printer_uri}")
    path = parsed.path or "/"

    if scheme in ("ipps", "https"):
        port = parsed.port or (631 if scheme == "ipps" else 443)
        if tls_verify:
            context = ssl.create_default_context()
        else:
            # プリンターは自己署名証明書が一般的なため、既定では検証しない
            context = ssl._create_unverified_context()  # noqa: SLF001
        conn: http.client.HTTPConnection = http.client.HTTPSConnection(
            host, port, timeout=timeout, context=context
        )
    elif scheme in ("ipp", "http"):
        port = parsed.port or (631 if scheme == "ipp" else 80)
        conn = http.client.HTTPConnection(host, port, timeout=timeout)
    else:
        raise IppError(f"未対応のスキームです: {scheme} (ipp/ipps/http/https のみ)")

    try:
        conn.request(
            "POST",
            path,
            body=payload,
            headers={
                "Content-Type": "application/ipp",
                "Content-Length": str(len(payload)),
                "User-Agent": "printdrop/1.0",
            },
        )
        http_resp = conn.getresponse()
        body = http_resp.read()
        if http_resp.status != 200:
            raise IppError(
                f"HTTP エラー {http_resp.status} {http_resp.reason} "
                f"(URI: {printer_uri})"
            )
    except (OSError, http.client.HTTPException) as exc:
        raise IppError(f"プリンターへの接続に失敗しました: {exc}") from exc
    finally:
        conn.close()

    return parse_response(body)


def print_pdf(
    printer_uri: str,
    pdf_data: bytes,
    *,
    job_name: str,
    requesting_user_name: str,
    job_attributes: Optional[Dict[str, Any]] = None,
    timeout: float = 60.0,
    tls_verify: bool = False,
) -> IppResponse:
    """PDF を Print-Job として送信する。失敗時は IppError を送出."""
    payload = build_print_job_request(
        printer_uri,
        pdf_data,
        job_name=job_name,
        requesting_user_name=requesting_user_name,
        job_attributes=job_attributes,
    )
    resp = send_request(printer_uri, payload, timeout=timeout, tls_verify=tls_verify)
    if not resp.ok:
        detail = resp.status_message or ""
        raise IppError(
            f"印刷ジョブが拒否されました: {resp.status_name} {detail}".strip()
        )
    return resp


def get_printer_attributes(
    printer_uri: str, *, timeout: float = 30.0, tls_verify: bool = False
) -> IppResponse:
    """プリンター属性を取得する (接続テスト用)。失敗時は IppError を送出."""
    payload = build_get_printer_attributes_request(printer_uri)
    resp = send_request(printer_uri, payload, timeout=timeout, tls_verify=tls_verify)
    if not resp.ok:
        detail = resp.status_message or ""
        raise IppError(
            f"プリンター属性の取得に失敗しました: {resp.status_name} {detail}".strip()
        )
    return resp
