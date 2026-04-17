'use client'

// Admin OTP boxes — visually identical in structure to the customer
// app's component but themed with the admin red accent on the active
// slot. Per the share-narrowly memory we keep a separate copy in each
// app rather than hoisting to a shared package.

import { OTPInput, type SlotProps } from 'input-otp'

interface OtpBoxesProps {
  length?: number
  value: string
  onChange: (value: string) => void
  autoFocus?: boolean
}

export function OtpBoxes({ length = 6, value, onChange, autoFocus }: OtpBoxesProps) {
  return (
    <OTPInput
      maxLength={length}
      value={value}
      onChange={onChange}
      autoFocus={autoFocus}
      containerClassName="flex items-center justify-center gap-1.5"
      render={({ slots }) => (
        <>
          {slots.map((slot, i) => (
            <Slot key={i} {...slot} />
          ))}
        </>
      )}
    />
  )
}

function Slot({ char, hasFakeCaret, isActive }: SlotProps) {
  const base =
    'relative w-10 h-12 text-xl font-semibold flex items-center justify-center rounded border transition-colors'
  const state = isActive
    ? 'border-red-700 shadow-[0_0_0_1px_#B91C1C]'
    : 'border-[color:var(--border-mid)]'
  return (
    <div className={`${base} ${state}`}>
      {char}
      {hasFakeCaret && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-5 w-px animate-pulse bg-red-700" />
        </div>
      )}
    </div>
  )
}
