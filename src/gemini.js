// --- gemini.js ---
// Gerencia a configuracao e interacao com a API Google Generative AI (Gemini)

const { GoogleGenerativeAI } = require("@google/generative-ai");
const { GOOGLE_AI_API_KEY, SAFETY_SETTINGS } = require('../config');

let genAI; // Cliente Google AI
let model; // Modelo Gemini
let isGoogleAiAvailable = false;

// --- Interacao com Google AI (Gemini) ---

function setupGoogleAI() {
    if (!GOOGLE_AI_API_KEY) {
        console.warn("!!! ATENÇÃO: Chave da API GOOGLE_AI não configurada no .env. Funcionalidades de IA estarão desabilitadas. !!!");
        isGoogleAiAvailable = false;
        return false;
    }
    try {
        genAI = new GoogleGenerativeAI(GOOGLE_AI_API_KEY);
        model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest", safetySettings: SAFETY_SETTINGS });
        console.log("Cliente Google AI (Gemini) configurado com sucesso usando safetySettings.");
        isGoogleAiAvailable = true;
        return true;
    } catch (error) {
        console.error("Erro Crítico ao configurar o Google AI (Gemini):", error);
        isGoogleAiAvailable = false;
        return false;
    }
}

function checkGoogleAiAvailability() {
    return isGoogleAiAvailable && model;
}

