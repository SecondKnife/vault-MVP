"""Hybrid decryption primitives (RSA-OAEP + AES-256-GCM + SHA-256)."""

import base64
import hashlib
import json
from typing import Any

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def load_private_key(pem_bytes: bytes):
    return serialization.load_pem_private_key(pem_bytes, password=None)


def decrypt_submission(item: dict[str, Any], private_key) -> dict[str, Any]:
    """Verify SHA-256 checksum, unwrap AES-256 session key, and decrypt payload."""
    raw_ciphertext = base64.b64decode(item["ciphertext"])
    computed_checksum = hashlib.sha256(raw_ciphertext).hexdigest()
    if computed_checksum != item["sha256_checksum"].lower():
        raise ValueError(f"Checksum mismatch for submission {item.get('id')}")

    wrapped_key = base64.b64decode(item["encrypted_session_key"])
    session_key = private_key.decrypt(
        wrapped_key,
        padding.OAEP(
            mgf=padding.MGF1(algorithm=hashes.SHA256()),
            algorithm=hashes.SHA256(),
            label=None,
        ),
    )

    iv = base64.b64decode(item["iv"])
    plaintext_bytes = AESGCM(session_key).decrypt(iv, raw_ciphertext, None)
    return json.loads(plaintext_bytes.decode("utf-8"))
