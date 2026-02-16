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
        maxResults: "1",
        order: "date",
        key: apiKey,
    });

    return `https://www.googleapis.com/youtube/v3/search?${params.toString()}`;
};

const buildYoutubeVideoDetailsUrl = ({ apiKey, videoId }) => {
    const params = new URLSearchParams({
        part: "liveStreamingDetails,snippet",
        id: videoId,
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

const selectFirstVideo = (searchData) => {
    const item = Array.isArray(searchData?.items) ? searchData.items[0] : null;
    const videoId = item?.id?.videoId;
    if (!videoId || !YOUTUBE_VIDEO_ID_REGEX.test(videoId)) return null;
    return {
        videoId,
        title: item?.snippet?.title || "",
    };
};

const resolveScheduledAt = (videoDetailsData, fallbackIso) => {
    const details = Array.isArray(videoDetailsData?.items) ? videoDetailsData.items[0] : null;
    const liveDetails = details?.liveStreamingDetails || {};

    return (
        liveDetails.scheduledStartTime
        || liveDetails.actualStartTime
        || fallbackIso
    );
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

    let selected = selectFirstVideo(liveSearch);
    let status = "live";

    if (!selected) {
        const upcomingSearch = await fetchJson(buildYoutubeSearchUrl({
            apiKey,
            channelId,
            eventType: "upcoming",
        }));
        selected = selectFirstVideo(upcomingSearch);
        status = "upcoming";
    }

    if (!selected) {
        return buildScheduledOnlyPayload("youtube_sin_video_programado");
    }

    const fallbackIso = getNextFridayAt11PmBogotaIso();
    const videoDetailsData = await fetchJson(buildYoutubeVideoDetailsUrl({
        apiKey,
        videoId: selected.videoId,
    }));

    const scheduledAt = resolveScheduledAt(videoDetailsData, fallbackIso);

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
