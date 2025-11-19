// --- messageHandler.js ---
// Contem a logica principal para processar mensagens recebidas

const db = require('./db');
const gemini = require('./gemini');
const utils = require('./utils');
const state = require('./state');
const config = require('../config');

// --- Funcoes Auxiliares de Fluxo de Conversa (Especificas para este handler) ---

/**
 * Avanca para a proxima etapa de coleta de dados ou finaliza o registro.
 * Modifica diretamente o currentState passado por referencia.
 * @param {string} chatId
 * @param {object} currentState - O objeto de estado atual do usuario (sera modificado).
 */
async function proceedToNextStepOrRegister(chatId, currentState) {
    if (!currentState || !currentState.tempData) {
        console.error(`Erro Crítico: Tentativa de processar estado inválido para ${chatId} em proceedToNextStepOrRegister.`);
        state.clearState(chatId); // Limpa estado inconsistente
        currentState.nextResponseMessage = "Ocorreu um erro interno. Por favor, tente novamente.";
        currentState.waitingFor = null;
        return;
    }

    const { tempData } = currentState;
    // Define valores padrao para evitar erros
    currentState.nextResponseMessage = "Algo deu errado no fluxo. Tente novamente.";
    currentState.waitingFor = null;

    try {
        // 1. Valor (Obrigatorio)
        if (typeof tempData.value !== 'number' || isNaN(tempData.value) || tempData.value <= 0) {
            currentState.waitingFor = 'value';
            currentState.nextResponseMessage = "Qual foi o *valor* da despesa?";
            console.log(`[${chatId}] Próximo passo: Pedir 'value'`);
            return;
        }
        const formattedValue = tempData.value.toFixed(2).replace('.', ',');

        // 2. Item (Obrigatorio)
         if (!tempData.item) {
            currentState.waitingFor = 'item';
            currentState.nextResponseMessage = `Ok, R$ ${formattedValue}. Qual foi o *item principal* ou serviço comprado?`;
            console.log(`[${chatId}] Próximo passo: Pedir 'item'`);
            return;
        }

        // 3. Metodo de Pagamento (Obrigatorio)
        if (!tempData.paymentMethod) {
            currentState.waitingFor = 'payment_method';
            currentState.nextResponseMessage = `Certo: R$ ${formattedValue} para "${tempData.item}". *Como você pagou*? (Ex: ${config.PAYMENT_METHODS_EXAMPLES})`;
            console.log(`[${chatId}] Próximo passo: Pedir 'payment_method'`);
            return;
        }

        // 4. Categoria (Opcional, default 'Outros')
        if (!tempData.category) {
            tempData.category = 'Outros'; // Define default se nao fornecido ainda
        }

        // 5. Estabelecimento (Opcional)
        if (!tempData.establishment) {
            currentState.waitingFor = 'establishment';
            currentState.nextResponseMessage = `Entendido: R$ ${formattedValue} (${tempData.item}, pago com ${tempData.paymentMethod}). *Onde* foi a compra? (Nome do local ou 'N/A')`;
            console.log(`[${chatId}] Próximo passo: Pedir 'establishment'`);
            return;
        }
         // Garante 'N/A' se passou direto
         if (tempData.establishment === 'N/A' || tempData.establishment === 'n/a') {
             tempData.establishment = 'N/A';
         }


        // 6. Confirmacao de Notas (Ultima etapa antes de salvar)
        // Neste ponto, todos os campos obrigatorios e opcionais solicitados foram preenchidos.
        currentState.waitingFor = 'notes_confirmation';
        let summary = `👍 Quase lá! Confira os dados:\n\n${utils.formatExpenseSummary(tempData, false)}`; // Mostra resumo sem notas ainda
        currentState.nextResponseMessage = `${summary}\n\nQuer adicionar alguma *observação*? (Digite a nota ou responda "não")`;
        console.log(`[${chatId}] Próximo passo: Pedir 'notes_confirmation'`);
        return;

    } catch (error) {
        console.error(`Erro durante proceedToNextStepOrRegister para ${chatId}:`, error);
        state.clearState(chatId); // Limpa estado em caso de erro
        currentState.nextResponseMessage = "Ocorreu um erro processando sua solicitação. Vamos tentar de novo do início.";
        currentState.waitingFor = null;
    }
}

