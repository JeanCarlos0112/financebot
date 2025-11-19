// --- Ponto de Entrada Principal do Bot ---
require('dotenv').config();
const DB = require('./src/database');
const GeminiAPI = require('./src/gemini');
const WhatsApp = require('./src/whatsapp');
const MessageHandler = require('./src/messageHandler');
const State = require('./src/state'); // Embora não usado diretamente aqui, é bom ter a referência

async function startBot() {
    console.log("Iniciando FinanceBot...");

    // 1. Inicializa o Banco de Dados
    try {
        await DB.initDb();
        console.log("Banco de dados inicializado.");
    } catch (error) {
        console.error("Falha CRÍTICA ao inicializar o banco de dados:", error);
        process.exit(1); // Não pode continuar sem DB
    }

    // 2. Inicializa a API de IA
    const aiAvailable = GeminiAPI.setupGoogleAI();
    if (!aiAvailable) {
        console.warn("!!! IA não disponível. Funcionalidades limitadas !!!");
        // Decide se quer continuar sem IA ou parar
        // process.exit(1);
    }

    // 3. Inicializa e conecta o cliente WhatsApp
    try {
        await WhatsApp.initializeWhatsAppClient(); // Espera o cliente estar pronto
        console.log("Cliente WhatsApp pronto. Configurando listener de mensagens...");

        // 4. Configura o Listener Principal de Mensagens
        WhatsApp.client.on('message', (message) => {
            MessageHandler.handleIncomingMessage(WhatsApp.client, message);
        });

        console.log(">>> FinanceBot está online e ouvindo mensagens! <<<");

    } catch (error) {
        console.error("Falha CRÍTICA ao inicializar o WhatsApp:", error);
        await DB.closeDbConnection(); // Tenta fechar o DB antes de sair
        process.exit(1);
    }
}

// --- Tratamento de Encerramento Gracioso ---
async function gracefulShutdown() {
    console.log('\nRecebido sinal de encerramento (SIGINT/SIGTERM). Desligando...');
    try {
        if (WhatsApp.client) {
            console.log("Desconectando cliente WhatsApp...");
            await Promise.race([
                 WhatsApp.client.destroy(),
                 new Promise(resolve => setTimeout(resolve, 5000)) // Timeout
            ]);
            console.log('Cliente WhatsApp desconectado ou timeout.');
        }
    } catch (error) {
        console.error('Erro durante a desconexão do cliente WhatsApp:', error);
    } finally {
        DB.closeDbConnection(); // Fecha a conexão do DB
        console.log("Aguardando encerramento...");
        setTimeout(() => {
            console.log("Processo encerrado.");
            process.exit(0);
        }, 1000);
    }
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

// Inicia o bot
startBot();