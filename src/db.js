// --- db.js ---
// Gerencia a conexao e operacoes com o banco de dados SQLite

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const { DB_FILE } = require('../config');

let db;

// --- Inicialização do Banco de Dados ---
function initDb() {
    return new Promise((resolve, reject) => {
        const dbExists = fs.existsSync(DB_FILE);
        console.log(`Arquivo DB (${DB_FILE}) existe: ${dbExists}`);
        db = new sqlite3.Database(DB_FILE, (err) => {
            if (err) {
                console.error("Erro Crítico ao conectar ao DB:", err.message);
                return reject(err);
            }
            console.log('Conectado ao DB SQLite.');
            // Cria a tabela se não existir
            db.run(`CREATE TABLE IF NOT EXISTS expenses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_id TEXT NOT NULL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                expense_date TEXT NOT NULL, /* YYYY-MM-DD */
                category TEXT NOT NULL,
                value REAL NOT NULL,
                establishment TEXT,
                payment_method TEXT NOT NULL,
                item TEXT NOT NULL,
                notes TEXT
            )`, (err) => {
                if (err) {
                    console.error("Erro ao criar/verificar tabela 'expenses':", err.message);
                    return reject(err);
                }
                // Cria tabela de imagens vinculadas à despesa
                db.run(`CREATE TABLE IF NOT EXISTS expense_images (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    expense_id INTEGER NOT NULL,
                    image_path TEXT NOT NULL,
                    FOREIGN KEY(expense_id) REFERENCES expenses(id) ON DELETE CASCADE
                )`, (err2) => {
                    if (err2) {
                        console.error("Erro ao criar/verificar tabela 'expense_images':", err2.message);
                        return reject(err2);
                    }
                    console.log("Tabelas 'expenses' e 'expense_images' verificadas/criadas com sucesso.");
                    resolve();
                });
            });
        });
    });
}

// --- Funções do Banco de Dados ---

