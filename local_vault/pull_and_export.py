"""One-way pull worker for the isolated local vault.

Polls the internet-facing FastAPI drop-box over outbound HTTPS, decrypts
records locally using private_key.pem, stores them into a local SQLite DB,
appends rows into categorized sheets (SuatAn / QuanNhu) in a local Excel
(.xlsx) file, and acknowledges deletion on the internet server.
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

SUAT_AN_HEADERS = [
    "submission_id",
    "ngay_bao_cao",
    "don_vi",
    "can_bo_lap",
    "che_do_an",
    "don_gia_vnd",
    "quan_so_an",
    "quan_so_cat",
    "du_toan_vnd",
    "gao_te_kg",
    "thit_kg",
    "ca_hai_san_kg",
    "rau_xanh_kg",
    "gia_vi_chat_dot",
    "tgsx_tai_cho",
    "pulled_at_local",
    "sha256_checksum",
]

QUAN_NHU_HEADERS = [
    "submission_id",
    "ngay_bao_cao",
    "don_vi",
    "can_bo_lap",
    "ky_bao_dam",
    "loai_phieu",
    "chi_tiet_quan_trang",
    "ghi_chu",
    "pulled_at_local",
    "sha256_checksum",
]


def _init_sqlite(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS decrypted_submissions (
            submission_id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            report_type TEXT NOT NULL,
            unit_name TEXT,
            report_date TEXT,
            created_at TEXT NOT NULL,
            pulled_at_local TEXT NOT NULL,
            sha256_checksum TEXT NOT NULL,
            raw_json TEXT NOT NULL
        )
        """
    )
    conn.commit()


def _get_or_create_sheet(wb: Workbook, title: str, headers: list[str]):
    if title in wb.sheetnames:
        return wb[title]
    ws = wb.create_sheet(title=title)
    ws.append(headers)
    return ws


def _append_excel(suat_an_rows: list[list], quan_nhu_rows: list[list]) -> None:
    if not suat_an_rows and not quan_nhu_rows:
        return

    if EXCEL_PATH.exists():
        wb = load_workbook(EXCEL_PATH)
    else:
        wb = Workbook()
        default_ws = wb.active
        default_ws.title = "SuatAn"
        default_ws.append(SUAT_AN_HEADERS)

    if suat_an_rows:
        ws_an = _get_or_create_sheet(wb, "SuatAn", SUAT_AN_HEADERS)
        for row in suat_an_rows:
            ws_an.append(row)

    if quan_nhu_rows:
        ws_qn = _get_or_create_sheet(wb, "QuanNhu", QUAN_NHU_HEADERS)
        for row in quan_nhu_rows:
            ws_qn.append(row)

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

        suat_an_rows: list[list] = []
        quan_nhu_rows: list[list] = []
        acked_ids: list[str] = []
        now_iso = datetime.now(timezone.utc).isoformat()

        for item in items:
            payload = decrypt_submission(item, private_key)
            report_type = str(payload.get("report_type", "unknown"))
            unit_name = str(payload.get("unit_name", ""))
            reporter_name = str(payload.get("reporter_name", ""))
            report_date = str(payload.get("report_date", ""))
            raw_json = json.dumps(payload, ensure_ascii=False)

            conn.execute(
                """
                INSERT OR IGNORE INTO decrypted_submissions (
                    submission_id, user_id, report_type, unit_name, report_date,
                    created_at, pulled_at_local, sha256_checksum, raw_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    item["id"],
                    item["user_id"],
                    report_type,
                    unit_name,
                    report_date,
                    item["created_at"],
                    now_iso,
                    item["sha256_checksum"],
                    raw_json,
                ),
            )

            if report_type == "suat_an":
                rations = payload.get("food_rations_kg") or {}
                suat_an_rows.append(
                    [
                        item["id"],
                        report_date,
                        unit_name,
                        reporter_name,
                        str(payload.get("ration_standard", "")),
                        payload.get("unit_cost_vnd", 0),
                        payload.get("headcount_active", 0),
                        payload.get("headcount_absent", 0),
                        payload.get("total_budget_vnd", 0),
                        rations.get("gao_te", 0),
                        rations.get("thit", 0),
                        rations.get("ca_hai_san", 0),
                        rations.get("rau_xanh", 0),
                        str(payload.get("spice_fuel_note", "")),
                        str(payload.get("tgsx_note", "")),
                        now_iso,
                        item["sha256_checksum"],
                    ]
                )
            else:
                equip_list = payload.get("items") or []
                equip_summary = "; ".join(
                    f"{e.get('item_name', '')} ({e.get('size_spec', '')}) x{e.get('quantity', 0)} [{e.get('condition', '')}]"
                    for e in equip_list
                )
                quan_nhu_rows.append(
                    [
                        item["id"],
                        report_date,
                        unit_name,
                        reporter_name,
                        str(payload.get("supply_period", "")),
                        str(payload.get("supply_type", "")),
                        equip_summary,
                        str(payload.get("remark", "")),
                        now_iso,
                        item["sha256_checksum"],
                    ]
                )

            acked_ids.append(item["id"])

        conn.commit()
        conn.close()

        _append_excel(suat_an_rows, quan_nhu_rows)

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
