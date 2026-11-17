# Peneira

A Peneira lê o chat público de uma live do YouTube e fica só com as mensagens que você marcou.

Ela não entra na sua conta, não envia mensagem e não modera. O servidor pede a mesma página de chat que o navegador abre e acompanha as mensagens novas.

## Abrir no Cursor

O código está no Origin da Cursor, não no GitHub. O **File → Clone Repository** do Cursor procura o GitHub e não acha este repo.

No terminal da sua máquina:

```bash
curl -fsSL https://downloads.cursor.com/origin/install.sh | sh
origin auth login
git clone https://origin.cursor.com/pietro-vito/peneira.git
cd peneira
npm install
```

No Windows (PowerShell):

```powershell
irm https://downloads.cursor.com/origin/install.ps1 | iex
origin auth login
git clone https://origin.cursor.com/pietro-vito/peneira.git
cd peneira
npm install
```

Depois, no Cursor: **File → Open Folder** e escolha a pasta `peneira`.

```bash
npm run dev
```

Abra [http://localhost:3847](http://localhost:3847).

O Cursor também pode subir o servidor com **Terminal → Run Task… → Servidor de desenvolvimento**.

A URL HTTPS para copiar no botão **Code** de [pietro-vito/peneira](https://cursor.com/codebase/pietro-vito/peneira) é:

```text
https://origin.cursor.com/pietro-vito/peneira.git
```

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
