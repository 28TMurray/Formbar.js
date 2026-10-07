const { dbGet, dbRun } = require("@modules/database");
const { creditDigipogTransferRecipient, getPoolById, verifyPoolPin } = require("@services/digipog-service");
const { getUserDataFromDb, verifyPin } = require("@services/user-service");
const { addItemToInventory, removeItemFromInventory, getItemById } = require("@services/inventory-service");
const { createNotification } = require("@services/notification-service");
const ValidationError = require("@errors/validation-error");
const ForbiddenError = require("@errors/forbidden-error");
const NotFoundError = require("@errors/not-found-error");
const AppError = require("@errors/app-error");

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
    for (const [itemId, quantity] of Object.entries(items)) {
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
 * Simply transfers digipogs from one user to another.
 * transferDigipogs from digipog service works with API objects
 * @param {number} amount
 * @param {string} fromType
 * @param {number} fromId
 * @param {string} toType
 * @param {number} toId
 */
async function exchangeDigipogs(amount, fromType, fromId, toType, toId) {
    if (fromType === "user") {
        await dbRun("UPDATE users SET digipogs = digipogs - ? WHERE id = ? AND digipogs >= ?", [
            amount,
            fromId,
            amount,
        ]);
    } else {
        await dbRun("UPDATE digipog_pools SET amount = amount - ? WHERE id = ? AND amount >= ?", [
            amount,
            fromId,
            amount,
        ]);
    }

    creditDigipogTransferRecipient(amount, toType, toId);
}

/**
 * Remove an exact quantity of an item from a user's inventory stacks. Throws
 * if the user does not hold enough. This is the strict variant used during
 * trade acceptance; it does NOT alter the permissive removeItemFromInventory
 * used elsewhere.
 * @param {number} userId
 * @param {number} itemId
 * @param {number} quantity
 * @returns {Promise<void>}
 */
async function strictRemoveFromInventory(userId, itemId, quantity) {
    const rows = await dbGetAll("SELECT id, quantity FROM inventory WHERE user_id = ? AND item_id = ? ORDER BY id DESC", [userId, itemId]);
    const total = rows.reduce((sum, r) => sum + r.quantity, 0);

    if (total < quantity) {
        throw new ForbiddenError(`Insufficient inventory: need ${quantity} of item ${itemId}, have ${total}.`);
    }

    let remaining = quantity;
    for (const row of rows) {
        if (remaining <= 0) break;
        if (row.quantity <= remaining) {
            await dbRun("DELETE FROM inventory WHERE id = ?", [row.id]);
            remaining -= row.quantity;
        } else {
            await dbRun("UPDATE inventory SET quantity = quantity - ? WHERE id = ?", [remaining, row.id]);
            remaining = 0;
        }
    }
}

async function validateExchangePartyFields(exchangeParty, payload, name, payloadName) {
    // Check if well-formed
    if (typeof exchangeParty !== "object") {
        throw new ValidationError(`'${name}' must be an object.`);
    }
    if (exchangeParty.id == null || exchangeParty.id <= 0) {
        throw new ValidationError(`'id' field of '${name}' must be a valid user or pool ID.`);
    }
    if (exchangeParty.type == null || !(["user", "pool"].includes(exchangeParty.type))) {
        throw new ValidationError(`'type' field of '${name}' must be either 'user' or 'pool'.`);
    }

    let exchangeAccount = exchangeParty.type === "user" ? await getUserDataFromDb(exchangeParty.id) : await getPoolById(exchangeParty.id);
    if (exchangeAccount == null) {
        throw new NotFoundError(`'id' field '${name}' is not associated with a valid ${exchangeParty.type}.`);
    }

    if (typeof payload !== "object") {
        throw new ValidationError(`'${payloadName}' field of '${name}' must be an object with IDs as keys and quantities as values.`);
    } else {
        for (const [itemId, quantity] of Object.entries(payload)) {
            // Check if payload is well-formed
            const itemIdNum = Number(itemId);

            if (!Number.isInteger(itemIdNum) || itemIdNum < 0) {
                throw new ValidationError(`'${payloadName}' must have valid IDs as keys (0 = digipogs, 1+ = item IDs).`);
            }

            if (!Number.isInteger(quantity) || quantity <= 0) {
                throw new ValidationError(`'${payloadName}' must have positive integer values as quantities.`);
            }

            // Non-digipogs need additional checks
            if (itemIdNum !== 0) {
                if (exchangeParty.type === "pool") {
                    throw new ValidationError(`'${payloadName}' cannot contain items because it is of type 'pool'.`);
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

async function validateRequesterPartyFields(fromParty, fromPayload, name, payloadName) {
    const fromAccount = await validateExchangePartyFields(fromParty, fromPayload, name, payloadName);

    if (Object.keys(fromPayload).length === 0) {
        throw new ValidationError(`'${payloadName}' can not be empty.`);
    }

    // Requester makes trade with resources they have
    // Recipient only needs them when accepting
    if (fromParty.type === "user") {
        if (typeof fromPayload["0"] === "number" && fromAccount.digipogs < fromPayload["0"]) {
            throw new ForbiddenError(`The requester has insufficient digipog balance: need ${fromPayload["0"]}, have ${fromAccount.digipogs}.`);
        }
        checkInventoryAvailability(fromAccount.id, getPayloadItems(fromPayload));
    } else {
        if (fromAccount.amount < fromPayload["0"]) {
            throw new ForbiddenError(`The requester pool has insufficient digipog balance: need ${fromPayload["0"]}, have ${fromAccount.amount}.`);
        }
    }

    if (fromParty.pin == null) {
        throw new ValidationError(`'pin' field of '${name}' is required.`);
    }

    if (fromParty.type === "user") await verifyPin(fromAccount.id, fromParty.pin);
    if (fromParty.type === "pool") await verifyPoolPin(fromAccount.id, fromParty.pin);

    return fromAccount;
}

async function createExchange(exchange) {
    const { to, from, reason } = exchange;
    await validateExchangePartyFields(to, to.request, "to", "request");
    const fromAccount = await validateRequesterPartyFields(from, from.offer, "from", "offer");

    if (to.id === from.id && to.type === from.type) {
        throw new ValidationError("You cannot exchange with yourself.");
    }

    to.userId = to.type === "user" ? to.id : null;
    to.poolId = to.type === "pool" ? to.id : null;
    from.userId = from.type === "user" ? from.id : from.userId;
    from.poolId = from.type === "pool" ? from.id : null;

    const offerDigipogs = from.offer["0"];
    const requestItems = getPayloadItems(to.request);
    const offerItems = getPayloadItems(from.offer);

    if ((Object.keys(requestItems) > 0 && from.type === "pool") ||
        (Object.keys(offerItems) > 0 && to.type === "pool")) {
        throw new ValidationError("Pools can not receive items.");
    }

    const now = new Date().toISOString();

    let status = 400;
    let exchangeId;
    // Treat as a trade if there is a request
    // Otherwise treat it as a transaction
    if (Object.keys(to.request).length > 0) {
        exchangeId = await dbRun(
            `INSERT INTO exchanges (from_user_id, from_id, from_type, offer, to_user_id, to_id, to_type,
                                    request, reason, status, created_at, updated_at) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
            [
                from.userId,
                from.poolId,
                from.type,
                JSON.stringify(from.offer),
                to.userId,
                to.poolId,
                to.type,
                JSON.stringify(to.request),
                reason ?? "Trade",
                now,
                now,
            ]
        );
        status = 201;
    } else {
        try {
            await dbRun("BEGIN IMMEDIATE TRANSACTION");
            {
                exchangeDigipogs(offerDigipogs, from.type, from.id, to.type, to.id);
                // Transfer digipogs
                if (from.type === "user") {
                    await dbRun("UPDATE users SET digipogs = digipogs - ? WHERE id = ? AND digipogs >= ?", [
                        offerDigipogs,
                        from.userId,
                        offerDigipogs,
                    ]);
                } else {
                    await dbRun("UPDATE digipog_pools SET amount = amount - ? WHERE id = ? AND amount >= ?", [
                        offerDigipogs,
                        from.poolId,
                        offerDigipogs,
                    ]);
                }
                await creditDigipogTransferRecipient(offerDigipogs, to.type, to.id);

                // Transfer items
                for (const [itemId, quantity] of offerItems) {
                    await strictRemoveFromInventory(from.userId, itemId, quantity);
                    await addItemToInventory(to.userId, itemId, quantity);
                }

                // Log exchange
                exchangeId = await dbRun(
                    `INSERT INTO exchanges (from_user_id, from_id, from_type, offer, to_user_id, to_id, to_type,
                                    request, reason, status, created_at, updated_at) 
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?)`,
                    [
                        from.userId,
                        from.poolId,
                        from.type,
                        JSON.stringify(from.offer),
                        to.userId,
                        to.poolId,
                        to.type,
                        JSON.stringify(to.request),
                        reason ?? "Transaction",
                        now,
                        now,
                    ]
                );
            }
            await dbRun("COMMIT");
            status = 200;
        } catch (err) {
            console.error(err)
            await dbRun("ROLLBACK");
        }
    }

    if (exchangeId == null) {
        throw new AppError("Exchange failed.");
    }

    return { status, exchangeId };
}

async function acceptExchange(exchangeId, pin) {
    const exchange = await dbGet("SELECT * FROM exchanges WHERE id = ?", [exchangeId]);

    // Validation/Authorization
    if (!exchange || exchange.status !== "pending") {
        throw new ValidationError("This exchange is no longer pending.", { reason: "invalid_status", status: exchange.status });
    }

    if (exchange.to_type === "user") await verifyPin(exchange.to_user_id, pin);
    if (exchange.to_type === "pool") await verifyPoolPin(exchange.to_.id, pin);

    // Deconstructing offer and request fields
    const offer = JSON.parse(exchange.offer);
    const request = JSON.parse(exchange.request);

    const offerId = exchange.from_id ?? exchange.from_user_id;
    const requestId = exchange.to_id ?? exchange.to_user_id;
    const offerItems = getPayloadItems(offer);
    const requestItems = getPayloadItems(request);
    const offerDigipogs = offer["0"] ?? 0;
    const requestDigipogs = request["0"] ?? 0;

    const now = new Date().toISOString()
    
    // Fail trade if insufficient items or digipogs
    async function checkResources(type, id, digipogs, items, name) {
        if (type === "user") {
            const user = await getUserDataFromDb(id);
            if (!user) {
                throw new NotFoundError(`${name} is no longer associated with a valid user.`, { reason: "invalid_user", id: id });
            }
            if (user.digipogs < digipogs) {
                throw new ForbiddenError(`${name} has insufficient funds: need ${digipogs}, have ${user.digipogs}.`, { reason: "insufficient_funds", id: id });
            }
            await checkInventoryAvailability(user.id, items);
        } else {
            const pool = await getPoolById(id);
            if (!pool) {
                throw new NotFoundError(`${name} is no longer associated with a valid pool.`, { reason: "invalid_pool", id: id });
            }
            if (pool.amount < digipogs) {
                throw new ForbiddenError(`${name} has insufficient funds in pool: need ${digipogs}, have ${pool.amount}.`, { reason: "insufficient_pool_funds", id: id });
            }
        }
    }
    await dbRun("BEGIN IMMEDIATE TRANSACTION");
        
    try {
        await checkResources(exchange.from_type, offerId, offerDigipogs, offerItems, "Creator");
        await checkResources(exchange.to_type, requestId, requestDigipogs, requestItems, "Recipient");

        // Transfer digipogs
        if (offerDigipogs > 0) await exchangeDigipogs(offerDigipogs, exchange.from_type, offerId, exchange.to_type, requestId);
        if (requestDigipogs > 0) await exchangeDigipogs(requestDigipogs, exchange.to_type, requestId, exchange.from_type, offerId);

        // Transfer resources
        for (const [itemId, quantity] of offerItems) {
            await strictRemoveFromInventory(offerId, itemId, quantity);
            await addItemToInventory(requestId, itemId, quantity);
        }

        for (const [itemId, quantity] of requestItems) {
            await strictRemoveFromInventory(requestId, itemId, quantity);
            await addItemToInventory(offerId, itemId, quantity);
        }

        dbRun("UPDATE exchanges SET status = 'completed', updated_at = ? WHERE id = ?", [now, exchangeId]);
        
        dbRun("COMMIT");
    } catch (err) {
        /**
         * Mark the exchange as failed, commit, and notify both participants. Throws the error
         * back up out of a catch.
         */
        await dbRun("ROLLBACK");
        await dbRun("UPDATE exchanges SET status = 'failed', failure_reason = ?, updated_at = ? WHERE id = ?", [err.reason, now, exchangeId]);
        await Promise.allSettled([
            createNotification(fromUserId, "exchange_failed", { exchangeId, reason }),
            createNotification(toUserId, "exchange_failed", { exchangeId, reason }),
        ]);
        throw err;
    }
}

module.exports = {
    createExchange,
    acceptExchange
}
