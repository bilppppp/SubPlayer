"""ASR micro-service — FastAPI + FunASR."""

from __future__ import annotations

import logging
import os
import tempfile

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from .services.asr_engine import ASREngine, DEVICE

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="FunASR Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

engine = ASREngine()


@app.on_event("startup")
async def startup() -> None:
    logger.info("Pre-loading multilingual model …")
    engine.load("multilingual")


@app.get("/health")
async def health():
    return {"status": "ok", "models_loaded": engine.is_ready(), "device": DEVICE}


@app.post("/asr/offline/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    language: str = Form("auto"),
    model: str = Form("multilingual"),
):
    suffix = os.path.splitext(file.filename or ".wav")[1]
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        result = engine.transcribe(tmp_path, language=language, model_type=model)
        return result
    finally:
        os.unlink(tmp_path)
