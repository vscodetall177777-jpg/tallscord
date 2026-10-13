# Nexo Voice — MVP de comunicação

Protótipo web + desktop Windows inspirado no fluxo de comunidades e canais do Discord, com marca própria. O foco deste MVP é validar comunicação por texto e a arquitetura de voz/compartilhamento de tela.

## O que está implementado

- Comunidade pública inicial (`Nexo Lounge`) e criação de comunidades públicas.
- Canais de texto e de voz criados por padrão em cada comunidade.
- Mensagens em tempo real via Socket.IO e histórico local persistido em `server/data.json`.
- Lista básica de presença em tempo real (por nome declarado pelo usuário).
- Emissão de token de sala LiveKit no backend; as chaves secretas não vão para o navegador.
- Sala de voz WebRTC com controles de microfone e compartilhamento de tela, usando componentes oficiais do LiveKit.
- Frontend React + TypeScript + Vite.
- Shell desktop Windows via Electron, com `contextIsolation: true`, `nodeIntegration: false` e `sandbox: true`.
- Servidor API pode servir a pasta `dist/` após o build, permitindo hospedar a web app e API no mesmo domínio.
- Limitação de taxa básica para API e mensagens de texto.

## Arquitetura

```text
Navegador / App Windows (Electron)
      │ HTTPS + Socket.IO
      ▼
Node.js + Express ───── JSON local (MVP: comunidades e mensagens)
      │ gera tokens curtos no servidor
      ▼
LiveKit (Cloud ou self-hosted) ◄──── WebRTC ────► outros participantes
      ├─ áudio
      └─ compartilhamento de tela
```

**Voz/tela não passam pelo Socket.IO.** O Socket.IO é usado para presença e mensagens; mídia em tempo real usa LiveKit/WebRTC, projetado para esse tipo de conexão.

## Requisitos

- Node.js 20 ou superior recomendado.
- npm.
- Conta/projeto LiveKit Cloud ou servidor LiveKit próprio para voz e compartilhamento de tela.
- Windows para gerar o instalador `.exe`.

## Rodar em desenvolvimento

1. Extraia o ZIP e abra um terminal nesta pasta.
2. Instale dependências:

   ```bash
   npm install
   ```

3. Copie `.env.example` para `.env` e preencha as credenciais LiveKit:

   ```env
   PORT=3001
   FRONTEND_URL=http://localhost:5173
   LIVEKIT_URL=wss://SEU-PROJETO.livekit.cloud
   LIVEKIT_API_KEY= sua-chave
   LIVEKIT_API_SECRET= seu-segredo
   ```

   Remova o espaço após `=` ao preencher a chave e o segredo.

4. Inicie frontend e backend:

   ```bash
   npm run dev
   ```

5. Abra `http://localhost:5173`.

Sem as três variáveis `LIVEKIT_*`, os canais de texto funcionam e a interface informa que voz/tela ainda não está configurada.

## Configurar LiveKit

### Opção recomendada para o primeiro teste

