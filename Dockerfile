FROM r-base:4.5.2

RUN R -e "install.packages(c('plumber','GD','readxl','jsonlite','car','callr'), repos='https://cloud.r-project.org')"

COPY . /app
WORKDIR /app

ENV HOST=0.0.0.0
ENV PORT=8765
EXPOSE 8765

CMD ["Rscript", "run_app.R"]
