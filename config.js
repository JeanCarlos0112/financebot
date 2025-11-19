// --- config.js ---
// Carrega variáveis de ambiente do .env e define constantes globais

require('dotenv').config();
const { HarmCategory, HarmBlockThreshold } = require("@google/generative-ai");

const GOOGLE_AI_API_KEY = process.env.GOOGLE_AI_API_KEY;
const DB_FILE = './finance_bot.db'; // Nome do arquivo do banco de dados
const PAYMENT_METHODS_EXAMPLES = "Pix, Dinheiro, Débito, Crédito (Visa), Crédito (Master), Boleto, Transferência";
const EXPENSE_IMAGES_DIR = './expense_images'; // Pasta padrão para imagens de despesas

// Configurações de segurança para a LLM (ajuste se necessário)
const SAFETY_SETTINGS = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
];

module.exports = {
    GOOGLE_AI_API_KEY,
    DB_FILE,
    PAYMENT_METHODS_EXAMPLES,
    SAFETY_SETTINGS,
    EXPENSE_IMAGES_DIR,
};