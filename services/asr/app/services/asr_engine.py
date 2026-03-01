"""FunASR engine wrapper — supports SenseVoiceSmall (multilingual) and Paraformer-zh (offline).

Two-stage pipeline for SenseVoiceSmall:
  1. FSMN-VAD splits audio into speech segments with timestamps.
  2. SenseVoiceSmall transcribes each segment individually.

This guarantees every segment has accurate start/end timestamps from VAD.
"""

from __future__ import annotations

import logging
import os
from typing import Any

import numpy as np
import soundfile as sf
from funasr import AutoModel
from funasr.utils.postprocess_utils import rich_transcription_postprocess

logger = logging.getLogger(__name__)


def _detect_device() -> str:
    # Allow explicit override for deployment scenarios.
    forced = os.getenv("ASR_DEVICE", "").strip().lower()
    if forced in {"cpu", "mps", "cuda"}:
        return forced

    # Auto-detect best available backend.
    try:
        import torch  # type: ignore
        if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            return "mps"
        if torch.cuda.is_available():
            return "cuda"
    except Exception:
        pass
    return "cpu"


DEVICE = _detect_device()

# ── Model configs ────────────────────────────────────────────────────
# NOTE: VAD is loaded separately so we can extract timestamps.
ASR_MODELS = {
    "multilingual": {
        "model": "iic/SenseVoiceSmall",
        "device": DEVICE,
    },
    "offline": {
        "model": "iic/speech_seaco_paraformer_large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
        "punc_model": "iic/punc_ct-transformer_cn-en-common-vocab471067-large",
        "device": DEVICE,
    },
}

VAD_CONFIG = {
    "model": "fsmn-vad",
    "device": DEVICE,
}

# Maximum merged segment length in milliseconds (15 s)
MAX_MERGE_MS = 15_000
# Gap threshold: segments closer than this are merged together (500 ms)
MERGE_GAP_MS = 500


def _merge_vad_segments(
    vad_segs: list[list[int]],
    max_ms: int = MAX_MERGE_MS,
    gap_ms: int = MERGE_GAP_MS,
) -> list[tuple[int, int]]:
    """Merge adjacent VAD segments so each group ≤ max_ms."""
    if not vad_segs:
        return []

    merged: list[tuple[int, int]] = []
    cur_start, cur_end = vad_segs[0]

    for seg in vad_segs[1:]:
        seg_start, seg_end = seg
        gap = seg_start - cur_end
        new_len = seg_end - cur_start

        if gap <= gap_ms and new_len <= max_ms:
            # Merge into current group
            cur_end = seg_end
        else:
            merged.append((cur_start, cur_end))
            cur_start, cur_end = seg_start, seg_end

    merged.append((cur_start, cur_end))
    return merged


class ASREngine:
    """Lazy-loaded singleton wrapping FunASR models."""

    def __init__(self) -> None:
        self._asr_models: dict[str, Any] = {}
        self._vad_model: Any = None

    # ── lifecycle ─────────────────────────────────────────────────────
    def load(self, model_type: str = "multilingual") -> None:
        # Load VAD model (once)
        if self._vad_model is None:
            logger.info("Loading VAD model …")
            self._vad_model = AutoModel(
                **VAD_CONFIG,
                disable_update=True,
                log_level="ERROR",
            )
            logger.info("VAD model ready.")

        # Load ASR model (without VAD — we run VAD separately)
        if model_type not in self._asr_models:
            cfg = ASR_MODELS[model_type]
            logger.info("Loading ASR model %s …", model_type)
            self._asr_models[model_type] = AutoModel(
                **cfg,
                disable_update=True,
                log_level="ERROR",
            )
            logger.info("ASR model %s ready.", model_type)

    def is_ready(self) -> bool:
        return self._vad_model is not None and len(self._asr_models) > 0

    # ── transcribe ────────────────────────────────────────────────────
    def transcribe(
        self,
        audio_path: str,
        *,
        language: str = "auto",
        model_type: str = "multilingual",
    ) -> dict:
        self.load(model_type)

        # ── Step 1: Run VAD to get speech segment timestamps ──────────
        vad_res = self._vad_model.generate(input=audio_path, cache={})
        vad_segs: list[list[int]] = []
        if vad_res and len(vad_res) > 0:
            vad_segs = vad_res[0].get("value", [])

        if not vad_segs:
            logger.warning("VAD returned no segments for %s", audio_path)
            return {
                "ok": True,
                "language": language,
                "full_text": "",
                "segments": [],
            }

        logger.info("VAD found %d raw segments, merging …", len(vad_segs))
        merged = _merge_vad_segments(vad_segs, MAX_MERGE_MS, MERGE_GAP_MS)
        logger.info("Merged into %d segments (max %.1fs)", len(merged), MAX_MERGE_MS / 1000)

        # ── Step 2: Load audio into numpy array ───────────────────────
        audio_data, sr = sf.read(audio_path, dtype="float32")
        if audio_data.ndim > 1:
            audio_data = audio_data[:, 0]  # mono

        # ── Step 3: Transcribe each VAD segment ──────────────────────
        asr_model = self._asr_models[model_type]
        segments: list[dict] = []
        full_text_parts: list[str] = []
        detected_langs: dict[str, int] = {}  # track language tags

        for start_ms, end_ms in merged:
            start_sample = int(start_ms / 1000.0 * sr)
            end_sample = int(end_ms / 1000.0 * sr)
            chunk = audio_data[start_sample:end_sample]

            if len(chunk) < int(0.1 * sr):  # skip < 100ms
                continue

            generate_kwargs: dict[str, Any] = {
                "input": chunk,
                "cache": {},
                "use_itn": True,
            }
            if model_type == "multilingual":
                generate_kwargs["language"] = language

            try:
                res = asr_model.generate(**generate_kwargs)
            except Exception as e:
                logger.warning("ASR failed for segment [%d-%d ms]: %s", start_ms, end_ms, e)
                continue

            for item in res or []:
                raw_text: str = item.get("text", "")

                # ── Extract language tag from SenseVoiceSmall output ──
                # Raw text looks like: <|en|><|EMO_UNKNOWN|><|Speech|><|withitn|>Hello...
                import re
                lang_match = re.search(r"<\|(\w{2})\|>", raw_text)
                if lang_match:
                    lang_code = lang_match.group(1)
                    detected_langs[lang_code] = detected_langs.get(lang_code, 0) + 1

                text = (
                    rich_transcription_postprocess(raw_text)
                    if model_type == "multilingual"
                    else raw_text
                )
                if not text.strip():
                    continue

                segments.append({
                    "start": round(start_ms / 1000.0, 3),
                    "end": round(end_ms / 1000.0, 3),
                    "text": text.strip(),
                })
                full_text_parts.append(text.strip())

        # ── Determine detected language (majority vote) ───────────────
        detected_language = language
        if detected_langs:
            detected_language = max(detected_langs, key=detected_langs.get)  # type: ignore
            logger.info("Language detection: %s", detected_langs)

        logger.info(
            "Transcribed %d segments (%.1fs total audio), detected lang: %s",
            len(segments),
            sum(s["end"] - s["start"] for s in segments),
            detected_language,
        )

        return {
            "ok": True,
            "language": detected_language,
            "full_text": " ".join(full_text_parts),
            "segments": segments,
        }
