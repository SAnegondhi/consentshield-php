'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'

// ADR-0030 Sprint 2.1 — Sectoral Template Server Actions.
//
// Wraps the four ADR-0027 Sprint 3.1 RPCs:
//   create_sectoral_template_draft  — support role
//   update_sectoral_template_draft  — support role; drafts only
//   publish_sectoral_template       — platform_operator; drafts only; auto-deprecates prior published version
//   deprecate_sectoral_template     — platform_operator; published only

export interface PurposeRow {
  purpose_code: string
  display_name: string
  framework: string
  data_scope: string[]
  default_expiry: string
  auto_delete: boolean
}

// ADR-1003 Sprint 4.1 (col) + Sprint 4.2 (RPC params).
// Possible values for the gate; null means "no opinion / template is mode-agnostic"
// (BFSI Starter, DPDP Minimum). Keep this enum-style typing in sync with the
// public.organisations.storage_mode + admin.sectoral_templates.default_storage_mode
// CHECK constraint values.
export type StorageMode = 'standard' | 'insulated' | 'zero_storage'

// ADR-1003 Sprint 4.1 — connector_defaults is a free-form jsonb object
// keyed by slot (e.g. emr_vendor / appointment_reminder_vendor). Each
// value carries category + examples + rationale. Typed loosely here
// because the admin form takes a JSON textarea — we only validate
// shape, not slot-specific schema.
export type ConnectorDefaults = Record<
  string,
  { category?: string; examples?: string[]; rationale?: string }
>

type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string }

const VALID_STORAGE_MODES: ReadonlyArray<StorageMode> = [
  'standard',
  'insulated',
  'zero_storage',
] as const

function validateStorageMode(value: string | null): string | null {
  if (value === null || value === '') return null
  if (!(VALID_STORAGE_MODES as readonly string[]).includes(value)) {
    return `default_storage_mode must be one of ${VALID_STORAGE_MODES.join(', ')} or empty.`
  }
  return null
}

function validateConnectorDefaults(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'object' || Array.isArray(value)) {
    return 'connector_defaults must be a JSON object (key → {category, examples, rationale}) or empty.'
  }
  for (const [slot, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!/^[a-z0-9_]+$/.test(slot)) {
      return `connector_defaults slot "${slot}" must be snake_case.`
    }
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      return `connector_defaults["${slot}"] must be an object.`
    }
  }
  return null
}

function validateTemplateCode(code: string): string | null {
  if (!/^[a-z0-9_]+$/.test(code)) {
    return 'Template code must be snake_case (a-z, 0-9, underscore).'
  }
  return null
}

function validatePurposes(purposes: PurposeRow[]): string | null {
  if (purposes.length === 0) return 'At least one purpose is required.'
  const seen = new Set<string>()
  for (const p of purposes) {
    if (!/^[a-z0-9_]+$/.test(p.purpose_code)) {
      return `Purpose code "${p.purpose_code}" must be snake_case.`
    }
    if (seen.has(p.purpose_code)) {
      return `Duplicate purpose code "${p.purpose_code}".`
    }
    seen.add(p.purpose_code)
    if (p.display_name.trim().length === 0) {
      return `Purpose "${p.purpose_code}" needs a display name.`
    }
  }
  return null
}

