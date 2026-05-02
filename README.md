# acesso-materiais-II

Página de acesso para publicar PDFs e permitir que clientes abram os materiais direto no navegador.

## Rodar localmente

```bash
node server.js
```

Abra `http://127.0.0.1:8000`.

## Códigos padrão

- Cliente: `cliente2026`
- Administrador: `admin2026`

Você pode trocar os códigos por variáveis de ambiente:

```bash
CLIENT_ACCESS_CODE="novo-codigo" ADMIN_ACCESS_CODE="novo-admin" node server.js
```

## Como anexar PDFs

1. Entre com o código de administrador.
2. Preencha título, categoria e descrição.
3. Selecione o PDF e clique em `Publicar PDF`.

Os PDFs ficam na pasta `materiais`, e os dados ficam em `data/materials.json`.

## Como criar códigos individuais

1. Entre com o código de administrador.
2. Na seção `Código individual`, informe o nome do cliente.
3. Opcionalmente, digite um código personalizado com letras, números e hífen.
4. Clique em `Gerar código`.

Os códigos ficam em `data/client-codes.json`. Cada código pode ser copiado, desativado ou reativado no painel administrativo. O código geral de cliente continua funcionando para manter compatibilidade.

## Usar no Railway com Volume

Este projeto já está preparado para Railway. Quando um Volume estiver conectado ao serviço, o servidor usa automaticamente `RAILWAY_VOLUME_MOUNT_PATH` para salvar:

- PDFs em `<volume>/materiais`
- dados dos materiais e códigos em `<volume>/data`

Configuração recomendada no Railway:

1. Crie o projeto no Railway a partir do repositório GitHub.
2. No serviço, configure o Start Command como `node server.js` se o Railway não detectar automaticamente.
3. Adicione as variáveis:

```text
ADMIN_ACCESS_CODE=seu-codigo-admin
CLIENT_ACCESS_CODE=seu-codigo-cliente-geral
SESSION_SECRET=uma-frase-grande-e-secreta
```

4. Crie um Volume e conecte ao serviço.
5. Monte o Volume em `/var/data`.

Com esse mount path, você pode deixar o app usar o automático do Railway, ou definir explicitamente:

```text
DATA_DIR=/var/data/data
MATERIALS_DIR=/var/data/materiais
```

Não suba PDFs reais nem códigos de clientes para o GitHub. Esses dados devem ficar no Volume do Railway.

## Observação

A interface não oferece botão de download e o servidor entrega os PDFs como `inline`. Ainda assim, nenhum site consegue impedir totalmente que uma pessoa salve, imprima ou capture um arquivo que ela consegue visualizar. Para proteção forte, use uma plataforma com controle de acesso e DRM.
