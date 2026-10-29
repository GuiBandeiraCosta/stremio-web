// Copyright (C) 2017-2026 Smart code 203358507

// "What comes next in this franchise / series, and when?" answered from TMDB.
//
// The rule for what a card says: a later part / episode / season with a date in
// the future ("upcoming"), or one that came out in the last RECENT_DAYS days
// ("recent"). A series TMDB marks as ended or canceled says so ("ended"). Anything
// else (out long ago, no date, no sequel) says nothing.

const TMDB_BASE = 'https://api.themoviedb.org/3';
const DAY_MS = 24 * 60 * 60 * 1000;
// A sequel / season that came out this recently still counts as news.
export const RECENT_DAYS = 90;

export type NextReleaseStatus = 'upcoming' | 'recent' | 'released' | 'tba' | 'none' | 'ended' | 'unknown' | 'unsupported';

export type NextRelease = {
    title: string;
    date: string | null;
    tmdbId?: number;
    name?: string | null;
    season?: number;
    episode?: number | null;
};

export type NextReleaseResult = {
    id?: string;
    kind: string;
    tmdbId?: number;
    title?: string;
    releaseDate?: string | null;
    collection?: string;
    seriesStatus?: string | null;
    lastAirDate?: string | null;
    status: NextReleaseStatus;
    reason?: string;
    next: NextRelease | null;
    daysUntil: number | null;
    followUp?: string;
};

export type NextReleaseBanner = {
    label: string;
    tone: 'upcoming' | 'recent' | 'ended';
    icon: string | null;
    title: string | null;
};

type ItemRef = { id: string; type: string };

// Follow-ups TMDB does not know about: TV shows have no "collection", so a
// spin-off of an ended series has to be listed by hand. Keyed by the Stremio
// (IMDb) id of the finished show; the value is what to watch for instead.
export const FOLLOW_UPS: Record<string, ItemRef & { title: string }> = {
    'tt6517102': { id: 'tt14833612', type: 'series', title: 'Castlevania: Nocturne' }, // Castlevania (2017–2021)
};

type TmdbFind = { movie_results?: { id: number }[]; tv_results?: { id: number }[] };
type TmdbPart = { id: number; title: string; release_date?: string | null };
type TmdbMovie = { id: number; title: string; release_date?: string | null; belongs_to_collection?: { id: number; name: string } | null };
type TmdbCollection = { name?: string; parts?: TmdbPart[] };
type TmdbEpisode = { season_number: number; episode_number: number; name?: string | null; air_date?: string | null };
type TmdbSeason = { season_number: number; name?: string | null; air_date?: string | null };
type TmdbShow = {
    id: number;
    name: string;
    status?: string | null;
    last_air_date?: string | null;
    last_episode_to_air?: TmdbEpisode | null;
    next_episode_to_air?: TmdbEpisode | null;
    seasons?: TmdbSeason[];
};

export type TmdbClient = {
    get: <T>(path: string, params?: Record<string, string>) => Promise<T | null>;
};

type ClientOptions = {
    apiKey: string;
    fetch?: typeof globalThis.fetch;
    language?: string;
};

// TMDB v4 "read access tokens" are JWTs sent as a bearer header;
// v3 keys are short hex strings sent as a query parameter.
const isBearerToken = (apiKey: string) => apiKey.startsWith('eyJ');

export const createClient = ({ apiKey, fetch = globalThis.fetch, language = 'en-US' }: ClientOptions): TmdbClient => {
    if (typeof apiKey !== 'string' || apiKey.length === 0) {
        throw new Error('A TMDB API key is required');
    }

    const get = async <T>(path: string, params: Record<string, string> = {}): Promise<T | null> => {
        const url = new URL(TMDB_BASE + path);
        url.searchParams.set('language', language);
        Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
        const headers: Record<string, string> = { accept: 'application/json' };
        if (isBearerToken(apiKey)) {
            headers.authorization = `Bearer ${apiKey}`;
        } else {
            url.searchParams.set('api_key', apiKey);
        }

        const response = await fetch(url.toString(), { headers });
        if (response.status === 404) {
            return null;
        }
        if (!response.ok) {
            throw new Error(`TMDB responded ${response.status} for ${path}`);
        }
        return response.json() as Promise<T>;
    };

    return { get };
};

// Stremio library ids are IMDb ids ("tt0133093") for most content, but a
// "tmdb:603" form and plain TMDB numbers are accepted too.
export const resolveTmdbId = async (client: TmdbClient, { id, type }: ItemRef): Promise<number | null> => {
    if (/^tmdb:\d+$/.test(id)) {
        return Number(id.slice('tmdb:'.length));
    }
    if (/^\d+$/.test(id)) {
        return Number(id);
    }
    if (/^tt\d+$/.test(id)) {
        const found = await client.get<TmdbFind>(`/find/${id}`, { external_source: 'imdb_id' });
        const results = type === 'series' ? found?.tv_results : found?.movie_results;
        return results?.[0]?.id ?? null;
    }
    return null;
};

