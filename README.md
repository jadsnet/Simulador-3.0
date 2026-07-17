# Simulador Academy V7.2 — Recuperação Segura

Esta versão mantém o mesmo banco IndexedDB `simulador-v42` e não apaga os dados existentes.

## Correções
- seção **Recuperação de progresso** na página inicial;
- restauração de progresso pelo `bankId`;
- tentativa segura de associar progresso órfão a um banco compatível;
- botão permanente **Guia de uso**;
- definições ausentes do tutorial corrigidas;
- Service Worker atualizado para buscar primeiro os arquivos novos;
- nenhuma chamada a `indexedDB.deleteDatabase()`.

## Atualização
Substitua os arquivos da raiz do GitHub Pages pelos arquivos deste pacote.
Não exclua os dados do site no navegador.