async function analyzeMessageWithGemini(userMessage, context = null) {
    if (!checkGoogleAiAvailability()) {
        console.warn("Tentativa de usar Gemini, mas não está disponível/configurado.");
        return { intent: 'unknown', error: 'LLM not configured or unavailable' };
    }

    // Prompt Mesclado com instrucoes refinadas para follow-up
    const prompt = `
Você é FinanceBot, um assistente financeiro pessoal para WhatsApp, amigável e prestativo. Seu objetivo é ajudar o usuário a registrar gastos, ver relatórios, dar dicas de economia personalizadas e pesquisar informações financeiras.

**Contexto da conversa anterior (se aplicável):**
${context ? `O bot perguntou sobre: ${context.waitingFor}. Dados já coletados: ${JSON.stringify(context.tempData)}. Último tópico pesquisado: ${context.lastResearchTopic || 'Nenhum'}` : "Nenhum contexto específico."}

**Intenções possíveis:**
- 'register_expense'
- 'request_report'
- 'request_advice'
- 'request_research'
- 'request_receipt'
- 'provide_info'
- 'confirm_action'
- 'cancel_action'
- 'greeting'
- 'chit_chat' (inclui desabafos, perguntas vagas)
- 'unknown'

**Entidades a extrair:**
- value, category, establishment, payment_method, item, notes, date (p/ 'register_expense')
- report_period ('month', 'today', 'yesterday', 'all'. Default 'month')
- advice_topic (p/ 'request_advice')
- research_query (p/ 'request_research', *SE FOR UM NOVO TÓPICO*)
- search_criteria (objeto com {item?, value?, date?, establishment?, category?} p/ 'request_receipt')
- confirmation (p/ 'confirm_action'/'cancel_action')
- provided_field (p/ 'provide_info', use snake_case p/ payment_method).
- provided_value (p/ 'provide_info').

**Instruções:**
1.  Se houver contexto ('waitingFor'), priorize FORTEMENTE 'provide_info', 'confirm_action', ou 'cancel_action'. Se 'waitingFor' = um nome de campo específico (ex: 'value', 'item', 'establishment', 'payment_method'), a intenção mais provável é 'provide_info' com 'provided_field' igual ao campo esperado, a menos que a mensagem seja claramente "sim"/"não"/"cancela".
2.  Se 'waitingFor' = 'notes_confirmation', interprete "sim" ou variações como 'confirm_action', e "não" ou variações como 'cancel_action' (que será tratado especialmente no código para não cancelar tudo). Qualquer outro texto direto DEVE ser 'provide_info' com 'provided_field'='notes'.
3.  Se 'waitingFor' = 'notes', a intenção é **SEMPRE** 'provide_info' com 'provided_field'='notes' e 'provided_value'=mensagem_completa, a menos que seja cancelamento claro.
4.  Se NÃO houver 'waitingFor' E houver 'lastResearchTopic' E a mensagem parecer um pedido de refinamento (ex: "explique melhor", "mais técnico", "e os cálculos?"), a intenção é 'request_research', mas **NÃO extraia** 'research_query' (retorne null para ele).
5.  Para 'register_expense', extraia os campos OBRIGATÓRIOS ('value', 'item', 'payment_method'). Retorne null para os não encontrados. Tente os outros ('category', 'establishment', 'date', 'notes'). Padronize 'category' para 'Outros' se não encontrada.
6.  Para 'request_receipt', extraia o máximo de detalhes possíveis sobre a despesa (item, valor, data, local, categoria) para o objeto 'search_criteria'.
7.  Para 'request_advice' e 'request_research' (novos tópicos), extraia os tópicos/queries.
8.  Para 'greeting' e 'chit_chat' (sem contexto de follow-up de pesquisa), **APENAS** retorne a intenção.
9.  Responda APENAS com um objeto JSON válido, sem usar markdown (\`\`\`json ... \`\`\`).

**Exemplos:**

Contexto: { waitingFor: null, lastResearchTopic: "Inflação" }
Mensagem: "me dá uma explicação mais técnica"
Resposta JSON: {"intent": "request_research", "research_query": null}

Contexto: Nenhum
Mensagem: "eu ganho pouco e gasto mt com aposta"
Resposta JSON: {"intent": "chit_chat"}

Contexto: { waitingFor: "notes", tempData: {...} }
Mensagem: "Comprei no cartão Renner"
Resposta JSON: {"intent": "provide_info", "provided_field": "notes", "provided_value": "Comprei no cartão Renner"}

Contexto: Nenhum
Mensagem: "Me mostra o comprovante daquela compra na padaria de ontem"
Resposta JSON: {"intent": "request_receipt", "search_criteria": {"establishment": "padaria", "date": "yesterday"}}

Contexto: Nenhum
Mensagem: "Quero o recibo do item 'doces' de 640 reais"
Resposta JSON: {"intent": "request_receipt", "search_criteria": {"item": "doces", "value": 640}}

Contexto: { waitingFor: "item", tempData: {...} }
Mensagem: "Cigarro"
Resposta JSON: {"intent": "provide_info", "provided_field": "item", "provided_value": "Cigarro"}

**Mensagem do Usuário:** "${userMessage}"
**Resposta JSON:**
`;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;

        // Verifica se a resposta foi bloqueada
        if (response.promptFeedback?.blockReason) {
            console.warn(`Resposta da LLM bloqueada: ${response.promptFeedback.blockReason}. Detalhes:`, response.promptFeedback);
            return { intent: 'unknown', error: `Blocked: ${response.promptFeedback.blockReason}` };
        }

        // Verifica se a funcao text() existe e e uma funcao
        if (typeof response.text !== 'function') {
            console.error("Resposta da LLM inválida ou incompleta:", response);
            throw new Error("Formato de resposta da LLM inesperado.");
        }

        const text = response.text();
        console.log("LLM Raw Response:", text);

        // Limpeza basica (remove markdown e espacos extras)
        const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();

        // Tenta parsear o JSON
        const parsed = JSON.parse(cleaned);
        console.log("LLM Parsed Data:", parsed);
        return parsed;

    } catch (error) {
        console.error("Erro ao chamar ou processar resposta da Gemini API:", error);
        // Inclui a resposta crua no erro, se possivel, para depuracao
        const rawResponse = error.response ? error.response.text() : (error.message || "Erro desconhecido na API");
        return { intent: 'unknown', error: 'LLM API call failed or invalid JSON response', raw_response: rawResponse };
    }
}


