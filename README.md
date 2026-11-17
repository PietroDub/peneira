# Peneira

A Peneira lê o chat público de uma live do YouTube e fica só com as mensagens que você marcou.

Ela não entra na sua conta, não envia mensagem e não modera. O servidor pede a mesma página de chat que o navegador abre e acompanha as mensagens novas.

## Como usar

1. Rode o app.
2. Cole o link da live (`youtube.com/watch`, `youtube.com/live` ou `youtu.be`) ou o código de 11 caracteres.
3. Escreva os termos, um por linha.
4. Escolha o modo: qualquer palavra, todas as palavras, ou a frase inteira.
5. Se quiser, limite por autor, tipo de mensagem ou valor mínimo de Super Chat.

A lista da direita mostra o que bateu. Copiar junta essas linhas. Baixar JSON guarda autor, texto, horário e valor.

O filtro fica salvo neste navegador.

## Rodar localmente

```bash
npm install
npm run dev
```

Abra [http://localhost:3847](http://localhost:3847).

```bash
npm test
npm run lint
```

A live precisa estar no ar, com o chat aberto. Se o chat acabou, a leitura para e o que já chegou continua na lista até você limpar.
