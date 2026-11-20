"""SMTP mail sender for Epson Email Print (empty body + PDF attachment) and CI fake."""

from __future__ import annotations

import os
import smtplib
from dataclasses import dataclass
from email.message import EmailMessage
from typing import Protocol


class MailSendError(Exception):
    def __init__(self, code: str, status: int = 502):
        super().__init__(code)
        self.code = code
        self.status = status


class MailSender(Protocol):
    @property
    def is_configured(self) -> bool: ...

    def send_pdf(
        self,
        *,
        to_email: str,
        filename: str,
        pdf_bytes: bytes,
        subject: str = "",
    ) -> None: ...


def build_epson_pdf_message(
    *,
    from_email: str,
    to_email: str,
    filename: str,
    pdf_bytes: bytes,
    subject: str = "",
) -> EmailMessage:
    """Build a MIME message with an empty body and ONLY the PDF attachment.

    Epson Email Print prints email bodies unless disabled in Epson Connect.
    Keeping the body empty prevents wasting paper on extra cover sheets.
    """
    msg = EmailMessage()
    msg["From"] = from_email
    msg["To"] = to_email
    # Subject is kept concise; body stays strictly empty.
    msg["Subject"] = subject[:120] if subject else "AulaLista PDF"
    safe_name = (
        filename.replace("/", "_")
        .replace("\\", "_")
        .replace("\r", "")
        .replace("\n", "")
    )
    if not safe_name.lower().endswith(".pdf"):
        safe_name = f"{safe_name}.pdf"
    msg.add_attachment(
        pdf_bytes,
        maintype="application",
        subtype="pdf",
        filename=safe_name,
    )
    return msg


class SmtpMailSender:
    """Standard-library SMTP sender (works with Gmail App Password or any SMTP server)."""

    def __init__(
        self,
        *,
        host: str,
        port: int,
        user: str,
        password: str,
        from_email: str,
        use_ssl: bool = False,
        timeout_seconds: int = 30,
    ):
        self._host = host.strip()
        self._port = port
        self._user = user.strip()
        self._password = password
        self._from_email = from_email.strip() or self._user
        self._use_ssl = use_ssl
        self._timeout = timeout_seconds

    @property
    def is_configured(self) -> bool:
        return bool(self._host and self._from_email)

    def send_pdf(
        self,
        *,
        to_email: str,
        filename: str,
        pdf_bytes: bytes,
        subject: str = "",
    ) -> None:
        if not self.is_configured:
            raise MailSendError("smtp_not_configured", status=503)
        msg = build_epson_pdf_message(
            from_email=self._from_email,
            to_email=to_email,
            filename=filename,
            pdf_bytes=pdf_bytes,
            subject=subject,
        )
        try:
            if self._use_ssl:
                with smtplib.SMTP_SSL(
                    self._host, self._port, timeout=self._timeout
                ) as server:
                    if self._user and self._password:
                        server.login(self._user, self._password)
                    server.send_message(msg)
            else:
                with smtplib.SMTP(
                    self._host, self._port, timeout=self._timeout
                ) as server:
                    server.ehlo()
                    if server.has_extn("starttls"):
                        server.starttls()
                        server.ehlo()
                    if self._user and self._password:
                        server.login(self._user, self._password)
                    server.send_message(msg)
        except smtplib.SMTPAuthenticationError:
            raise MailSendError("smtp_auth_failed", status=502) from None
        except smtplib.SMTPRecipientsRefused:
            raise MailSendError("smtp_recipient_refused", status=502) from None
        except (smtplib.SMTPException, OSError, TimeoutError):
            raise MailSendError("smtp_send_failed", status=502) from None


class UnconfiguredMailSender:
    @property
    def is_configured(self) -> bool:
        return False

    def send_pdf(
        self,
        *,
        to_email: str,
        filename: str,
        pdf_bytes: bytes,
        subject: str = "",
    ) -> None:
        raise MailSendError("smtp_not_configured", status=503)


@dataclass(frozen=True)
class SentMailRecord:
    to_email: str
    filename: str
    pdf_bytes: bytes
    subject: str


class FakeMailSender:
    """In-memory deterministic sender for pytest / CI."""

    def __init__(self, *, fail_with: str | None = None):
        self.sent: list[SentMailRecord] = []
        self.fail_with = fail_with

    @property
    def is_configured(self) -> bool:
        return True

    def send_pdf(
        self,
        *,
        to_email: str,
        filename: str,
        pdf_bytes: bytes,
        subject: str = "",
    ) -> None:
        if self.fail_with:
            raise MailSendError(self.fail_with, status=502)
        self.sent.append(
            SentMailRecord(
                to_email=to_email,
                filename=filename,
                pdf_bytes=pdf_bytes,
                subject=subject,
            )
        )


def load_mail_sender_from_env() -> MailSender:
    host = os.environ.get("SMTP_HOST", "").strip()
    if not host:
        return UnconfiguredMailSender()
    port_raw = os.environ.get("SMTP_PORT", "587").strip()
    try:
        port = int(port_raw)
    except ValueError:
        port = 587
    user = os.environ.get("SMTP_USER", "").strip()
    password = os.environ.get("SMTP_PASSWORD", "")
    from_email = os.environ.get("PRINT_FROM_EMAIL", "").strip() or user
    use_ssl_raw = os.environ.get("SMTP_USE_SSL", "").strip().lower()
    use_ssl = use_ssl_raw == "true" if use_ssl_raw else port == 465
    return SmtpMailSender(
        host=host,
        port=port,
        user=user,
        password=password,
        from_email=from_email,
        use_ssl=use_ssl,
    )
