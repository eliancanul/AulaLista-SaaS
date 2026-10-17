"""Verify locally signed synthetic tokens through the real Google auth library.

PYTEST_DONT_REWRITE: do not expose synthetic JWTs in failing assertions.
"""

import json
import time
from types import SimpleNamespace

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from google.auth import crypt, jwt

from aulalista_api.auth_google import GoogleVerifier

CLIENT = "synthetic.apps.googleusercontent.com"


@pytest.fixture(scope="module")
def signing_material():
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    public = (
        key.public_key()
        .public_bytes(
            serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
        )
        .decode()
    )
    return crypt.RSASigner.from_string(private, key_id="synthetic-key"), public


def credential(signer, **overrides):
    instant = int(time.time())
    claims = {
        "iss": "https://accounts.google.com",
        "aud": CLIENT,
        "sub": "synthetic-subject",
        "iat": instant - 1,
        "exp": instant + 600,
        "nonce": "one-use-nonce",
        "email": "synthetic@example.test",
        "email_verified": True,
        **overrides,
    }
    return jwt.encode(signer, claims).decode()


def verifier(public):
    result = GoogleVerifier(CLIENT)

    def transport(**kwargs):
        assert kwargs["timeout"] == 3
        assert kwargs["method"] == "GET"
        assert kwargs["url"] == "https://www.googleapis.com/oauth2/v1/certs"
        return SimpleNamespace(
            status=200, data=json.dumps({"synthetic-key": public}).encode()
        )

    result.transport = transport
    return result


def test_actual_signature_validates_without_external_network(signing_material):
    signer, public = signing_material
    assert (
        verifier(public).verify(credential(signer), "one-use-nonce")["sub"]
        == "synthetic-subject"
    )


@pytest.mark.parametrize(
    "overrides",
    [
        {"aud": "another-client.apps.googleusercontent.com"},
        {"iss": "https://attacker.example"},
        {"exp": 1},
        {"iat": 4_000_000_000, "exp": 4_000_000_100},
        {"nonce": "different-nonce"},
        {"email_verified": False},
        {"email_verified": "true"},
    ],
)
def test_signed_invalid_claims_are_denied(signing_material, overrides):
    signer, public = signing_material
    with pytest.raises(ValueError, match="Invalid Google credential"):
        verifier(public).verify(credential(signer, **overrides), "one-use-nonce")


def test_signature_from_untrusted_key_is_denied(signing_material):
    _, public = signing_material
    attacker = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private = attacker.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    signer = crypt.RSASigner.from_string(private, key_id="synthetic-key")
    with pytest.raises(ValueError, match="Invalid Google credential"):
        verifier(public).verify(credential(signer), "one-use-nonce")
