"use client"

import { useEffect, useMemo, useState } from "react"
import { apiFetch, ApiError } from "@/lib/api"
import { encryptForVault } from "@/lib/vault-crypto"

interface SubmissionReceipt {
  id: string
  sha256_checksum: string
  status: string
  created_at: string
}

type FormMode = "suat_an" | "quan_nhu"

interface RationPreset {
  id: string
  label: string
  baseRate: number
  multiplier: number
  note: string
}

const RATION_PRESETS: RationPreset[] = [
  {
    id: "bo_binh_co_ban",
    label: "Bộ binh cơ bản (TT 96/2025/TT-BQP)",
    baseRate: 72000,
    multiplier: 1.0,
    note: "72.000đ/người/ngày",
  },
  {
    id: "da_ngoai_dien_tap",
    label: "Huấn luyện dã ngoại / Diễn tập",
    baseRate: 72000,
    multiplier: 1.5,
    note: "Hệ số 1.5x (108.000đ/người/ngày)",
  },
  {
    id: "truc_sscd",
    label: "Trực Sẵn sàng chiến đấu / Đặc thù",
    baseRate: 72000,
    multiplier: 1.25,
    note: "Hệ số 1.25x (90.000đ/người/ngày)",
  },
  {
    id: "benh_xa_dieu_tri",
    label: "Bệnh xá / Điều trị quân y",
    baseRate: 72000,
    multiplier: 1.75,
    note: "Hệ số 1.75x (126.000đ/người/ngày)",
  },
  {
    id: "le_tet",
    label: "Ăn thêm ngày Lễ / Tết",
    baseRate: 72000,
    multiplier: 2.0,
    note: "Cộng thêm 100% cơ bản (144.000đ/người/ngày)",
  },
]

const QUARTERMASTER_CATALOG = [
  "Quần áo thường dùng Xuân Hè",
  "Quần áo thường dùng Thu Đông",
  "Quần áo dã ngoại (huấn luyện)",
  "Bộ lễ phục",
  "Giày da sĩ quan / QNCN",
  "Giày vải huấn luyện (bata)",
  "Dép nhựa đúc",
  "Mũ kê-pi / Mũ mềm / Mũ cứng",
  "Dây lưng chiến đấu / Mặt khóa",
  "Áo lót / Quần đùi / Tất chân",
  "Ba lô con cóc & Áo mưa",
  "Doanh cụ (Chăn, Màn, Chiếu, Gối)",
  "Dụng cụ cấp dưỡng, khay ăn",
]

interface EquipmentItem {
  item_name: string
  size_spec: string
  quantity: number
  condition: string
}

const VAULT_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAULT_PUBLIC_KEY ?? ""

