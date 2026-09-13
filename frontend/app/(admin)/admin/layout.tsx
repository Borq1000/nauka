// Layout НЕ выполняет проверку доступа. Она живёт в серверных функциях
// каждого раздела: Server Action публикуется как собственный HTTP endpoint
// и вызывается напрямую, минуя любой layout — полагаться на layout как на
// охрану означало бы оставить эти endpoint'ы без проверки.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-slate-50">{children}</div>
}