async function generateConversationalResponse(userMessage, intent = 'chit_chat', isNewConversation = false) {
    if (!checkGoogleAiAvailability()) return "Desculpe, não consigo conversar agora (IA indisponível).";

    let promptInstruction = "";
    if (isNewConversation || intent === 'greeting') {
        promptInstruction = "O usuário iniciou a conversa ou enviou uma saudação. Cumprimente de forma CURTA e AMIGÁVEL, perguntando como você pode ajudar com as finanças dele HOJE. Use um emoji apropriado (ex: 👋,💰). EVITE perguntar 'tudo bem?'.";
    } else if (intent === 'chit_chat') {
        promptInstruction = `O usuário enviou uma mensagem de conversa geral (chit_chat): "${userMessage}". Responda com EMPATIA e de forma CONVERSACIONAL. Se parecer um desabafo financeiro (ex: "ganho pouco", "gasto muito com X"), mostre compreensão (ex: _"Nossa, imagino como é..."_), valide o sentimento, e PERGUNTE DELICADAMENTE se ele gostaria de algumas dicas sobre como lidar com isso (ex: _"Quer conversar um pouco sobre estratégias para lidar com X?"_ ou _"Gostaria de algumas dicas sobre organização financeira?"_). Se for uma pergunta sobre suas capacidades, explique brevemente o que você faz (registrar gastos, relatórios, dicas, pesquisas). Se for um agradecimento, responda com um simples "De nada! 😊" ou similar. Use emojis para manter o tom leve. Não comece a resposta com "Oi, tudo bem?", a menos que a mensagem do usuário indique claramente que ele está mal (nesse caso, mostre empatia e pergunte se ele está bem antes de continuar).`;
    } else if (intent === 'cancel_action'){
        promptInstruction = `O usuário cancelou a ação atual. Responda de forma CURTA e compreensiva (ex: "Ok, cancelado! 👍", "Entendido, sem problemas.", "Cancelado."). Use um emoji positivo ou neutro.`;
    } else if (intent === 'unknown') {
         promptInstruction = `O usuário enviou algo que você não entendeu: "${userMessage}". Peça desculpas CURTAMENTE e diga que não compreendeu. Sugira que ele tente reformular ou pergunte se pode ajudar com registro de gastos, relatórios ou dicas. Ex: "Desculpe, não entendi direito 🤔. Poderia tentar dizer de outra forma? Posso ajudar a registrar gastos, ver relatórios ou dar dicas financeiras!".`;
    }
    else { // Fallback para outras intencoes nao cobertas explicitamente aqui
        promptInstruction = `Responda de forma CURTA, AMIGÁVEL e NATURAL à mensagem do usuário: "${userMessage}", considerando a intenção ${intent}.`;
    }

    const prompt = `Você é FinanceBot, um assistente financeiro para WhatsApp. Seu tom é amigável, prestativo e informal.
${promptInstruction}

Responda de forma Curta e Natural (use formatação WhatsApp como *negrito* ou _itálico_ quando apropriado):`;

    try {
        const result = await model.generateContent(prompt);
        const response = result.response;
        if (response.promptFeedback?.blockReason) {
            console.warn(`Resposta conversacional bloqueada: ${response.promptFeedback.blockReason}`);
            return "Hmm, sobre isso prefiro não comentar. Mas posso ajudar com suas finanças!"; // Resposta segura
        }
        return response.text() || "Legal! 😊 Em que mais posso te ajudar com suas finanças?"; // Fallback
    } catch (error) {
        console.error("Erro ao gerar resposta conversacional:", error);
        return "Opa! Algo deu errado aqui. 😅 Tente novamente em um instante."; // Mensagem de erro generica
    }
}