const toUtcDay = (date: string | null | undefined): number | null => {
    if (typeof date !== 'string' || date.length === 0) {
        return null;
    }
    const day = Date.parse(`${date}T00:00:00Z`);
    return Number.isNaN(day) ? null : day;
};

export const daysBetween = (fromDate: string | null | undefined, toDate: string | null | undefined): number | null => {
    const from = toUtcDay(fromDate);
    const to = toUtcDay(toDate);
    if (from === null || to === null) {
        return null;
    }
    return Math.round((to - from) / DAY_MS);
};

// 'upcoming' (date in the future) | 'recent' (out in the last RECENT_DAYS days) |
// 'released' (out longer ago) | 'tba' (no date)
export const statusForDate = (date: string | null | undefined, today: string): 'upcoming' | 'recent' | 'released' | 'tba' => {
    const days = daysBetween(today, date);
    if (days === null) {
        return 'tba';
    }
    return days > 0 ? 'upcoming' : days > -RECENT_DAYS ? 'recent' : 'released';
};

// What a dated "next" thing yields: its status and the signed day count (negative = ago).
const dated = (next: NextRelease, today: string) => ({
    status: statusForDate(next.date, today),
    next,
    daysUntil: next.date ? daysBetween(today, next.date) : null,
});

const nextForMovie = async (client: TmdbClient, tmdbId: number, today: string): Promise<NextReleaseResult> => {
    const movie = await client.get<TmdbMovie>(`/movie/${tmdbId}`);
    if (!movie) {
        return { kind: 'movie', tmdbId, status: 'unknown', reason: 'TMDB has no movie with this id', next: null, daysUntil: null };
    }

    const base = { kind: 'movie', tmdbId, title: movie.title, releaseDate: movie.release_date || null };
    const membership = movie.belongs_to_collection;
    if (!membership) {
        return { ...base, status: 'none', reason: 'not part of a collection', next: null, daysUntil: null };
    }

    const collection = await client.get<TmdbCollection>(`/collection/${membership.id}`);
    const collectionName = collection?.name ?? membership.name;
    const parts = (collection?.parts ?? []).map((part) => ({
        tmdbId: part.id,
        title: part.title,
        date: part.release_date || null,
    }));
    const currentDate = movie.release_date || parts.find((part) => part.tmdbId === movie.id)?.date || null;

    // Later parts with a date, soonest first. It does not matter whether the part
    // right after this one is already out: Dune (2021) still counts down to Part Three.
    const later = parts
        .filter((part): part is typeof part & { date: string } =>
            part.tmdbId !== movie.id && part.date !== null && (currentDate === null || part.date > currentDate)
        )
        .sort((a, b) => a.date.localeCompare(b.date));
    const upcoming = later.find((part) => statusForDate(part.date, today) === 'upcoming');
    const recent = [...later].reverse().find((part) => statusForDate(part.date, today) === 'recent');
    const next = upcoming ?? recent ?? null;

    if (!next) {
        const reason = later.length === 0 ? 'no later movie in the collection' : 'the later movies are all out for a while';
        return { ...base, collection: collectionName, status: 'none', reason, next: null, daysUntil: null };
    }

    return {
        ...base,
        collection: collectionName,
        ...dated({ title: next.title, date: next.date, tmdbId: next.tmdbId }, today),
    };
};

const nextForSeries = async (client: TmdbClient, tmdbId: number, today: string): Promise<NextReleaseResult> => {
    const show = await client.get<TmdbShow>(`/tv/${tmdbId}`);
    if (!show) {
        return { kind: 'series', tmdbId, status: 'unknown', reason: 'TMDB has no series with this id', next: null, daysUntil: null };
    }

    const base = { kind: 'series', tmdbId, title: show.name, seriesStatus: show.status ?? null, lastAirDate: show.last_air_date || null };
    const nextEpisode = show.next_episode_to_air ?? null;
    if (nextEpisode) {
        const label = `S${nextEpisode.season_number}E${nextEpisode.episode_number}`;
        return {
            ...base,
            ...dated({ title: label, name: nextEpisode.name || null, date: nextEpisode.air_date || null, season: nextEpisode.season_number, episode: nextEpisode.episode_number }, today),
        };
    }

    const lastSeason = show.last_episode_to_air?.season_number ?? 0;
    const nextSeason = (show.seasons ?? [])
        .filter((season) => season.season_number > lastSeason)
        .sort((a, b) => a.season_number - b.season_number)[0] ?? null;
    if (nextSeason) {
        return {
            ...base,
            ...dated({ title: `Season ${nextSeason.season_number}`, name: nextSeason.name || null, date: nextSeason.air_date || null, season: nextSeason.season_number, episode: null }, today),
        };
    }

    const ended = ['Ended', 'Canceled'].includes(show.status ?? '');
    return {
        ...base,
        status: ended ? 'ended' : 'tba',
        reason: ended ? `series ${String(show.status).toLowerCase()}` : 'nothing scheduled yet',
        next: null,
        daysUntil: null,
    };
};

const hasNews = (result: NextReleaseResult) => result.status === 'upcoming' || result.status === 'recent';

