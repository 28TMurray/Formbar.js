const { getUserDataFromDb } = require("@services/user-service");
const ValidationError = require("@errors/validation-error");
const NotFoundError = require("@errors/not-found-error");

function requireTransactionPartyFields(transactionParty, name) {
    if (transactionParty.id == null || transactionParty.id <= 0) {
        throw new ValidationError(`"id" field of "${name}" must be a valid user ID`);
    }
    if (transactionParty.type == null || !(transactionParty.type === "user" || transactionParty.type === "pool")) {
        throw new ValidationError(`"type" field of "${name}" must be either "user" or "pool"`);
    }
    if (typeof transactionParty !== "object") {
        throw new ValidationError(`"payload" field of "${name}" must be an object with item IDs as keys and quantities as values`);
    }
}

function requireRequesterPartyFields(fromParty, name) {
    requireTransactionPartyFields(fromParty, name);
    if (fromParty.pin == null) {
        throw new ValidationError(`"pin" field of "${name}" is required`);
    }
}

async function createTransaction(transaction) {
    const { to, from, reason } = transaction;
    requireTransactionPartyFields(to, "to");
    requireRequesterPartyFields(from, "from");

    if (to.id === from.id) {
        throw new ValidationError("You cannot transact with yourself.", { reason: "self_transaction" });
    }

    const toUser = await getUserDataFromDb(to.id);
    if (!toUser) {
        throw new NotFoundError("Recipient user not found.");
    }
    
}

module.exports = {
    createTransaction
}
