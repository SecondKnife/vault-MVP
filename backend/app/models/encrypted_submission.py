import uuid

from sqlalchemy import Column, DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.database import Base


class EncryptedSubmission(Base):
    """Zero-knowledge dropbox record stored on the internet-facing DB.

    The server only stores ciphertext encrypted client-side with the local
    vault's public key, plus an integrity checksum and the authenticated
    sender's user_id (for rate-limiting and anti-spam attribution).
    """

    __tablename__ = "encrypted_submissions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    encrypted_session_key = Column(Text, nullable=False)
    iv = Column(String(64), nullable=False)
    ciphertext = Column(Text, nullable=False)
    sha256_checksum = Column(String(64), nullable=False, index=True)
    status = Column(String(32), nullable=False, server_default="pending", index=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    pulled_at = Column(DateTime(timezone=True), nullable=True)
