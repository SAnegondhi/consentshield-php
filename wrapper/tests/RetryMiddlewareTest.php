<?php declare(strict_types=1);

namespace ConsentShield\Sdk\Tests;

use ConsentShield\Sdk\Exception\ConsentShieldTimeoutException;
use ConsentShield\Sdk\Http\RetryMiddleware;
use GuzzleHttp\Client;
use GuzzleHttp\Exception\ConnectException;
use GuzzleHttp\Exception\RequestException;
use GuzzleHttp\Handler\MockHandler;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Psr7\Request;
use GuzzleHttp\Psr7\Response;
use PHPUnit\Framework\TestCase;

class RetryMiddlewareTest extends TestCase
{
    private function clientWith(MockHandler $mock, int $maxRetries): Client
    {
        $stack = HandlerStack::create($mock);
        $stack->push(RetryMiddleware::create($maxRetries));
        return new Client(['handler' => $stack, 'http_errors' => false]);
    }

    public function testTwoXxNeverRetried(): void
    {
        $mock = new MockHandler([new Response(200, [], '{}')]);
        $client = $this->clientWith($mock, 3);
        $r = $client->get('/x');
        $this->assertSame(200, $r->getStatusCode());
        $this->assertCount(0, $mock); // queue drained, only 1 consumed
    }

    /** @dataProvider fourXxCodes */
    public function testFourXxNeverRetried(int $code): void
    {
        $mock = new MockHandler([new Response($code)]);
        $client = $this->clientWith($mock, 3);
        $r = $client->get('/x');
        $this->assertSame($code, $r->getStatusCode());
        $this->assertCount(0, $mock);
    }

    public static function fourXxCodes(): array
    {
        return [[400], [401], [403], [404], [410], [422]];
    }

    public function testFiveXxRetriesUntilSuccess(): void
    {
        $mock = new MockHandler([
            new Response(503),
            new Response(503),
            new Response(200, [], '{}'),
        ]);
        $client = $this->clientWith($mock, 3);
        $r = $client->get('/x');
        $this->assertSame(200, $r->getStatusCode());
        $this->assertCount(0, $mock);
    }

    public function testFiveXxExhaustsRetriesThenSurfaces(): void
    {
        $mock = new MockHandler([
            new Response(503),
            new Response(503),
            new Response(503),
            new Response(503),
        ]);
        $client = $this->clientWith($mock, 3);
        $r = $client->get('/x');
        $this->assertSame(503, $r->getStatusCode());
        $this->assertCount(0, $mock);
    }

    public function testTransportErrorRetriedThenSucceeds(): void
    {
        $req = new Request('GET', '/x');
        $mock = new MockHandler([
            new ConnectException('connection refused', $req),
            new ConnectException('connection refused', $req),
            new Response(200, [], '{}'),
        ]);
        $client = $this->clientWith($mock, 3);
        $r = $client->get('/x');
        $this->assertSame(200, $r->getStatusCode());
        $this->assertCount(0, $mock);
    }

    public function testTransportErrorExhaustsRetriesThenThrows(): void
    {
        $req = new Request('GET', '/x');
        $mock = new MockHandler([
            new ConnectException('refused', $req),
            new ConnectException('refused', $req),
            new ConnectException('refused', $req),
            new ConnectException('refused', $req),
        ]);
        $client = $this->clientWith($mock, 3);
        $this->expectException(ConnectException::class);
        $client->get('/x');
    }

    public function testTimeoutNeverRetried(): void
    {
        $req = new Request('GET', '/x');
        // Simulate cURL timeout via errno=28 in handler context.
        $mock = new MockHandler([
            new ConnectException('cURL error 28: Operation timed out', $req, null, ['errno' => 28]),
            new Response(200, [], '{}'),
        ]);
        $client = $this->clientWith($mock, 3);
        $this->expectException(ConsentShieldTimeoutException::class);
        $client->get('/x');
    }

    public function testTimeoutDetectedByMessageEvenWithoutErrno(): void
    {
        $req = new Request('GET', '/x');
        $mock = new MockHandler([
            new ConnectException('Operation timed out after 2000 ms', $req),
            new Response(200, [], '{}'),
        ]);
        $client = $this->clientWith($mock, 3);
        $this->expectException(ConsentShieldTimeoutException::class);
        $client->get('/x');
    }

    public function testRequestExceptionWithResponseDoesNotRetry(): void
    {
        $req = new Request('GET', '/x');
        $mock = new MockHandler([
            new RequestException('http error', $req, new Response(404)),
            new Response(200, [], '{}'),
        ]);
        $client = $this->clientWith($mock, 3);
        $this->expectException(RequestException::class);
        $client->get('/x');
    }

    public function testZeroRetriesMeansOneAttempt(): void
    {
        $mock = new MockHandler([new Response(503)]);
        $client = $this->clientWith($mock, 0);
        $r = $client->get('/x');
        $this->assertSame(503, $r->getStatusCode());
        $this->assertCount(0, $mock);
    }

    public function testInvalidMaxRetriesRejected(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        RetryMiddleware::create(-1);
    }

    public function testInvalidMaxRetriesUpperBoundRejected(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        RetryMiddleware::create(99);
    }
}
