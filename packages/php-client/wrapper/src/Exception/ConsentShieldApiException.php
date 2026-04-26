<?php declare(strict_types=1);

namespace ConsentShield\Sdk\Exception;

/**
 * Thrown when the ConsentShield API returns a 4xx response.
 * 4xx responses ALWAYS surface — never retried, never folded into fail-OPEN.
 */
final class ConsentShieldApiException extends ConsentShieldException
{
    /**
     * @param array<string, mixed> $extensions
     */
    public function __construct(
        private readonly int $status,
        private readonly ?string $type,
        private readonly ?string $title,
        private readonly ?string $detail,
        private readonly ?string $instance,
        ?string $traceId,
        private readonly array $extensions = [],
    ) {
        $msg = "ConsentShield API error: status={$status}"
            . ($title !== null && $title !== '' ? " title={$title}" : '')
            . ($detail !== null && $detail !== '' ? " detail={$detail}" : '');
        parent::__construct($msg, $traceId);
    }

    public function getStatus(): int { return $this->status; }
    public function getType(): ?string { return $this->type; }
    public function getTitle(): ?string { return $this->title; }
    public function getDetail(): ?string { return $this->detail; }
    public function getInstance(): ?string { return $this->instance; }
    /** @return array<string, mixed> */
    public function getExtensions(): array { return $this->extensions; }
}
