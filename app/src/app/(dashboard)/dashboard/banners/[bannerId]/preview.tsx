'use client'

interface Purpose {
  id: string
  name: string
  description: string
  required: boolean
  default: boolean
}

export function BannerPreview({
  headline,
  bodyCopy,
  position,
  purposes,
}: {
  headline: string
  bodyCopy: string
  position: string
  purposes: Purpose[]
}) {
  const positionClass = getPositionClass(position)

  return (
    <div className="relative h-[400px] rounded border border-gray-200 bg-gradient-to-br from-blue-50 to-indigo-50 overflow-hidden">
      {/* Fake page content */}
      <div className="p-4 text-xs text-gray-400">
        <div className="h-3 w-32 rounded bg-gray-300 mb-2" />
        <div className="h-2 w-full rounded bg-gray-200 mb-1" />
        <div className="h-2 w-3/4 rounded bg-gray-200 mb-1" />
        <div className="h-2 w-5/6 rounded bg-gray-200" />
      </div>

      {/* Banner */}
      <div className={`absolute ${positionClass}`}>
        <div className="bg-white rounded-lg shadow-2xl border border-gray-200 max-w-md p-4 space-y-3">
          <div>
            <h3 className="text-sm font-bold text-gray-900">{headline || 'Headline'}</h3>
            <p className="text-xs text-gray-600 mt-1">{bodyCopy || 'Body copy'}</p>
          </div>

          {purposes.length > 0 && (
            <div className="space-y-1.5 max-h-32 overflow-y-auto">
              {purposes.map((p) => (
                <label key={p.id} className="flex items-start gap-2 text-xs">
                  <input
                    type="checkbox"
                    defaultChecked={p.default || p.required}
                    disabled={p.required}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-medium">{p.name}</span>
                    {p.required && (
                      <span className="ml-1 text-gray-500">(required)</span>
                    )}
                    {p.description && (
                      <span className="block text-gray-500">{p.description}</span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <button className="flex-1 rounded bg-black px-3 py-1.5 text-xs font-medium text-white">
              Accept all
            </button>
            <button className="flex-1 rounded border border-gray-300 px-3 py-1.5 text-xs font-medium">
              Save preferences
            </button>
            <button className="flex-1 rounded border border-gray-300 px-3 py-1.5 text-xs font-medium">
              Reject all
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function getPositionClass(position: string): string {
  switch (position) {
    case 'bottom-bar':
      return 'bottom-2 left-1/2 -translate-x-1/2'
    case 'bottom-left':
      return 'bottom-2 left-2'
    case 'bottom-right':
      return 'bottom-2 right-2'
    case 'modal':
      return 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2'
    default:
      return 'bottom-2 left-1/2 -translate-x-1/2'
  }
}