Crie um projeto no [LiveKit Cloud](https://cloud.livekit.io/), copie a URL WebSocket pública e as credenciais API para o `.env` do backend. Não coloque `LIVEKIT_API_SECRET` em variáveis `VITE_*`, no frontend, nem em código enviado ao navegador.

### Teste local com Docker (mesmo computador/rede local)

O diretório contém `livekit.yaml.example` e `docker-compose.livekit.example.yml`, com credenciais de desenvolvimento. Copie `livekit.yaml.example` para `livekit.yaml`, inicie com `docker compose -f docker-compose.livekit.example.yml up -d` e use localmente `LIVEKIT_URL=ws://localhost:7880`, `LIVEKIT_API_KEY=devkey` e `LIVEKIT_API_SECRET=secret`. **Não exponha essas credenciais nem essa configuração à internet.** O mapeamento de portas é reduzido para teste com poucos participantes.

### Hospedar por conta própria

O LiveKit Server é open source e pode ser hospedado em sua infraestrutura. Para que amigos em redes diferentes consigam conectar, o servidor precisa de endereço acessível, TLS/HTTPS/WSS, DNS e portas WebRTC configuradas corretamente. Consulte a [documentação oficial de self-hosting](https://docs.livekit.io/transport/self-hosting/) e a [lista oficial de portas e firewall](https://docs.livekit.io/transport/self-hosting/ports-firewall/). Um servidor local não fica automaticamente acessível pela internet.

## Publicar a aplicação web

Para um deploy simples no mesmo domínio:

1. Defina `FRONTEND_URL` para a origem real da aplicação.
2. Execute `npm run build`.
3. Inicie `npm start` no servidor. Se a pasta `dist/` existir, o Express servirá o frontend e as rotas `/api/*` no mesmo host.
4. Configure `LIVEKIT_URL` para a URL pública WSS do serviço LiveKit.

Se API e frontend estiverem em domínios diferentes, compile o frontend com `VITE_API_URL=https://api.seudominio.com` e ajuste `FRONTEND_URL` no backend.

### Deploy no Render

O arquivo `render.yaml` configura um serviço web Node.js que compila o frontend e inicia a API, servindo ambos no mesmo domínio:

1. Envie este repositório ao GitHub.
2. No Render, escolha **New + → Blueprint** e conecte o repositório. O Render lerá `render.yaml`.
3. Cadastre `LIVEKIT_URL`, `LIVEKIT_API_KEY` e `LIVEKIT_API_SECRET` nas variáveis de ambiente do serviço. Use a URL e as credenciais do mesmo projeto LiveKit. Não as adicione ao repositório.
4. Aguarde o deploy e abra a URL HTTPS fornecida pelo Render.

O backend reconhece automaticamente a URL pública do Render para CORS. O serviço usa o armazenamento JSON local do MVP; em planos sem disco persistente, os dados podem ser perdidos em novos deploys ou reinicializações. Configure um disco persistente e `DATA_FILE` antes de depender da retenção dos dados. Este MVP ainda não implementa autenticação de usuários e não deve ser exposto publicamente sem considerar as limitações de segurança abaixo.

## App Windows

Em desenvolvimento, rode `npm run desktop:dev`.

Para produzir um instalador Windows que aponta para uma API já hospedada, execute no PowerShell, substituindo o endereço pelo backend real:

```powershell
$env:VITE_API_URL="https://api.seudominio.com"
npm run dist:win
```

O instalador ficará na pasta `release/`. **O backend e o serviço LiveKit precisam permanecer online** para os amigos se comunicarem. Empacotar o cliente não hospeda automaticamente os serviços.

## Estado de segurança: protótipo, não produção pública

A descoberta de comunidades públicas está habilitada, mas esta versão ainda usa um nome de exibição local, não contas autenticadas. Por isso:

- usuários podem se passar por outras pessoas;
- não há sistema de convites privados, banimento, moderação ou denúncias;
- a lista de presença representa nomes declarados por sockets, não identidades verificadas;
- o armazenamento JSON é apropriado só para um pequeno MVP de uma instância, não para muitas conexões concorrentes;
- limite de taxa básico não substitui políticas robustas anti-abuso;
- antes de abrir para o público, implemente contas/sessões, permissões por comunidade/canal, moderação, persistência transacional (PostgreSQL), logs operacionais, limites de upload e backups.

Tokens LiveKit são emitidos pelo backend com validade limitada. Ainda assim, a rota deve ficar atrás de autenticação e autorização antes de publicar o serviço amplamente.

## Limitações conhecidas do MVP

- Não inclui DM, chamadas individuais, câmera, gravação, busca de histórico, upload de anexos, notificações push, roles avançados ou sincronização de perfil.
- A criação de comunidade gera canais padrão; edição/exclusão de canais fica para próxima etapa.
- A configuração de voz requer credenciais válidas e conectividade WebRTC externa. Não declare a voz funcionando até testar com dois dispositivos em redes diferentes.
- Os dados das comunidades/mensagens ficam em `server/data.json`; faça backup antes de atualizar o formato.

## Próxima etapa recomendada

1. Contas e autenticação (sessões/JWT com renovação segura).
2. Permissões por comunidade e canal, convites, papéis, bloqueio e denúncias.
3. PostgreSQL + migrações.
4. Presence e estados de voz obtidos de forma consistente do servidor de mídia.
5. TURN/TLS e testes reais com conexões móveis, Wi-Fi e redes restritivas.
6. CI, logging, backups e publicação do instalador assinado.
