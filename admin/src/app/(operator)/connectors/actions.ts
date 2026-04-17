'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'

// ADR-0031 Sprint 1.2 — Connector Catalogue Server Actions.
//
// Wraps three ADR-0027 RPCs:
//   admin.add_connector         — platform_operator
//   admin.update_connector      — platform_operator
//   admin.deprecate_connector   — platform_operator

type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string }

function validateConnectorCode(code: string): string | null {
  if (!/^[a-z0-9_]+$/.test(code)) {
    return 'Connector code must be snake_case (a-z, 0-9, underscore).'
  }
  return null
}

function validateVersion(v: string): string | null {
  if (v.trim().length === 0) return 'Version required.'
  if (v.length > 16) return 'Version too long (≤16 chars).'
  return null
}

function validateJsonSchema(raw: string): { ok: true; parsed: Record<string, unknown> } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ok: false, error: 'Credentials schema must be a JSON object.' }
    }
    return { ok: true, parsed: parsed as Record<string, unknown> }
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${(e as Error).message}` }
  }
}

function parsePurposes(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

export async function createConnector(input: {
  connectorCode: string
  displayName: string
  vendor: string
  version: string
  supportedPurposesCsv: string
  requiredCredentialsJson: string
  webhookEndpointTemplate: string
  documentationUrl: string
  retentionLockSupported: boolean
  reason: string
}): Promise<ActionResult<{ connectorId: string }>> {
  const codeErr = validateConnectorCode(input.connectorCode)
  if (codeErr) return { ok: false, error: codeErr }
  if (input.displayName.trim().length === 0) return { ok: false, error: 'Display name required.' }
  if (input.vendor.trim().length === 0) return { ok: false, error: 'Vendor required.' }
  const verErr = validateVersion(input.version)
  if (verErr) return { ok: false, error: verErr }
  const purposes = parsePurposes(input.supportedPurposesCsv)
  if (purposes.length === 0) return { ok: false, error: 'At least one supported purpose code is required.' }
  if (input.webhookEndpointTemplate.trim().length === 0) {
    return { ok: false, error: 'Webhook endpoint template required.' }
  }
  const schemaResult = validateJsonSchema(input.requiredCredentialsJson)
  if (!schemaResult.ok) return { ok: false, error: schemaResult.error }
  if (input.reason.trim().length < 10) return { ok: false, error: 'Reason must be at least 10 characters.' }

  const supabase = await createServerClient()
  const { data, error } = await supabase.schema('admin').rpc('add_connector', {
    p_connector_code: input.connectorCode.trim(),
    p_display_name: input.displayName.trim(),
    p_vendor: input.vendor.trim(),
    p_version: input.version.trim(),
    p_supported_purpose_codes: purposes,
    p_required_credentials_schema: schemaResult.parsed,
    p_webhook_endpoint_template: input.webhookEndpointTemplate.trim(),
    p_documentation_url: input.documentationUrl.trim() || null,
    p_retention_lock_supported: input.retentionLockSupported,
    p_reason: input.reason.trim(),
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath('/connectors')
  return { ok: true, data: { connectorId: data as string } }
}

export async function updateConnector(input: {
  connectorId: string
  displayName: string
  supportedPurposesCsv: string
  requiredCredentialsJson: string
  webhookEndpointTemplate: string
  documentationUrl: string
  retentionLockSupported: boolean
  reason: string
}): Promise<ActionResult> {
  if (input.displayName.trim().length === 0) return { ok: false, error: 'Display name required.' }
  const purposes = parsePurposes(input.supportedPurposesCsv)
  if (purposes.length === 0) return { ok: false, error: 'At least one supported purpose code is required.' }
  if (input.webhookEndpointTemplate.trim().length === 0) {
    return { ok: false, error: 'Webhook endpoint template required.' }
  }
  const schemaResult = validateJsonSchema(input.requiredCredentialsJson)
  if (!schemaResult.ok) return { ok: false, error: schemaResult.error }
  if (input.reason.trim().length < 10) return { ok: false, error: 'Reason must be at least 10 characters.' }

  const supabase = await createServerClient()
  const { error } = await supabase.schema('admin').rpc('update_connector', {
    p_connector_id: input.connectorId,
    p_display_name: input.displayName.trim(),
    p_supported_purpose_codes: purposes,
    p_required_credentials_schema: schemaResult.parsed,
    p_webhook_endpoint_template: input.webhookEndpointTemplate.trim(),
    p_documentation_url: input.documentationUrl.trim() || null,
    p_retention_lock_supported: input.retentionLockSupported,
    p_reason: input.reason.trim(),
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/connectors/${input.connectorId}`)
  revalidatePath('/connectors')
  return { ok: true }
}

export async function deprecateConnector(input: {
  connectorId: string
  replacementId: string | null
  cutoverDeadline: string | null
  reason: string
}): Promise<ActionResult> {
  if (input.reason.trim().length < 10) return { ok: false, error: 'Reason must be at least 10 characters.' }

  const supabase = await createServerClient()
  const { error } = await supabase.schema('admin').rpc('deprecate_connector', {
    p_connector_id: input.connectorId,
    p_replacement_id: input.replacementId,
    p_cutover_deadline: input.cutoverDeadline,
    p_reason: input.reason.trim(),
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/connectors/${input.connectorId}`)
  revalidatePath('/connectors')
  return { ok: true }
}

export async function goToCloneConnector(sourceId: string): Promise<void> {
  redirect(`/connectors/new?from=${sourceId}`)
}
