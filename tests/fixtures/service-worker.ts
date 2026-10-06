// The test environment has no installed PWA service worker.
export const useRegisterSW = () => ({ needRefresh: [false] as const, updateServiceWorker: async () => {} });
