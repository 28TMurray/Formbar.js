const { dbGet, dbGetAll, dbRun } = require("@modules/database");

module.exports = {
    async run(database) {
        // Assumed that transactions was already combined if trades doesn't exist
        const tradesTable = await dbGet("SELECT name FROM sqlite_master WHERE type='table' AND name='trades'");
        if (!tradesTable) return;

        const transactionRows = await dbGetAll("SELECT * FROM transaction");
        
        const combinedTransactions = transactionRows.map((transaction) => {
            return {
                fromUserId: transaction.from_id,
                fromType: transaction.fromType,
                fromPool
            }
        })
        const tradeRows = await dbGetAll("SELECT * FROM trades");
    }
}