/**
 * Script de teste automatizado - Simula 15 conversas com o Assistente Decodifica
 * Roda contra a API local (localhost:3001)
 * 
 * Uso: npx ts-node scripts/test-conversations.ts
 */

import axios from 'axios';
import * as fs from 'fs';

const API_URL = 'http://localhost:3001';

interface ConversationScenario {
  name: string;
  messages: string[];
}

const scenarios: ConversationScenario[] = [
  {
    name: '1. Clínica - Agendamento',
    messages: [
      'Oi, boa tarde',
      'Tenho uma clínica odontológica e recebo muita mensagem no WhatsApp pra marcar consulta',
      'Uma recepcionista, mas ela não dá conta. Às vezes demora horas pra responder',
      'Umas 50 por dia',
      'Uso o Dental Office',
      'Sim, pode encaminhar',
      'Sim',
    ],
  },
  {
    name: '2. Moda Íntima - Vendas',
    messages: [
      'Oi, vi que vocês fazem automação pra WhatsApp',
      'Tenho uma loja de moda íntima. Vendo pelo Instagram e WhatsApp. As clientes perguntam tamanho, cor, preço',
      'Eu respondo sozinha e às vezes demoro muito. A cliente desiste',
      'Umas 30 a 40 por dia',
      'Quanto custa?',
      'Já contei tudo. Quero saber o preço mesmo',
    ],
  },
  {
    name: '3. Etiquetas - Orçamento',
    messages: [
      'Boa tarde, quero saber sobre automação',
      'Fabricamos etiquetas adesivas. O WhatsApp é nosso principal canal. O cliente manda especificações e fazemos orçamento',
      'Os vendedores perdem muito tempo perguntando as mesmas coisas',
      'Sempre perguntamos: material, medida, quantidade, cor, acabamento e prazo',
      'Uns 20 a 30 orçamentos por dia',
      'Sou o gestor comercial',
      'Pode encaminhar sim',
    ],
  },
  {
    name: '4. Restaurante - Pedidos',
    messages: [
      'E aí, vocês fazem chatbot?',
      'Tenho um restaurante e recebo pedido pelo WhatsApp. É uma loucura',
      'Minha esposa fica respondendo mas no horário de pico não dá conta',
      'Uns 60 a 80 pedidos por dia',
      'Tenho um PDF do cardápio',
      'Quanto custa?',
      'Tá bom, manda',
    ],
  },
  {
    name: '5. Imobiliária - Qualificação',
    messages: [
      'Oi, preciso de ajuda com atendimento no WhatsApp',
      'Sou corretor. Recebo leads dos portais e não consigo responder todos rápido',
      'Uns 15 a 20 por dia, mas metade não tem perfil',
      'Trabalho sozinho',
      'Sim, quero',
      'Sim, pode encaminhar',
    ],
  },
  {
    name: '6. Preço logo no começo',
    messages: [
      'Quanto custa um chatbot?',
      'Não quero contar minha vida. Só quero saber o preço',
      'Me dá uma faixa de preço pelo menos',
      'Deixa pra lá então',
    ],
  },
  {
    name: '7. IA substitui humano?',
    messages: [
      'Se eu colocar IA no meu WhatsApp, ela vai substituir meus atendentes?',
      'Tenho uma escola de idiomas. Meus atendentes fazem matrícula e tiram dúvidas',
      'Umas 40 mensagens por dia. Minha preocupação é a IA errar',
      'Sim, quero entender melhor como funciona',
      'Tá, pode encaminhar',
    ],
  },
  {
    name: '8. Integração com sistema',
    messages: [
      'Vocês conseguem integrar com qualquer sistema?',
      'Tenho um ERP próprio. Queria que o chatbot puxasse dados de lá',
      'E-commerce de eletrônicos. Cliente pergunta status do pedido, prazo, troca',
      'Umas 200 mensagens por dia',
      'Sou o dono',
      'Quanto tempo leva pra implementar?',
      'Ok, pode encaminhar',
    ],
  },
  {
    name: '9. Não sabe o que quer',
    messages: [
      'Oi, queria saber mais sobre o que vocês fazem',
      'Tenho uma consultoria de RH. Uso WhatsApp pra falar com clientes mas não sei se preciso de automação',
      'Respondo dúvidas de candidatos, mando links de vagas, agendo entrevistas',
      'Agendamento, com certeza. Fico indo e voltando pra achar horário',
      'Uso Google Calendar',
      'Sim, mas não sei se tenho budget pra isso agora',
      'Pode ser, vamos ver',
    ],
  },
  {
    name: '10. Pronto pra humano',
    messages: [
      'Quero falar com alguém da equipe sobre um projeto de automação',
      'Já sei o que quero. Preciso de um chatbot para minha clínica veterinária. Quero proposta',
    ],
  },
  {
    name: '11. Pet Shop - Agendamento banho',
    messages: [
      'Oi',
      'Tenho um pet shop e recebo muita mensagem pra agendar banho e tosa',
      'Eu mesma respondo, mas perco muito tempo confirmando horário',
      'Umas 25 por dia',
      'Sou a dona',
      'Quero sim, pode encaminhar',
    ],
  },
  {
    name: '12. Advogado - Triagem',
    messages: [
      'Boa tarde',
      'Sou advogado e recebo muitas consultas pelo WhatsApp. Preciso filtrar quem realmente precisa de atendimento',
      'Hoje eu mesmo respondo tudo. Perco tempo com curiosos',
      'Umas 10 a 15 por dia, mas gasto 2h respondendo',
      'Sim, sou eu que decido',
      'Pode encaminhar',
    ],
  },
  {
    name: '13. Academia - Matrículas',
    messages: [
      'Vocês fazem automação pra academia?',
      'Tenho uma academia e recebo muita pergunta sobre planos, horários e matrícula',
      'A recepcionista responde mas demora. O pessoal desiste e vai pra concorrente',
      'Umas 30 mensagens por dia',
      'Quanto custa mais ou menos?',
      'Tá, pode encaminhar pra equipe',
    ],
  },
  {
    name: '14. Contabilidade - Dúvidas',
    messages: [
      'Oi, quero automatizar o atendimento do meu escritório',
      'Escritório de contabilidade. Clientes perguntam sobre prazos, documentos, impostos',
      'Minha secretária responde mas são sempre as mesmas perguntas',
      'Umas 20 por dia, sempre as mesmas 5 perguntas',
      'Sou o sócio fundador',
      'Sim, quero uma proposta',
    ],
  },
  {
    name: '15. Desistente frustrado',
    messages: [
      'Oi',
      'Quero saber o preço',
      'Cara, só me diz quanto custa. Não tenho tempo pra ficar respondendo pergunta',
      'Esquece, vou procurar outro fornecedor',
    ],
  },
];

