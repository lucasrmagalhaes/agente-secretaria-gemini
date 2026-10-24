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

O mesmo servidor também sobe por HTTP Streamable (`npm run mcp:http`), no caminho `/mcp`. É esse endereço que o n8n usa no nó MCP Client Tool. O stdio continua disponível para o chat local.

## Ferramentas

- `getTodayDate`: data, hora e dia da semana no fuso `CALENDAR_TIMEZONE`.
- `listEvents`: eventos de um dia (`date`) ou de um intervalo (`timeMin` e `timeMax`, os dois inclusive, `AAAA-MM-DD`). "Próximos 7 dias" a partir de 2026-05-01 é uma chamada só, com `timeMin` 2026-05-01 e `timeMax` 2026-05-07. O intervalo máximo é de 31 dias.
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
| `MAX_TOOL_STEPS` | Rodadas de ferramenta por mensagem. Padrão: 8. Um intervalo de agenda gasta uma chamada, não uma por dia. |
| `MCP_HOST` | Onde o HTTP escuta. Padrão: `127.0.0.1`. `0.0.0.0` exige `MCP_AUTH_TOKEN`. |
| `MCP_PORT` | Porta do HTTP. Padrão: `3333`. |
| `MCP_PATH` | Caminho do HTTP. Padrão: `/mcp`. |
| `MCP_AUTH_TOKEN` | Bearer do HTTP. Obrigatório fora de localhost. Se estiver definido, vale também no localhost. |

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
npm run start:mcp-http
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
Você: Que dia é hoje e quais meus eventos nos próximos 7 dias?
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

Para a semana, a pergunta "que dia é hoje e quais meus eventos nos próximos 7 dias?" segue o mesmo par: um `getTodayDate` e um único `listEvents` com `timeMin` e `timeMax`. Não deve aparecer uma chamada de `listEvents` por dia.

Criar ou alterar evento exige título, data `AAAA-MM-DD` e horário `HH:mm` quando esses dados ainda não existem. O destinatário de e-mail precisa ser um endereço (`ana@example.com`), não apenas um apelido. Se faltar algo, a secretária pergunta.

## n8n pelo MCP Client Tool

O chat do n8n fala com este processo pelo transporte HTTP Streamable. O stdio não serve para o n8n, porque o n8n não é o processo pai. O nó precisa ser o **MCP Client Tool** na versão 1.2 ou mais nova (o padrão atual é 1.4), com o transporte **HTTP Streamable**. O modo SSE antigo (versão 1 do nó, campo SSE Endpoint) não é o deste servidor.

### Subir o servidor

No `.env`, escolha um token longo e deixe o restante como no exemplo:

```bash
MCP_HOST=127.0.0.1
MCP_PORT=3333
MCP_PATH=/mcp
MCP_AUTH_TOKEN=um-token-longo
```

No localhost o token é opcional. O fluxo abaixo usa Bearer, então defina o token e use a mesma string na credencial do n8n. Se `MCP_HOST` for `0.0.0.0` ou outro endereço que não seja localhost, o processo recusa subir sem `MCP_AUTH_TOKEN`.

Com o token e o calendário já autorizados (`npm run auth`):

```bash
npm run mcp:http
```

O stderr mostra `MCP HTTP ouvindo em 127.0.0.1:3333/mcp`. `GET http://127.0.0.1:3333/health` responde `{"ok":true}` e não pede o token. O caminho `/mcp` pede `Authorization: Bearer`.

### Ligar o AI Agent

1. No n8n, importe `examples/n8n-agente-mcp-secretaria.json` (menu do workflow, Import from File).
2. Crie uma credencial **Google Gemini** (tipo `googlePalmApi`) com a chave gratuita do AI Studio. O host padrão da credencial pode ficar o da API Gemini.
3. Crie uma credencial **Bearer Auth** (`httpBearerAuth`). O token é o valor de `MCP_AUTH_TOKEN`, sem a palavra Bearer.
4. Abra o nó **Google Gemini Chat Model** e selecione a credencial Gemini. O modelo do exemplo é `models/gemini-3.8-flash`.
5. Abra o nó **MCP Secretaria** e selecione a credencial Bearer. Confira:
   - Endpoint: `http://127.0.0.1:3333/mcp`
   - Server Transport: HTTP Streamable
   - Authentication: Bearer Auth
   - Tools to Include: All
