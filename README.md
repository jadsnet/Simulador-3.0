# Simulador Academy V4.0 Cloud

Versão com login por e-mail e senha, IndexedDB offline e sincronização automática com Supabase.

## Instalação no GitHub Pages

Substitua os arquivos do repositório pelos arquivos deste pacote. Mantenha todos na raiz.

Depois:
1. Aguarde o GitHub Pages publicar.
2. Abra `https://jadsnet.github.io/Simulador-3.0/`.
3. Use `Ctrl + Shift + R`.
4. Crie a conta ou entre.
5. Importe novamente seu banco CSV/ZIP.
6. Em **Configurações**, use **Importar progresso antigo** para recuperar as 52 respostas do arquivo `backup-localstorage-simulador.json`.

## Segurança

A Publishable Key do Supabase pode existir no frontend. Não coloque senha do banco, Secret Key ou Service Role Key nos arquivos.

## Sincronização

- O progresso é salvo primeiro no IndexedDB.
- Em seguida é enviado ao Supabase.
- Se a internet falhar, o progresso local permanece disponível.
- O botão ↻ força uma sincronização.
