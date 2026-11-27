import base64
import hashlib
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user, require_internal_token
from app.models.encrypted_submission import EncryptedSubmission
from app.models.user import User
from app.schemas.submission import (
    SubmissionCreate,
    SubmissionReceipt,
    VaultAckRequest,
    VaultPullItem,
)
from app.utils.rate_limit import limiter

router = APIRouter(prefix="/vault", tags=["vault"])


@router.post("/submissions", response_model=SubmissionReceipt, status_code=status.HTTP_202_ACCEPTED)
@limiter.limit("20/minute")
def submit_encrypted_payload(
    request: Request,
    data: SubmissionCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Accept an already client-encrypted payload from an authenticated user.

    Verifies the SHA-256 checksum of the ciphertext bytes before persisting it
    to the dropbox queue for one-way retrieval by the local vault server.
    """
    try:
        raw_ciphertext = base64.b64decode(data.ciphertext, validate=True)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "INVALID_CIPHERTEXT",
                "message": "ciphertext must be valid base64.",
                "field": "ciphertext",
                "meta": None,
            },
        )

    computed = hashlib.sha256(raw_ciphertext).hexdigest()
    if computed != data.sha256_checksum:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "CHECKSUM_MISMATCH",
                "message": "sha256_checksum does not match ciphertext.",
                "field": "sha256_checksum",
                "meta": None,
            },
        )

    record = EncryptedSubmission(
        user_id=current_user.id,
        encrypted_session_key=data.encrypted_session_key,
        iv=data.iv,
        ciphertext=data.ciphertext,
        sha256_checksum=data.sha256_checksum,
        status="pending",
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


@router.get("/submissions/mine", response_model=list[SubmissionReceipt])
@limiter.limit("60/minute")
def list_my_submissions(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return receipt metadata (no ciphertext) for the authenticated user."""
    return (
        db.query(EncryptedSubmission)
        .filter(EncryptedSubmission.user_id == current_user.id)
        .order_by(EncryptedSubmission.created_at.desc())
        .limit(50)
        .all()
    )


@router.get("/pull", response_model=list[VaultPullItem], dependencies=[Depends(require_internal_token)])
@limiter.limit("60/minute")
def pull_pending_submissions(
    request: Request,
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
):
    """One-way pull endpoint polled by the isolated local vault server."""
    return (
        db.query(EncryptedSubmission)
        .filter(EncryptedSubmission.status == "pending")
        .order_by(EncryptedSubmission.created_at.asc())
        .limit(limit)
        .all()
    )


@router.post("/ack", dependencies=[Depends(require_internal_token)])
@limiter.limit("60/minute")
def acknowledge_pulled_submissions(
    request: Request,
    data: VaultAckRequest,
    purge: bool = Query(default=True, description="Delete ciphertext from internet DB after local decryption"),
    db: Session = Depends(get_db),
):
    """Confirm local decryption and purge or mark pulled records."""
    uuid_ids = [UUID(i) for i in data.ids]
    rows = (
        db.query(EncryptedSubmission)
        .filter(EncryptedSubmission.id.in_(uuid_ids))
        .all()
    )
    if purge:
        for row in rows:
            db.delete(row)
    else:
        now = datetime.now(timezone.utc)
        for row in rows:
            row.status = "pulled"
            row.pulled_at = now
    db.commit()
    return {"acknowledged": len(rows), "purged": purge}
