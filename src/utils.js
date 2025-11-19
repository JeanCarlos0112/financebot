// --- utils.js ---
// Funcoes utilitarias, como formatacao de strings para exibicao

function formatReport(expenses, period = 'month') {
    let periodText = 'Período não especificado';
    switch (period) {
        case 'month': periodText = 'Mês Atual'; break;
        case 'today': periodText = 'Hoje'; break;
        case 'yesterday': periodText = 'Ontem'; break;
        case 'all': periodText = 'Geral'; break;
        // Adicione outros períodos se necessário (ex: 'last_month')
        // case 'last_month': periodText = 'Mês Passado'; break;
        default: periodText = `Período (${period})`; // Fallback
    }

    if (!expenses || expenses.length === 0) {
        return `Nenhuma despesa encontrada para o período: *${periodText}*.`;
    }

    let report = `🧾 *Relatório de Despesas (${periodText})* 🧾\n\n`;
    let total = 0;

    expenses.forEach(exp => {
        let formattedDate = 'Data Inválida';
        try {
            // Assume que exp.expense_date está no formato 'YYYY-MM-DD'
            const dateParts = exp.expense_date.split('-');
            if (dateParts.length === 3) {
                formattedDate = `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}`; // DD/MM/YYYY
            }
        } catch (e) {
            console.warn("Erro ao formatar data da despesa:", exp.expense_date, e);
        }

        const formattedValue = (exp.value || 0).toFixed(2).replace('.', ',');
        const establishment = exp.establishment || 'N/A';
        const category = exp.category || 'N/A';
        const item = exp.item || 'N/A';
        const paymentMethod = exp.payment_method || 'N/A';
        const notes = exp.notes; // Pode ser null ou undefined
        const hasImage = exp.has_image || false;

        report += `*- Data:* ${formattedDate}\n`;
        report += `  *- Categoria:* ${category}\n`;
        report += `  *- Item:* ${item}\n`;
        report += `  *- Local:* ${establishment}\n`;
        report += `  *- Pagamento:* ${paymentMethod}\n`;
        if (notes) {
            report += `  *- Observações:* ${notes}\n`;
        }
        if (hasImage) {
            report += `  *- Comprovante:* [Imagem anexada]\n`;
        }
        report += `  *- Valor:* R$ ${formattedValue}\n\n`;

        total += (exp.value || 0);
    });

    report += `--------------------\n*Total (${periodText}):* R$ ${total.toFixed(2).replace('.', ',')}`;
    return report;
}


function formatExpenseSummary(expenseData, includeNotes = false) {
    if (!expenseData) return "Erro: Dados da despesa não fornecidos.";

    let summary = `*- Valor:* R$ ${(expenseData.value || 0).toFixed(2).replace('.', ',')}\n`;
    summary += `*- Categoria:* ${expenseData.category || 'N/A'}\n`;
    summary += `*- Item:* ${expenseData.item || 'N/A'}\n`;
    summary += `*- Local:* ${expenseData.establishment || 'N/A'}\n`;
    summary += `*- Pagamento:* ${expenseData.paymentMethod || 'N/A'}`;

    // Adiciona a data formatada, se disponivel
    if (expenseData.date && expenseData.date !== 'today') {
         try {
             const d = new Date(expenseData.date);
             if (!isNaN(d.getTime())) {
                 const formattedDate = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                 summary += `\n*- Data:* ${formattedDate}`;
             }
         } catch (e) { /* Ignora erro de data inválida no resumo */ }
    } else if (expenseData.date === 'today') {
         summary += `\n*- Data:* Hoje`;
    }


    if (includeNotes && expenseData.notes) {
        summary += `\n*- Observações:* ${expenseData.notes}`;
    }
    if (expenseData.has_image) {
        summary += `\n*- Comprovante:* [Imagem anexada]`;
    }
    return summary;
}

module.exports = {
    formatReport,
    formatExpenseSummary,
};