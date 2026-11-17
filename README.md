# Peneira

A Peneira lê o chat público de uma live do YouTube e fica só com as mensagens que você marcou.

Ela não entra na sua conta, não envia mensagem e não modera. O servidor pede a mesma página de chat que o navegador abre e acompanha as mensagens novas.

## Abrir no Cursor

1. No Cursor, **File → Clone Repository** (ou Clone Repo na tela inicial).
2. Cole o repositório privado `pietro-vito/peneira` (Origin).
3. Abra a pasta clonada como o workspace.
4. No terminal integrado:

```bash
npm install
npm run dev
```

5. Abra [http://localhost:3847](http://localhost:3847).

O Cursor também pode subir o servidor com **Terminal → Run Task… → Servidor de desenvolvimento**.

## Como usar

1. Cole o link da live (`youtube.com/watch`, `youtube.com/live` ou `youtu.be`) ou o código de 11 caracteres.
2. Escreva os termos, um por linha.
3. Escolha o modo: qualquer palavra, todas as palavras, ou a frase inteira.
4. Se quiser, limite por autor, tipo de mensagem ou valor mínimo de Super Chat.

A lista da direita mostra o que bateu. Copiar junta essas linhas. Baixar JSON guarda autor, texto, horário e valor.

O filtro fica salvo neste navegador.

A live precisa estar no ar, com o chat aberto. Se o chat acabou, a leitura para e o que já chegou continua na lista até você limpar.

```bash
npm test
npm run lint
```
