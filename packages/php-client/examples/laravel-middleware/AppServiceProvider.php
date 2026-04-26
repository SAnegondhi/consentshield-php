<?php declare(strict_types=1);

namespace App\Providers;

use ConsentShield\Sdk\ConsentShieldClient;
use Illuminate\Support\ServiceProvider;

/**
 * Wire ConsentShieldClient into Laravel's container. Drop into
 * app/Providers/AppServiceProvider.php (or merge with your existing one) and
 * Laravel will auto-resolve it into the middleware constructor.
 */
final class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(ConsentShieldClient::class, function () {
            $apiKey = config('consentshield.api_key');
            if (!is_string($apiKey) || $apiKey === '') {
                throw new \RuntimeException('consentshield.api_key is not configured');
            }
            return ConsentShieldClient::create($apiKey, [
                'baseUrl' => config('consentshield.base_url', 'https://api.consentshield.in/v1'),
                'timeoutSeconds' => (float)config('consentshield.timeout_seconds', 2.0),
                'maxRetries' => (int)config('consentshield.max_retries', 3),
                'failOpen' => (bool)config('consentshield.fail_open', false),
            ]);
        });
    }
}