export function SecureSubmissionForm({
  accessToken,
  username,
}: {
  accessToken: string
  username: string
}) {
  const [mode, setMode] = useState<FormMode>("suat_an")

  // ── Shared Unit Metadata ──────────────────────────────────────────────────
  const [unitName, setUnitName] = useState("")
  const [reporterName, setReporterName] = useState(username)
  const [reportDate, setReportDate] = useState(() => new Date().toISOString().slice(0, 10))

  // ── Tab 1: Suất ăn & Báo cơm ──────────────────────────────────────────────
  const [rationPresetId, setRationPresetId] = useState(RATION_PRESETS[0].id)
  const [headcountActive, setHeadcountActive] = useState<number>(80)
  const [headcountAbsent, setHeadcountAbsent] = useState<number>(4)
  const [riceKg, setRiceKg] = useState<string>("56")
  const [meatKg, setMeatKg] = useState<string>("18")
  const [fishKg, setFishKg] = useState<string>("10")
  const [vegKg, setVegKg] = useState<string>("40")
  const [spiceFuelNote, setSpiceFuelNote] = useState("Đậu phụ, dầu ăn, nước mắm, gas bếp tập thể")
  const [tgsxNote, setTgsxNote] = useState("")

  // ── Tab 2: Quân nhu & Quân trang ──────────────────────────────────────────
  const [supplyPeriod, setSupplyPeriod] = useState("Quý IV/2026")
  const [supplyType, setSupplyType] = useState("Cấp phát định kỳ")
  const [equipmentItems, setEquipmentItems] = useState<EquipmentItem[]>([
    { item_name: QUARTERMASTER_CATALOG[2], size_spec: "Cỡ 4", quantity: 30, condition: "Mới 100%" },
    { item_name: QUARTERMASTER_CATALOG[5], size_spec: "Số 40-42", quantity: 30, condition: "Mới 100%" },
  ])
  const [supplyRemark, setSupplyRemark] = useState("")

  // ── Submission & Receipts State ───────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastReceipt, setLastReceipt] = useState<SubmissionReceipt | null>(null)
  const [receipts, setReceipts] = useState<SubmissionReceipt[]>([])

  const selectedPreset = useMemo(
    () => RATION_PRESETS.find((p) => p.id === rationPresetId) ?? RATION_PRESETS[0],
    [rationPresetId],
  )
  const dailyUnitCost = Math.round(selectedPreset.baseRate * selectedPreset.multiplier)
  const totalEstimatedBudget = Math.max(0, headcountActive) * dailyUnitCost

  async function loadReceipts() {
    try {
      const items = await apiFetch<SubmissionReceipt[]>("/v1/vault/submissions/mine", {
        token: accessToken,
      })
      setReceipts(items)
    } catch {
      // Non-fatal
    }
  }

  useEffect(() => {
    loadReceipts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken])

  function addEquipmentRow() {
    setEquipmentItems((prev) => [
      ...prev,
      { item_name: QUARTERMASTER_CATALOG[0], size_spec: "Cỡ 4", quantity: 10, condition: "Mới 100%" },
    ])
  }

  function updateEquipmentRow(index: number, patch: Partial<EquipmentItem>) {
    setEquipmentItems((prev) =>
      prev.map((row, idx) => (idx === index ? { ...row, ...patch } : row)),
    )
  }

  function removeEquipmentRow(index: number) {
    setEquipmentItems((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== index) : prev))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    try {
      const payload =
        mode === "suat_an"
          ? {
              report_type: "suat_an",
              unit_name: unitName.trim(),
              reporter_name: reporterName.trim(),
              report_date: reportDate,
              ration_standard: selectedPreset.label,
              unit_cost_vnd: dailyUnitCost,
              headcount_active: headcountActive,
              headcount_absent: headcountAbsent,
              total_budget_vnd: totalEstimatedBudget,
              food_rations_kg: {
                gao_te: Number(riceKg) || 0,
                thit: Number(meatKg) || 0,
                ca_hai_san: Number(fishKg) || 0,
                rau_xanh: Number(vegKg) || 0,
              },
              spice_fuel_note: spiceFuelNote.trim(),
              tgsx_note: tgsxNote.trim(),
              submitted_at_client: new Date().toISOString(),
            }
          : {
              report_type: "quan_nhu",
              unit_name: unitName.trim(),
              reporter_name: reporterName.trim(),
              report_date: reportDate,
              supply_period: supplyPeriod.trim(),
              supply_type: supplyType,
              items: equipmentItems,
              remark: supplyRemark.trim(),
              submitted_at_client: new Date().toISOString(),
            }

      const encrypted = await encryptForVault(payload, VAULT_PUBLIC_KEY)

      const receipt = await apiFetch<SubmissionReceipt>("/v1/vault/submissions", {
        method: "POST",
        token: accessToken,
        body: JSON.stringify(encrypted),
      })

      setLastReceipt(receipt)
      await loadReceipts()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Mode Switcher Tabs */}
      <div className="grid grid-cols-2 gap-2 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-900">
        <button
          type="button"
          onClick={() => setMode("suat_an")}
          className={`rounded-md px-3 py-2 text-sm font-medium transition ${
            mode === "suat_an"
              ? "bg-emerald-800 text-white shadow-sm"
              : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          }`}
        >
          Báo cơm & Định lượng Suất ăn
        </button>
        <button
          type="button"
          onClick={() => setMode("quan_nhu")}
          className={`rounded-md px-3 py-2 text-sm font-medium transition ${
            mode === "quan_nhu"
              ? "bg-emerald-800 text-white shadow-sm"
              : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          }`}
        >
          Kê khai & Cấp phát Quân nhu
        </button>
      </div>

      <form
        onSubmit={handleSubmit}
        className="space-y-5 rounded-lg border border-zinc-200 p-5 dark:border-zinc-800"
      >
        {!VAULT_PUBLIC_KEY && (
          <div className="rounded-md bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
            Thiếu <code>NEXT_PUBLIC_VAULT_PUBLIC_KEY</code> trong môi trường frontend. Chạy{" "}
            <code>local_vault/keygen.py</code> để sinh khóa trước.
          </div>
        )}

        {/* Shared Unit Info */}
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-1">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
              Đơn vị / Bếp ăn *
            </label>
            <input
              type="text"
              required
              value={unitName}
              onChange={(e) => setUnitName(e.target.value)}
              placeholder="VD: Tiểu đoàn 1 - Trung đoàn 2"
              className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
              Cán bộ lập phiếu *
            </label>
            <input
              type="text"
              required
              value={reporterName}
              onChange={(e) => setReporterName(e.target.value)}
              placeholder="Họ tên / Cấp bậc"
              className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
              Ngày báo cáo *
            </label>
            <input
              type="date"
              required
              value={reportDate}
              onChange={(e) => setReportDate(e.target.value)}
              className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
            />
          </div>
        </div>

        {mode === "suat_an" ? (
          <div className="space-y-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Tiêu chuẩn / Chế độ ăn
                </label>
                <select
                  value={rationPresetId}
                  onChange={(e) => setRationPresetId(e.target.value)}
                  className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                >
                  {RATION_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label} — {p.note}
                    </option>
                  ))}
                </select>
              </div>
              <div className="rounded-md bg-zinc-50 p-3 dark:bg-zinc-900">
                <span className="block text-[11px] text-zinc-500">Dự toán tiền ăn ngày</span>
                <span className="text-base font-bold text-emerald-700 dark:text-emerald-400">
                  {totalEstimatedBudget.toLocaleString("vi-VN")} đ
                </span>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Quân số ăn tại bếp (người) *
                </label>
                <input
                  type="number"
                  min={0}
                  required
                  value={headcountActive}
                  onChange={(e) => setHeadcountActive(Number(e.target.value))}
                  className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Quân số báo cắt / công tác / phép
                </label>
                <input
                  type="number"
                  min={0}
                  value={headcountAbsent}
                  onChange={(e) => setHeadcountAbsent(Number(e.target.value))}
                  className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
                />
              </div>
            </div>

            <div>
              <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-zinc-500">
                Định lượng thực phẩm xuất bếp (kg)
              </span>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <label className="mb-1 block text-xs text-zinc-500">Gạo tẻ (kg)</label>
                  <input
                    type="number"
                    step="0.1"
                    min={0}
                    value={riceKg}
                    onChange={(e) => setRiceKg(e.target.value)}
                    className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 text-sm dark:border-zinc-700"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-zinc-500">Thịt gia súc/cầm (kg)</label>
                  <input
                    type="number"
                    step="0.1"
                    min={0}
                    value={meatKg}
                    onChange={(e) => setMeatKg(e.target.value)}
                    className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 text-sm dark:border-zinc-700"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-zinc-500">Cá / Hải sản (kg)</label>
                  <input
                    type="number"
                    step="0.1"
                    min={0}
                    value={fishKg}
                    onChange={(e) => setFishKg(e.target.value)}
                    className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 text-sm dark:border-zinc-700"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-zinc-500">Rau xanh (kg)</label>
                  <input
                    type="number"
                    step="0.1"
                    min={0}
                    value={vegKg}
                    onChange={(e) => setVegKg(e.target.value)}
                    className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 text-sm dark:border-zinc-700"
                  />
                </div>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-zinc-500">
                  Đậu phụ, gia vị & chất đốt
                </label>
                <input
                  type="text"
                  value={spiceFuelNote}
                  onChange={(e) => setSpiceFuelNote(e.target.value)}
                  className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-zinc-500">
                  Nguồn Tăng gia sản xuất (TGSX) đưa vào bếp
                </label>
                <input
                  type="text"
                  value={tgsxNote}
                  onChange={(e) => setTgsxNote(e.target.value)}
                  placeholder="VD: 15kg rau muống, 5kg thịt lợn đơn vị"
                  className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Kỳ / Đợt bảo đảm
                </label>
                <input
                  type="text"
                  required
                  value={supplyPeriod}
                  onChange={(e) => setSupplyPeriod(e.target.value)}
                  placeholder="VD: Quý IV/2026 - Đợt 2"
                  className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Nghiệp vụ phiếu
                </label>
                <select
                  value={supplyType}
                  onChange={(e) => setSupplyType(e.target.value)}
                  className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                >
                  <option value="Cấp phát định kỳ">Cấp phát định kỳ (Niên hạn)</option>
                  <option value="Cấp phát bổ sung / Chiến sĩ mới">
                    Cấp phát bổ sung / Chiến sĩ mới
                  </option>
                  <option value="Dự trữ Sẵn sàng chiến đấu">Dự trữ Sẵn sàng chiến đấu</option>
                  <option value="Thu hồi / Đổi cũ">Thu hồi / Đổi cũ</option>
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Danh mục quân trang / doanh cụ
                </span>
                <button
                  type="button"
                  onClick={addEquipmentRow}
                  className="rounded border border-emerald-700 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 dark:border-emerald-500 dark:text-emerald-400 dark:hover:bg-emerald-950"
                >
                  + Thêm mặt hàng
                </button>
              </div>

              {equipmentItems.map((row, idx) => (
                <div
                  key={idx}
                  className="grid gap-2 rounded-md border border-zinc-200 p-2.5 sm:grid-cols-12 dark:border-zinc-800"
                >
                  <div className="sm:col-span-5">
                    <select
                      value={row.item_name}
                      onChange={(e) => updateEquipmentRow(idx, { item_name: e.target.value })}
                      className="w-full rounded border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                    >
                      {QUARTERMASTER_CATALOG.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <input
                      type="text"
                      value={row.size_spec}
                      onChange={(e) => updateEquipmentRow(idx, { size_spec: e.target.value })}
                      placeholder="Cỡ/Số"
                      className="w-full rounded border border-zinc-300 bg-transparent px-2 py-1.5 text-xs dark:border-zinc-700"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <input
                      type="number"
                      min={1}
                      value={row.quantity}
                      onChange={(e) =>
                        updateEquipmentRow(idx, { quantity: Number(e.target.value) })
                      }
                      placeholder="SL"
                      className="w-full rounded border border-zinc-300 bg-transparent px-2 py-1.5 text-xs dark:border-zinc-700"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <input
                      type="text"
                      value={row.condition}
                      onChange={(e) => updateEquipmentRow(idx, { condition: e.target.value })}
                      placeholder="Tình trạng"
                      className="w-full rounded border border-zinc-300 bg-transparent px-2 py-1.5 text-xs dark:border-zinc-700"
                    />
                  </div>
                  <div className="flex items-center justify-end sm:col-span-1">
                    <button
                      type="button"
                      onClick={() => removeEquipmentRow(idx)}
                      className="text-xs text-red-600 hover:underline dark:text-red-400"
                    >
                      Xóa
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div>
              <label className="mb-1 block text-xs text-zinc-500">Ghi chú kho / đề nghị bổ sung</label>
              <textarea
                rows={2}
                value={supplyRemark}
                onChange={(e) => setSupplyRemark(e.target.value)}
                placeholder="Ghi chú cỡ số thiếu hoặc yêu cầu điều chuyển..."
                className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
              />
            </div>
          </div>
        )}

        {error && (
          <p className="rounded-md bg-red-50 p-3 text-xs text-red-700 dark:bg-red-950 dark:text-red-200">
            {error}
          </p>
        )}

        {lastReceipt && (
          <div className="rounded-md bg-emerald-50 p-3 text-xs text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
            Đã gửi phiếu <span className="font-mono font-medium">{lastReceipt.id}</span> ({username})
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || !VAULT_PUBLIC_KEY}
          className="w-full rounded-lg bg-emerald-800 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50 sm:w-auto"
        >
          {submitting
            ? "Đang gửi..."
            : mode === "suat_an"
              ? "Gửi Phiếu Báo Cơm"
              : "Gửi Phiếu Quân Nhu"}
        </button>
      </form>

      {receipts.length > 0 && (
        <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Đang chờ xử lý ({receipts.filter((r) => r.status === "pending").length})
          </h3>
          <ul className="space-y-1.5 text-xs">
            {receipts
              .filter((item) => item.status === "pending")
              .map((item) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between rounded border border-zinc-100 px-3 py-1.5 dark:border-zinc-800"
                >
                  <span className="font-mono">{item.id}</span>
                  <span className="text-zinc-500">
                    {username} · {item.status}
                  </span>
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  )
}
