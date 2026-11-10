VICECLIPS — PUBLICAÇÃO NO RENDER

O que foi preparado:
- Dockerfile com Node.js 20 e FFmpeg/FFprobe instalados.
- Configuração render.yaml para criar o serviço e um disco persistente.
- Servidor configurado para guardar vídeos, clipes e banco de dados em DATA_DIR.
- Interface original preservada.

COMO PUBLICAR PELO CELULAR:
1. Extraia este ZIP.
2. Crie uma conta em https://github.com/ e um repositório novo chamado viceclips.
3. Envie TODOS os arquivos e pastas que estão dentro desta pasta para a raiz do repositório.
   Importante: Dockerfile, render.yaml, package.json, server.js e a pasta public
   devem ficar juntos na raiz.
4. Entre em https://render.com/ e conecte sua conta GitHub.
5. No Render, escolha New > Blueprint e selecione o repositório viceclips.
6. O Render vai ler o render.yaml e preparar o serviço.
7. Se você tiver uma chave da API da OpenAI, informe-a como OPENAI_API_KEY
   nas variáveis de ambiente do serviço. Sem ela, o sistema usa análise por áudio
   e não gera legendas automáticas por IA.
8. Aguarde o deploy e abra o endereço .onrender.com criado pelo Render.

IMPORTANTE:
- A configuração usa plano pago Starter e disco persistente de 10 GB.
- Vídeos enviados e clipes ocupam esse espaço. 10 GB pode não ser suficiente
  para muitos vídeos; aumente o disco conforme a necessidade.
- Não coloque sua chave OPENAI_API_KEY dentro do código ou publique-a no GitHub.
- O Netlify Drop não executa este servidor; use o endereço gerado pelo Render.
- Esta preparação não significa que o site já está publicado. Ainda é necessário
  enviar os arquivos ao GitHub e concluir a implantação no Render.
