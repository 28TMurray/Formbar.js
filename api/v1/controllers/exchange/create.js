const { createExchange } = require("@services/exchange-service");
const { isAuthenticated, isVerified } = require("@middleware/authentication");
const { requireBodyParam } = require("@modules/error-wrapper");
const ValidationError = require("@errors/validation-error");

module.exports = (router) => {
    /**
    * @swagger
    * /exchanges:
    *   post:
    *     summary: Create a new exchange
    *     description: Creates a new exchange transaction between two parties
    *     tags:
    *       - Exchanges
    *     security:
    *       - bearerAuth: []
    *     requestBody:
    *       required: true
    *       content:
    *         application/json:
    *           schema:
    *             type: object
    *             required:
    *               - to
    *               - from
    *             properties:
    *               to:
    *                 type: object
    *                 description: Recipient details
    *               from:
    *                 type: object
    *                 description: Sender details
    *               reason:
    *                 type: string
    *                 description: Reason for the exchange
    *     responses:
    *       200:
    *         description: Exchange completed successfully
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
    *                     exchangeId:
    *                       type: string
    *       201:
    *         description: Exchange pending approval
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
    *                     exchangeId:
    *                       type: string
    *       400:
    *         description: Request is badly formed or is missing PIN.
    *       401:
    *         description: Invalid PIN
    *       403:
    *         description: Insufficient resources
    *       404:
    *         description: Invalid IDs
    *       500:
    *         description: Failed transfer
    */
    router.post("/exchanges", isAuthenticated, async (req, res) => {
        const { to, from } = req.body;

        requireBodyParam(to, "to");
        requireBodyParam(from, "from");

        from.userId = req.user.id;

        req.infoEvent("exchange.create.attempt", "Creating exchange", req.body);

        const { status, exchangeId } = await createExchange(req.body);

        res.status(200).json({ success: true, data: { exchangeId } });
    })
}
