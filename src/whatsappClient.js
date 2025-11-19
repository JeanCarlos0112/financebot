// --- whatsappClient.js ---
// Configura e gerencia o cliente whatsapp-web.js

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { handleIncomingMessage } = require('./messageHandler');
const { closeDbConnection } = require('./db');
const path = require('path');
const fs = require('fs');
const { EXPENSE_IMAGES_DIR } = require('../config');

let client;

function initWhatsApp(onReadyCallback) {
    console.log("Inicializando cliente WhatsApp...");

    client = new Client({
        authStrategy: new LocalAuth({ dataPath: "./.wwebjs_auth" }),
        puppeteer: {
            headless: true,
            args: [ // Args recomendados para rodar em servidores (especialmente Linux)
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu' // Pode ser necessario em alguns sistemas
            ],
        },
        // Outras opcoes do cliente, se necessario:
        // webVersionCache: {
        //   type: 'remote',
        //   remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
        // },
    });

    client.on('qr', (qr) => {
        console.log('--- QR Code Recebido ---');
        qrcode.generate(qr, { small: true });
        console.log('Escaneie o QR Code acima com o seu WhatsApp para autenticar.');
        console.log('-----------------------');
    });

    client.on('loading_screen', (percent, message) => {
        console.log(`Carregando WhatsApp Web: ${percent}% - ${message}`);
    });


    client.on('authenticated', () => {
        console.log('WhatsApp Autenticado com sucesso!');
    });

    client.on('auth_failure', msg => {
        console.error('!!! FALHA NA AUTENTICAÇÃO DO WHATSAPP !!!', msg);
        console.error('Isso pode ocorrer se o QR code expirou ou houve um problema na sessão.');
        console.error('Delete a pasta .wwebjs_auth e tente novamente.');
        process.exit(1);
    });

    client.on('ready', () => {
        console.log('✅ Cliente WhatsApp está pronto para uso!');
        if (onReadyCallback) onReadyCallback(); // Chama callback, se fornecido
    });

    client.on('message', async (message) => {
        let imagePaths = [];
        const chatId = message.from;
        if (message.hasMedia) {
            const media = await message.downloadMedia();
            // Aceita imagens OU PDFs
            if (media && media.mimetype && (media.mimetype.startsWith('image/') || media.mimetype === 'application/pdf') && media.data) {
                try {
                    // Tenta obter a extensao do mimetype, senao usa um default
                    let ext = media.mimetype.split('/')[1] || 'bin';
                    if (media.mimetype === 'application/pdf') ext = 'pdf';

                    const fileName = `receipt_${Date.now()}_${Math.floor(Math.random()*10000)}.${ext}`;
                    const dir = EXPENSE_IMAGES_DIR || './expense_images'; // Garante um default
                    const filePath = path.join(dir, fileName);
                    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                    fs.writeFileSync(filePath, Buffer.from(media.data, 'base64'));
                    imagePaths.push(filePath);
                    //console.log(`[${chatId}] Comprovante (${media.mimetype}) recebido e salvo em: ${filePath}`);
                } catch (saveError) {
                    console.error(`[${chatId}] Erro ao salvar comprovante recebido (${media.mimetype}):`, saveError);
                }
            }
        }

        // Chama o handler principal para processar a mensagem, passando imagePaths
        const reply = await handleIncomingMessage(message, imagePaths);

        // Logica de envio de resposta aprimorada
        if (Array.isArray(reply)) {
            for (const item of reply) {
                try {
                    if (typeof item === 'string') {
                        await client.sendMessage(chatId, item);
                    } else if (item && item.type === 'image' && item.path) {
                        if (fs.existsSync(item.path)) {
                            const media = MessageMedia.fromFilePath(item.path);
                            await client.sendMessage(chatId, media);
                            console.log(`[${chatId}] Imagem enviada: ${item.path}`);
                        } else {
                            console.error(`[${chatId}] Arquivo de imagem não encontrado para envio: ${item.path}`);
                            await client.sendMessage(chatId, `😥 Desculpe, não consegui encontrar o arquivo do comprovante (${path.basename(item.path)}).`);
                        }
                    }
                } catch (err) {
                    console.error(`[${chatId}] Erro ao enviar parte da resposta (${typeof item === 'string' ? 'texto' : 'mídia'}):`, err);
                    await client.sendMessage(chatId, `😥 Ocorreu um erro ao tentar enviar parte da resposta.`);
                }
            }
        } else if (typeof reply === 'string') {
            try {
                await client.sendMessage(chatId, reply);
            } catch (err) {
                console.error(`[${chatId}] Erro ao enviar mensagem de resposta via WhatsApp:`, err);
            }
        } else if (reply === null) {
             console.log(`[${chatId}] Nenhuma resposta enviada (ou erro prévio no envio).`);
        }
    });

    client.on('disconnected', (reason) => {
        console.warn('Cliente WhatsApp foi desconectado!', reason);
        closeDbConnection();
        console.log('Processo será encerrado devido à desconexão do WhatsApp.');
        process.exit(1);
    });

    client.on('change_state', state => {
        console.log('Estado do cliente WhatsApp mudou:', state);
    });


    client.initialize()
        .then(() => console.log("Inicialização do cliente WA solicitada... Aguardando eventos."))
        .catch(err => {
            console.error("!!! FALHA CRÍTICA AO INICIALIZAR O WHATSAPP WEB !!!", err);
            console.error("Verifique sua conexão com a internet e as dependências.");
            process.exit(1);
        });

     return client;
}

function getClient() {
    return client;
}

module.exports = {
    initWhatsApp,
    getClient,
};