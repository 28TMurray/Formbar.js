const { resetPoolPin, requestPoolPinReset, poolTopHolderCheck } = require("@services/digipog-service");
const { isAuthenticated, isVerified } = require("@middleware/authentication");
const { SCOPES } = require("@modules/permissions");
const { isOwnerOrHasScopes } = require("@middleware/permission-check");
const { isValidPin } = require("@modules/pin-validation");
const { requireQueryParam } = require("@modules/error-wrapper");
const { settings } = require("@modules/config");
const AppError = require("@errors/app-error");
const ForbiddenError = require("@errors/forbidden-error");
const ValidationError = require("@errors/validation-error");

/**
 * Register reset controller routes.
 * @param {import("express").Router} router - router.
 * @returns {void}
 */
module.exports = (router) => {
    /**
     * @swagger
     * /api/v1/pool/{id}/pin/reset:
     *   post:
     *     summary: Request a PIN reset email
     *     tags:
     *       - Pools
     *     description: |
     *       Sends a PIN reset email to the authenticated user. Only the user themselves
     *       may request a reset for their own pool PIN. Email service must be enabled.
     *     security:
     *       - bearerAuth: []
     *       - apiKeyAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         description: The ID of the pool to reset
     *         schema:
     *           type: string
     *           example: "1"
     *     responses:
     *       200:
     *         description: PIN reset email sent
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 message:
     *                   type: string
     *                   example: "PIN reset email has been sent."
     *       403:
     *         description: Cannot request a PIN reset for another pool
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       503:
     *         description: Email service not enabled
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       500:
     *         description: Server error
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ServerError'
     */
    router.post("/pool/:id/pin/reset", 
        isAuthenticated, 
        isVerified,
        isOwnerOrHasScopes(poolTopHolderCheck, SCOPES.GLOBAL.SYSTEM.ADMIN, "You do not have enough shares to own this pool."),
        async (req, res) => {
            const targetPoolId = Number(req.params.id);
            requireQueryParam(targetPoolId, "id");

            if (!settings.emailEnabled) {
                throw new AppError("Email service is not enabled. Pool PIN resets are not available at this time.", {
                    statusCode: 503,
                    event: "user.pin.reset.request.failed",
                    reason: "email_disabled",
                });
            }

            req.infoEvent("pool.pin.reset.request", "PIN reset requested", { poolId: targetPoolId });
            await requestPoolPinReset(targetPoolId);

            req.infoEvent("pool.pin.reset.request.success", "PIN reset email sent");
            res.status(200).json({
                success: true,
                data: {
                    message: "PIN reset email has been sent.",
                },
            });
        }
    );

    /**
     * @swagger
     * /api/v1/pool/pin/reset:
     *   patch:
     *     summary: Reset PIN using a token
     *     tags:
     *       - Pools
     *     description: |
     *       Resets a user's PIN using a token received via email.
     *
     *       **Required Permission:** None (public endpoint, requires valid reset token)
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - pin
     *               - token
     *             properties:
     *               pin:
     *                 type: string
     *                 description: New PIN (4-6 numeric digits)
     *                 example: "1234"
     *               token:
     *                 type: string
     *                 description: PIN reset token received via email
     *     responses:
     *       200:
     *         description: PIN reset successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 message:
     *                   type: string
     *                   example: "PIN has been reset successfully."
     *       400:
     *         description: Validation error (missing fields or invalid PIN format)
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       404:
     *         description: Token is invalid or has expired
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/NotFoundError'
     *       500:
     *         description: Server error
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ServerError'
     */
    router.patch("/pool/pin/reset", async (req, res) => {
        const { pin, token } = req.body;

        if (!token) {
            throw new ValidationError("Token is required.", {
                event: "pool.pin.reset.failed",
                reason: "missing_token",
            });
        }

        if (!isValidPin(pin)) {
            throw new ValidationError("Invalid PIN format. PIN must be 4-6 numeric digits.", {
                event: "pool.pin.reset.failed",
                reason: "invalid_pin_format",
            });
        }

        req.infoEvent("pool.pin.reset.attempt", "Attempting to reset PIN with token");
        await resetPoolPin(pin, token);

        req.infoEvent("pool.pin.reset.success", "PIN reset successfully");
        res.status(200).json({
            success: true,
            data: {
                message: "PIN has been reset successfully.",
            },
        });
    });
};
