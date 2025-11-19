// --- state.js ---
// Gerencia o estado da conversa para cada usuario

// Armazena o estado atual da interacao com cada usuario
// Formato: { chatId: { waitingFor: 'field' | 'advice_confirmation' | 'notes_confirmation', tempData: {...}, lastResearchTopic?: string } }
const conversationState = {};

// Armazena o timestamp da ultima mensagem recebida de cada usuario (para detectar novas conversas)
const lastMessageTimestamps = {};

function getState(chatId) {
    return conversationState[chatId];
}

function setState(chatId, newState) {
    if (newState) {
        conversationState[chatId] = newState;
    } else {
        // Se newState for null ou undefined, remove o estado
        delete conversationState[chatId];
        console.log(`Estado removido para ${chatId}.`);
    }
}

function updateState(chatId, updates) {
    if (!conversationState[chatId]) {
        conversationState[chatId] = {}; // Cria se nao existir
    }
    // Mescla as atualizacoes no estado existente
    conversationState[chatId] = { ...conversationState[chatId], ...updates };
}

function clearState(chatId) {
    delete conversationState[chatId];
    console.log(`Estado da conversa explicitamente limpo para ${chatId}.`);
}

function clearWaitingFor(chatId) {
     if (conversationState[chatId]) {
         delete conversationState[chatId].waitingFor;
     }
}

function clearTempData(chatId) {
     if (conversationState[chatId]) {
         delete conversationState[chatId].tempData;
     }
}
function clearLastResearchTopic(chatId){
    if (conversationState[chatId]) {
         delete conversationState[chatId].lastResearchTopic;
     }
}


function getLastMessageTimestamp(chatId) {
    return lastMessageTimestamps[chatId] || 0;
}

function setLastMessageTimestamp(chatId, timestamp) {
    lastMessageTimestamps[chatId] = timestamp;
}

module.exports = {
    getState,
    setState,
    updateState,
    clearState,
    clearWaitingFor,
    clearTempData,
    clearLastResearchTopic,
    getLastMessageTimestamp,
    setLastMessageTimestamp,
};