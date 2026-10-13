# Decisões de arquitetura do Nexo Voice

## MVP
- React/TypeScript: interface web compartilhada pelo navegador e Electron.
- Express: API JSON para comunidades, configuração e tokenização LiveKit.
- Socket.IO: chat de texto, presença simples e eventos de comunidades.
- LiveKit: roteamento de mídia WebRTC, publicação/assinatura de áudio e compartilhamento de tela.
- JSON local: persistência inicial sem configurar um banco separado.
- Electron: aplicativo Windows, renderer isolado, sem Node integration.

## Por que não transmitir áudio pelo Socket.IO?
Socket.IO é apropriado para eventos e mensagens, mas voz e compartilhamento de tela exigem os mecanismos de mídia de WebRTC (negociação, codecs, transporte e traversia de NAT). LiveKit fornece esse componente e mantém chaves administrativas no servidor.

## Caminho de produção
Trocar persistência JSON por PostgreSQL; implementar contas e sessões, autorização por comunidade/canal, moderação e limites anti-abuso; mover a configuração e logs para secret manager; fazer deploy com HTTPS e um LiveKit Cloud ou self-hosted corretamente configurado com TURN/TLS; instrumentar métricas e backups.