// Main entry. `item` is { id, type } from a Stremio library item.
// `today` is a 'YYYY-MM-DD' string, defaulting to the current UTC day.
export const nextRelease = async (client: TmdbClient, item: ItemRef, today: string = new Date().toISOString().slice(0, 10)): Promise<NextReleaseResult> => {
    const type = item.type === 'series' ? 'series' : item.type === 'movie' ? 'movie' : null;
    if (type === null) {
        return { kind: item.type, id: item.id, status: 'unsupported', reason: `no franchise lookup for type "${item.type}"`, next: null, daysUntil: null };
    }

    const tmdbId = await resolveTmdbId(client, { id: item.id, type });
    if (tmdbId === null) {
        return { kind: type, id: item.id, status: 'unknown', reason: 'could not map this id to TMDB', next: null, daysUntil: null };
    }

    const result = type === 'movie' ?
        await nextForMovie(client, tmdbId, today)
        :
        await nextForSeries(client, tmdbId, today);

    // A finished show with a hand-listed follow-up: report the follow-up's news instead.
    const followUp = FOLLOW_UPS[item.id];
    if (followUp && !hasNews(result)) {
        const followUpResult = await nextRelease(client, followUp, today);
        if (hasNews(followUpResult)) {
            return { id: item.id, ...followUpResult, followUp: followUp.title, title: result.title ?? followUpResult.title };
        }
    }
    return { id: item.id, ...result };
};

// "Dune: Part Three" on a Dune card is just "Part Three". Only a "<prefix>: " or
// "<prefix> - " prefix is dropped; "Harry Potter and the ..." stays whole.
export const shortTitle = (title: string, prefixes: (string | null | undefined)[]): string => {
    for (const prefix of prefixes) {
        if (typeof prefix !== 'string' || prefix.length === 0) continue;
        const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = new RegExp(`^${escaped}\\s*[:\\-–]\\s+(.+)$`, 'i').exec(title);
        if (match) return match[1];
    }
    return title;
};

const whenLabel = (days: number | null): string => {
    if (days === null) return '';
    if (days === 0) return 'today';
    if (days === 1) return 'tomorrow';
    if (days > 1) return `in ${days} days`;
    if (days === -1) return 'out yesterday';
    return `out ${-days} days ago`;
};

// One full sentence, for the tooltip: "Dune: Part Three · in 50 days".
export const formatNextRelease = (result: NextReleaseResult | null | undefined): string | null => {
    if (!result) {
        return null;
    }
    const via = result.followUp ? `${result.followUp} ` : '';
    switch (result.status) {
        case 'upcoming':
        case 'recent':
            return result.next ? `${via}${result.next.title} · ${whenLabel(result.daysUntil)}` : null;
        case 'released':
            return result.next ? `${result.next.title} · out ${-(result.daysUntil ?? 0)} days ago` : null;
        case 'tba':
            return result.next ? `${result.next.title} · no date yet` : 'Next season · no date yet';
        case 'ended':
            return result.seriesStatus === 'Canceled' ? 'Series canceled' : 'Series ended';
        case 'none':
            return result.kind === 'movie' ? 'No sequel announced' : 'Nothing announced';
        default:
            return null;
    }
};

// The banner across the top of a poster, or null when there is nothing to say.
// `libraryTmdbIds` (optional) is the set of TMDB ids already in the user's library:
// a recent sequel they already have is not news.
export const formatNextReleaseBanner = (result: NextReleaseResult | null | undefined, libraryTmdbIds: Set<number> | null = null): NextReleaseBanner | null => {
    if (!result) {
        return null;
    }
    if (result.status === 'ended') {
        const year = typeof result.lastAirDate === 'string' ? result.lastAirDate.slice(0, 4) : null;
        const what = result.seriesStatus === 'Canceled' ? 'Canceled' : 'Ended';
        return { label: year ? `${what} · ${year}` : what, tone: 'ended', icon: null, title: formatNextRelease(result) };
    }
    const next = result.next;
    if (!hasNews(result) || !next) {
        return null;
    }
    if (result.status === 'recent' && result.kind === 'movie' && libraryTmdbIds && typeof next.tmdbId === 'number' && libraryTmdbIds.has(next.tmdbId)) {
        return null;
    }
    const collectionPrefix = typeof result.collection === 'string' ? result.collection.replace(/\s+collection$/i, '') : null;
    const what = result.kind === 'series' ?
        (next.episode === null ? `S${next.season}` : next.title)
        :
        shortTitle(next.title, [result.title, collectionPrefix]);
    const via = result.followUp ? `${shortTitle(result.followUp, [result.title])} ` : '';
    const days = result.daysUntil ?? 0;
    const tone: NextReleaseBanner['tone'] = result.status === 'recent' ? 'recent' : 'upcoming';
    // "Out now" leads on a recent release so it survives a narrow poster; a countdown trails.
    const label = tone === 'recent' ?
        `Out now · ${via}${what}`
        :
        `${via}${what} · ${days === 0 ? 'today' : days === 1 ? 'tomorrow' : `${days} days`}`;
    return { label, tone, icon: 'clock', title: formatNextRelease(result) };
};