6. Os ids de credencial no JSON são marcadores. Depois de importar, o n8n pede para escolher as credenciais reais. Faça isso nos dois nós.
7. Abra o chat do nó **When chat message received** e pergunte pelos próximos 7 dias. O agente deve chamar `getTodayDate` uma vez e `listEvents` uma vez, com `timeMin` e `timeMax`.

O nó do agente já traz o mesmo recado do prompt local: um intervalo é uma chamada só. As descrições das ferramentas vêm do servidor, iguais às do `npm run dev`.

Se o n8n e este processo estão no mesmo computador, fora do Docker, a URL é `http://127.0.0.1:3333/mcp`. Se os dois estão em containers na mesma rede Docker, troque para `http://secretaria-mcp:3333/mcp`. `127.0.0.1` dentro do container do n8n é o próprio n8n, não este servidor.

### Docker na VM ARM

A imagem usa `node:22-bookworm-slim`, que existe para `linux/arm64`. Na VM Oracle (aarch64), o build feito na própria máquina já sai em arm64. Não fixe `linux/amd64`.

```bash
docker compose up --build -d
```

O Compose publica a porta 3333, monta `./secrets` em `/app/secrets` (somente leitura) e força `MCP_HOST=0.0.0.0`. Por isso `MCP_AUTH_TOKEN` no `.env` é obrigatório: sem ele o processo encerra. O `.env` e a pasta `secrets/` não entram na imagem.

O n8n que já roda na mesma VM alcança o servidor assim:

- n8n no host: `http://127.0.0.1:3333/mcp`
- n8n em outro container, sem rede compartilhada: o IP da ponte Docker no host (no Linux, muitas vezes `172.17.0.1:3333`) ou o IP da VM
- n8n em outro Compose: ligue os dois na mesma rede e use `http://secretaria-mcp:3333/mcp`. O `docker-compose.yml` deixa um exemplo comentado da rede `n8n_default`

O fluxo no-code do curso continua em [n8n-agente-agenda-mcp](https://github.com/lucasrmagalhaes/n8n-agente-agenda-mcp). O JSON desta pasta é o atalho para apontar o AI Agent desse estilo de fluxo para este servidor.

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
| `npm run mcp:http` | Servidor MCP em HTTP Streamable, para o n8n. |
| `npm run start:mcp-http` | O mesmo HTTP, a partir do `dist/`. |
| `npm test` | Testes do loop com modelo falso, sem rede. |
| `npm run lint` | ESLint. |

Os testes cobrem o loop (resposta direta, uma chamada, chamadas encadeadas, várias chamadas no mesmo turno, argumento inválido, ferramenta desconhecida e limite de passos), a validação Zod, o intervalo de `listEvents`, o dry-run de e-mail, o servidor MCP por stdio e o HTTP com Bearer. Nenhum teste chama Gemini nem o Google.

## Limites e segurança

- A cota gratuita do Gemini é finita. Um 429 ou 503 dispara novas tentativas e, se você configurou, o modelo reserva. Se a cota acabar de vez, a chamada falha. Não cadastre cartão por causa disso.
- O token e o JSON do cliente OAuth autorizam sua agenda. Não os commite e não os cole no chat.
- `createEvent` e `updateEvent` não mandam convite do Calendar. O aviso a convidados é uma ação separada, e no dry-run ela só aparece no terminal.
- O aplicativo OAuth fica em modo de teste, restrito aos usuários que você cadastrou.
- O servidor stdio não abre porta. O HTTP só escuta em `127.0.0.1` se `MCP_HOST` não mudar. Fora do localhost, `MCP_AUTH_TOKEN` é obrigatório. `GET /health` não pede o token. O caminho `/mcp` pede, quando o token existe.
