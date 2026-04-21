'use client'

import { useEffect, useRef, useState } from 'react'
import { StepIndicator } from './step-indicator'
import { Step1Welcome } from './step-1-welcome'
import { Step2Company } from './step-2-company'
import { Step3DataInventory } from './step-3-data-inventory'
import { Step4Purposes } from './step-4-purposes'
import { Step5Deploy } from './step-5-deploy'
import { Step6Scores } from './step-6-scores'
import { Step7FirstConsent } from './step-7-first-consent'
import { PlanSwap } from './plan-swap'
import { logStepCompletion } from '../actions'
import type { InvitePreview, ResumeContext } from './wizard-types'

interface WizardState {
  orgId: string | null
  accountId: string | null
  orgName: string
  industry: string | null
  planCode: string | null
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
        planCode: null,
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
      planCode: props.preview.plan_code ?? null,
      currentStep: 1,
    }
  })

  // Step-enter timestamp for telemetry. Reset on every step transition.
  const stepEnteredAtRef = useRef<number>(new Date().getTime())
  useEffect(() => {
    stepEnteredAtRef.current = new Date().getTime()
  }, [state.currentStep])

  function completeStep(step: number, advance: number) {
    if (state.orgId) {
      const elapsed = new Date().getTime() - stepEnteredAtRef.current
      void logStepCompletion(state.orgId, step, elapsed)
    }
    setState((s) => ({ ...s, currentStep: advance }))
  }

  const currentStep = state.currentStep
  const showPlanSwap =
    state.orgId !== null && currentStep >= 2 && currentStep <= 6

  return (
    <div>
      {showPlanSwap && state.orgId ? (
        <PlanSwap
          orgId={state.orgId}
          currentPlan={state.planCode}
          onSwapped={(newPlan) => {
            setState((s) => ({ ...s, planCode: newPlan }))
          }}
        />
      ) : null}

      <StepIndicator currentStep={currentStep} />

      {currentStep === 1 && props.mode === 'fresh' ? (
        <Step1Welcome
          preview={props.preview}
          token={props.token}
          onComplete={({ orgId, accountId, orgName }) => {
            const elapsed = new Date().getTime() - stepEnteredAtRef.current
            void logStepCompletion(orgId, 1, elapsed)
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
            if (state.orgId) {
              const elapsed =
                new Date().getTime() - stepEnteredAtRef.current
              void logStepCompletion(state.orgId, 2, elapsed)
            }
            setState((s) => ({ ...s, industry, currentStep: 3 }))
          }}
        />
      ) : null}

      {currentStep === 3 && state.orgId ? (
        <Step3DataInventory
          orgId={state.orgId}
          onComplete={() => completeStep(3, 4)}
        />
      ) : null}

      {currentStep === 4 && state.orgId && state.industry ? (
        <Step4Purposes
          orgId={state.orgId}
          industry={state.industry}
          onComplete={() => completeStep(4, 5)}
        />
      ) : null}

      {currentStep === 5 && state.orgId ? (
        <Step5Deploy
          orgId={state.orgId}
          onComplete={() => completeStep(5, 6)}
        />
      ) : null}

      {currentStep === 6 && state.orgId ? (
        <Step6Scores
          orgId={state.orgId}
          onComplete={() => completeStep(6, 7)}
        />
      ) : null}

      {currentStep >= 7 && state.orgId ? (
        <Step7FirstConsent
          orgId={state.orgId}
          onDone={() => {
            window.location.href = '/dashboard?welcome=1'
          }}
        />
      ) : null}
    </div>
  )
}
