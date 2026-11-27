"""Generate RSA-4096 keypair for the isolated local vault.

Run ONLY on the single trusted local machine that is allowed to decrypt data.
Never deploy private_key.pem to the internet-facing server.
"""

import os
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

KEYS_DIR = Path(__file__).parent / "keys"
PRIVATE_KEY_PATH = KEYS_DIR / "private_key.pem"
PUBLIC_KEY_PATH = KEYS_DIR / "public_key.pem"


def generate_keypair(overwrite: bool = False) -> tuple[Path, Path]:
    KEYS_DIR.mkdir(parents=True, exist_ok=True)
    if PRIVATE_KEY_PATH.exists() and not overwrite:
        raise FileExistsError(
            f"{PRIVATE_KEY_PATH} already exists. Pass overwrite=True to replace it."
        )

    private_key = rsa.generate_private_key(public_exponent=65537, key_size=4096)

    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    public_pem = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )

    PRIVATE_KEY_PATH.write_bytes(private_pem)
    os.chmod(PRIVATE_KEY_PATH, 0o600)
    PUBLIC_KEY_PATH.write_bytes(public_pem)

    return PRIVATE_KEY_PATH, PUBLIC_KEY_PATH


if __name__ == "__main__":
    priv, pub = generate_keypair()
    pub_text = pub.read_text(encoding="utf-8").strip()
    escaped = pub_text.replace("\n", "\\n")
    print(f"Private key saved (keep offline/local only): {priv}")
    print(f"Public key saved: {pub}\n")
    print("Add this line to frontend/.env.local:")
    print(f'NEXT_PUBLIC_VAULT_PUBLIC_KEY="{escaped}"')
