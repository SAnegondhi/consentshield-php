<?php

return [
    'api_key' => env('CONSENTSHIELD_API_KEY'),
    'base_url' => env('CONSENTSHIELD_BASE_URL', 'https://api.consentshield.in/v1'),
    'timeout_seconds' => env('CONSENTSHIELD_TIMEOUT_SECONDS', 2.0),
    'max_retries' => env('CONSENTSHIELD_MAX_RETRIES', 3),
    'fail_open' => env('CONSENTSHIELD_FAIL_OPEN', false),
];