/**
 * Finaliza o processo e registra a despesa no banco de dados.
 * @param {string} chatId
 * @param {object} expenseData - Os dados completos da despesa.
 * @param {array} imagePaths - Os caminhos das imagens associadas à despesa.
 * @returns {Promise<void>}
 * @throws {Error} Se os dados finais forem inválidos.
 */
async function finalizeAndRegisterExpense(chatId, expenseData, imagePaths = []) {
    console.log(`[${chatId}] Finalizando e registrando despesa:`, expenseData);
    // Validação final antes de inserir no DB
    if (typeof expenseData.value !== 'number' || isNaN(expenseData.value) || expenseData.value <= 0 ||
        !expenseData.category || !expenseData.paymentMethod || !expenseData.item) {
        console.error(`[${chatId}] Erro Crítico: Dados FINAIS inválidos ao tentar registrar:`, expenseData);
        throw new Error("Dados inválidos detectados ao tentar finalizar o registro da despesa.");
    }
    try {
        const expenseId = await db.addExpenseWithImages(chatId, expenseData, imagePaths);
        if (imagePaths && imagePaths.length > 0) {
            expenseData.has_image = true;
        }
        console.log(`[${chatId}] Despesa registrada com sucesso no DB.`);
    } catch (dbError) {
        console.error(`[${chatId}] Erro ao registrar despesa no DB:`, dbError);
        throw dbError;
    }
}


// --- Logica Principal do Bot ---

/**
 * Processa uma mensagem recebida do WhatsApp.
 * @param {object} message - O objeto da mensagem do whatsapp-web.js.
 * @param {array} imagePaths - Os caminhos das imagens associadas à despesa.
 */
