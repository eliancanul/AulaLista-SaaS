"""GIS: verificación mantenida, caché de certificados y red acotada."""

import secrets

import cachecontrol
import google.auth.exceptions
import google.auth.transport.requests
import requests
from google.oauth2 import id_token


class GoogleVerifier:
    def __init__(self, client_id: str):
        self.client_id = client_id
        self.transport = google.auth.transport.requests.Request(
            session=cachecontrol.CacheControl(requests.Session())
        )

    def verify(self, credential: str, nonce: str) -> dict:
        def bounded_request(url, method="GET", body=None, headers=None, **kwargs):
            return self.transport(
                url=url, method=method, body=body, headers=headers, timeout=3
            )

        try:
            claims = id_token.verify_oauth2_token(
                credential, bounded_request, self.client_id
            )
            if (
                claims.get("aud") != self.client_id
                or claims.get("iss")
                not in {"accounts.google.com", "https://accounts.google.com"}
                or not isinstance(claims.get("sub"), str)
                or not 1 <= len(claims["sub"]) <= 255
                or not isinstance(claims.get("nonce"), str)
                or not secrets.compare_digest(claims["nonce"].encode(), nonce.encode())
                or not isinstance(claims.get("email"), str)
                or len(claims["email"]) > 320
                or claims.get("email_verified") is not True
            ):
                raise ValueError
            return dict(claims, iss="https://accounts.google.com")
        except (
            ValueError,
            KeyError,
            TypeError,
            google.auth.exceptions.GoogleAuthError,
            requests.RequestException,
        ):
            raise ValueError("Invalid Google credential.") from None
