# Peneira

A Peneira lê o chat público de uma live do YouTube — no ar ou já encerrada, se o replay do chat estiver ligado — e fica só com as mensagens que você marcou.

Ela não entra na sua conta, não envia mensagem e não modera. O servidor pede a mesma página de chat que o navegador abre e acompanha as mensagens novas ou o replay gravado.

## Abrir no Cursor

No Cursor: **File → Clone Repository** e cole:

```text
https://github.com/PietroDub/peneira.git
```

Ou no terminal:

```bash
git clone https://github.com/PietroDub/peneira.git
cd peneira
npm install
npm run dev
```

Abra [http://localhost:3847](http://localhost:3847).

O Cursor também pode subir o servidor com **Terminal → Run Task… → Servidor de desenvolvimento**.

## Como usar

1. Cole o link da live (`youtube.com/watch`, `youtube.com/live` ou `youtu.be`) ou o código de 11 caracteres.
2. Escreva os termos, um por linha.
3. Escolha o modo: qualquer palavra, todas as palavras, ou a frase inteira.
4. Se quiser, limite por autor, tipo de mensagem ou valor mínimo de Super Chat.

A lista da direita mostra o que bateu. Copiar junta essas linhas. Baixar JSON guarda autor, texto, horário e valor.

O filtro fica salvo neste navegador.

Live no ar: o chat entra conforme chega. Live encerrada: ela lê o replay, se o canal deixou o replay ligado. Se o YouTube desligou o chat, a abertura avisa.

```bash
npm test
npm run lint
```
