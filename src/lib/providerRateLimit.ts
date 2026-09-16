import { setTimeout as delay } from "node:timers/promises";
import { Provider } from "../types";

export const providerStatus = (error: any): number | undefined => {
    return error?.status ?? error?.statusCode ?? error?.response?.status;
}

const header = (headers: any, name: string): string | undefined => {
    return headers?.get?.(name) ?? headers?.[name];
}

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

export const tagProviderError = (error: any, provider: Provider) => {
    if (error && typeof error === "object") {
        error.provider = provider;
        error.status = providerStatus(error);
        if (error.status === 429) error.retryAfterMs = retryDelay(error);
    }
    return error;
};

export interface ProviderGate {
    acquire(tokens: number): Promise<number>;
    cooldown(milliseconds: number): Promise<void>;
}

export const abortableWait = async (
    milliseconds: number,
) => {
    while (milliseconds > 0) {
        const chunk = Math.min(milliseconds, 30000);
        await delay(chunk, undefined);
        milliseconds -= chunk;
    }
};

export class ProviderScheduler {
    constructor(
        private gate: ProviderGate,
        private wait = abortableWait,
    ) { }

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

export const configureProviderScheduler = (
    provider: Provider,
    scheduler?: ProviderScheduler,
) => {
    if (scheduler) schedulers.set(provider, scheduler);
    else schedulers.delete(provider);
};

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

export const providerBackoff = (
    attempts: number,
    _type: string | undefined,
    error: any,
) => Math.max(30000 * 2 ** Math.max(0, attempts - 1), error?.retryAfterMs ?? 0);
