-- Migration: Add OTP storage columns to rights_requests
-- For the email verification step of the public rights request form.
-- OTP is stored as a SHA-256 hash (never plaintext) with a 15-minute expiry.

alter table rights_requests
  add column if not exists otp_hash text,
  add column if not exists otp_expires_at timestamptz,
  add column if not exists otp_attempts integer not null default 0;

-- Index to quickly find unverified abandoned requests for cleanup
create index if not exists idx_rights_requests_abandoned
  on rights_requests (created_at)
  where email_verified = false;
