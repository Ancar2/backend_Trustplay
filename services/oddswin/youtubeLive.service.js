const LiveEventCache = require("../../models/oddswin/liveEventCache.model");

const CACHE_KEY_NEXT_LIVE = "lottery_medellin_next_live";
const DEFAULT_TIMEZONE = "America/Bogota";
const DEFAULT_CACHE_TTL_SECONDS = 600;
const YOUTUBE_VIDEO_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;

const toPositiveInteger = (value, fallback) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    const rounded = Math.floor(parsed);
    return rounded > 0 ? rounded : fallback;
};

const getCacheTtlMs = () => (
    toPositiveInteger(process.env.YOUTUBE_LIVE_CACHE_TTL_SECONDS, DEFAULT_CACHE_TTL_SECONDS) * 1000
);

const getYoutubeConfig = () => ({
    apiKey: String(process.env.YOUTUBE_API_KEY || "").trim(),
    channelId: String(process.env.YOUTUBE_LOTERIA_MEDELLIN_CHANNEL_ID || "").trim(),
});

const buildEmbedUrl = (videoId) => `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1`;

const buildScheduledOnlyPayload = (reason = "fallback") => ({
    status: "scheduled_only",
    scheduledAt: getNextFridayAt11PmBogotaIso(),
    timezone: DEFAULT_TIMEZONE,
    source: reason,
});

const fetchJson = async (url) => {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`YouTube API ${response.status}`);
    }
    return response.json();
};

const buildYoutubeSearchUrl = ({ apiKey, channelId, eventType }) => {
    const params = new URLSearchParams({
        part: "snippet",
        channelId,
        eventType,
        type: "video",
        maxResults: "10",
        order: "date",
        key: apiKey,
    });

    return `https://www.googleapis.com/youtube/v3/search?${params.toString()}`;
};

const buildYoutubeVideoDetailsUrl = ({ apiKey, videoIds }) => {
    const params = new URLSearchParams({
        part: "liveStreamingDetails,snippet",
        id: videoIds.join(","),
        key: apiKey,
    });

    return `https://www.googleapis.com/youtube/v3/videos?${params.toString()}`;
};

const getNextFridayAt11PmBogotaIso = () => {
    const bogotaOffsetMinutes = -5 * 60;
    const bogotaOffsetMs = bogotaOffsetMinutes * 60 * 1000;
    const nowUtcMs = Date.now();
    const nowBogotaMs = nowUtcMs + bogotaOffsetMs;
    const nowBogota = new Date(nowBogotaMs);

    const currentBogotaDay = nowBogota.getUTCDay(); // 0 domingo ... 5 viernes
    const currentHour = nowBogota.getUTCHours();
    const currentMinute = nowBogota.getUTCMinutes();
    const currentSecond = nowBogota.getUTCSeconds();

    let daysUntilFriday = (5 - currentBogotaDay + 7) % 7;
    const alreadyPastToday = currentBogotaDay === 5 && (
        currentHour > 23
        || (currentHour === 23 && (currentMinute > 0 || currentSecond > 0))
    );

    if (daysUntilFriday === 0 && alreadyPastToday) {
        daysUntilFriday = 7;
    }

    const targetBogotaAsUtc = Date.UTC(
        nowBogota.getUTCFullYear(),
        nowBogota.getUTCMonth(),
        nowBogota.getUTCDate() + daysUntilFriday,
        23,
        0,
        0,
        0
    );

    const targetUtcMs = targetBogotaAsUtc - bogotaOffsetMs;
    return new Date(targetUtcMs).toISOString();
};

const toTimestamp = (value) => {
    if (!value) return Number.NaN;
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : Number.NaN;
};

const extractVideoCandidates = (searchData) => {
    const items = Array.isArray(searchData?.items) ? searchData.items : [];
    return items
        .map((item) => {
            const videoId = item?.id?.videoId;
            if (!videoId || !YOUTUBE_VIDEO_ID_REGEX.test(videoId)) return null;
            return {
                videoId,
                title: item?.snippet?.title || "",
                publishedAt: item?.snippet?.publishedAt || "",
            };
        })
        .filter(Boolean);
};

const buildDetailsMap = (videoDetailsData) => {
    const details = Array.isArray(videoDetailsData?.items) ? videoDetailsData.items : [];
    const map = new Map();
    details.forEach((item) => {
        const videoId = item?.id;
        if (!videoId || !YOUTUBE_VIDEO_ID_REGEX.test(videoId)) return;
        const liveDetails = item?.liveStreamingDetails || {};
        map.set(videoId, {
            title: item?.snippet?.title || "",
            scheduledStartTime: liveDetails?.scheduledStartTime || "",
            actualStartTime: liveDetails?.actualStartTime || "",
            publishedAt: item?.snippet?.publishedAt || "",
        });
    });
    return map;
};