async function generateSpendingAdvice(spendingData, userContextMessage = null) {
    if (!checkGoogleAiAvailability()) return "Não consigo analisar ou dar conselhos agora (IA indisponível).";

    // Cenario 1: Sem dados de gastos registrados
    if (!spendingData || spendingData.length === 0) {
        console.log("Gerando conselho financeiro sem dados de gastos. Contexto do usuário:", userContextMessage);
        const promptNoData = `Você é FinanceBot, um consultor financeiro *responsável*, *empático* e *cuidadoso*. O usuário pediu conselhos financeiros ${userContextMessage ? `relacionados a: "${userContextMessage}"` : '(pedido geral)'}, mas ele ainda não possui gastos registrados no sistema.

Instruções:
1.  Responda de forma AMIGÁVEL e COMPREENSIVA. Valide o sentimento ou a preocupação expressa na mensagem do usuário (se houver contexto).
2.  Explique CLARAMENTE que as dicas mais *personalizadas* e eficazes são baseadas nos hábitos de gastos reais, e incentive-o a começar a registrar as despesas usando o bot.
3.  Mesmo sem dados, ofereça 1 ou 2 conselhos *GERAIS*, *PRÁTICOS* e *SEGUROS* sobre o tópico mencionado no contexto (se houver) OU sobre organização financeira básica (ex: anotar gastos, criar um orçamento simples).
4.  **MUITA ATENÇÃO**: Se o contexto mencionar comportamentos de risco (ex: apostas, dívidas excessivas, investimentos duvidosos), **NÃO DÊ CONSELHOS DIRETOS** sobre como fazer isso melhor. Em vez disso, ACONSELHE *FORTEMENTE CONTRA*, mencione os *RISCOS* (perda financeira, vício, ilegalidade), e sugira GENTILMENTE buscar *AJUDA PROFISSIONAL* (terapeuta financeiro, grupos de apoio, órgãos de defesa do consumidor). Seja empático, mas firme na recomendação de cautela e busca por suporte qualificado. NÃO minimize os riscos.
5.  Finalize perguntando se ele gostaria de começar a registrar um gasto agora ou se quer detalhar mais a situação para receber dicas gerais.
6.  Use formatação WhatsApp (*negrito*, _itálico_) para destacar pontos importantes. Mantenha a resposta concisa.

Resposta (use formatação WhatsApp):`;
         try {
            const result = await model.generateContent(promptNoData);
            const response = result.response;
            if (response.promptFeedback?.blockReason) { return "Para te ajudar melhor, preciso entender seus gastos e objetivos. Que tal começar registrando suas despesas?"; }
            return response.text() || "Adoraria te ajudar com conselhos! 😊 Para dicas personalizadas, o ideal é conhecer seus gastos. Que tal começar a registrá-los? Ou me conta mais sobre o que você precisa!";
         } catch (error) {
            console.error("Erro ao gerar conselho (sem dados):", error);
            return "Para te ajudar de forma eficaz, preciso conhecer um pouco dos seus hábitos de gastos. Comece a registrar suas despesas comigo!";
         }
    }

    // Cenario 2: Com dados de gastos
    let dataString = "Gastos recentes por categoria (valores agregados):\n";
    spendingData.forEach(item => {
        dataString += `- ${item.category}: R$ ${item.total.toFixed(2).replace('.', ',')}\n`; // Formata para Real
    });

    console.log("Gerando conselho financeiro com dados. Contexto:", userContextMessage);
    const promptWithData = `Você é FinanceBot, um consultor financeiro *responsável*, *empático* e *cuidadoso*. O usuário pediu conselhos financeiros ${userContextMessage ? `Contexto do pedido: "${userContextMessage}"` : "(Pedido geral)"}. Analise os dados de gastos fornecidos e o contexto do pedido.

Dados de Gastos do Usuário:
${dataString}

Instruções:
1.  Analise os dados: Identifique as 2-3 categorias com maiores gastos ou categorias relevantes para o contexto do pedido (se houver).
2.  Dê 2 ou 3 dicas *PRÁTICAS*, *ACIONÁVEIS* e *REALISTAS* focadas nessas categorias principais ou no tópico específico mencionado pelo usuário. As dicas devem ser claras e fáceis de implementar (ex: "Que tal tentar reduzir X em 10%?" ou "Já pesquisou alternativas mais baratas para Y?").
3.  Seja *positivo* e *encorajador*, não julgador.
4.  **MUITA ATENÇÃO**: Se o contexto do usuário OU os dados de gastos indicarem comportamentos de risco (ex: categorias como "Apostas", "Jogos de Azar", ou menção a dívidas altas, empréstimos duvidosos), aborde o tema com *EXTREMO CUIDADO*.
    *   NÃO incentive ou dê dicas para "melhorar" o comportamento de risco.
    *   EXPLIQUE os *RISCOS* associados (perda financeira significativa, vício, impacto na saúde mental/relacionamentos).
    *   SUGIRA *FORTEMENTE* a busca por *AJUDA PROFISSIONAL* especializada (terapeuta financeiro, psicólogo, grupos de apoio como Jogadores Anônimos, renegociação de dívidas com bancos/órgãos oficiais).
    *   Ofereça apoio para organizar as *outras* finanças, mas seja claro sobre os limites do bot em lidar com situações complexas ou de risco.
5.  Use formatação WhatsApp (*negrito*, _itálico_) para destacar conselhos e informações importantes. Mantenha a resposta útil e direta.
6.  Finalize de forma amigável, talvez perguntando se as dicas fazem sentido ou se ele quer focar em algo específico.

Sugestões Curtas, Práticas e Responsáveis (use formatação WhatsApp):`;

    try {
        const result = await model.generateContent(promptWithData);
        const response = result.response;
        if (response.promptFeedback?.blockReason) { return "Analisei seus dados, mas não consigo gerar sugestões específicas neste momento. Posso tentar ajudar com algo mais geral?"; }
        return response.text() || "Dei uma olhada nos seus gastos! Baseado nisso, aqui vão algumas ideias que podem te ajudar...";
    } catch (error) {
        console.error("Erro ao gerar conselhos (com dados):", error);
        return "Tive um problema ao analisar seus dados para gerar conselhos. 😥";
    }
}

