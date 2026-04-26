<?php declare(strict_types=1);

namespace ConsentShield\Sdk\Tests;

use ConsentShield\Sdk\ConsentShieldClient;
use PHPUnit\Framework\TestCase;

class ConsentShieldClientTest extends TestCase
{
    public function testCreatesWithDefaults(): void
    {
        $client = ConsentShieldClient::create('cs_live_abc123');
        $this->assertSame('https://api.consentshield.in/v1', $client->getBaseUrl());
        $this->assertFalse($client->isFailOpen());
        $this->assertNotNull($client->utility());
    }

    public function testRejectsApiKeyWithoutPrefix(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        ConsentShieldClient::create('not-a-cs-key');
    }

    public function testTrimsTrailingSlashFromBaseUrl(): void
    {
        $client = ConsentShieldClient::create('cs_live_abc123', [
            'baseUrl' => 'https://api.consentshield.in/v1/',
        ]);
        $this->assertSame('https://api.consentshield.in/v1', $client->getBaseUrl());
    }

    public function testExplicitFailOpenWinsOverEnv(): void
    {
        // Even if env said true, the explicit false should win — and vice versa.
        $client = ConsentShieldClient::create('cs_live_abc123', ['failOpen' => true]);
        $this->assertTrue($client->isFailOpen());

        $client2 = ConsentShieldClient::create('cs_live_abc123', ['failOpen' => false]);
        $this->assertFalse($client2->isFailOpen());
    }

    public function testRejectsNonPositiveTimeout(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        ConsentShieldClient::create('cs_live_abc123', ['timeoutSeconds' => 0]);
    }

    public function testRejectsNegativeRetries(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        ConsentShieldClient::create('cs_live_abc123', ['maxRetries' => -1]);
    }
}
