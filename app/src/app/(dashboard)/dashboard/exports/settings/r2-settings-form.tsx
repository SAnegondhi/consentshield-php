'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { saveR2Config, verifyR2Config, deleteR2Config } from '../actions'

interface ExistingConfig {
  bucket_name: string
  path_prefix: string
  region: string
  is_verified: boolean
  last_export_at: string | null
  updated_at: string
}

interface Props {
  isAdmin: boolean
  existing: ExistingConfig | null
}

export function R2SettingsForm({ isAdmin, existing }: Props) {
  const [message, setMessage] = useState<
    { kind: 'ok'; text: string } | { kind: 'error'; text: string } | null
  >(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleSave(formData: FormData) {
    startTransition(async () => {
      const res = await saveR2Config(formData)
      if (res.error) setMessage({ kind: 'error', text: res.error })
      else {
        setMessage({
          kind: 'ok',
          text: 'Saved. Run Verify to test credentials against R2.',
        })
        router.refresh()
      }
    })
  }

  function handleVerify() {
    startTransition(async () => {
      const res = await verifyR2Config()
      if (res.verify_status === 'verified') {
        setMessage({ kind: 'ok', text: 'Verified — test PUT succeeded.' })
      } else if (res.verify_status === 'failed') {
        setMessage({
          kind: 'error',
          text: `Verify failed: ${res.verify_detail ?? res.error ?? 'unknown'}`,
        })
      } else if (res.error) {
        setMessage({ kind: 'error', text: res.error })
      }
      router.refresh()
    })
  }

  function handleDelete() {
    if (!confirm('Delete R2 configuration? Future exports will fall back to direct download.')) return
    startTransition(async () => {
      const res = await deleteR2Config()
      if (res.error) setMessage({ kind: 'error', text: res.error })
      else {
        setMessage({ kind: 'ok', text: 'Configuration removed.' })
        router.refresh()
      }
    })
  }

  return (
    <section className="space-y-4 rounded border border-gray-200 p-5">
      {existing ? (
        <div className="rounded bg-gray-50 p-3 text-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">
                Current:{' '}
                <code className="font-mono">
                  {existing.bucket_name}
                  {existing.path_prefix ? `/${existing.path_prefix}` : ''}
                </code>{' '}
                {existing.is_verified ? (
                  <span className="rounded bg-green-50 px-1.5 py-0.5 text-xs text-green-700">
                    verified
                  </span>
                ) : (
                  <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700">
                    unverified
                  </span>
                )}
              </p>
              <p className="text-xs text-gray-500">
                Region {existing.region} · last export{' '}
                {existing.last_export_at
                  ? new Date(existing.last_export_at).toLocaleString()
                  : 'never'}{' '}
                · updated {new Date(existing.updated_at).toLocaleString()}
              </p>
            </div>
            {isAdmin ? (
              <div className="flex gap-2">
                <button
                  onClick={handleVerify}
                  disabled={isPending}
                  className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Verify
                </button>
                <button
                  onClick={handleDelete}
                  disabled={isPending}
                  className="rounded border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  Delete
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {isAdmin ? (
        <form action={handleSave} className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="text-sm md:col-span-2">
            <span className="text-xs text-gray-600">R2 endpoint URL</span>
            <input
              name="endpoint"
              required
              placeholder="https://<account-id>.r2.cloudflarestorage.com"
              className="mt-1 block w-full rounded border border-gray-300 px-2 py-1 font-mono text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="text-xs text-gray-600">Bucket name</span>
            <input
              name="bucket_name"
              required
              defaultValue={existing?.bucket_name}
              className="mt-1 block w-full rounded border border-gray-300 px-2 py-1 font-mono text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="text-xs text-gray-600">Path prefix (optional)</span>
            <input
              name="path_prefix"
              defaultValue={existing?.path_prefix}
              placeholder="consentshield-exports/"
              className="mt-1 block w-full rounded border border-gray-300 px-2 py-1 font-mono text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="text-xs text-gray-600">Region</span>
            <input
              name="region"
              defaultValue={existing?.region ?? 'auto'}
              className="mt-1 block w-full rounded border border-gray-300 px-2 py-1 font-mono text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="text-xs text-gray-600">Access key ID</span>
            <input
              name="access_key_id"
              required
              className="mt-1 block w-full rounded border border-gray-300 px-2 py-1 font-mono text-sm"
            />
          </label>
          <label className="text-sm md:col-span-2">
            <span className="text-xs text-gray-600">
              Secret access key (encrypted at rest via per-org derived key)
            </span>
            <input
              name="secret_access_key"
              type="password"
              required
              className="mt-1 block w-full rounded border border-gray-300 px-2 py-1 font-mono text-sm"
            />
          </label>
          {message ? (
            <p
              className={
                'md:col-span-2 text-sm ' +
                (message.kind === 'ok' ? 'text-green-700' : 'text-red-700')
              }
            >
              {message.text}
            </p>
          ) : null}
          <div className="md:col-span-2 flex justify-end">
            <button
              type="submit"
              disabled={isPending}
              className="rounded bg-black px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {existing ? 'Save (re-enter credentials)' : 'Save configuration'}
            </button>
          </div>
        </form>
      ) : null}
    </section>
  )
}