/**
 * Gera uma resposta de pesquisa/explicacao usando Gemini, lidando com refinamentos.
 * @param {string} topic - O topico principal da pesquisa.
 * @param {string|null} [refinementRequest=null] - O pedido de refinamento do usuario (ex: "explique melhor", "mais exemplos").
 * @returns {Promise<string>} - A resposta gerada pela LLM.
 */
async function generateResearchResponse(topic, refinementRequest = null) {
    if (!checkGoogleAiAvailability()) return "Desculpe, minha função de pesquisa está indisponível agora.";
    console.log(`Gerando resposta de pesquisa/refinamento para: "${topic}" ${refinementRequest ? `(Refinamento solicitado: "${refinementRequest}")` : '(Primeira consulta)'}`);

    let promptInstruction = "";
    if (refinementRequest) {
        // Instrucao para refinar a explicacao anterior sobre o 'topic'
        promptInstruction = `O usuário pediu um refinamento ou mais detalhes sobre o tópico financeiro "${topic}", com a seguinte solicitação: "${refinementRequest}".
Elabore uma nova resposta focando especificamente no pedido do usuário (ex: precisa de uma explicação mais técnica? mais simples? exemplos práticos? os cálculos envolvidos? prós e contras?).
Use seu conhecimento financeiro para fornecer informações precisas e úteis sobre "${topic}", adaptadas ao pedido de refinamento.
Seja claro, objetivo e use formatação WhatsApp (*negrito*, _itálico_) para melhorar a legibilidade.`;
    } else {
        // Instrução para a primeira explicacao sobre o 'topic'
        promptInstruction = `O usuário pediu para pesquisar ou explicar sobre o tópico financeiro "${topic}".
Forneça uma explicação clara, concisa e precisa sobre "${topic}", usando seu conhecimento financeiro.
Se for um conceito, defina-o. Se for um produto/serviço, explique como funciona, principais características, vantagens e desvantagens (se aplicável).
Se for um tópico que envolve dados muito voláteis (ex: cotação de ações, taxas de juros atuais), explique o conceito, mas mencione que os valores mudam constantemente e sugira consultar fontes financeiras atualizadas para dados em tempo real.
Use formatação WhatsApp (*negrito*, _itálico_) para destacar termos chave ou informações importantes.`;
    }

    const prompt = `Você é FinanceBot, um assistente financeiro prestativo e com bons conhecimentos sobre finanças pessoais, investimentos básicos e economia.
${promptInstruction}

Resposta Detalhada e Clara (use formatação WhatsApp):`;
    try {
        const result = await model.generateContent(prompt);
        const response = result.response;
        if (response.promptFeedback?.blockReason) {
             console.warn(`Pesquisa sobre "${topic}" bloqueada: ${response.promptFeedback.blockReason}`);
             return `Hmm, não consigo fornecer detalhes sobre "${topic}" especificamente ${refinementRequest ? 'com esse refinamento' : ''}. Talvez eu possa ajudar com outro tópico financeiro? 😅`;
        }
        return response.text() || `Tentei pesquisar sobre "${topic}", mas não consegui encontrar uma resposta clara no momento.`;
    } catch (error) {
        console.error(`Erro ao gerar resposta de pesquisa para "${topic}":`, error);
        return `Ocorreu um erro ao tentar pesquisar ou detalhar informações sobre "${topic}". Por favor, tente novamente mais tarde.`;
    }
}

module.exports = {
    setupGoogleAI,
    checkGoogleAiAvailability,
    analyzeMessageWithGemini,
    generateConversationalResponse,
    generateSpendingAdvice,
    generateResearchResponse,
};