async function handleIncomingMessage(message, imagePaths = []) {
    // Ignora mensagens de status, grupos, ou próprias mensagens do bot
    if (message.isStatus || message.from.includes('@g.us') || message.fromMe) {
        return;
    }

    const chatId = message.from;
    const userMessage = message.body?.trim() || ''; // Garante que é string e remove espaços extras
    console.log(`\n--- Nova Mensagem Recebida ---`);
    console.log(`[${chatId}] De: ${chatId}`);
    console.log(`[${chatId}] Mensagem: "${userMessage}"`);

    const now = Date.now();
    const lastTimestamp = state.getLastMessageTimestamp(chatId);
    // Considera nova conversa se passaram mais de 15 minutos
    const isNewConversationFlow = (now - lastTimestamp) > (15 * 60 * 1000);
    state.setLastMessageTimestamp(chatId, now); // Atualiza timestamp

    if (isNewConversationFlow) {
        console.log(`[${chatId}] Fluxo de nova conversa detectado.`);
        state.clearState(chatId); // Limpa estado anterior se for nova conversa
    }

    let responseMessage = "Desculpe, não consegui processar sua solicitação. 🤔"; // Mensagem padrão de erro
    let currentState = state.getState(chatId); // Pega o estado atual (pode ser undefined)

    try {
        if (!gemini.checkGoogleAiAvailability()) {
            responseMessage = "Desculpe, a funcionalidade de inteligência artificial está temporariamente indisponível.";
        } else {
            // --- 1. Análise da Mensagem com Gemini ---
            console.log(`[${chatId}] Analisando mensagem com Gemini. Contexto atual:`, currentState);
            const analysis = await gemini.analyzeMessageWithGemini(userMessage, currentState);
            console.log(`[${chatId}] Análise Gemini:`, analysis);

            if (analysis.error) {
                 console.error(`[${chatId}] Erro na análise Gemini: ${analysis.error}. Raw: ${analysis.raw_response}`);
                 // Tenta dar uma resposta genérica se a análise falhar
                 responseMessage = await gemini.generateConversationalResponse(userMessage, 'unknown', isNewConversationFlow);
            } else {

                // --- 2. Bloco de Decisao Principal ---

                // --- Cenario A: Usuario esta respondendo a uma pergunta anterior ---
                if (currentState && currentState.waitingFor) {
                    console.log(`[${chatId}] Processando resposta para estado pendente: '${currentState.waitingFor}'`);
                    const fieldBeingWaitedFor = currentState.waitingFor;

                    // Primeiro: tratar notes_confirmation
                    if (fieldBeingWaitedFor === 'notes_confirmation') {
                        // Se a LLM interpretar como cancel_action, NAO cancelar a transacao, apenas finalizar sem observacao
                        if (analysis.intent === 'cancel_action') {
                            console.log(`[${chatId}] Usuário recusou adicionar observação (intent cancel_action). Finalizando...`);
                            await finalizeAndRegisterExpense(chatId, currentState.tempData, currentState.tempData.imagePaths);
                            responseMessage = `✅ Despesa registrada com sucesso!\n\n${utils.formatExpenseSummary(currentState.tempData, false)}`;
                            state.clearState(chatId);
                        } else if (analysis.intent === 'provide_info' && analysis.provided_field === 'notes') {
                            currentState.tempData.notes = analysis.provided_value;
                            console.log(`[${chatId}] Notas fornecidas diretamente: "${analysis.provided_value}". Finalizando...`);
                            await finalizeAndRegisterExpense(chatId, currentState.tempData, currentState.tempData.imagePaths);
                            responseMessage = `✅ Despesa registrada com sucesso!\n\n${utils.formatExpenseSummary(currentState.tempData, true)}`;
                            state.clearState(chatId);
                        } else if (analysis.intent === 'confirm_action' || (analysis.intent === 'provide_info' && ['sim', 's', 'yes', 'y', 'quero', 'pode', 'ok'].includes(String(analysis.provided_value || '').toLowerCase()))) {
                            state.updateState(chatId,{ waitingFor: 'notes' });
                            responseMessage = "Ok, pode digitar as observações agora:";
                            console.log(`[${chatId}] Usuário confirmou adição de notas. -> Esperando 'notes'`);
                        } else {
                            console.log(`[${chatId}] Usuário não quis adicionar notas. Finalizando...`);
                            await finalizeAndRegisterExpense(chatId, currentState.tempData, currentState.tempData.imagePaths);
                            responseMessage = `✅ Despesa registrada com sucesso!\n\n${utils.formatExpenseSummary(currentState.tempData, false)}`;
                            state.clearState(chatId);
                        }
                    }
                    // Depois: cancelamento global
                    else if (analysis.intent === 'cancel_action') {
                        responseMessage = await gemini.generateConversationalResponse(userMessage, 'cancel_action', false);
                        state.clearState(chatId); // Limpa o estado ao cancelar
                    }
                    // Caso Especifico: Esperando a digitacao das notas
                    else if (fieldBeingWaitedFor === 'notes') {
                        // Interpreta QUALQUER coisa que nao seja cancelamento como a nota
                        currentState.tempData.notes = userMessage; // Pega a mensagem INTEIRA como nota
                        console.log(`[${chatId}] Notas recebidas (mensagem inteira): "${userMessage}". Finalizando...`);
                        await finalizeAndRegisterExpense(chatId, currentState.tempData, currentState.tempData.imagePaths);
                        responseMessage = `✅ Despesa registrada com sucesso!\n\n${utils.formatExpenseSummary(currentState.tempData, true)}`;
                        state.clearState(chatId);
                    }
                    // Caso Especifico: Esperando confirmacao para conselho
                    else if (fieldBeingWaitedFor === 'advice_confirmation') {
                        if (analysis.intent === 'confirm_action') {
                             console.log(`[${chatId}] Usuário confirmou pedido de conselho.`);
                             const userContext = currentState.tempData?.userContext || null;
                             // Tenta pegar dados do ultimo mes, senao todos
                             let spending = await db.getSpendingByCategory(chatId, 'last_month');
                             if (!spending?.length) spending = await db.getSpendingByCategory(chatId, 'all');
                             responseMessage = await gemini.generateSpendingAdvice(spending, userContext);
                             state.clearState(chatId);
                        } else { // Assume cancelamento se nao for confirmacao explicita
                             responseMessage = await gemini.generateConversationalResponse("Não, obrigado", 'cancel_action', false);
                             state.clearState(chatId);
                        }
                    }
                    // Caso Geral: Esperando um campo especifico (value, item, payment_method, establishment)
                    else if (analysis.intent === 'provide_info' && analysis.provided_field === fieldBeingWaitedFor) {
                        const providedValue = analysis.provided_value;
                        let isValid = true;
                        let processedValue = providedValue;

                        // Validacao especifica para 'value'
                        if (fieldBeingWaitedFor === 'value') {
                            const numericValue = parseFloat(String(providedValue).replace(/\s/g, '').replace(',', '.'));
                            if (!isNaN(numericValue) && numericValue > 0) {
                                processedValue = numericValue;
                            } else {
                                isValid = false;
                                responseMessage = `Hum, o valor "${providedValue}" não parece válido. Por favor, digite um número positivo (ex: 25,50).`;
                                console.warn(`[${chatId}] Valor inválido recebido: ${providedValue}`);
                            }
                        }
                        // Validacao/Limpeza para 'establishment' (ex: remover aspas)
                         else if (fieldBeingWaitedFor === 'establishment') {
                             processedValue = String(providedValue).replace(/["']/g, ''); // Remove aspas
                             if (!processedValue) { // Nao pode ser vazio
                                 isValid = false;
                                 responseMessage = `Preciso que informe o nome do local ou digite 'N/A' se não aplicável.`;
                             }
                         }
                          // Validacao/Limpeza para 'item'
                         else if (fieldBeingWaitedFor === 'item') {
                             processedValue = String(providedValue).replace(/["']/g, ''); // Remove aspas
                              if (!processedValue) { // Nao pode ser vazio
                                 isValid = false;
                                 responseMessage = `Por favor, informe o item ou serviço principal.`;
                             }
                         }
                         // Validacao/Limpeza para 'payment_method'
                          else if (fieldBeingWaitedFor === 'payment_method') {
                             processedValue = String(providedValue).replace(/["']/g, ''); // Remove aspas
                               if (!processedValue) { // Nao pode ser vazio
                                 isValid = false;
                                 responseMessage = `Como você pagou? (Pix, Débito, Crédito, etc.)`;
                             }
                         }


                        if (isValid) {
                            console.log(`[${chatId}] Campo '${fieldBeingWaitedFor}' recebido: "${processedValue}". Avançando...`);
                            // Converte nome do campo para camelCase se necessario (ex: payment_method -> paymentMethod)
                            const internalFieldName = fieldBeingWaitedFor === 'payment_method' ? 'paymentMethod' : fieldBeingWaitedFor;
                            currentState.tempData[internalFieldName] = processedValue;

                            // Cria um novo objeto de estado para passar para a proxima funcao
                            let nextState = { ...currentState };
                            await proceedToNextStepOrRegister(chatId, nextState); // Passa a copia

                            // Atualiza o estado principal com o resultado de proceedToNextStepOrRegister
                            state.setState(chatId, nextState.waitingFor ? nextState : null);
                            responseMessage = nextState.nextResponseMessage;
                        }
                        // Se nao for valido, a responseMessage ja foi definida na validacao

                    } else {
                        // Tratamento da escolha na desambiguacao
                        if (fieldBeingWaitedFor === 'receipt_disambiguation') {
                            console.log(`[${chatId}] Processando resposta para 'receipt_disambiguation'. Mensagem: \"${userMessage}\"`);
                            const userChoice = userMessage.toLowerCase().trim();
                            const candidates = currentState.tempData.foundExpenses; // Pega do estado
                            let selectedId = null;
                            let errorMsg = null;

                            if (!candidates || candidates.length === 0) {
                                // Segurança: Se não há candidatos no estado, algo deu errado antes.
                                console.error(`[${chatId}] Estado receipt_disambiguation sem candidatos em tempData!`);
                                responseMessage = "Ocorreu um erro ao processar sua escolha. Por favor, tente pedir o comprovante novamente.";
                                state.clearState(chatId);
                            } else {
                                if (userChoice === 'o mais antigo' || userChoice === 'o primeiro') {
                                    selectedId = candidates[0].id;
                                    console.log(`[${chatId}] Usuário escolheu 'o mais antigo'. ID: ${selectedId}`);
                                } else if (userChoice === 'o mais recente' || userChoice === 'o último') {
                                    selectedId = candidates[candidates.length - 1].id;
                                    console.log(`[${chatId}] Usuário escolheu 'o mais recente'. ID: ${selectedId}`);
                                } else {
                                    const idMatch = userChoice.match(/^id\s+(\d+)$/i);
                                    if (idMatch && idMatch[1]) {
                                        const requestedId = parseInt(idMatch[1], 10);
                                        const found = candidates.find(exp => exp.id === requestedId);
                                        if (found) {
                                            selectedId = found.id;
                                            console.log(`[${chatId}] Usuário escolheu por ID. ID: ${selectedId}`);
                                        } else {
                                            errorMsg = `ID ${requestedId} não está na lista de opções. Tente novamente.`;
                                            console.log(`[${chatId}] ID ${requestedId} inválido.`);
                                        }
                                    } else {
                                        errorMsg = "Não entendi sua escolha. Por favor, responda com o *ID*, *'o mais antigo'* ou *'o mais recente'*.";
                                        console.log(`[${chatId}] Resposta de desambiguação inválida: "${userMessage}"`);
                                    }
                                }

                                if (selectedId) {
                                    const selectedExpense = candidates.find(exp => exp.id === selectedId);
                                    const imagePathsFound = await db.getExpenseImages(selectedId);
                                    if (imagePathsFound && imagePathsFound.length > 0) {
                                        console.log(`[${chatId}] Comprovante(s) encontrado(s) para despesa ${selectedId}. Preparando para envio.`);
                                        responseMessage = [
                                            `🧾 Aqui está o comprovante para a despesa '${selectedExpense.item}' (ID ${selectedId}):`,
                                            ...imagePathsFound.map(p => ({ type: 'image', path: p }))
                                        ];
                                    } else {
                                        responseMessage = `✅ Encontrei a despesa '${selectedExpense.item}' (ID ${selectedId}), mas não há comprovante anexado a ela.`;
                                    }
                                    state.clearState(chatId); // Limpa estado apos sucesso na desambiguacao
                                } else {
                                    // Se houve erro ou ID invalido, manda a mensagem de erro e NAO limpa o estado
                                    responseMessage = errorMsg;
                                }
                            }
                        }
                        // Bloco final else para respostas inesperadas
                        else {
                            // Usuario respondeu algo inesperado quando se esperava um campo
                            responseMessage = `Hum... Acho que não entendi sua resposta para "${fieldBeingWaitedFor}". Poderia tentar de novo, ou digitar "cancela"?`;
                            console.log(`[${chatId}] Resposta inesperada (${analysis.intent}) enquanto esperava por '${fieldBeingWaitedFor}'.`);
                        }
                    }
                }

                // --- Cenário B: Nova Intenção do Usuário (sem estado pendente) ---
                else {
                    console.log(`[${chatId}] Processando nova intenção: '${analysis.intent}'`);
                    // Limpa qualquer resquício de estado anterior (exceto lastResearchTopic)
                    state.clearWaitingFor(chatId);
                    state.clearTempData(chatId);

                    // Garante que existe um objeto de estado para guardar lastResearchTopic se necessário
                    if (!state.getState(chatId)) {
                        state.setState(chatId, {});
                    }

                    switch (analysis.intent) {
                        case 'register_expense':
                            const { value: vR, category: c, establishment: e, payment_method: pm, item: i, notes: n, date: d } = analysis;
                            let numericValue = null;
                            if (vR != null && vR !== undefined) {
                                numericValue = parseFloat(String(vR).replace(/\s/g, '').replace(',', '.'));
                                if (isNaN(numericValue) || numericValue <= 0) numericValue = null; // Invalida se não for número positivo
                            }
                             // Cria o objeto inicial com os dados extraídos (podem ser null)
                            const initialExpenseData = {
                                value: numericValue,
                                category: c || null,
                                establishment: e || null,
                                paymentMethod: pm || null,
                                item: i || null,
                                notes: n || null,
                                date: d || 'today',
                                imagePaths: imagePaths && imagePaths.length > 0 ? imagePaths : null
                            };

                            console.log(`[${chatId}] Iniciando fluxo de registro com dados:`, initialExpenseData);
                            // Cria um novo estado para o registro
                            let registrationState = { waitingFor: null, tempData: initialExpenseData };
                            await proceedToNextStepOrRegister(chatId, registrationState); // Inicia o fluxo

                            // Atualiza o estado global com base no resultado
                            state.setState(chatId, registrationState.waitingFor ? registrationState : null);
                            responseMessage = registrationState.nextResponseMessage; // Pega a mensagem de resposta (pedindo o próximo campo ou confirmação)
                            state.clearLastResearchTopic(chatId); // Registro de despesa limpa contexto de pesquisa
                            break;

                        case 'request_report':
                            const reportPeriod = analysis.report_period || 'month'; // Default para 'month'
                            console.log(`[${chatId}] Gerando relatório para período: ${reportPeriod}`);
                            const expenses = await db.getExpenses(chatId, reportPeriod);
                            responseMessage = utils.formatReport(expenses, reportPeriod);
                            state.clearLastResearchTopic(chatId); // Ver relatório limpa contexto de pesquisa
                            break;

                        case 'request_advice':
                            console.log(`[${chatId}] Pedido de conselho (nova intenção). Contexto: ${userMessage}`);
                             // Tenta pegar dados do último mês, senão todos
                            let spendingData = await db.getSpendingByCategory(chatId, 'last_month');
                            if (!spendingData?.length) spendingData = await db.getSpendingByCategory(chatId, 'all');
                            responseMessage = await gemini.generateSpendingAdvice(spendingData, userMessage); // Passa a mensagem original como contexto
                            state.clearLastResearchTopic(chatId); // Pedir conselho limpa contexto de pesquisa anterior
                            break;

                        case 'request_research':
                            const researchQuery = analysis.research_query;
                            const lastTopic = state.getState(chatId)?.lastResearchTopic;

                            if (researchQuery) { // Nova pesquisa explícita
                                console.log(`[${chatId}] Nova pesquisa solicitada: "${researchQuery}"`);
                                responseMessage = await gemini.generateResearchResponse(researchQuery, null);
                                state.updateState(chatId,{ lastResearchTopic: researchQuery }); // Armazena novo tópico
                            } else if (lastTopic) { // Follow-up de pesquisa anterior (sem query nova extraída)
                                console.log(`[${chatId}] Follow-up de pesquisa detectado sobre: "${lastTopic}". Pedido: "${userMessage}"`);
                                responseMessage = await gemini.generateResearchResponse(lastTopic, userMessage);
                                // Mantém o lastResearchTopic existente
                            } else { // Pedido de pesquisa genérico sem tópico claro ou anterior
                                console.log(`[${chatId}] Pedido de pesquisa genérico detectado.`);
                                responseMessage = "Claro! Sobre qual tópico financeiro você gostaria de saber mais?";
                                // Não define lastResearchTopic ainda
                            }
                            break;

                        case 'greeting':
                            console.log(`[${chatId}] Gerando saudação (nova conversa: ${isNewConversationFlow}).`);
                            responseMessage = await gemini.generateConversationalResponse(userMessage, 'greeting', isNewConversationFlow);
                            state.clearLastResearchTopic(chatId); // Saudação limpa contexto de pesquisa
                            break;

                        case 'chit_chat':
                            const currentLastTopic = state.getState(chatId)?.lastResearchTopic;
                             // Lógica Aprimorada: Verifica se PODE ser um follow-up de pesquisa, mesmo que classificado como chit_chat
                            const isPotentialFollowUp = currentLastTopic && (
                                userMessage.toLowerCase().includes("explique") ||
                                userMessage.toLowerCase().includes("mais") ||
                                userMessage.toLowerCase().includes("detalhe") ||
                                userMessage.toLowerCase().includes("como assim") ||
                                userMessage.toLowerCase().includes("técnico") ||
                                userMessage.toLowerCase().includes("simples") ||
                                userMessage.toLowerCase().includes("exemplo") ||
                                userMessage.toLowerCase().includes("cálculo")
                            );

                            if (isPotentialFollowUp) {
                                console.log(`[${chatId}] 'chit_chat' interpretado como follow-up de pesquisa para: "${currentLastTopic}"`);
                                responseMessage = await gemini.generateResearchResponse(currentLastTopic, userMessage);
                                // Mantém o lastResearchTopic
                            } else { // Trata como chit_chat normal
                                console.log(`[${chatId}] Gerando resposta para 'chit_chat'.`);
                                responseMessage = await gemini.generateConversationalResponse(userMessage, 'chit_chat', false);

                                // Verifica se a resposta do bot ofereceu ajuda/dicas (para entrar no estado advice_confirmation)
                                const botResponseLower = responseMessage.toLowerCase();
                                if (botResponseLower.includes("quer") && (botResponseLower.includes("dica") || botResponseLower.includes("ajuda") || botResponseLower.includes("organizar") || botResponseLower.includes("conversar sobre"))) {
                                    console.log(`[${chatId}] Bot ofereceu ajuda/dicas. -> Entrando no estado 'advice_confirmation'`);
                                    state.updateState(chatId,{
                                         waitingFor: 'advice_confirmation',
                                         tempData: { userContext: userMessage } // Guarda a mensagem original que levou à oferta
                                     });
                                } else {
                                     // Se não ofereceu ajuda, limpa contexto de pesquisa para evitar follow-ups incorretos
                                     state.clearLastResearchTopic(chatId);
                                }
                            }
                            break;

                        case 'request_receipt':
                            console.log(`[${chatId}] Pedido de comprovante recebido. Critérios:`, analysis.search_criteria);
                            if (!analysis.search_criteria || Object.keys(analysis.search_criteria).length === 0) {
                                responseMessage = "Por favor, me dê mais detalhes da despesa para eu encontrar o comprovante (item, valor, data, local...). 😉";
                            } else {
                                const foundExpenses = await db.findExpense(chatId, analysis.search_criteria);
                                if (!foundExpenses || foundExpenses.length === 0) {
                                    responseMessage = "🙁 Não encontrei nenhuma despesa com esses detalhes para buscar o comprovante.";
                                } else if (foundExpenses.length > 1) {
                                    // --- Lógica para Ambiguidade ---
                                    console.log(`[${chatId}] Múltiplas despesas encontradas. Solicitando desambiguação.`);
                                    let msg = "Encontrei estas despesas. Qual comprovante você deseja?\n_(Responda com o ID, 'o mais antigo' ou 'o mais recente')_\n";
                                    foundExpenses.forEach(exp => {
                                        // Usa o campo timestamp_utc formatado pelo DB
                                        const timestampDate = new Date(exp.timestamp_utc);
                                        const timeString = timestampDate.toLocaleTimeString('pt-BR', {
                                            hour: '2-digit',
                                            minute: '2-digit',
                                            timeZone: 'America/Sao_Paulo'
                                        });
                                        msg += `\n- *ID ${exp.id}:* ${exp.item} (R$ ${exp.value.toFixed(2).replace('.', ',')}) em ${exp.expense_date} às ${timeString}`;
                                    });
                                    responseMessage = msg;
                                    state.setState(chatId, {
                                        waitingFor: 'receipt_disambiguation',
                                        tempData: { foundExpenses: foundExpenses }
                                    });
                                } else {
                                    // --- Encontrou exatamente uma despesa ---
                                    const expenseId = foundExpenses[0].id;
                                    const imagePathsFound = await db.getExpenseImages(expenseId);
                                    if (imagePathsFound && imagePathsFound.length > 0) {
                                        console.log(`[${chatId}] Comprovante(s) encontrado(s) para despesa ${expenseId}. Preparando para envio.`);
                                        responseMessage = [
                                            `🧾 Aqui está o comprovante para a despesa '${foundExpenses[0].item}':`,
                                            ...imagePathsFound.map(p => ({ type: 'image', path: p }))
                                        ];
                                    } else {
                                        responseMessage = `✅ Encontrei a despesa '${foundExpenses[0].item}', mas não há comprovante anexado a ela.`;
                                    }
                                    state.clearState(chatId);
                                }
                            }
                            break;

                        case 'confirm_action': // Confirmação genérica fora de um fluxo esperado
                        case 'provide_info':   // Informação genérica fora de um fluxo esperado
                        case 'cancel_action': // Cancelamento genérico fora de um fluxo esperado
                             console.log(`[${chatId}] Intenção '${analysis.intent}' recebida fora de contexto. Tratando como 'unknown'.`);
                             // Tenta gerar uma resposta conversacional genérica
                             responseMessage = await gemini.generateConversationalResponse(userMessage, 'unknown', isNewConversationFlow);
                             state.clearLastResearchTopic(chatId); // Limpa contexto pesquisa
                             break;


                        default: // unknown ou erro não capturado na análise
                            console.warn(`[${chatId}] Intenção não reconhecida ou erro LLM não tratado:`, analysis);
                            const lastTopicUnknown = state.getState(chatId)?.lastResearchTopic;
                            // Última tentativa: tratar como follow-up de pesquisa se houver tópico anterior
                            if (lastTopicUnknown) {
                                console.log(`[${chatId}] Intenção 'unknown' interpretada como follow-up de pesquisa para: "${lastTopicUnknown}"`);
                                responseMessage = await gemini.generateResearchResponse(lastTopicUnknown, userMessage);
                            } else {
                                responseMessage = await gemini.generateConversationalResponse(userMessage, 'unknown', isNewConversationFlow);
                            }
                            break;
                    }
                }
            } // Fim do else (analysis sem erro)
        } // Fim do else (Gemini disponível)
    } // Fechamento correto do bloco try principal
    catch (error) {
        console.error(`\n!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!`);
        console.error(`[${chatId}] Erro GRAVE no handler principal:`, error);
        console.error(`!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n`);
        responseMessage = "🤯 Oops! Ocorreu um erro inesperado ao processar sua mensagem. Por favor, tente novamente.";
        state.clearState(chatId); // Limpa o estado em caso de erro grave para evitar loops
    }

    // --- 3. Envio da Resposta ---
    if (responseMessage) {
        // Log da resposta antes de enviar
        if (Array.isArray(responseMessage)) {
            // Se for um array (provavelmente com imagem), loga apenas a parte de texto ou uma msg genérica
            const textPart = responseMessage.find(item => typeof item === 'string');
            console.log(`[${chatId}] Enviando resposta com comprovante: "${textPart || 'Comprovante encontrado...'}"`);
        } else if (typeof responseMessage === 'string'){
            // Se for string, loga normally (com replace e substring)
            const logMsg = responseMessage.length > 100 ? responseMessage.substring(0, 97) + "..." : responseMessage;
            // Corrigindo a formatação da string de log
            console.log(`[${chatId}] Enviando resposta: "${logMsg.replace(/\n/g, '\\n')}"`);
        } else {
             console.log(`[${chatId}] Enviando resposta de tipo inesperado:`, responseMessage);
        }

        // Lógica de envio (agora dentro do if principal)
        try {
           // ... (código de retorno ou preparação para envio)
           return responseMessage; // Retorna a string ou o array
        } catch (sendError) {
             console.error(`[${chatId}] Erro CRÍTICO ao preparar mensagem para envio:`, sendError);
             return null; // Indica que não houve envio
        }
    }
}

module.exports = {
    handleIncomingMessage,
};