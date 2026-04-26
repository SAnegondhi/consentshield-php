<?php declare(strict_types=1);

namespace ConsentShield\Sdk\Tests;

use ConsentShield\Sdk\Exception\ConsentShieldApiException;
use ConsentShield\Sdk\Exception\ConsentShieldTimeoutException;
use ConsentShield\Sdk\Exception\ConsentVerifyException;
use ConsentShield\Sdk\Exception\VerifyFailureCause;
use PHPUnit\Framework\TestCase;

class ExceptionTest extends TestCase
{
    public function testApiExceptionCarriesAllFields(): void
    {
        $ex = new ConsentShieldApiException(
            status: 404,
            type: '/errors/not-found',
            title: 'Not Found',
            detail: 'property_id does not belong to your org',
            instance: '/v1/consent/verify',
            traceId: 'abc-123',
            extensions: ['hint' => 'double-check the property_id'],
        );

        $this->assertSame(404, $ex->getStatus());
        $this->assertSame('Not Found', $ex->getTitle());
        $this->assertSame('property_id does not belong to your org', $ex->getDetail());
        $this->assertSame('abc-123', $ex->getTraceId());
        $this->assertSame('/v1/consent/verify', $ex->getInstance());
        $this->assertCount(1, $ex->getExtensions());
        $this->assertStringContainsString('404', $ex->getMessage());
    }

    public function testApiExceptionToleratesNullExtensions(): void
    {
        $ex = new ConsentShieldApiException(400, null, null, null, null, null);
        $this->assertSame([], $ex->getExtensions());
    }

    public function testTimeoutExceptionPreservesCauseAndTraceId(): void
    {
        $cause = new \RuntimeException('read timeout');
        $ex = new ConsentShieldTimeoutException('per-attempt timeout', 'trace-xyz', $cause);
        $this->assertSame('trace-xyz', $ex->getTraceId());
        $this->assertSame($cause, $ex->getPrevious());
    }

    public function testVerifyExceptionCarriesCauseDiscriminator(): void
    {
        $ex = new ConsentVerifyException(
            VerifyFailureCause::ServerError,
            '5xx after retries',
            'trace-xyz',
        );
        $this->assertSame(VerifyFailureCause::ServerError, $ex->getCauseCode());
        $this->assertSame('trace-xyz', $ex->getTraceId());
    }

    public function testFailureCauseEnumValues(): void
    {
        $this->assertSame('server_error', VerifyFailureCause::ServerError->value);
        $this->assertSame('timeout', VerifyFailureCause::Timeout->value);
        $this->assertSame('network', VerifyFailureCause::Network->value);
    }
}
