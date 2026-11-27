import { auth } from "@/auth"
import { SecureSubmissionForm } from "@/components/SecureSubmissionForm"
import { logoutAction } from "@/lib/actions"
import { apiFetch, ApiError } from "@/lib/api"
import type { User } from "@/types"

// Minimal authenticated page: the middleware already guards /dashboard, so a
// session is expected here. Fetches the current user from the backend to show
// the full auth loop (cookie → access token → API) working.
export default async function DashboardPage() {
  const session = await auth()

  let user: User | null = null
  let loadError: string | null = null
  if (session?.accessToken) {
    try {
      user = await apiFetch<User>("/v1/auth/me", { token: session.accessToken })
    } catch (error) {
      loadError = error instanceof ApiError ? error.message : "Could not load your profile"
    }
  }

  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 px-6 py-10">
      <div className="flex items-center justify-between border-b border-zinc-200 pb-4 dark:border-zinc-800">
        <div>
          <h1 className="text-xl font-bold tracking-tight">
            Hệ thống Nhập liệu Quân nhu & Suất ăn Bảo mật
          </h1>
          <p className="text-xs text-zinc-500">
            Cổng tiếp nhận số liệu hậu cần từ xa — Dữ liệu được mã hóa đầu-cuối trước khi truyền
          </p>
        </div>
        <form action={logoutAction}>
          <button
            type="submit"
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium dark:border-zinc-700"
          >
            Đăng xuất
          </button>
        </form>
      </div>

      {user ? (
        <>
          <div className="rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800">
            <p>
              Tài khoản trực ban: <span className="font-medium">{user.username}</span> ({user.email})
            </p>
            <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
              Vai trò: {user.role} · Trạng thái xác thực JWT hợp lệ
            </p>
          </div>
          {session?.accessToken && (
            <SecureSubmissionForm accessToken={session.accessToken} username={user.username} />
          )}
        </>
      ) : (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {loadError ?? "No profile data available."}
        </p>
      )}
    </main>
  )
}