const resolvePreferredVideo = ({ candidates, detailsMap, eventType }) => {
    if (!Array.isArray(candidates) || candidates.length === 0) return null;

    const enriched = candidates.map((candidate, index) => {
        const details = detailsMap.get(candidate.videoId) || {};
        const title = details.title || candidate.title || "";
        const scheduledAt = details.scheduledStartTime || "";
        const actualAt = details.actualStartTime || "";
        const publishedAt = details.publishedAt || candidate.publishedAt || "";

        // live: queremos el primero que empezó (actualStartTime más antiguo)
        // upcoming: queremos el primero que va a empezar (scheduledStartTime más próximo)
        const preferredTime = eventType === "live"
            ? (actualAt || scheduledAt || publishedAt)
            : (scheduledAt || publishedAt || actualAt);

        return {
            videoId: candidate.videoId,
            title,
            scheduledAt,
            actualAt,
            sortTimestamp: toTimestamp(preferredTime),
            originalIndex: index,
        };
    });

    const withTime = enriched.filter((item) => Number.isFinite(item.sortTimestamp));
    const sorted = (withTime.length > 0 ? withTime : enriched).sort((a, b) => {
        const left = Number.isFinite(a.sortTimestamp) ? a.sortTimestamp : Number.MAX_SAFE_INTEGER;
        const right = Number.isFinite(b.sortTimestamp) ? b.sortTimestamp : Number.MAX_SAFE_INTEGER;
        if (left !== right) return left - right;
        return a.originalIndex - b.originalIndex;
    });

    return sorted[0] || null;
};

const fetchYoutubeLivePayload = async () => {
    const { apiKey, channelId } = getYoutubeConfig();
    if (!apiKey || !channelId) {
        return buildScheduledOnlyPayload("youtube_no_configurado");
    }

    const liveSearch = await fetchJson(buildYoutubeSearchUrl({
        apiKey,
        channelId,
        eventType: "live",
    }));

    const liveCandidates = extractVideoCandidates(liveSearch);
    let selected = null;
    let status = "live";

    if (liveCandidates.length > 0) {
        const liveDetailsData = await fetchJson(buildYoutubeVideoDetailsUrl({
            apiKey,
            videoIds: liveCandidates.map((item) => item.videoId),
        }));
        selected = resolvePreferredVideo({
            candidates: liveCandidates,
            detailsMap: buildDetailsMap(liveDetailsData),
            eventType: "live",
        });
    }

    if (!selected) {
        const upcomingSearch = await fetchJson(buildYoutubeSearchUrl({
            apiKey,
            channelId,
            eventType: "upcoming",
        }));
        const upcomingCandidates = extractVideoCandidates(upcomingSearch);
        if (upcomingCandidates.length > 0) {
            const upcomingDetailsData = await fetchJson(buildYoutubeVideoDetailsUrl({
                apiKey,
                videoIds: upcomingCandidates.map((item) => item.videoId),
            }));
            selected = resolvePreferredVideo({
                candidates: upcomingCandidates,
                detailsMap: buildDetailsMap(upcomingDetailsData),
                eventType: "upcoming",
            });
        }
        status = "upcoming";
    }

    if (!selected) {
        return buildScheduledOnlyPayload("youtube_sin_video_programado");
    }

    const fallbackIso = getNextFridayAt11PmBogotaIso();
    const scheduledAt = selected.scheduledAt || selected.actualAt || fallbackIso;

    return {
        status,
        scheduledAt,
        videoId: selected.videoId,
        title: selected.title,
        embedUrl: buildEmbedUrl(selected.videoId),
        timezone: DEFAULT_TIMEZONE,
        source: status === "live" ? "youtube_live" : "youtube_upcoming",
    };
};

const shouldRefreshCacheNow = (cachedPayload) => {
    if (!cachedPayload) return true;
    if (cachedPayload.status === "live") return false;

    const scheduledAt = cachedPayload.scheduledAt ? new Date(cachedPayload.scheduledAt).getTime() : NaN;
    if (!Number.isFinite(scheduledAt)) return false;

    const now = Date.now();
    return now >= (scheduledAt - 3 * 60 * 1000);
};

const getNextLiveWithCache = async ({ forceRefresh = false } = {}) => {
    const now = new Date();
    const cached = await LiveEventCache.findOne({ key: CACHE_KEY_NEXT_LIVE }).lean();

    if (!forceRefresh && cached && cached.expiresAt && new Date(cached.expiresAt) > now) {
        if (!shouldRefreshCacheNow(cached.payload)) {
            return {
                ...cached.payload,
                cached: true,
                checkedAt: now.toISOString(),
            };
        }
    }

    let payload;
    try {
        payload = await fetchYoutubeLivePayload();
    } catch (error) {
        payload = {
            ...buildScheduledOnlyPayload("youtube_error"),
            error: error.message,
        };
    }

    const expiresAt = new Date(now.getTime() + getCacheTtlMs());

    await LiveEventCache.findOneAndUpdate(
        { key: CACHE_KEY_NEXT_LIVE },
        {
            $set: {
                payload,
                expiresAt,
            },
        },
        {
            upsert: true,
            setDefaultsOnInsert: true,
        }
    );

    return {
        ...payload,
        cached: false,
        checkedAt: now.toISOString(),
    };
};

module.exports = {
    getNextLiveWithCache,
    getNextFridayAt11PmBogotaIso,
    DEFAULT_TIMEZONE,
};
