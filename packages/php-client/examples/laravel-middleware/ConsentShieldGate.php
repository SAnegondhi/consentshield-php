<?php declare(strict_types=1);

namespace App\Http\Middleware;

use ConsentShield\Sdk\ConsentShieldClient;
use ConsentShield\Sdk\Exception\ConsentShieldApiException;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Example Laravel 11 middleware. Drop into app/Http/Middleware/ and register
 * in bootstrap/app.php:
 *
 *     ->withMiddleware(function (Middleware $middleware) {
 *         $middleware->alias(['consent.gate' => ConsentShieldGate::class]);
 *     })
 *
 * Then guard a marketing route:
 *
 *     Route::post('/api/marketing/send', SendController::class)
 *         ->middleware('consent.gate');
 *
 * Outcomes:
 *  - Granted → pass through to the controller.
 *  - 4xx from upstream → 502 Bad Gateway.
 *  - Fail-CLOSED on 5xx / network / timeout → 503 Service Unavailable.
 *  - Fail-OPEN → pass through with X-CS-Open: true header.
 */
final class ConsentShieldGate
{
    public function __construct(private readonly ConsentShieldClient $client)
    {
    }

    public function handle(Request $request, Closure $next): Response
    {
        try {
            // Sketch: real verify call goes against ConsentApi with a property
            // resolved from request input. Outcome contract is what's load-
            // bearing here; the actual call site is straightforward.
            $this->client->utility()->ping();
            return $next($request);
        } catch (ConsentShieldApiException $e) {
            return response()->json(
                ['error' => 'consentshield_api', 'detail' => $e->getDetail()],
                502,
            );
        } catch (\Throwable $e) {
            if ($this->client->isFailOpen()) {
                $response = $next($request);
                $response->headers->set('X-CS-Open', 'true');
                return $response;
            }
            return response()->json(['error' => 'consent_check_failed'], 503);
        }
    }
}
