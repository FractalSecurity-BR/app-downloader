# README

Para configurar o servidor de produção corretamente, siga as instruções abaixo:

1. Certifique-se de substituir o arquivo `index.html` por `iisstart.htm` no diretório raiz do servidor.
2. Reinicie o servidor para que as alterações entrem em vigor.

Para executar o aplicativo localmente, siga as etapas abaixo:

1. Abra o terminal.
2. Navegue até o diretório do projeto.
3. Certifique-se de ter um arquivo `.apk` (para Android) e um `.ipa` (para iOS) na raiz do diretório para iniciar o download.
4. Execute o seguinte comando para iniciar o servidor na porta 8080:

```bash
php -S localhost:8080
```

## Docker so funciona localmente, precisa de alguns ajustes!

## Rodar no Nginx

- Pasta para colocar o projeto: /var/www/app-downloader
- Codigo para copiar o arquivo.

```bash
sudo cp -r * /var/www/app-downloader
```