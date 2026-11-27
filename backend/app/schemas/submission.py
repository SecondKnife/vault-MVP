import re
from datetime import datetime
from uuid import UUID

from pydantic import Field, field_validator

from app.schemas._base import StrictModel, StrictORMModel

_HEX_SHA256_RE = re.compile(r"^[0-9a-fA-F]{64}$")


class SubmissionCreate(StrictModel):
    encrypted_session_key: str = Field(..., min_length=16, max_length=4096)
    iv: str = Field(..., min_length=8, max_length=64)
    ciphertext: str = Field(..., min_length=4, max_length=500_000)
    sha256_checksum: str = Field(..., min_length=64, max_length=64)

    @field_validator("sha256_checksum")
    @classmethod
    def _validate_checksum(cls, value: str) -> str:
        if not _HEX_SHA256_RE.match(value):
            raise ValueError("sha256_checksum must be a 64-character hex string.")
        return value.lower()


class SubmissionReceipt(StrictORMModel):
    id: UUID
    sha256_checksum: str
    status: str
    created_at: datetime


class VaultPullItem(StrictORMModel):
    id: UUID
    user_id: UUID
    encrypted_session_key: str
    iv: str
    ciphertext: str
    sha256_checksum: str
    created_at: datetime


class VaultAckRequest(StrictModel):
    ids: list[UUID] = Field(..., min_length=1, max_length=500)
