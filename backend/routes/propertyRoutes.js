import express from 'express';
import rateLimit from 'express-rate-limit';
import { searchProperties, getLocationTrends, createUserListing, getUserListings, updateUserListing, deleteUserListing, validateApiKeys, getCacheStats, chatWithAI, chatWithAIStream } from '../controller/propertyController.js';
import { transformAISearchRequest } from '../middleware/transformRequest.js';
import { protect } from '../middleware/authMiddleware.js';
import upload from '../middleware/multer.js';
import { createDistributedRateLimiter } from '../utils/distributedRateLimiter.js';

const router = express.Router();

// ── AI-specific distributed rate limiter (works across multiple instances) ────
// Each AI call costs real Firecrawl + GitHub Models quota, so cap per IP/hour.
// Uses filesystem-based storage to work across multiple server instances.
const distributedLimiter = createDistributedRateLimiter({
    windowMs: 60 * 60 * 1000, // 1 hour window
    max: 10,                   // max 10 AI searches per IP per hour
    keyGenerator: (req) => {
        // Respect Render/Vercel proxy header
        const forwarded = req.headers['x-forwarded-for'];
        return forwarded ? forwarded.split(',')[0].trim() : req.ip;
    },
    message: {
        success: false,
        message: 'AI search limit reached (10 searches per hour). Please try again later.',
        error: 'RATE_LIMIT_EXCEEDED',
    },
    storePath: process.env.RATE_LIMIT_STORE_PATH || './.rate-limit-store'
});

const aiLimiter = distributedLimiter.createMiddleware();

// ── Chat-specific distributed rate limiter ────────────────────────────────
// A chat turn is much cheaper than a Firecrawl-backed search (no scraping,
// far fewer tokens), and a real chat session sends many more messages than
// a single search - sharing the 10/hr search budget would let a normal
// conversation lock a user out of property search entirely. Same
// storage-backed pattern as the search limiter, separate budget/state.
const chatDistributedLimiter = createDistributedRateLimiter({
    windowMs: 60 * 60 * 1000, // 1 hour window
    max: 30,                   // max 30 chat messages per IP per hour
    keyGenerator: (req) => {
        const forwarded = req.headers['x-forwarded-for'];
        return forwarded ? forwarded.split(',')[0].trim() : req.ip;
    },
    message: {
        success: false,
        message: 'AI chat limit reached (30 messages per hour). Please try again later.',
        error: 'RATE_LIMIT_EXCEEDED',
    },
    storePath: process.env.CHAT_RATE_LIMIT_STORE_PATH || './.rate-limit-store-chat'
});

const chatLimiter = chatDistributedLimiter.createMiddleware();

// Original route (backend format) — also rate-limited
router.post('/properties/search', aiLimiter, searchProperties);

// Alias route for frontend — transforms format, then rate-limits, then searches
router.post('/ai/search', aiLimiter, transformAISearchRequest, searchProperties);

// Validate user-provided API keys before save/use
router.post('/ai/validate-keys', validateApiKeys);

// AI chat assistant - own rate-limit budget, separate from search (see above)
router.post('/ai/chat', chatLimiter, chatWithAI);

// AI chat assistant (streaming/SSE variant) - same validation, same rate limit
router.post('/ai/chat/stream', chatLimiter, chatWithAIStream);

// Location trends — same rate limit (shares the 10/hr budget)
router.get('/locations/:city/trends', aiLimiter, getLocationTrends);

// ── User listing routes (auth required) ──────────────────────────────────────
router.post('/user/properties', protect, upload.array('images', 4), createUserListing);
router.get('/user/properties', protect, getUserListings);
router.put('/user/properties/:id', protect, upload.array('images', 4), updateUserListing);
router.delete('/user/properties/:id', protect, deleteUserListing);

// ── Rate limiter stats (for monitoring) ──────────────────────────────────────
router.get('/rate-limit/stats', async (req, res) => {
    try {
        const [searchStats, chatStats] = await Promise.all([
            distributedLimiter.getStats(),
            chatDistributedLimiter.getStats(),
        ]);
        res.json({
            success: true,
            stats: { search: searchStats, chat: chatStats },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error fetching rate limit stats:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch rate limit statistics',
            error: error.message
        });
    }
});

// ── Cache stats (for monitoring MongoDB cache) ──────────────────────────────
router.get('/cache/stats', async (req, res) => {
    try {
        const stats = await getCacheStats();
        res.json({
            success: true,
            ...stats,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error fetching cache stats:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch cache statistics',
            error: error.message
        });
    }
});

export default router;