// Copyright (C) 2017-2026 Smart code 203358507

import { useEffect, useRef, useState } from 'react';
import { createClient, nextRelease, NextReleaseResult } from './nextRelease';

// Results are cached per item in this browser for a day: TMDB data changes
// slowly, and a Library page can hold a hundred cards. The prefix carries a
// version: bump it when the result shape or rules change.
const CACHE_PREFIX = 'nextRelease3:';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CONCURRENCY = 4;

type CatalogItem = { _id: string; type: string };
type Results = Record<string, NextReleaseResult>;

const readCache = (id: string): NextReleaseResult | null => {
    try {
        const raw = globalThis.localStorage?.getItem(CACHE_PREFIX + id);
        if (!raw) return null;
        const entry = JSON.parse(raw) as { at: number; result: NextReleaseResult };
        return Date.now() - entry.at < CACHE_TTL_MS ? entry.result : null;
    } catch {
        return null;
    }
};

const writeCache = (id: string, result: NextReleaseResult) => {
    try {
        globalThis.localStorage?.setItem(CACHE_PREFIX + id, JSON.stringify({ at: Date.now(), result }));
    } catch {
        // storage unavailable: results simply are not remembered
    }
};

// Returns { [itemId]: result } for the given catalog, filling in as lookups finish.
// Does nothing when `apiKey` or `catalog` is null.
const useNextReleases = (catalog: CatalogItem[] | null, apiKey: string | null): Results => {
    const [results, setResults] = useState<Results>({});
    const inFlight = useRef(new Set<string>());

    useEffect(() => {
        if (!apiKey || !Array.isArray(catalog)) {
            return;
        }

        let active = true;
        const client = createClient({ apiKey });
        const pending: CatalogItem[] = [];
        const cached: Results = {};
        catalog.forEach((item) => {
            if (results[item._id] !== undefined || inFlight.current.has(item._id)) {
                return;
            }
            const hit = readCache(item._id);
            if (hit) {
                cached[item._id] = hit;
            } else {
                pending.push(item);
            }
        });
        if (Object.keys(cached).length > 0) {
            setResults((prev) => ({ ...prev, ...cached }));
        }

        const worker = async () => {
            while (active && pending.length > 0) {
                const item = pending.shift() as CatalogItem;
                inFlight.current.add(item._id);
                try {
                    const result = await nextRelease(client, { id: item._id, type: item.type });
                    writeCache(item._id, result);
                    if (active) {
                        setResults((prev) => ({ ...prev, [item._id]: result }));
                    }
                } catch (error) {
                    // Leave the card without a banner; try again on the next visit.
                    console.warn('nextRelease failed for', item._id, error instanceof Error ? error.message : error);
                } finally {
                    inFlight.current.delete(item._id);
                }
            }
        };
        Array.from({ length: CONCURRENCY }, worker);

        return () => {
            active = false;
        };
    }, [catalog, apiKey]);

    return results;
};

export default useNextReleases;
