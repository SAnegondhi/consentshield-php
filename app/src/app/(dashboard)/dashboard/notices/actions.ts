'use server'

// ADR-1004 Phase 2 Sprint 2.2 — server action for publishing a notice.

import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'

export interface PublishNoticeInput {
  orgId: string
  title: string
  bodyMarkdown: string
  materialChange: boolean
}

export type PublishNoticeResult =
  | { ok: true; version: number; id: string }
  | { ok: false; error: string }

export async function publishNoticeAction(
  input: PublishNoticeInput,
): Promise<PublishNoticeResult> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'auth_required' }

  if (input.title.trim().length < 3) {
    return { ok: false, error: 'title_too_short' }
  }
  if (input.bodyMarkdown.trim().length < 10) {
    return { ok: false, error: 'body_too_short' }
  }

  const { data, error } = await supabase.rpc('publish_notice', {
    p_org_id:               input.orgId,
    p_title:                input.title.trim(),
    p_body_markdown:        input.bodyMarkdown,
    p_material_change_flag: input.materialChange,
  })

  if (error) {
    return { ok: false, error: error.message }
  }

  revalidatePath('/dashboard/notices')

  const row = data as { id: string; version: number } | null
  if (!row) return { ok: false, error: 'no_row_returned' }
  return { ok: true, id: row.id, version: row.version }
}
