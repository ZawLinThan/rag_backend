import { setTimeout as delay } from "node:timers/promises";
import { Provider } from "../types";

/**
 * Reads the HTTP status from a provider error.
 *
 * @param error - The provider error to inspect.
 * @returns The available HTTP status, or undefined.
 */
export const providerStatus = (error: any): number | undefined => {
    return error?.status ?? error?.statusCode ?? error?.response?.status;
}

/**
 * Reads a header from a Headers-like object or a plain object.
 *
 * @param headers - The response headers to inspect.
 * @param name - The header name to retrieve.
 * @returns The header value, or undefined.
 */
const header = (headers: any, name: string): string | undefined => {
    return headers?.get?.(name) ?? headers?.[name];
}

/**
 * Calculates a retry delay from provider headers, with a one-second buffer.
 *
 * @param error - The provider error containing response headers.
 * @param now - The current time in milliseconds since the Unix epoch.
 * @returns The delay in milliseconds, defaulting to 60000 for missing or invalid headers.
 */
export const retryDelay = (error: any, now = Date.now()): number => {
    const headers = error?.headers ?? error?.response?.headers;
    const retry = header(headers, "retry-after");

    if (retry) {
        const seconds = Number(retry);
        const milliseconds = Number.isFinite(seconds)
            ? seconds * 1000
            : Date.parse(retry) - now;
        if (Number.isFinite(milliseconds) && milliseconds >= 0)
            return Math.ceil(milliseconds) + 1000;
    }
    const reset = header(headers, "x-ratelimit-reset-tokens");

    if (reset && /^(?:\d+(?:\.\d+)?(?:ms|s|m|h))+$/.test(reset)) {
        let milliseconds = 0;
        for (const match of reset.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/g))
            milliseconds +=
                Number(match[1]) * { ms: 1, s: 1000, m: 60000, h: 3600000 }[match[2]]!;
        return Math.ceil(milliseconds) + 1000;
    }

    return 60000;
};

/**
 * Adds provider, status, and rate-limit retry details to an error object.
 *
 * @param error - The error to annotate when it is an object.
 * @param provider - The provider that produced the error.
 * @returns The original error value.
 */
export const tagProviderError = (error: any, provider: Provider) => {
    if (error && typeof error === "object") {
        error.provider = provider;
        error.status = providerStatus(error);
        if (error.status === 429) error.retryAfterMs = retryDelay(error);
    }
    return error;
};

/**
 * Coordinates token capacity and cooldowns for provider requests.
 */
export interface ProviderGate {
    /**
     * Attempts to reserve token capacity for a request.
     *
     * @param tokens - The estimated token cost of the request.
     * @returns A positive delay in milliseconds when the caller must wait, or a nonpositive value when ready.
     */
    acquire(tokens: number): Promise<number>;
    /**
     * Applies a cooldown after a rate-limit response.
     *
     * @param milliseconds - The cooldown duration in milliseconds.
     * @returns Resolves when the cooldown has been registered.
     */
    cooldown(milliseconds: number): Promise<void>;
}

/**
 * Waits for the requested duration in chunks of at most 30 seconds.
 *
 * @param milliseconds - The total duration to wait in milliseconds.
 * @returns Resolves after the wait completes.
 */
export const abortableWait = async (
    milliseconds: number,
) => {
    while (milliseconds > 0) {
        const chunk = Math.min(milliseconds, 30000);
        await delay(chunk, undefined);
        milliseconds -= chunk;
    }
};

/**
 * Schedules requests through a token gate and retries rate-limit failures.
 */
export class ProviderScheduler {
    /**
     * Creates a provider request scheduler.
     *
     * @param gate - The token capacity and cooldown coordinator.
     * @param wait - The asynchronous delay function used between attempts.
     */
    constructor(
        private gate: ProviderGate,
        private wait = abortableWait,
    ) { }

    /**
     * Waits for capacity and executes a request with up to two rate-limit retries.
     *
     * @template T - The request result type.
     * @param provider - The provider receiving the request.
     * @param tokens - The estimated token cost.
     * @param request - The operation to execute after capacity is available.
     * @returns The successful request result.
     * @throws The provider error when it is not retryable or retries are exhausted.
     */
    async run<T>(
        provider: Provider,
        tokens: number,
        request: () => Promise<T>,
    ) {
        for (let attempt = 0; ; attempt++) {

            let wait: number;

            while ((wait = await this.gate.acquire(tokens)) > 0)
                await this.wait(wait);

            
            try {
                return await request();
            } catch (error) {
                tagProviderError(error, provider);
                if (providerStatus(error) !== 429) throw error;
                const milliseconds = retryDelay(error);
                await this.gate.cooldown(milliseconds);
                if (attempt >= 2) throw error;
                console.info(
                    JSON.stringify({
                        event: "provider_rate_limited",
                        provider,
                        retryAfterMs: milliseconds,
                    }),
                );
                await this.wait(milliseconds);
            }
        }
    }
}
const schedulers = new Map<Provider, ProviderScheduler>();

/**
 * Registers or removes a scheduler for a provider.
 *
 * @param provider - The provider to configure.
 * @param scheduler - The scheduler to register; omit it to remove the current scheduler.
 */
export const configureProviderScheduler = (
    provider: Provider,
    scheduler?: ProviderScheduler,
) => {
    if (scheduler) schedulers.set(provider, scheduler);
    else schedulers.delete(provider);
};

/**
 * Executes a provider request using its configured scheduler, if present.
 *
 * @template T - The request result type.
 * @param provider - The provider receiving the request.
 * @param tokens - The estimated token cost.
 * @param request - The asynchronous provider operation.
 * @returns The successful request result.
 * @throws The error annotated with provider details if the request fails.
 */
export const scheduleProviderRequest = async <T>(
    provider: Provider,
    tokens: number,
    request: () => Promise<T>,
) => {
    try {
        const scheduler = schedulers.get(provider);
        return scheduler
            ? await scheduler.run(provider, tokens, request)
            : await request();
    } catch (error) {
        throw tagProviderError(error, provider);
    }
};

/**
 * Calculates exponential backoff while honoring the provider retry delay.
 *
 * @param attempts - The number of attempts used to calculate backoff.
 * @param _type - An unused backoff type supplied by the caller.
 * @param error - The error that may contain a provider retry delay.
 * @returns The backoff duration in milliseconds, with a minimum of 30000.
 */
export const providerBackoff = (
    attempts: number,
    _type: string | undefined,
    error: any,
) => Math.max(30000 * 2 ** Math.max(0, attempts - 1), error?.retryAfterMs ?? 0);
