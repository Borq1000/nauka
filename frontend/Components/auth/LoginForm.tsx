'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth-client'

export function LoginForm() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)

    const { error } = await authClient.signIn.email({
      email: email.trim().toLowerCase(),
      password,
    })

    if (error) {
      // Намеренно не уточняем, неверен email или пароль:
      // это позволило бы перебором выяснить, какие адреса зарегистрированы.
      setError('Неверный email или пароль')
      setPending(false)
      return
    }

    router.push('/admin')
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="flex w-full max-w-sm flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Email</span>
        <input
          type="email"
          required
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded-lg border px-3 py-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Пароль</span>
        <input
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded-lg border px-3 py-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
        />
      </label>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-violet-700 px-4 py-2 font-medium text-white disabled:opacity-60"
      >
        {pending ? 'Вход…' : 'Войти'}
      </button>
    </form>
  )
}
