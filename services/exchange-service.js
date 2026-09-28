const { getUserDataFromDb } = require("@services/user-service");
const ValidationError = require("@errors/validation-error");
const NotFoundError = require("@errors/not-found-error");

function requireExchangePartyFields(exchangeParty, name) {
    if (exchangeParty.id == null || exchangeParty.id <= 0) {
        throw new ValidationError(`"id" field of "${name}" must be a valid user ID`);
    }
    if (exchangeParty.type == null || !(exchangeParty.type === "user" || exchangeParty.type === "pool")) {
        throw new ValidationError(`"type" field of "${name}" must be either "user" or "pool"`);
    }
    if (typeof exchangeParty !== "object") {
        throw new ValidationError(`"payload" field of "${name}" must be an object with item IDs as keys and quantities as values`);
    }
}

function requireRequesterPartyFields(fromParty, name) {
    requireExchangePartyFields(fromParty, name);
    if (fromParty.pin == null) {
        throw new ValidationError(`"pin" field of "${name}" is required`);
    }
}

async function createExchange(exchange) {
    const { to, from, reason } = exchange;
    requireExchangePartyFields(to, "to");
    requireRequesterPartyFields(from, "from");

    if (to.id === from.id) {
        throw new ValidationError("You cannot transact with yourself.", { reason: "self_exchange" });
    }

    const toUser = await getUserDataFromDb(to.id);
    if (!toUser) {
        throw new NotFoundError("Recipient user not found.");
    }
    
}

module.exports = {
    createExchange
}
