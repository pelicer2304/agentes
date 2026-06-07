#!/bin/bash
# Script para testar 15 conversas com o Assistente Decodifica
# Cada conversa simula um cenário diferente

API="http://localhost:3001"
OUTPUT="docs/teste-15-conversas.md"

echo "# Teste de 15 Conversas — $(date '+%d/%m/%Y %H:%M')" > $OUTPUT
echo "" >> $OUTPUT
echo "> Teste automatizado das novas regras comportamentais" >> $OUTPUT
echo "" >> $OUTPUT

send_msg() {
  local conv_id=$1
  local msg=$2
  local response=$(curl -s -X POST "$API/playground/conversations/$conv_id/messages" \
    -H "Content-Type: application/json" \
    -d "{\"content\": \"$msg\"}")
  echo "$response" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get('message', {}).get('content', 'ERRO: sem resposta'))
except:
    print('ERRO: resposta inválida')
" 2>/dev/null
}

create_conv() {
  curl -s -X POST "$API/playground/conversations" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(d['id'])
" 2>/dev/null
}

run_conversation() {
  local num=$1
  local title=$2
  shift 2
  local messages=("$@")
  
  echo "---" >> $OUTPUT
  echo "" >> $OUTPUT
  echo "## Conversa $num: $title" >> $OUTPUT
  echo "" >> $OUTPUT
  
  local conv_id=$(create_conv)
  echo "Conv ID: $conv_id" >> $OUTPUT
  echo "" >> $OUTPUT
  
  for msg in "${messages[@]}"; do
    echo "**Cliente:** $msg" >> $OUTPUT
    echo "" >> $OUTPUT
    local reply=$(send_msg "$conv_id" "$msg")
    echo "**Assistente:** $reply" >> $OUTPUT
    echo "" >> $OUTPUT
    sleep 2
  done
}

echo "Iniciando testes..."

# Conversa 1: Clínica - agendamento
echo "Conversa 1..."
run_conversation 1 "Clínica - agendamento" \
  "Oi, tenho uma clínica e quero automatizar agendamento" \
  "Recebo umas 50 mensagens por dia pedindo horário" \
  "Uso Google Calendar" \
  "Sou o dono da clínica" \
  "Sim, quero falar com a equipe"

# Conversa 2: Loja moda íntima
echo "Conversa 2..."
run_conversation 2 "Loja moda íntima - vendas" \
  "Tenho loja de lingerie e vendo pelo WhatsApp" \
  "As clientes perguntam tamanho, cor e preço o dia todo" \
  "Respondo sozinha e demoro muito" \
  "Quanto custa?" \
  "Mas me dá uma faixa de preço pelo menos"

# Conversa 3: Preço direto
echo "Conversa 3..."
run_conversation 3 "Cliente quer preço direto" \
  "Quanto custa um chatbot?" \
  "Não quero contar minha vida, só o preço" \
  "Me dá uma faixa então"

# Conversa 4: Restaurante delivery
echo "Conversa 4..."
run_conversation 4 "Restaurante delivery" \
  "Tenho restaurante e recebo pedido pelo WhatsApp" \
  "Minha esposa responde mas não dá conta no pico" \
  "Uns 80 pedidos por dia" \
  "Quero automatizar tudo" \
  "Pode encaminhar pra equipe"

# Conversa 5: Imobiliária
echo "Conversa 5..."
run_conversation 5 "Imobiliária - qualificação" \
  "Sou corretor e recebo leads de portais" \
  "Uns 20 por dia mas metade não tem perfil" \
  "Trabalho sozinho" \
  "Quero falar com alguém sobre proposta"

# Conversa 6: IA substitui humano?
echo "Conversa 6..."
run_conversation 6 "Preocupação com IA" \
  "A IA vai substituir meus atendentes?" \
  "Tenho escola de idiomas" \
  "Minha preocupação é a IA errar" \
  "Como vocês garantem que não vai falar besteira?"

# Conversa 7: Integração com sistema
echo "Conversa 7..."
run_conversation 7 "Integração com ERP" \
  "Vocês integram com qualquer sistema?" \
  "Tenho ERP próprio, e-commerce de eletrônicos" \
  "200 mensagens de suporte por dia" \
  "Quanto tempo leva pra implementar?" \
  "Ok, pode encaminhar"

# Conversa 8: Não sabe o que quer
echo "Conversa 8..."
run_conversation 8 "Cliente indeciso" \
  "Oi, queria saber mais sobre o que vocês fazem" \
  "Tenho consultoria de RH, não sei se preciso de automação" \
  "Respondo dúvidas de candidatos e agendo entrevistas" \
  "Agendamento me toma mais tempo" \
  "Não sei se tenho budget agora"

# Conversa 9: Desistente
echo "Conversa 9..."
run_conversation 9 "Cliente desistente" \
  "Quanto custa?" \
  "Não quero diagnóstico, só preço" \
  "Deixa pra lá então"

# Conversa 10: Pronto pra humano
echo "Conversa 10..."
run_conversation 10 "Pronto para humano" \
  "Quero falar com alguém da equipe sobre um projeto" \
  "Já sei o que preciso, quero proposta"

# Conversa 11: Etiquetas - orçamento
echo "Conversa 11..."
run_conversation 11 "Fábrica de etiquetas" \
  "Fabricamos etiquetas adesivas e o WhatsApp é nosso canal de vendas" \
  "Os vendedores perdem tempo coletando especificações" \
  "Sempre perguntamos material, medida, quantidade, cor e acabamento" \
  "Uns 25 orçamentos por dia" \
  "Sou gestor comercial, preciso aprovar com diretor"

# Conversa 12: Pet shop
echo "Conversa 12..."
run_conversation 12 "Pet shop" \
  "Tenho pet shop e recebo muita pergunta sobre banho e tosa" \
  "Horários disponíveis, preço do banho, se aceita gato" \
  "Umas 30 mensagens por dia" \
  "Quero automatizar isso"

# Conversa 13: Advogado
echo "Conversa 13..."
run_conversation 13 "Escritório de advocacia" \
  "Tenho escritório de advocacia e recebo consultas pelo WhatsApp" \
  "Preciso filtrar quem realmente precisa de advogado" \
  "Uns 10 contatos por dia mas gasto 1h respondendo" \
  "Sou sócio do escritório" \
  "Quero entender melhor como funciona"

# Conversa 14: Academia
echo "Conversa 14..."
run_conversation 14 "Academia" \
  "Tenho academia e o WhatsApp é pra matrículas e dúvidas" \
  "Horários de aula, preço de planos, se tem estacionamento" \
  "Umas 40 mensagens" \
  "Quanto custa mais ou menos?" \
  "Tá, pode encaminhar"

# Conversa 15: Contabilidade
echo "Conversa 15..."
run_conversation 15 "Contabilidade" \
  "Tenho escritório de contabilidade" \
  "Clientes mandam documentos e perguntas sobre impostos pelo WhatsApp" \
  "É muita coisa repetida, sempre as mesmas dúvidas sobre prazo de entrega" \
  "Uns 50 clientes ativos mandando mensagem toda semana" \
  "Pode me encaminhar pra equipe"

echo "" >> $OUTPUT
echo "---" >> $OUTPUT
echo "Teste concluído em $(date '+%H:%M')" >> $OUTPUT

echo ""
echo "=== TESTE CONCLUÍDO ==="
echo "Resultado salvo em: $OUTPUT"
