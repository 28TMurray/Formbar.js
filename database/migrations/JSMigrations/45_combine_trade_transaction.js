const { dbGet, dbGetAll } = require("@modules/database");

module.exports = {
    async run(database) {
        // Assumed that transactions was already combined if trades doesn't exist
        const tradesTable = await dbGet("SELECT name FROM sqlite_master WHERE type='table' AND name='trades'");
        if (!tradesTable) return;

        const transactionRows = await dbGetAll("SELECT * FROM transactions");
        
        const combinedTransactions = transactionRows.map((transaction) => {
            const datetime = new Date(Number(transaction.date)).toISOString()
            
            return {
                fromId: transaction.from_id,
                fromType: transaction.from_type,
                fromPayload: {},
                toId: transaction.to_id,
                toType: transaction.to_type,
                toPayload: {0: transaction.amount},
                reason: transaction.reason,
                status: "completed",
                failureReason: null,
                createdAt: datetime,
                updatedAt: datetime
            }
        });

        const tradeRows = await dbGetAll("SELECT * FROM trades");
    }
}
