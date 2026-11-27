"""End-to-end test for zero-knowledge submission, one-way pull, local decrypt, and purge."""

import base64
import hashlib
import json
import os
import sys
from pathlib import Path

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi.testclient import TestClient

from app.config import settings
from app.database import Base, SessionLocal, engine
from app.main import app
from app.models.user import User
from app.services.auth_service import AuthService

# Import local_vault decryption helper directly to verify compatibility
_LOCAL_VAULT_DIR = str(Path(__file__).resolve().parents[2] / "local_vault")
if _LOCAL_VAULT_DIR not in sys.path:
    sys.path.insert(0, _LOCAL_VAULT_DIR)

from crypto_vault import decrypt_submission  # noqa: E402


def _client_encrypt(payload: dict, public_key) -> dict:
    session_key = AESGCM.generate_key(bit_length=256)
    iv = os.urandom(12)
    raw_ciphertext = AESGCM(session_key).encrypt(
        iv, json.dumps(payload).encode("utf-8"), None
    )
    wrapped_key = public_key.encrypt(
        session_key,
        padding.OAEP(
            mgf=padding.MGF1(algorithm=hashes.SHA256()),
            algorithm=hashes.SHA256(),
            label=None,
        ),
    )
    return {
        "encrypted_session_key": base64.b64encode(wrapped_key).decode("ascii"),
        "iv": base64.b64encode(iv).decode("ascii"),
        "ciphertext": base64.b64encode(raw_ciphertext).decode("ascii"),
        "sha256_checksum": hashlib.sha256(raw_ciphertext).hexdigest(),
    }


def test_vault_end_to_end_flow():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == "vault-test@example.com").first()
        if not user:
            user = User(
                email="vault-test@example.com",
                username="vaulttester",
                is_active=True,
                is_verified=True,
            )
            db.add(user)
            db.commit()
            db.refresh(user)
        token_pair = AuthService(db)._issue_token_pair(user)
        access_token = token_pair.access_token
    finally:
        db.close()

    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public_key = private_key.public_key()

    secret_payload = {
        "full_name": "Nguyen Van A",
        "contact_info": "0909123456",
        "sensitive_note": "Top secret MVP payload",
    }
    encrypted_pkg = _client_encrypt(secret_payload, public_key)

    original_internal = settings.internal_api_secret
    settings.internal_api_secret = "test-vault-internal-secret-32bytes"
    try:
        client = TestClient(app)

        # 1. Tampered checksum is rejected
        bad_pkg = dict(encrypted_pkg, sha256_checksum="0" * 64)
        res_bad = client.post(
            "/v1/vault/submissions",
            json=bad_pkg,
            headers={"Authorization": f"Bearer {access_token}"},
        )
        assert res_bad.status_code == 422

        # 2. Valid encrypted submission is accepted (202)
        res_ok = client.post(
            "/v1/vault/submissions",
            json=encrypted_pkg,
            headers={"Authorization": f"Bearer {access_token}"},
        )
        assert res_ok.status_code == 202, res_ok.text
        receipt = res_ok.json()
        assert receipt["status"] == "pending"

        # 3. Pull without internal token is blocked (403)
        res_unauth = client.get("/v1/vault/pull")
        assert res_unauth.status_code == 403

        # 4. Pull with internal token returns encrypted item
        res_pull = client.get(
            "/v1/vault/pull",
            headers={"X-Internal-Token": settings.internal_api_secret},
        )
        assert res_pull.status_code == 200
        items = res_pull.json()
        matching = [i for i in items if i["id"] == receipt["id"]]
        assert len(matching) == 1

        # 5. Local vault decrypts using private key
        decrypted = decrypt_submission(matching[0], private_key)
        assert decrypted == secret_payload

        # 6. Acknowledge & purge from internet DB
        res_ack = client.post(
            "/v1/vault/ack",
            json={"ids": [receipt["id"]]},
            headers={"X-Internal-Token": settings.internal_api_secret},
        )
        assert res_ack.status_code == 200
        assert res_ack.json()["acknowledged"] == 1

        # 7. Confirm item is gone from pending pull queue
        res_pull_after = client.get(
            "/v1/vault/pull",
            headers={"X-Internal-Token": settings.internal_api_secret},
        )
        assert all(i["id"] != receipt["id"] for i in res_pull_after.json())
    finally:
        settings.internal_api_secret = original_internal
