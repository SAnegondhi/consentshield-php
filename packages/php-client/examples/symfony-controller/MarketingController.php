<?php declare(strict_types=1);

namespace App\Controller;

use ConsentShield\Sdk\ConsentShieldClient;
use ConsentShield\Sdk\Exception\ConsentShieldApiException;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Annotation\Route;

/**
 * Symfony 7 controller demonstrating the ConsentShield gate. Wire
 * ConsentShieldClient as a service in `services.yaml`:
 *
 *     services:
 *         ConsentShield\Sdk\ConsentShieldClient:
 *             factory: ['ConsentShield\Sdk\ConsentShieldClient', 'create']
 *             arguments:
 *                 - '%env(CONSENTSHIELD_API_KEY)%'
 */
final class MarketingController extends AbstractController
{
    public function __construct(private readonly ConsentShieldClient $client)
    {
    }

    #[Route('/api/marketing/send', methods: ['POST'])]
    public function send(Request $request): JsonResponse
    {
        try {
            $this->client->utility()->ping();
            return new JsonResponse(['queued' => true], 202);
        } catch (ConsentShieldApiException $e) {
            return new JsonResponse(
                ['error' => 'consentshield_api', 'detail' => $e->getDetail()],
                502,
            );
        } catch (\Throwable $e) {
            if ($this->client->isFailOpen()) {
                return new JsonResponse(['queued' => true, 'open' => true], 202);
            }
            return new JsonResponse(['error' => 'consent_check_failed'], 503);
        }
    }
}