function addExpense(chatId, expenseData) {
    return new Promise((resolve, reject) => {
        if (!db) return reject(new Error("Conexão com DB não inicializada."));
        if (typeof expenseData.value !== 'number' || !expenseData.category || !expenseData.paymentMethod || !expenseData.item) {
            return reject(new Error("Erro interno: Dados inválidos fornecidos para addExpense."));
        }

        const sql = `INSERT INTO expenses (chat_id, expense_date, category, value, establishment, payment_method, item, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

        // Validação e formatação da data
        let expenseDate = expenseData.date;
        if (!expenseDate || expenseDate === 'today' || expenseDate === null) {
            expenseDate = new Date().toISOString().split('T')[0];
        } else {
            try {
                const d = new Date(expenseDate);
                if (isNaN(d.getTime())) throw new Error(`Data inválida: ${expenseData.date}`);
                expenseDate = d.toISOString().split('T')[0]; // Formato YYYY-MM-DD
            } catch (e) {
                console.warn(`Data "${expenseData.date}" inválida, usando data de hoje. Erro: ${e.message}`);
                expenseDate = new Date().toISOString().split('T')[0];
            }
        }

        const establishment = expenseData.establishment || 'N/E';
        const category = expenseData.category || 'Outros';
        const item = expenseData.item; // Obrigatório pela validacao inicial
        const notes = expenseData.notes || null;
        const paymentMethod = expenseData.paymentMethod; // Obrigatorio

        db.run(sql, [chatId, expenseDate, category, expenseData.value, establishment, paymentMethod, item, notes], function (err) {
            if (err) {
                console.error("Erro ao inserir despesa no DB:", err.message);
                reject(err);
            } else {
                console.log(`Despesa ID ${this.lastID} registrada para ${chatId}.`);
                resolve(this.lastID);
            }
        });
    });
}

function getExpenses(chatId, period = 'month') {
    return new Promise((resolve, reject) => {
        if (!db) return reject(new Error("Conexão com DB não inicializada."));

        let sql = `SELECT id, expense_date, category, value, establishment, item, notes, payment_method FROM expenses WHERE chat_id = ?`;
        const params = [chatId];
        const now = new Date();
        const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        let startDate, endDate;
        let periodDescription = period;

        if (period === 'month') {
            startDate = new Date(todayDate.getFullYear(), todayDate.getMonth(), 1).toISOString().split('T')[0];
            endDate = new Date(todayDate.getFullYear(), todayDate.getMonth() + 1, 1).toISOString().split('T')[0];
            sql += ` AND date(expense_date) >= date(?) AND date(expense_date) < date(?)`;
            params.push(startDate, endDate);
        } else if (period === 'today') {
            startDate = todayDate.toISOString().split('T')[0];
            sql += ` AND date(expense_date) = date(?)`;
            params.push(startDate);
        } else if (period === 'yesterday') {
            const yesterday = new Date(todayDate);
            yesterday.setDate(todayDate.getDate() - 1);
            startDate = yesterday.toISOString().split('T')[0];
            sql += ` AND date(expense_date) = date(?)`;
            params.push(startDate);
        } else if (period === 'all') {
    
        } else {
             console.warn(`Período de relatório não reconhecido: '${period}'. Usando 'month' como padrão.`);
             periodDescription = 'month (default)';
             startDate = new Date(todayDate.getFullYear(), todayDate.getMonth(), 1).toISOString().split('T')[0];
             endDate = new Date(todayDate.getFullYear(), todayDate.getMonth() + 1, 1).toISOString().split('T')[0];
             sql += ` AND date(expense_date) >= date(?) AND date(expense_date) < date(?)`;
             params.push(startDate, endDate);
        }

        sql += ` ORDER BY expense_date ASC, id ASC`;
        console.log(`Buscando despesas do DB (${periodDescription}) para ${chatId}${startDate ? ` a partir de ${startDate}` : ''}${endDate ? ` até ${endDate} (exclusivo)` : ''}`);

        db.all(sql, params, (err, rows) => {
            if (err) {
                console.error(`Erro ao buscar despesas (${periodDescription}) do DB:`, err.message);
                reject(err);
            } else {
                console.log(`Encontradas ${rows?.length || 0} despesas (${periodDescription}) para ${chatId}.`);
                resolve(rows || []);
            }
        });
    });
}

function getSpendingByCategory(chatId, period = 'month') {
    return new Promise((resolve, reject) => {
        if (!db) return reject(new Error("Conexão com DB não inicializada."));

        let sqlBase = `SELECT category, SUM(value) as total FROM expenses WHERE chat_id = ? `;
        let sqlPeriod = '';
        const params = [chatId];
        const now = new Date();
        const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        let startDate, endDate;
        let periodDescription = period;

        if (period === 'month') {
            startDate = new Date(todayDate.getFullYear(), todayDate.getMonth(), 1).toISOString().split('T')[0];
            endDate = new Date(todayDate.getFullYear(), todayDate.getMonth() + 1, 1).toISOString().split('T')[0];
            sqlPeriod = ` AND date(expense_date) >= date(?) AND date(expense_date) < date(?)`;
            params.push(startDate, endDate);
        } else if (period === 'last_month') {
            startDate = new Date(todayDate.getFullYear(), todayDate.getMonth() - 1, 1).toISOString().split('T')[0];
            endDate = new Date(todayDate.getFullYear(), todayDate.getMonth(), 1).toISOString().split('T')[0];
            sqlPeriod = ` AND date(expense_date) >= date(?) AND date(expense_date) < date(?)`;
            params.push(startDate, endDate);
        } else if (period !== 'all') {
            console.warn(`Período não suportado para getSpendingByCategory: ${period}. Buscando 'all'.`);
            periodDescription = 'all (fallback)';
        }
        // Se period for 'all' ou fallback, sqlPeriod continua vazio ""

        let sql = sqlBase + sqlPeriod + ` GROUP BY category ORDER BY total DESC`;
        console.log(`Buscando gastos por categoria (${periodDescription}) para ${chatId}`);

        db.all(sql, params, (err, rows) => {
            if (err) {
                console.error(`Erro ao buscar gastos/categoria (${periodDescription}):`, err.message);
                return reject(err);
            }
            // Se nao encontrou nada no periodo especifico (e nao era 'all' originalmente), tenta buscar 'all' para dar conselhos
            if ((!rows || rows.length === 0) && period !== 'all') {
                console.log(`Sem dados de gastos/categoria para '${periodDescription}'. Tentando buscar 'all' para análise de conselhos.`);
                sql = sqlBase + ` GROUP BY category ORDER BY total DESC`;
                db.all(sql, [chatId], (errAll, rowsAll) => {
                    if (errAll) {
                        console.error("Erro ao buscar gastos/categoria ('all' fallback):", errAll.message);
                        reject(errAll);
                    } else {
                        console.log(`Encontradas ${rowsAll?.length || 0} categorias ('all' fallback) para ${chatId}.`);
                        resolve(rowsAll || []);
                    }
                });
            } else {
                console.log(`Encontradas ${rows?.length || 0} categorias (${periodDescription}) para ${chatId}.`);
                resolve(rows || []);
            }
        });
    });
}

function closeDbConnection() {
    if (db) {
        console.log("Fechando conexão com o banco de dados SQLite...");
        db.close(err => {
            if (err) {
                console.error("Erro ao fechar conexão com DB:", err.message);
            } else {
                console.log("Conexão com DB fechada com sucesso.");
            }
            db = null;
        });
    } else {
        console.log("Conexão com DB já estava fechada ou não foi inicializada.");
    }
}

// Adiciona imagens vinculadas a despesa
function addExpenseImages(expenseId, imagePaths) {
    return new Promise((resolve, reject) => {
        if (!db) return reject(new Error("Conexão com DB não inicializada."));
        if (!expenseId || !Array.isArray(imagePaths) || imagePaths.length === 0) return resolve();
        const stmt = db.prepare(`INSERT INTO expense_images (expense_id, image_path) VALUES (?, ?)`);
        for (const path of imagePaths) {
            stmt.run(expenseId, path);
        }
        stmt.finalize((err) => {
            if (err) {
                console.error("Erro ao inserir imagens vinculadas:", err.message);
                reject(err);
            } else {
                resolve();
            }
        });
    });
}

// Busca imagens vinculadas a uma despesa
function getExpenseImages(expenseId) {
    return new Promise((resolve, reject) => {
        if (!db) return reject(new Error("Conexão com DB não inicializada."));
        db.all(`SELECT image_path FROM expense_images WHERE expense_id = ?`, [expenseId], (err, rows) => {
            if (err) {
                reject(err);
            } else {
                resolve(rows.map(r => r.image_path));
            }
        });
    });
}

// Adapta addExpense para aceitar imagens (opcional)
async function addExpenseWithImages(chatId, expenseData, imagePaths) {
    const expenseId = await addExpense(chatId, expenseData);
    if (imagePaths && imagePaths.length > 0) {
        await addExpenseImages(expenseId, imagePaths);
    }
    return expenseId;
}

// Procura por despesas com base em criterios (para encontrar comprovantes)
function findExpense(chatId, criteria) {
    return new Promise((resolve, reject) => {
        if (!db) return reject(new Error("Conexão com DB não inicializada."));

        let sql = `SELECT id, expense_date, item, value, category, establishment, strftime('%Y-%m-%dT%H:%M:%SZ', timestamp) as timestamp_utc FROM expenses WHERE chat_id = ?`;
        const params = [chatId];
        const conditions = [];

        // Criterios de busca (adicionar mais conforme necessario)
        if (criteria.item) {
            conditions.push(`item LIKE ?`);
            params.push(`%${criteria.item}%`); // Busca parcial
        }
        if (criteria.value) {
            // Busca por valor aproximado
            const tolerance = 0.10;
            conditions.push(`value BETWEEN ? AND ?`);
            params.push(criteria.value * (1 - tolerance), criteria.value * (1 + tolerance));
        }
        if (criteria.establishment) {
            conditions.push(`establishment LIKE ?`);
            params.push(`%${criteria.establishment}%`);
        }
        if (criteria.date) {
            // Tenta buscar na data exata
            try {
                const d = new Date(criteria.date);
                if (!isNaN(d.getTime())) {
                    const dateStr = d.toISOString().split('T')[0];
                    conditions.push(`date(expense_date) = date(?)`);
                    params.push(dateStr);
                }
            } catch (e) { }
        }
        if (criteria.category) {
            conditions.push(`category = ?`);
            params.push(criteria.category);
        }

        if (conditions.length > 0) {
            sql += ` AND ` + conditions.join(' AND ');
        } else {
            
            console.log(`[${chatId}] Nenhum critério válido fornecido para findExpense.`);
            return resolve([]);
        }

        // Ordena por timestamp (mais antigo primeiro) e limita resultados
        sql += ` ORDER BY timestamp ASC LIMIT 10`;

        console.log(`[${chatId}] Buscando despesa com critérios:`, criteria);
        db.all(sql, params, (err, rows) => {
            if (err) {
                console.error(`Erro ao buscar despesa no DB:`, err.message);
                reject(err);
            } else {
                console.log(`[${chatId}] Encontradas ${rows?.length || 0} despesas candidatas.`);
                resolve(rows || []);
            }
        });
    });
}

module.exports = {
    initDb,
    addExpense,
    getExpenses,
    getSpendingByCategory,
    closeDbConnection,
    addExpenseImages,
    getExpenseImages,
    addExpenseWithImages,
    findExpense,
};