"use client"

import { useEffect, useState } from "react"
import { apiFetch, ApiError } from "@/lib/api"
import { encryptForVault } from "@/lib/vault-crypto"

interface SubmissionReceipt {
  id: string
  sha256_checksum: string
  status: string
  created_at: string
}

const VAULT_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAULT_PUBLIC_KEY ?? ""

export function SecureSubmissionForm({ accessToken }: { accessToken: string }) {
  const [fullName, setFullName] = useState("")
  const [contactInfo, setContactInfo] = useState("")
  const [sensitiveNote, setSensitiveNote] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastReceipt, setLastReceipt] = useState<SubmissionReceipt | null>(null)
  const [receipts, setReceipts] = useState<SubmissionReceipt[]>([])

  async function loadReceipts() {
    try {
      const items = await apiFetch<SubmissionReceipt[]>("/v1/vault/submissions/mine", {
        token: accessToken,
      })
      setReceipts(items)
    } catch {
      // Non-fatal on initial load
    }
  }

  useEffect(() => {
    loadReceipts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    try {
      const encrypted = await encryptForVault(
        {
          full_name: fullName.trim(),
          contact_info: contactInfo.trim(),
          sensitive_note: sensitiveNote.trim(),
          submitted_at_client: new Date().toISOString(),
        },
        VAULT_PUBLIC_KEY,
      )

      const receipt = await apiFetch<SubmissionReceipt>("/v1/vault/submissions", {
        method: "POST",
        token: accessToken,
        body: JSON.stringify(encrypted),
      })

      setLastReceipt(receipt)
      setFullName("")
      setContactInfo("")
      setSensitiveNote("")
      await loadReceipts()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      <form
        onSubmit={handleSubmit}
        className="space-y-4 rounded-lg border border-zinc-200 p-5 dark:border-zinc-800"
      >
        <div>
          <h2 className="text-lg font-semibold">Zero-Knowledge Encrypted Submission</h2>
          <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
            Data is encrypted inside your browser (AES-256-GCM + RSA-OAEP) before leaving your
            device. Only the isolated local vault holds the private key to decrypt it.
          </p>
        </div>

        {!VAULT_PUBLIC_KEY && (
          <div className="rounded-md bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
            Missing <code>NEXT_PUBLIC_VAULT_PUBLIC_KEY</code> in frontend environment. Run{" "}
            <code>local_vault/keygen.py</code> to generate keys first.
          </div>
        )}

        <div>
          <label className="mb-1 block text-sm font-medium">Full Name / Identifier</label>
          <input
            type="text"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Nguyen Van A"
            className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Contact / Reference</label>
          <input
            type="text"
            required
            value={contactInfo}
            onChange={(e) => setContactInfo(e.target.value)}
            placeholder="Phone, ID, or reference code"
            className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Sensitive Payload</label>
          <textarea
            required
            rows={4}
            value={sensitiveNote}
            onChange={(e) => setSensitiveNote(e.target.value)}
            placeholder="Enter confidential information..."
            className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
          />
        </div>

        {error && (
          <p className="rounded-md bg-red-50 p-3 text-xs text-red-700 dark:bg-red-950 dark:text-red-200">
            {error}
          </p>
        )}

        {lastReceipt && (
          <div className="rounded-md bg-emerald-50 p-3 text-xs text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
            <p className="font-medium">Encrypted & queued in drop-box</p>
            <p className="mt-1 font-mono break-all">
              ID: {lastReceipt.id}
              <br />
              SHA-256: {lastReceipt.sha256_checksum}
            </p>
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || !VAULT_PUBLIC_KEY}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {submitting ? "Encrypting & Sending..." : "Encrypt & Submit"}
        </button>
      </form>

      {receipts.length > 0 && (
        <div className="rounded-lg border border-zinc-200 p-5 dark:border-zinc-800">
          <h3 className="mb-3 text-sm font-semibold">Recent Encrypted Receipts</h3>
          <ul className="space-y-2 text-xs">
            {receipts.map((item) => (
              <li
                key={item.id}
                className="flex flex-col gap-1 rounded border border-zinc-100 p-2 dark:border-zinc-800"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono">{item.id}</span>
                  <span className="rounded bg-zinc-100 px-2 py-0.5 uppercase dark:bg-zinc-800">
                    {item.status}
                  </span>
                </div>
                <span className="font-mono text-zinc-500 break-all">
                  sha256: {item.sha256_checksum}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
