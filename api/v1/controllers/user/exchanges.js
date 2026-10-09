const { isAuthenticated, isVerified } = require("@middleware/authentication");
const { getExchangesForUser } = require("@services/exchange-service");
const { getUserDataFromDb } = require("@services/user-service");
const { requireQueryParam } = require("@modules/error-wrapper");
const { parsePaginationQuery } = require("@modules/pagination");
const NotFoundError = require("@errors/not-found-error");
const ForbiddenError = require("@errors/forbidden-error");

const DEFAULT_exchange_LIMIT = 20;
const MAX_exchange_LIMIT = 100;

/**
 * Register exchanges list controller routes.
 * @param {import("express").Router} router
 */
module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/user/{id}/exchanges:
     *   get:
     *     summary: List the user's exchanges
     *     description: >
     *       Returns the user's exchanges based on metadata filters
     *     tags: [Exchanges, Users]
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: query
     *         name: limit
     *         schema:
     *           type: integer
     *           default: 20
     *         description: Maximum number of exchanges per bucket
     *       - in: query
     *         name: offset
     *         schema:
     *           type: integer
     *           default: 0
     *         description: Number of exchanges to skip per bucket
     *     responses:
     *       200:
     *         description: exchange buckets returned successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                 data:
     *                   type: object
     *                   properties:
     *                     inbound:
     *                       $ref: '#/components/schemas/TradeBucket'
     *                     outbound:
     *                       $ref: '#/components/schemas/TradeBucket'
     *                     completed:
     *                       $ref: '#/components/schemas/TradeBucket'
     *                     inactive:
     *                       $ref: '#/components/schemas/TradeBucket'
     *       401:
     *         description: Not authenticated
     */
    router.get("/user/:id/trades", isAuthenticated, isVerified, async (req, res) => {
        const userId = Number(req.params.id);
        requireQueryParam(userId, "id");

        if (req.user.id !== userId) {
            throw new ForbiddenError("You can only view your own trades.", { event: "user.trades.list.failed", reason: "forbidden" });
        }

        const { limit, offset } = parsePaginationQuery(req.query, DEFAULT_TRADE_LIMIT, MAX_TRADE_LIMIT);
        const requestedUser = await getUserDataFromDb(userId);
        if (!requestedUser) {
            throw new NotFoundError("User not found.", { event: "user.trades.list.failed", reason: "user_not_found" });
        }

        req.infoEvent("user.trades.list.attempt", "Attempting to list user trades", { userId: userId });

        const buckets = await getTradesForUser(userId, { limit, offset });
        req.infoEvent("user.trades.list.success", "User trades listed successfully", { userId: userId });
        res.status(200).json({ success: true, data: buckets });
    });
};
