// --- app.js ---
// Ponto de entrada principal da aplicação. Inicializa módulos e gerencia o ciclo de vida.

const db = require('./src/db');
const gemini = require('./src/gemini');
const whatsapp = require('./src/whatsappClient');

let isShuttingDown = false; // Flag para evitar chamadas múltiplas de shutdown

// --- Função de Encerramento Controlado ---
async function gracefulShutdown() {
    if (isShuttingDown) {
        console.log("Desligamento já em progresso...");
        return;
    }
    isShuttingDown = true;
    console.log('\nIniciando desligamento controlado...');

    // 1. Desconectar o cliente WhatsApp (se existir e conectado)
    const waClient = whatsapp.getClient();
    if (waClient) {
        console.log("Tentando desconectar o cliente WhatsApp...");
        try {
            // Adiciona um timeout para o destroy, caso ele trave
            await Promise.race([
                waClient.destroy(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout ao desconectar WhatsApp')), 8000)) // Timeout de 8s
            ]);
            console.log('Cliente WhatsApp desconectado com sucesso.');
        } catch (e) {
            console.error("Erro (ou timeout) ao desconectar o cliente WhatsApp:", e.message);
            // Continua o desligamento mesmo assim
        }
    } else {
        console.log("Cliente WhatsApp não estava inicializado.");
    }

    // 2. Fechar a conexão com o banco de dados
    console.log("Fechando conexão com o banco de dados...");
    db.closeDbConnection(); // A função já loga o resultado

    // 3. Encerrar o processo
    console.log("Aguardando últimos logs...");
    // Dá um pequeno tempo para logs pendentes serem escritos
    setTimeout(() => {
        console.log("Processo encerrado.");
        process.exit(0); // Encerra o processo Node.js
    }, 1500); // Espera 1.5 segundos
}

// --- Inicialização da Aplicação ---
async function startApp() {
    console.log("--- Iniciando FinanceBot ---");

    // 1. Configurar Google AI (necessário antes de inicializar o WA)
    const isAiReady = gemini.setupGoogleAI();
    if (!isAiReady) {
        console.warn("Aplicação continuará sem funcionalidades de IA.");
        // Decide se quer continuar sem IA ou parar
        process.exit(1);
    }

    // 2. Inicializar Banco de Dados
    try {
        await db.initDb();
        console.log("Banco de dados inicializado com sucesso.");
    } catch (dbError) {
        console.error("!!! FALHA CRÍTICA AO INICIALIZAR O BANCO DE DADOS !!!", dbError);
        process.exit(1); // Encerra se o DB falhar
    }

    // 3. Inicializar Cliente WhatsApp (só depois do DB estar pronto)
    // O initWhatsApp agora gerencia seus próprios erros críticos e logs de inicialização
    whatsapp.initWhatsApp(() => {
         console.log("Callback de WhatsApp Pronto chamado.");
         // Pode adicionar ações aqui que só devem ocorrer quando o WA estiver 100% pronto
     });

    console.log("--- Aplicação FinanceBot iniciada e aguardando conexões/mensagens ---");

    // --- Listeners para Encerramento Controlado ---
    process.on('SIGINT', gracefulShutdown);  // Captura Ctrl+C
    process.on('SIGTERM', gracefulShutdown); // Captura sinais de término (ex: systemctl stop)
    process.on('uncaughtException', (error, origin) => {
        console.error(`\n!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!`);
        console.error('!!! ERRO NÃO TRATADO (Uncaught Exception) !!!');
        console.error('Origem:', origin);
        console.error('Erro:', error);
        console.error(`!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n`);
        // Tenta um desligamento controlado, mas pode não funcionar dependendo do erro
        gracefulShutdown().catch(() => process.exit(1)); // Força saída se shutdown falhar
    });
     process.on('unhandledRejection', (reason, promise) => {
        console.error(`\n!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!`);
        console.error('!!! PROMISE REJEITADA NÃO TRATADA (Unhandled Rejection) !!!');
        console.error('Promise:', promise);
        console.error('Razão:', reason);
        console.error(`!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n`);
         // Tenta um desligamento controlado
        gracefulShutdown().catch(() => process.exit(1)); // Força saída se shutdown falhar
    });


}

// --- Iniciar a aplicação ---
startApp();