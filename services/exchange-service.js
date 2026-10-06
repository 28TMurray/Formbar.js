const { getPoolById, verifyPoolPin } = require("@services/digipog-service");
const { getUserDataFromDb, verifyPin } = require("@services/user-service");
const { getItemById } = require("@services/inventory-service");
const ValidationError = require("@errors/validation-error");
const ForbiddenError = require("@errors/forbidden-error");
const NotFoundError = require("@errors/not-found-error");

/**
 * Filters for only the item IDs of payload
 * @param {Object} payload - An object with item IDs as keys and quantities as values
 * @returns {Object} A new object containing only non-zero item IDs with their quantities
 */
function getPayloadItems(payload) {
    let items = {};
    for (const [itemId, quantity] of Object.entries(payload)) {
        if (itemId !== "0") {
            items[itemId] = quantity;
        }
    }
    return items;
}

async function getInventoryTotal(userId, itemId) {
    const row = await dbGet("SELECT COALESCE(SUM(quantity), 0) AS total FROM inventory WHERE user_id = ? AND item_id = ?", [userId, itemId]);
    return row ? row.total : 0;
}

/**
 * Assert a user holds at least the required quantity of every item. Throws a
 * ValidationError if any item is insufficient.
 * @param {number} userId
 * @param {Array<{itemId: number, quantity: number}>} items
 * @returns {Promise<void>}
 */
async function checkInventoryAvailability(userId, items) {
    for (const [ itemId, quantity ] of Object.entries(items)) {
        const total = await getInventoryTotal(userId, itemId);
        if (total < quantity) {
            throw new ForbiddenError(`Insufficient inventory for item ${itemId}: need ${quantity}, have ${total}.`, {
                reason: "insufficient_inventory",
                itemId,
            });
        }
    }
}

/**
 * Assert a pool holds at least the required digipog amount.
 * @param {number} poolId
 * @param {number} amount
 * @returns {Promise<void>}
 */
async function checkPoolBalanceAvailability(poolId, amount) {
    const pool = await dbGet("SELECT amount FROM digipog_pools WHERE id = ?", [poolId]);
    if (!pool) {
        throw new ValidationError(`Pool ${poolId} not found.`, { reason: "pool_not_found" });
    }
    if (pool.amount < amount) {
        throw new ValidationError(`Pool ${poolId} has insufficient balance: need ${amount}, have ${pool.amount}.`, {
            reason: "insufficient_pool_balance",
        });
    }
}

function validateExchangePartyFields(exchangeParty, payload, name, payloadName) {
    // Check if well-formed
    if (typeof exchangeParty !== "object") {
        throw new ValidationError(`"${name}" must be an object.`);
    }
    if (exchangeParty.id == null || exchangeParty.id <= 0) {
        throw new ValidationError(`"id" field of "${name}" must be a valid user ID.`);
    }
    if (exchangeParty.type == null || !(["user", "pool"].includes(exchangeParty.type))) {
        throw new ValidationError(`"type" field of "${name}" must be either "user" or "pool".`);
    }

    let exchangeAccount = exchangeParty.type === "user" ? getUserDataFromDb(exchangeParty.id) : getPoolById(exchangeParty.id);
    if (exchangeAccount == null) {
        throw new NotFoundError(`"id" field "${name}" is not associated with a valid ${exchangeParty.type}.`);
    }
    
    if (typeof payload !== "object") {
        throw new ValidationError(`"${payloadName}" field of "${name}" must be an object with IDs as keys and quantities as values.`);
    } else {
        for (const [itemId, quantity] of Object.entries(payload)) {
            // Check if payload is well-formed
            const itemIdNum = Number(itemId);

            if (!Number.isInteger(itemIdNum) || itemIdNum < 0) {
                throw new ValidationError(`"${payloadName}" must have valid IDs as keys (0 = digipogs, 1+ = item IDs).`);
            }

            if (!Number.isInteger(quantity) || quantity <= 0) {
                throw new ValidationError(`"${payloadName}" must have positive integer values as quantities.`);
            }

            // Non-digipogs need additional checks
            if (itemIdNum !== 0) {
                if (exchangeParty.type === "pool") {
                    throw new ValidationError(`"${payloadName}" cannot contain items because it is of type "pool".`);
                }

                try {
                    getItemById(itemId);
                } catch (err) {
                    throw NotFoundError(`Item ID ${itemId} is not associated with a valid item.`);
                }
            }
        }
    }

    return exchangeAccount;
}

function validateRequesterPartyFields(fromParty, fromPayload, name, payloadName) {
    const fromAccount = validateExchangePartyFields(fromParty, fromPayload, name, payloadName);

    if (Object.keys(fromPayload) === 0) {
        throw new ValidationError(`"${payloadName}" can not be empty.`);
    }
    
    // Requester makes trade with resources they have
    // Recipient only needs them when accepting
    if (exchangeParty.type === "user") {
        if (typeof fromPayload["0"] === "number" && fromAccount.digipogs < fromPayload["0"]) {
            throw new ForbiddenError(`The requester has insufficient digipog balance: need ${fromPayload["0"]}, have ${fromAccount.digipogs}.`);
        }
        checkInventoryAvailability(fromAccount.id, getPayloadItems(fromPayload));
    } else {
        if (fromAccount.amount < fromPayload["0"]) {
            throw new ForbiddenError(`The requester pool has insufficient digipog balance: need ${fromPayload["0"]}, have ${fromAccount.digipogs}.`);
        }
    }

    if (fromParty.pin == null) {
        throw new ValidationError(`"pin" field of "${name}" is required.`);
    }
    
    if (fromParty.type === "user") return verifyPin(fromAccount.id, fromParty.pin);
    if (fromParty.type === "pool") return verifyPoolPin(fromAccount.id, fromParty.pin);

    return fromAccount;
}

async function createExchange(exchange) {
    const { to, from, reason } = exchange;
    validateExchangePartyFields(to, to.request, "to", "request");
    validateRequesterPartyFields(from, from.offer, "from", "offer");

    if (to.id === from.id && to.type === from.type) {
        throw new ValidationError("You cannot exchange with yourself.");
    }
    
    const requestDigipogs = to.request["0"];
    const offerDigipogs = from.offer["0"];
    const requestItems = getPayloadItems(to.request);
    const offerItems = getPayloadItems(from.offer);

    if ((Object.keys(requestItems) > 0 && from.type === "pool") ||j
        (Object.keys(offerItems) > 0 && to.type === "pool")) {
        throw new ValidationError("Pools can not receive items.");
    }

    // Treat as a trade if there is a request
    // Otherwise treat it as a transaction
    if (Object.keys(to.request) > 0) {
        
    } else {
        
    }
}

module.exports = {
    createExchange
}