async function createConversation(): Promise<string> {
  const { data } = await axios.post(`${API_URL}/playground/conversations`);
  return data.id;
}

async function sendMessage(conversationId: string, content: string): Promise<any> {
  const { data } = await axios.post(
    `${API_URL}/playground/conversations/${conversationId}/messages`,
    { content }
  );
  return data;
}

async function runScenario(scenario: ConversationScenario): Promise<string> {
  const lines: string[] = [];
  lines.push(`## ${scenario.name}\n`);

  try {
    const conversationId = await createConversation();
    lines.push(`> Conversa criada: ${conversationId}\n`);

    // Get initial greeting
    const { data: conv } = await axios.get(`${API_URL}/playground/conversations/${conversationId}`);
    const greeting = conv.messages?.[0]?.content || 'Sem saudação';
    lines.push(`**Assistente:** ${greeting}\n`);

    for (const msg of scenario.messages) {
      lines.push(`**Cliente:** ${msg}\n`);

      try {
        const startTime = Date.now();
        const response = await sendMessage(conversationId, msg);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const reply = response.message?.content || 'Sem resposta';
        const qual = response.qualification;

        lines.push(`**Assistente:** ${reply} _(${elapsed}s)_\n`);
        lines.push(`> Score: ${qual?.leadScore || 0} | Temp: ${qual?.temperature || '-'} | Status: ${qual?.status || '-'} | Handoff: ${qual?.shouldHandoff || false}\n`);
      } catch (err: any) {
        lines.push(`**ERRO:** ${err.response?.data?.message || err.message}\n`);
      }
    }
  } catch (err: any) {
    lines.push(`**ERRO ao criar conversa:** ${err.message}\n`);
  }

  lines.push('\n---\n');
  return lines.join('\n');
}

async function main() {
  console.log('🚀 Iniciando testes de conversa...\n');
  console.log(`API: ${API_URL}`);
  console.log(`Cenários: ${scenarios.length}\n`);

  // Check if API is running
  try {
    await axios.get(`${API_URL}/`);
  } catch {
    console.error('❌ API não está rodando em localhost:3001. Inicie a API primeiro.');
    process.exit(1);
  }

  const results: string[] = [];
  results.push('# Resultados dos Testes de Conversa\n');
  results.push(`Data: ${new Date().toISOString()}\n`);
  results.push(`Total de cenários: ${scenarios.length}\n\n---\n`);

  for (let i = 0; i < scenarios.length; i++) {
    const scenario = scenarios[i];
    console.log(`[${i + 1}/${scenarios.length}] ${scenario.name}...`);

    const result = await runScenario(scenario);
    results.push(result);

    // Small delay between scenarios to not overwhelm the API
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  const outputPath = './docs/resultados-testes.md';
  fs.writeFileSync(outputPath, results.join('\n'));
  console.log(`\n✅ Resultados salvos em: ${outputPath}`);
}

main().catch(console.error);
