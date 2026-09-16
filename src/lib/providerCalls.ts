import { AsyncLocalStorage } from "node:async_hooks";

const calls = new AsyncLocalStorage<() => Promise<void>>();

/**
 * Runs the pre-call hook registered in the current asynchronous context.
 *
 * @returns Resolves after the hook completes, or immediately if none is registered.
 */
export const beforeProviderCall = async () => {
    await calls.getStore()?.();
};