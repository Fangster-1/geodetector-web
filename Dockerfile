FROM rocker/r-ver:4.5.0

RUN apt-get update && apt-get install -y --no-install-recommends \
    libcurl4-openssl-dev libssl-dev libxml2-dev \
    && rm -rf /var/lib/apt/lists/*

RUN R -e "install.packages(c('plumber','GD','readxl','jsonlite','car','callr'), repos='https://cloud.r-project.org')"

COPY . /app
WORKDIR /app

ENV HOST=0.0.0.0
ENV PORT=8765
EXPOSE 8765

CMD ["Rscript", "run_app.R"]
