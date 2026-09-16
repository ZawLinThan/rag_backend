import { AsyncLocalStorage } from "node:async_hooks";

const calls = new AsyncLocalStorage<() => Promise<void>>();

export const beforeProviderCall = async () => {
    await calls.getStore()?.();
};