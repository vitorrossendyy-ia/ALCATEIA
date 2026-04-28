# Alcateia — Sistema de Pagamentos

## Como subir no Railway

1. Crie uma conta em railway.app
2. Clique em "New Project" → "Deploy from GitHub"
3. Faça upload desta pasta ou conecte ao GitHub
4. Adicione a variável de ambiente:
   - `MP_ACCESS_TOKEN` = seu Access Token do Mercado Pago
5. O Railway detecta automaticamente o Node.js e sobe o servidor

## Variáveis de ambiente

| Variável | Descrição |
|---|---|
| `MP_ACCESS_TOKEN` | Access Token do Mercado Pago (teste ou produção) |
| `PORT` | Porta do servidor (Railway define automaticamente) |

## Estrutura

```
alcateia/
├── server.js        # Backend Node.js + Express
├── package.json     # Dependências
└── public/
    └── index.html   # Frontend completo
```
