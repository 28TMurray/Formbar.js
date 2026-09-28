const { createExchange } = require("@services/exchange-service");
const { isAuthenticated, isVerified } = require("@middleware/authentication");
const { requireBodyParam } = require("@modules/error-wrapper");
const ValidationError = require("@errors/validation-error");

module.exports = (router) => {
    router.post("/exchanges", isAuthenticated, isVerified, async (req, res) => {
        const { to, from, reason } = req.body;

        requireBodyParam(to, "to");
        requireBodyParam(from, "from");
        requireBodyParam(reason, "reason");

        if (typeof to !== "object") {
            throw new ValidationError("to must be an object");
        }
        if (typeof from !== "object") {
            throw new ValidationError("from must be an object");
        }
        if (typeof reason !== "string") {
            throw new ValidationError("reason must be a string");
        }

        req.infoEvent("exchange.create.attempt", "Creating exchange", req.body);

        const { exchangeId } = await createExchange(req.body);

        res.status(200).json({ success: true, data: { exchangeId } });
    })
}
