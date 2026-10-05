const { getUserDataFromDb } = require("@services/user-service");
const ValidationError = require("@errors/validation-error");
const NotFoundError = require("@errors/not-found-error");

function validateExchangePartyFields(exchangeParty, payload, name, payloadName) {
    if (exchangeParty.id == null || exchangeParty.id <= 0) {
        throw new ValidationError(`"id" field of "${name}" must be a valid user ID`);
    }
    if (exchangeParty.type == null || !(["user", "pool"].includes(exchangeParty.type))) {
        throw new ValidationError(`"type" field of "${name}" must be either "user" or "pool"`);
    }
    
    if (typeof payload !== "object") {
        throw new ValidationError(`"${payloadName}" field of "${name}" must be an object with IDs as keys and quantities as values`);;
    } else {
        for (const [itemId, quantity] of Object.entries(payload)) {
            const itemIdNum = Number(itemId);

            if (!Number.isInteger(itemIdNum) || itemIdNum < 0)
                throw new ValidationError(`${payloadName} must have valid IDs as keys (0 = digipogs, 1+ = item IDs)`);

            if (!Number.isInteger(quantity) || quantity <= 0)
                throw new ValidationError(`${payloadName} must have positive integer values as quantities`);

            
        }
    }
}

function validateRequesterPartyFields(fromParty, fromPayload, name, payloadName) {
    validateExchangePartyFields(fromParty, fromPayload, name, payloadName);
    if (fromParty.pin == null) {
        throw new ValidationError(`"pin" field of "${name}" is required`);
    }
}

async function createExchange(exchange) {
    const { to, from, reason } = exchange;
    validateExchangePartyFields(to, to.request, "to", "request");
    validateRequesterPartyFields(from, from.offer, "from", "offer");

    if (to.id === from.id) {
        throw new ValidationError("You cannot exchange with yourself.", { reason: "self_exchange" });
    }

    const toUser = await getUserDataFromDb(to.id);
    if (!toUser) {
        throw new NotFoundError("Recipient user not found.");
    }

    
}

module.exports = {
    createExchange
}
