// Copyright (C) 2017-2026 Smart code 203358507

// The TMDB key is personal and lives only in this browser.
// It is never sent anywhere except api.themoviedb.org.

const STORAGE_KEY = 'tmdb_api_key';

export const getTmdbApiKey = (): string | null => {
    try {
        const value = globalThis.localStorage?.getItem(STORAGE_KEY);
        return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
    } catch {
        return null;
    }
};

export const setTmdbApiKey = (value: string | null): void => {
    try {
        if (typeof value === 'string' && value.trim().length > 0) {
            globalThis.localStorage?.setItem(STORAGE_KEY, value.trim());
        } else {
            globalThis.localStorage?.removeItem(STORAGE_KEY);
        }
    } catch {
        // storage unavailable (private mode, blocked): the key just isn't remembered
    }
};
