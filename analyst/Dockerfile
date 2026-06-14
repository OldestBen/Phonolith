FROM python:3.12-slim

RUN apt-get update && apt-get install -y \
    libchromaprint-tools \
    ffmpeg \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

VOLUME /music
VOLUME /waveforms

ENV LIBRARY_PATH=/music
ENV WAVEFORM_PATH=/waveforms

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