export async function createDraft(input: {
  templateCode: string
  displayName: string
  description: string
  sector: string
  purposes: PurposeRow[]
  reason: string
  defaultStorageMode: StorageMode | null
  connectorDefaults: ConnectorDefaults | null
}): Promise<ActionResult<{ templateId: string }>> {
  const codeErr = validateTemplateCode(input.templateCode)
  if (codeErr) return { ok: false, error: codeErr }
  if (input.displayName.trim().length === 0) {
    return { ok: false, error: 'Display name required.' }
  }
  if (input.description.trim().length === 0) {
    return { ok: false, error: 'Description required.' }
  }
  if (input.sector.trim().length === 0) {
    return { ok: false, error: 'Sector required.' }
  }
  const pErr = validatePurposes(input.purposes)
  if (pErr) return { ok: false, error: pErr }
  if (input.reason.trim().length < 10) {
    return { ok: false, error: 'Reason must be at least 10 characters.' }
  }
  const modeErr = validateStorageMode(input.defaultStorageMode)
  if (modeErr) return { ok: false, error: modeErr }
  const connErr = validateConnectorDefaults(input.connectorDefaults)
  if (connErr) return { ok: false, error: connErr }

  const supabase = await createServerClient()
  const { data, error } = await supabase
    .schema('admin')
    .rpc('create_sectoral_template_draft', {
      p_template_code: input.templateCode.trim(),
      p_display_name: input.displayName.trim(),
      p_description: input.description.trim(),
      p_sector: input.sector.trim(),
      p_purpose_definitions: input.purposes,
      p_reason: input.reason.trim(),
      p_default_storage_mode: input.defaultStorageMode,
      p_connector_defaults: input.connectorDefaults,
    })
  if (error) return { ok: false, error: error.message }

  revalidatePath('/templates')
  return { ok: true, data: { templateId: data as string } }
}

export async function updateDraft(input: {
  templateId: string
  displayName: string
  description: string
  purposes: PurposeRow[]
  reason: string
  defaultStorageMode: StorageMode | null
  connectorDefaults: ConnectorDefaults | null
}): Promise<ActionResult> {
  if (input.displayName.trim().length === 0) {
    return { ok: false, error: 'Display name required.' }
  }
  if (input.description.trim().length === 0) {
    return { ok: false, error: 'Description required.' }
  }
  const pErr = validatePurposes(input.purposes)
  if (pErr) return { ok: false, error: pErr }
  if (input.reason.trim().length < 10) {
    return { ok: false, error: 'Reason must be at least 10 characters.' }
  }
  const modeErr = validateStorageMode(input.defaultStorageMode)
  if (modeErr) return { ok: false, error: modeErr }
  const connErr = validateConnectorDefaults(input.connectorDefaults)
  if (connErr) return { ok: false, error: connErr }

  const supabase = await createServerClient()
  const { error } = await supabase
    .schema('admin')
    .rpc('update_sectoral_template_draft', {
      p_template_id: input.templateId,
      p_display_name: input.displayName.trim(),
      p_description: input.description.trim(),
      p_purpose_definitions: input.purposes,
      p_reason: input.reason.trim(),
      p_default_storage_mode: input.defaultStorageMode,
      p_connector_defaults: input.connectorDefaults,
    })
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/templates/${input.templateId}`)
  revalidatePath('/templates')
  return { ok: true }
}

export async function publishTemplate(
  templateId: string,
  versionNotes: string,
): Promise<ActionResult> {
  if (versionNotes.trim().length < 10) {
    return { ok: false, error: 'Version notes must be at least 10 characters.' }
  }

  const supabase = await createServerClient()
  const { error } = await supabase
    .schema('admin')
    .rpc('publish_sectoral_template', {
      p_template_id: templateId,
      p_version_notes: versionNotes.trim(),
    })
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/templates/${templateId}`)
  revalidatePath('/templates')
  return { ok: true }
}

export async function deprecateTemplate(
  templateId: string,
  reason: string,
): Promise<ActionResult> {
  if (reason.trim().length < 10) {
    return { ok: false, error: 'Reason must be at least 10 characters.' }
  }

  const supabase = await createServerClient()
  const { error } = await supabase
    .schema('admin')
    .rpc('deprecate_sectoral_template', {
      p_template_id: templateId,
      p_reason: reason.trim(),
    })
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/templates/${templateId}`)
  revalidatePath('/templates')
  return { ok: true }
}

// Convenience wrapper: used by "Clone as new version" on a published
// template. We just route to /templates/new?from=<id>; the new-draft
// page prefills from the source template. Kept here so the action
// surface is one import.
export async function goToCloneForm(sourceTemplateId: string): Promise<void> {
  redirect(`/templates/new?from=${sourceTemplateId}`)
}
