FROM php:7.4-cli

WORKDIR /var/www/app-downloader

RUN useradd -u 1000 -ms /bin/bash appuser

USER appuser

COPY . /var/www/app-downloader

EXPOSE 8080

CMD ["php", "-S", "0.0.0.0:8080"]
