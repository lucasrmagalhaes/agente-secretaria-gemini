# Secretaria virtual

Agente de IA em TypeScript que conversa no terminal e atua como uma secretária: consulta a data, lista, cria, atualiza e apaga eventos no Google Calendar e lista ou envia e-mails. O modelo é o Gemini Flash, no plano gratuito do Google AI Studio. As ferramentas seguem o paradigma ReAct e, num segundo modo, saem do processo do agente e passam a viver num servidor MCP.

Este repositório acompanha os módulos 1 e 2 do curso [Criação de Agentes de IA do Zero](https://app.rocketseat.com.br/jornada/criacao-de-agentes-de-ia-do-zero/visao-geral), da Rocketseat. O módulo 1 monta a secretária, declara as ferramentas e faz o loop de chamadas encadeadas com histórico de chat. O módulo 2 move essas ferramentas para um servidor MCP e liga o Gemini nele com `mcpToTool`.

O projeto em código combina com o fluxo no-code em [n8n-agente-agenda-mcp](https://github.com/lucasrmagalhaes/n8n-agente-agenda-mcp). Lá a orquestração fica no n8n. Aqui a mesma ideia de secretária (agenda, e-mail e ferramentas padronizadas) está em Node, para estudar o loop ReAct e o protocolo MCP por dentro.

Tudo o que o projeto usa tem plano gratuito: Node, o SDK `@google/genai`, a API Gemini Flash sem faturamento, Google Calendar, Gmail e o SDK MCP. Não é necessário cartão nem conta de billing.

## Arquitetura

Há dois pontos de entrada. Os dois compartilham as mesmas ferramentas, os mesmos esquemas Zod e o mesmo prompt.

### Chat com loop ReAct (`npm run dev`)

```
Você (readline)
    |
    v
Histórico de mensagens
    |
    v
Gemini Flash
    |  functionCall (nome + argumentos)
    v
Loop ReAct
    |  valida com Zod e executa
    v
Google Calendar (OAuth) e e-mail (dry-run ou Gmail)
    |  functionResponse
    v
Gemini de novo, até não haver mais chamadas
    |
    v
Texto final no terminal
```

O modelo não executa código. Ele pede uma função. O processo local valida os argumentos, roda a função e devolve o resultado. Se a resposta ainda tiver chamadas, o loop continua. Foi assim que o curso encadeou "que eventos eu tenho hoje?": primeiro `getTodayDate`, depois `listEvents` com a data devolvida. Várias chamadas no mesmo turno (por exemplo dois `sendEmail`) rodam juntas e voltam numa única mensagem.

O nome de cada ferramenta no curso e o equivalente aqui:

| No curso | Neste repositório |
| --- | --- |
| getTodayDate | getTodayDate |
| getEvents | listEvents |
| scheduleEvent | createEvent |
| rescheduleEvent | updateEvent (também altera título, data, duração, descrição e convidados) |
| (não havia) | deleteEvent |
| getEmails | listEmails |
| sendEmail | sendEmail |

### Chat via MCP (`npm run dev:mcp`)

```
Você (readline)
    |
    v
Gemini Flash + mcpToTool
    |
    |  stdio, processo filho
    v
Servidor MCP (secretaria)
    |
    v
As mesmas ferramentas
```

O SDK do Google chama o servidor sozinho (automatic function calling). O cliente não precisa do mapa de funções. O servidor fala JSON-RPC pelo stdout. Por isso ele nunca usa `console.log`. Logs vão para o stderr (`MCP server funcionando`).

## Ferramentas

- `getTodayDate`: data, hora e dia da semana no fuso `CALENDAR_TIMEZONE`.
- `listEvents`: eventos de um dia (`AAAA-MM-DD`) no calendário indicado.
- `createEvent`: título, data, horário, duração, convidados e descrição. Não dispara convite do Google (`sendUpdates: none`). Para avisar alguém, o agente usa `sendEmail`.
- `updateEvent`: altera um evento pelo `id` retornado em `listEvents`.
- `deleteEvent`: apaga pelo `id`.
- `listEmails`: caixa de exemplo no dry-run, ou a caixa real no modo gmail.
- `sendEmail`: no dry-run só imprime. No modo gmail envia pela API.

Os argumentos passam por Zod antes da execução. Data, horário e e-mail fora do formato voltam como erro para o modelo, que pode pedir o dado de novo.

## Requisitos

- Node.js 20 ou superior
- Uma conta Google
- Projeto no Google Cloud **sem conta de faturamento**
- Chave de API do Gemini no plano gratuito (Google AI Studio, sem billing)

Não vincule um cartão. Calendar API e Gmail API funcionam no projeto pessoal dentro da cota gratuita. A chave do AI Studio também. Se a cota acabar, a chamada falha. Não ative pagamento para desbloquear o projeto.

## 1. Chave do Gemini

1. Abra o [Google AI Studio](https://aistudio.google.com/apikey) com sua conta Google.
2. Crie uma chave de API. Não adicione forma de pagamento.
3. Copie a chave para o `.env` (`GEMINI_API_KEY`).

O modelo padrão é `gemini-3.8-flash`. O id antigo `gemini-2.5-flash` responde 404 para contas novas. Se o Google aposentar o id atual, troque `GEMINI_MODEL` por outro Flash ainda listado como gratuito no AI Studio.

Quando a API responde 429 ou 503 (alta demanda), a chamada é repetida algumas vezes, com espera de 1s, 2s e 4s. O terminal mostra cada nova tentativa. Se ainda falhar e `GEMINI_FALLBACK_MODEL` estiver definido, a mesma sequência roda nesse modelo reserva. Outros erros, como um modelo inexistente, param na hora.

## 2. Projeto Google Cloud sem billing

1. Abra o [Google Cloud Console](https://console.cloud.google.com/).
2. Crie um projeto, por exemplo `secretaria-virtual`. Quando perguntar pela conta de faturamento, não vincule nenhuma. O projeto pode existir sem billing.
3. Em **APIs e serviços > Biblioteca**, ative **Google Calendar API**.
4. Ative **Gmail API** somente se for usar `EMAIL_MODE=gmail`. No dry-run (padrão) ela não é necessária.
5. Configure a tela de consentimento OAuth. No console atual isso fica em **Google Auth Platform** (ou, na interface antiga, **Tela de consentimento OAuth**):
   - Tipo de usuário: **Externo**.
   - Estado de publicação: **Teste**. Não precisa verificar o aplicativo nem publicar.
   - Em usuários de teste, adicione o e-mail da conta que vai autorizar o acesso.
   - Escopos:
     - `https://www.googleapis.com/auth/calendar`
     - se for usar Gmail: `https://www.googleapis.com/auth/gmail.readonly` e `https://www.googleapis.com/auth/gmail.send`
6. Em **APIs e serviços > Credenciais > Criar credenciais > ID do cliente OAuth**, escolha **Aplicativo para computador** (Desktop). Não use cliente Web.
7. Baixe o JSON. Salve fora do Git, por exemplo em `secrets/credentials.json`. Essa pasta já está no `.gitignore`.

O cliente do tipo computador aceita o retorno em `http://127.0.0.1`, que é o fluxo que `npm run auth` abre. Se o navegador mostrar `redirect_uri_mismatch`, confira se a credencial é mesmo de computador, não de aplicação Web.

## 3. Variáveis de ambiente

```bash
cp .env.example .env
```

| Variável | Função |
| --- | --- |
| `GEMINI_API_KEY` | Chave gratuita do AI Studio. Obrigatória para o chat. |
| `GEMINI_MODEL` | Modelo Flash. Padrão: `gemini-3.8-flash`. |
| `GEMINI_FALLBACK_MODEL` | Opcional. Modelo usado depois que o principal esgota as tentativas de 429 e 503. |
| `GOOGLE_CREDENTIALS_PATH` | Caminho do JSON do cliente OAuth. |
| `GOOGLE_TOKEN_PATH` | Onde `npm run auth` grava o token. Não commite. |
| `GOOGLE_CALENDAR_ID` | Calendário. Padrão: `primary`. |
| `CALENDAR_TIMEZONE` | Fuso IANA. Padrão: `America/Sao_Paulo`. |
| `EMAIL_MODE` | `dry-run` (padrão) ou `gmail`. |
| `MAX_TOOL_STEPS` | Rodadas de ferramenta por mensagem. Padrão: 8. |

Segredos ficam só no `.env`, no JSON de credenciais e no arquivo de token. Os três estão fora do Git.

## 4. Instalar e autorizar o calendário

```bash
npm install
npm run auth
```

`npm run auth` imprime um endereço. Abra no navegador, entre com o usuário de teste e aceite os escopos. O processo escuta `127.0.0.1` por alguns minutos e grava o token em `GOOGLE_TOKEN_PATH` (permissão `600`).

Com `EMAIL_MODE=dry-run`, o token pede apenas o Calendar. Se mais tarde você mudar para `gmail`, rode `npm run auth` de novo para incluir os escopos do Gmail. O código avisa se o token estiver incompleto.

## 5. Conversar com a secretária

Loop ReAct no próprio processo:

```bash
npm run dev
```

O mesmo chat, com as ferramentas no servidor MCP:

```bash
npm run dev:mcp
```

Para encerrar, escreva `sair` ou use Ctrl+C.

Também dá para mandar uma mensagem sem abrir o chat. O programa lê o stdin até o fim, responde e encerra. Se a chamada falhar, o erro sai no stderr e o processo termina com código de erro, em vez de ficar esperando outro prompt.

```bash
echo 'Que dia é hoje?' | npm run dev
```

Depois de `npm run build`:

```bash
npm start
npm run start:mcp
npm run start:mcp-server
```

`start:mcp-server` sobe só o servidor, para outro cliente MCP conectar por stdio. Exemplo de configuração (caminho absoluto no seu computador):

```json
{
  "mcpServers": {
    "secretaria": {
      "command": "node",
      "args": ["/caminho/do/repo/dist/mcp/server.js"],
      "cwd": "/caminho/do/repo",
      "env": {
        "GOOGLE_CREDENTIALS_PATH": "/caminho/do/repo/secrets/credentials.json",
        "GOOGLE_TOKEN_PATH": "/caminho/do/repo/secrets/token.json",
        "CALENDAR_TIMEZONE": "America/Sao_Paulo",
        "EMAIL_MODE": "dry-run"
      }
    }
  }
}
```

O servidor carrega o `.env` a partir do diretório de trabalho. O `env` acima cobre o caso em que o cliente MCP não herda o seu shell.

### Exemplos de mensagem

```text
Você: Que dia é hoje?
Você: Quais eventos eu tenho hoje?
Você: Marque amanhã às 15:00 uma reunião chamada Planejamento com ana@example.com, por 45 minutos.
Você: Remarque o Planejamento para 16:30 e avise ana@example.com.
Você: Quais e-mails eu tenho?
Você: Envie um e-mail para ana@example.com com o assunto Horário e a mensagem de que a reunião foi para as 16:30.
Você: Apague o evento de planejamento.
```

No primeiro pedido de agenda do dia, o esperado é ver no terminal algo como:

```text
Chamando a função getTodayDate
Chamando a função listEvents
```

Isso é o encadeamento do curso: a segunda chamada usa a data devolvida pela primeira.

Criar ou alterar evento exige título, data `AAAA-MM-DD` e horário `HH:mm` quando esses dados ainda não existem. O destinatário de e-mail precisa ser um endereço (`ana@example.com`), não apenas um apelido. Se faltar algo, a secretária pergunta.

## E-mail

O padrão é dry-run. `sendEmail` imprime Para, Assunto e Mensagem e responde ao modelo que **nada foi enviado**. A caixa do dry-run começa com duas mensagens de exemplo (como a caixa fictícia do curso) e acumula, na mesma sessão, o que foi "enviado". Não há SMTP e não há chamada ao Gmail.

Para enviar e listar de verdade:

1. Ative a Gmail API no projeto sem billing.
2. Inclua os escopos do Gmail na tela de consentimento.
3. No `.env`, defina `EMAIL_MODE=gmail`.
4. Rode `npm run auth` outra vez.
5. Suba o chat de novo.

## Scripts

| Script | O que faz |
| --- | --- |
| `npm run dev` | Chat ReAct com as ferramentas no processo. |
| `npm run dev:mcp` | Chat que sobe o servidor MCP e usa `mcpToTool`. |
| `npm run auth` | Login OAuth no navegador e gravação do token. |
| `npm run build` | Compila para `dist/`. |
| `npm start` | Chat ReAct compilado. |
| `npm run start:mcp` | Chat MCP compilado. |
| `npm run start:mcp-server` | Só o servidor stdio. |
| `npm test` | Testes do loop com modelo falso, sem rede. |
| `npm run lint` | ESLint. |

Os testes cobrem o loop (resposta direta, uma chamada, chamadas encadeadas, várias chamadas no mesmo turno, argumento inválido, ferramenta desconhecida e limite de passos), a validação Zod, o dry-run de e-mail e a subida do servidor MCP por stdio. Nenhum teste chama Gemini nem o Google.

## Limites e segurança

- A cota gratuita do Gemini é finita. Um 429 ou 503 dispara novas tentativas e, se você configurou, o modelo reserva. Se a cota acabar de vez, a chamada falha. Não cadastre cartão por causa disso.
- O token e o JSON do cliente OAuth autorizam sua agenda. Não os commite e não os cole no chat.
- `createEvent` e `updateEvent` não mandam convite do Calendar. O aviso a convidados é uma ação separada, e no dry-run ela só aparece no terminal.
- O aplicativo OAuth fica em modo de teste, restrito aos usuários que você cadastrou.
- O servidor MCP é local (stdio). Ele não abre porta HTTP.
