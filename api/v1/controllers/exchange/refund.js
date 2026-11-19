const { isAuthenticated, isVerified } = require("@middleware/authentication");
const { requireParam, requireBodyParam } = require("@modules/error-wrapper");
const { refundExchange } = require("@services/exchange-service");
const ValidationError = require("@errors/validation-error");

/**
 * Register exchanges refund controller routes.
 * @param {import("express").Router} router
 */
module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/exchanges/{id}/refund:
     *   post:
     *     summary: Refund an exchange
     *     description: >
     *       Refunds a completed exchange and reverses the exchanged resources.
     *       Partial refunds can be specified with partial offer or request payloads.
     *     tags: [Exchanges]
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: integer
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - pin
     *             properties:
     *               pin:
     *                 type: string
     *                 description: 4-6 numeric user or pool pin
     *                 example: "1234"
     *               partialOffer:
     *                 type: object
     *                 description: Quantities from the original offer to refund, keyed by item ID (0 for digipogs).
     *                 additionalProperties:
     *                   type: integer
     *                 example:
     *                   "0": 10
     *                   "2": 3
     *               partialRequest:
     *                 type: object
     *                 description: Quantities from the original request to refund, keyed by item ID (0 for digipogs).
     *                 additionalProperties:
     *                   type: integer
     *                 example:
     *                   "0": 5
     *                   "1": 2
     *     responses:
     *       200:
     *         description: Exchange refunded successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                 data:
     *                   type: object
     *       400:
     *         description: Request is badly formed or is missing PIN
     *       401:
     *         description: Not authenticated or invalid PIN
     *       403:
     *         description: Exchange cannot be refunded
     *       404:
     *         description: Exchange not found
     */
    router.post("/exchanges/:id/refund", isAuthenticated, isVerified, async (req, res) => {
        requireParam(req.params.id, "id");
        requireBodyParam(req.body.pin, "pin");

        const exchangeId = Number(req.params.id);
        const { pin, partialOffer = {}, partialRequest = {} } = req.body;
        if (!Number.isInteger(exchangeId) || exchangeId <= 0) {
            throw new ValidationError("Exchange ID must be a positive integer.", { reason: "invalid_exchange_id" });
        }

        req.infoEvent("exchanges.refund", "Refunding exchange", { exchangeId, userId: req.user.id });

        const { success } = await refundExchange({
            id: exchangeId,
            pin,
            partialOffer,
            partialRequest,
        });
        res.status(200).json({ success: true, data: { refunded: success } });
    });
};