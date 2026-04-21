'use client'

import { useState } from 'react'
import { StepIndicator } from './step-indicator'
import { Step1Welcome } from './step-1-welcome'
import { Step2Company } from './step-2-company'
import { Step3DataInventory } from './step-3-data-inventory'
import { Step4Purposes } from './step-4-purposes'
import type { InvitePreview, ResumeContext } from './wizard-types'

interface WizardState {
  orgId: string | null
  accountId: string | null
  orgName: string
  industry: string | null
  currentStep: number
}

type WizardProps =
  | { mode: 'fresh'; preview: InvitePreview; token: string }
  | { mode: 'resume'; resume: ResumeContext }

export function OnboardingWizard(props: WizardProps) {
  const [state, setState] = useState<WizardState>(() => {
    if (props.mode === 'resume') {
      return {
        orgId: props.resume.orgId,
        accountId: null,
        orgName: props.resume.orgName,
        industry: props.resume.industry,
        currentStep: Math.max(1, Math.min(7, props.resume.step + 1)),
      }
    }
    return {
      orgId: null,
      accountId: null,
      orgName:
        props.preview.default_org_name ??
        props.preview.invited_email.split('@')[0],
      industry: null,
      currentStep: 1,
    }
  })

  function advanceTo(step: number) {
    setState((s) => ({ ...s, currentStep: step }))
  }

  const currentStep = state.currentStep

  return (
    <div>
      <StepIndicator currentStep={currentStep} />

      {currentStep === 1 && props.mode === 'fresh' ? (
        <Step1Welcome
          preview={props.preview}
          token={props.token}
          onComplete={({ orgId, accountId, orgName }) => {
            setState((s) => ({
              ...s,
              orgId,
              accountId,
              orgName,
              currentStep: 2,
            }))
          }}
        />
      ) : null}

      {currentStep === 2 && state.orgId ? (
        <Step2Company
          orgId={state.orgId}
          orgName={state.orgName}
          initialIndustry={state.industry}
          onComplete={(industry) => {
            setState((s) => ({ ...s, industry, currentStep: 3 }))
          }}
        />
      ) : null}

      {currentStep === 3 && state.orgId ? (
        <Step3DataInventory
          orgId={state.orgId}
          onComplete={() => advanceTo(4)}
        />
      ) : null}

      {currentStep === 4 && state.orgId && state.industry ? (
        <Step4Purposes
          orgId={state.orgId}
          industry={state.industry}
          onComplete={() => advanceTo(5)}
        />
      ) : null}

      {currentStep >= 5 ? <ComingSoonShell /> : null}
    </div>
  )
}

function ComingSoonShell() {
  return (
    <div className="mx-auto max-w-lg rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
      <h1 className="text-2xl font-semibold">Great progress!</h1>
      <p className="mt-2 text-sm text-gray-600">
        You&apos;ve set up your organisation, data inventory, and purpose
        template. The final three steps — deploy the banner, see your DEPA
        score, and watch the first consent land — are coming in the next
        release.
      </p>
      <p className="mt-4 text-sm text-gray-700">
        For now, continue to your dashboard and explore.
      </p>
      <a
        href="/dashboard"
        className="mt-4 inline-block rounded bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
      >
        Go to dashboard
      </a>
    </div>
  )
}
