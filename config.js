/* ===================================================================
   CONFIGURAÇÃO DO SUPABASE
   -------------------------------------------------------------------
   1. Crie uma conta gratuita em https://supabase.com
   2. Crie um novo projeto (fica pronto em ~2 minutos)
   3. No menu do projeto, vá em "SQL Editor" e rode o script que está
      no arquivo SUPABASE-SETUP.sql (junto com estes arquivos)
   4. Vá em "Project Settings" > "API" e copie:
        - "Project URL"        -> cole em SUPABASE_CONFIG.url
        - "anon public" key    -> cole em SUPABASE_CONFIG.anonKey
   5. Salve este arquivo e recarregue o index.html
   -------------------------------------------------------------------
   Sem preencher isso, o app continua funcionando 100% normalmente,
   só que salvando apenas no navegador local (sem sincronizar entre
   aparelhos), como antes.
=================================================================== */

window.SUPABASE_CONFIG = {
  url: 'https://dzafjtdohmhlwzieuquq.supabase.co',
  anonKey: 'sb_publishable_CaFT9HQAb5curX01RmGPvA_rwQDIL3S'
};
