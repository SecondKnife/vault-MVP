"""One-way pull worker for the isolated local vault.

Polls the internet-facing FastAPI drop-box over outbound HTTPS, decrypts
records locally using private_key.pem, stores them into a local SQLite DB,
appends rows into a local Excel (.xlsx) file, and acknowledges deletion on
the internet server.
"""

import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import httpx
from openpyxl import Workbook, load_workbook

from crypto_vault import decrypt_submission, load_private_key

BASE_DIR = Path(__file__).parent
PRIVATE_KEY_PATH = Path(os.getenv("VAULT_PRIVATE_KEY_PATH", BASE_DIR / "keys" / "private_key.pem"))
DATA_DIR = Path(os.getenv("VAULT_DATA_DIR", BASE_DIR / "data"))
SQLITE_PATH = DATA_DIR / "vault_local.db"
EXCEL_PATH = DATA_DIR / "submissions.xlsx"

API_URL = os.getenv("VAULT_API_URL", "http://localhost:8000").rstrip("/")
INTERNAL_API_SECRET = os.getenv("INTERNAL_API_SECRET", "")

EXCEL_HEADERS = [
    "submission_id",
    "user_id",
    "created_at",
    "pulled_at_local",
    "sha256_checksum",
    "full_name",
    "contact_info",
    "sensitive_note",
    "raw_json",
]


def _init_sqlite(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS decrypted_submissions (
            submission_id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            pulled_at_local TEXT NOT NULL,
            sha256_checksum TEXT NOT NULL,
            full_name TEXT,
            contact_info TEXT,
            sensitive_note TEXT,
            raw_json TEXT NOT NULL
        )
        """
    )
    conn.commit()


def _append_excel(rows: list[list[str]]) -> None:
    if not rows:
        return
    if EXCEL_PATH.exists():
        wb = load_workbook(EXCEL_PATH)
        ws = wb.active
    else:
        wb = Workbook()
        ws = wb.active
        ws.title = "Submissions"
        ws.append(EXCEL_HEADERS)

    for row in rows:
        ws.append(row)

    wb.save(EXCEL_PATH)


def pull_once() -> int:
    if not INTERNAL_API_SECRET:
        raise RuntimeError("INTERNAL_API_SECRET environment variable is required.")
    if not PRIVATE_KEY_PATH.exists():
        raise FileNotFoundError(
            f"Private key not found at {PRIVATE_KEY_PATH}. Run keygen.py first."
        )

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    private_key = load_private_key(PRIVATE_KEY_PATH.read_bytes())
    headers = {"X-Internal-Token": INTERNAL_API_SECRET}

    with httpx.Client(timeout=30.0) as client:
        resp = client.get(f"{API_URL}/v1/vault/pull", headers=headers)
        resp.raise_for_status()
        items = resp.json()

        if not items:
            return 0

        conn = sqlite3.connect(SQLITE_PATH)
        _init_sqlite(conn)

        excel_rows: list[list[str]] = []
        acked_ids: list[str] = []
        now_iso = datetime.now(timezone.utc).isoformat()

        for item in items:
            payload = decrypt_submission(item, private_key)
            full_name = str(payload.get("full_name", ""))
            contact_info = str(payload.get("contact_info", ""))
            sensitive_note = str(payload.get("sensitive_note", ""))
            raw_json = json.dumps(payload, ensure_ascii=False)

            conn.execute(
                """
                INSERT OR IGNORE INTO decrypted_submissions (
                    submission_id, user_id, created_at, pulled_at_local,
                    sha256_checksum, full_name, contact_info, sensitive_note, raw_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    item["id"],
                    item["user_id"],
                    item["created_at"],
                    now_iso,
                    item["sha256_checksum"],
                    full_name,
                    contact_info,
                    sensitive_note,
                    raw_json,
                ),
            )
            excel_rows.append(
                [
                    item["id"],
                    item["user_id"],
                    item["created_at"],
                    now_iso,
                    item["sha256_checksum"],
                    full_name,
                    contact_info,
                    sensitive_note,
                    raw_json,
                ]
            )
            acked_ids.append(item["id"])

        conn.commit()
        conn.close()

        _append_excel(excel_rows)

        ack_resp = client.post(
            f"{API_URL}/v1/vault/ack",
            headers=headers,
            json={"ids": acked_ids},
        )
        ack_resp.raise_for_status()
        return len(acked_ids)


if __name__ == "__main__":
    count = pull_once()
    print(f"Pulled, decrypted, and exported {count} submission(s) to {EXCEL_PATH}")
