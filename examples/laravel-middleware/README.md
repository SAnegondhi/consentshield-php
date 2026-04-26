# Laravel middleware — ConsentShield PHP SDK example

Three drop-in files for a Laravel 11 app:

| File | Goes in |
|---|---|
| `AppServiceProvider.php` | `app/Providers/AppServiceProvider.php` |
| `ConsentShieldGate.php` | `app/Http/Middleware/ConsentShieldGate.php` |
| `config/consentshield.php` | `config/consentshield.php` |

Then in `bootstrap/app.php`:

```php
->withMiddleware(function (Middleware $middleware) {
    $middleware->alias(['consent.gate' => App\Http\Middleware\ConsentShieldGate::class]);
})
```

```bash
composer require consentshield/sdk:^1.0
export CONSENTSHIELD_API_KEY=cs_live_...
php artisan serve
```

```php
Route::post('/api/marketing/send', SendController::class)
    ->middleware('consent.gate');
```

## Outcomes

| Scenario | HTTP status |
|---|---|
| Consent granted | continues to controller |
| Consent not granted | 451 (controller decision) |
| Upstream 4xx | 502 Bad Gateway |
| Upstream 5xx / network / timeout (fail-CLOSED) | 503 Service Unavailable |
| Upstream 5xx / network / timeout (fail-OPEN) | continues + `X-CS-Open: true` |
