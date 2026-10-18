# Cadastro por email (Supabase)

O codigo agora envia `emailRedirectTo` com o endereco do site, mostra "check your email" depois de registrar,
trata link expirado/ja usado e tem o botao "Resend confirmation email".
Mas o link do email so volta pro seu site se o Supabase souber qual e o seu site:

1. Supabase > Authentication > URL Configuration
   - **Site URL**: o endereco onde o app roda (ex: https://seu-app.vercel.app). Se estiver `http://localhost:3000`, o link do email abre localhost e "nao entra".
   - **Redirect URLs**: adicione `https://seu-app.vercel.app/**` e `http://localhost:3000/**`
2. Supabase > Authentication > Providers > Email
   - Para testar rapido: desligue **Confirm email** (o cadastro ja entra direto).
   - Se deixar ligado: o envio padrao do Supabase tem limite baixo de emails por hora. Para uso real, configure um SMTP proprio em Authentication > SMTP Settings.
3. Hotmail/Outlook e alguns antivirus "abrem" o link antes de voce, e o link de confirmacao so vale uma vez
   (erro `otp_expired`). Se acontecer, entre normalmente com email e senha, a conta ja foi confirmada.

Nao precisa rodar SQL novo nesta versao.
