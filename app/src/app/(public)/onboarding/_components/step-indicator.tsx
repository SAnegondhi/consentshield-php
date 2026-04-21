'use client'

import { WIZARD_LABELS } from './wizard-types'

export function StepIndicator({ currentStep }: { currentStep: number }) {
  return (
    <ol className="mb-8 flex items-start justify-between gap-2">
      {WIZARD_LABELS.map((label, idx) => {
        const step = idx + 1
        const state =
          step < currentStep
            ? 'done'
            : step === currentStep
              ? 'current'
              : 'upcoming'
        return (
          <li
            key={label}
            className="flex flex-1 flex-col items-center text-center"
            aria-current={state === 'current' ? 'step' : undefined}
          >
            <span
              className={
                state === 'done'
                  ? 'flex h-8 w-8 items-center justify-center rounded-full bg-teal-600 text-xs font-semibold text-white'
                  : state === 'current'
                    ? 'flex h-8 w-8 items-center justify-center rounded-full border-2 border-teal-600 bg-white text-xs font-semibold text-teal-600'
                    : 'flex h-8 w-8 items-center justify-center rounded-full border border-gray-300 bg-white text-xs font-medium text-gray-400'
              }
            >
              {state === 'done' ? '✓' : step}
            </span>
            <span
              className={
                state === 'upcoming'
                  ? 'mt-2 text-[11px] text-gray-400'
                  : 'mt-2 text-[11px] font-medium text-gray-700'
              }
            >
              {label}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
